#!/usr/bin/env python3
"""Local WuLab paper holdings. Indexing and retrieval use no model calls."""
import argparse,contextlib,csv,hashlib,json,os,re,sqlite3,sys,tempfile,time,urllib.parse,urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'packages'))
import pymupdf

DEFAULT_LIBRARY=Path(__file__).resolve().parents[2]/'library'

def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def save_json(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile('w',dir=path.parent,delete=False,encoding='utf-8') as f:
        json.dump(data,f,ensure_ascii=False,indent=2);f.write('\n');tmp=f.name
    os.replace(tmp,path)

def connect(library,write=False):
    path=Path(library)/'holdings.sqlite'
    if write:path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path if write else path.as_uri()+'?mode=ro',uri=not write)
    db.row_factory=sqlite3.Row
    if write:
        db.executescript('''CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY,sha256 TEXT UNIQUE,metadata TEXT);
        CREATE TABLE IF NOT EXISTS locations(path TEXT PRIMARY KEY,paper_id TEXT);
        CREATE TABLE IF NOT EXISTS pages(paper_id TEXT,page INTEGER,text TEXT,PRIMARY KEY(paper_id,page));
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(paper_id UNINDEXED,page UNINDEXED,title,text);
        ''')
    return db

def source_metadata(folder):
    result={}
    for path in folder.glob('Analysis/decoder_corpus_inventory*.csv'):
        with path.open(encoding='utf-8-sig',newline='') as f:
            for row in csv.DictReader(f):
                if row.get('sha256'):result[row['sha256']]=row
    return result

def record(db,ident):
    row=db.execute('SELECT metadata FROM papers WHERE id=? OR sha256=? OR json_extract(metadata,\'$.catalog_id\')=?',(ident,ident,ident)).fetchone()
    if not row:raise ValueError('Unknown paper ID: '+ident)
    value=json.loads(row[0]);value['paths']=[x[0] for x in db.execute('SELECT path FROM locations WHERE paper_id=? ORDER BY path',(value['id'],))]
    return value

def import_folder(library,folder):
    library=Path(library).resolve();folder=Path(folder).resolve()
    if not folder.is_dir():raise ValueError('Choose an existing folder.')
    # External collections are copied into holdings; registered paths stay in the library.
    inside=folder.is_relative_to(library)
    metadata=source_metadata(folder);stats={'files':0,'new_papers':0,'existing_papers':0,'errors':[]}
    with contextlib.closing(connect(library,True)) as db,db:
        files=sorted(p for p in folder.rglob('*') if p.is_file() and p.suffix.lower()=='.pdf')
        for path in files:
            stats['files']+=1
            db.execute('SAVEPOINT one_file');counts=(stats['new_papers'],stats['existing_papers'])
            try:
                sha=digest(path);ident='pdf-'+sha[:24]
                old=db.execute('SELECT id FROM papers WHERE sha256=?',(sha,)).fetchone()
                with pymupdf.open(path) as doc:
                    if not doc.is_pdf or doc.needs_pass or not doc.page_count:raise ValueError('Not a readable, unencrypted PDF.')
                    if old:
                        ident=old[0];stats['existing_papers']+=1
                    else:
                        prior=metadata.get(sha,{})
                        title=prior.get('paper_title') or (doc.metadata or {}).get('title') or path.stem.replace('_',' ')
                        first=doc[0].get_text()
                        ids=sorted(set(re.findall(r'arXiv\s*:\s*(\d{4}\.\d{4,5}v\d+)\b',first,re.I)))
                        arxiv=ids[0] if len(ids)==1 else None
                        data={'id':ident,'sha256':sha,'title':title[:500],'bytes':path.stat().st_size,'pages':doc.page_count,'version':arxiv.rsplit('v',1)[-1] if arxiv else None,'arxiv':arxiv,'identity_note':'Version label extracted from first page; identity should be checked before merging catalog records.','year':prior.get('publication_year'),'topics':[path.relative_to(folder).parts[0]] if len(path.relative_to(folder).parts)>1 else [],'availability':'Local PDF; text indexed','reading':'Imported; not read by a WuLab agent.','imported_at':time.time(),'metadata_from':'Existing inventory matched by file SHA-256' if prior else 'PDF metadata or filename'}
                        data['version']='v'+data['version'] if data['version'] else 'unverified'
                        db.execute('INSERT INTO papers VALUES(?,?,?)',(ident,sha,json.dumps(data,ensure_ascii=False)))
                        for number,page in enumerate(doc,1):
                            text=page.get_text();db.execute('INSERT INTO pages VALUES(?,?,?)',(ident,number,text));db.execute('INSERT INTO search VALUES(?,?,?,?)',(ident,number,title,text))
                        stats['new_papers']+=1
                dest=path
                if not inside:
                    import shutil
                    dest=library/'papers'/'files'/sha/'paper.pdf';dest.parent.mkdir(parents=True,exist_ok=True)
                    if not dest.exists():
                        tmp=dest.with_suffix('.copying');shutil.copyfile(path,tmp)
                        if digest(tmp)!=sha:tmp.unlink();raise ValueError('Copy verification failed.')
                        os.replace(tmp,dest)
                    elif digest(dest)!=sha:raise ValueError('Existing stored file changed.')
                db.execute('INSERT OR REPLACE INTO locations VALUES(?,?)',(str(dest),ident))
                db.execute('RELEASE one_file')
            except Exception as e:
                db.execute('ROLLBACK TO one_file');db.execute('RELEASE one_file')
                stats['new_papers'],stats['existing_papers']=counts
                stats['errors'].append({'path':str(path),'error':str(e)})
        stats['unique_papers']=db.execute('SELECT count(*) FROM papers').fetchone()[0]
        stats['indexed_pages']=db.execute('SELECT count(*) FROM pages').fetchone()[0]
    save_json(library/'last-import.json',stats)
    for path in (library/'requests').glob('*.json'):
        request=json.loads(path.read_text());dest=Path(request['destination'])
        if dest.is_file() and request['status']=='awaiting_file':
            with contextlib.closing(connect(library)) as db:
                item=db.execute('SELECT paper_id FROM locations WHERE path=?',(str(dest),)).fetchone()
            if item:
                request.update(status='file_received_identity_unverified',paper_id=item[0]);save_json(path,request)
    return stats

def search(library,query,limit=10):
    if limit<1:raise ValueError('Choose at least one result.')
    words=re.findall(r'[\w.-]+',query)
    if not words:return []
    expression=' AND '.join('"'+w+'"' for w in words)
    with contextlib.closing(connect(library)) as db:
        ident=re.fullmatch(r'(?:arxiv\s*:\s*)?(\d{4}\.\d{4,5})(v[1-9][0-9]*)?',query.strip(),re.I)
        if ident:
            rows=db.execute('SELECT id,metadata FROM papers').fetchall();hits=[]
            for row in rows:
                data=json.loads(row['metadata']);label=data.get('arxiv') or ''
                if label==(ident[1]+(ident[2] or '')) or (not ident[2] and re.fullmatch(re.escape(ident[1])+r'v[1-9][0-9]*',label)):
                    hits.append({'paper_id':row['id'],'catalog_id':data.get('catalog_id'),'page':1,'title':data['title'],'snippet':'Local PDF with first-page arXiv label '+label})
            return hits[:limit]
        rows=db.execute('SELECT paper_id,page,snippet(search,3,"[", "]"," … ",28) AS snippet FROM search WHERE search MATCH ? ORDER BY rank',(expression,))
        hits=[];seen=set()
        for row in rows:
            if row['paper_id'] in seen:continue
            seen.add(row['paper_id']);data=record(db,row['paper_id'])
            hits.append({**dict(row),'title':data['title'],'catalog_id':data.get('catalog_id')})
            if len(hits)>=limit:break
        return hits

def page_numbers(spec):
    result=[]
    for part in spec.split(','):
        ends=part.split('-');lo=int(ends[0]);hi=int(ends[-1])
        if len(ends)>2 or lo<1 or hi<lo:raise ValueError('Pages start at 1; use 16-18 or 1,4.')
        result.extend(range(lo,hi+1))
    return sorted(set(result))

def read_pages(library,ident,spec):
    with contextlib.closing(connect(library)) as db:
        info=record(db,ident);numbers=page_numbers(spec)
        if max(numbers)>info['pages']:raise ValueError('Page is outside this PDF.')
        return {'paper':info,'note':'Extracted text can lose equation symbols. Render the original page before relying on an equation.','pages':[dict(db.execute('SELECT page,text FROM pages WHERE paper_id=? AND page=?',(info['id'],n)).fetchone()) for n in numbers]}

def render(library,ident,number,output):
    with contextlib.closing(connect(library)) as db:info=record(db,ident)
    path=next((Path(x) for x in info['paths'] if Path(x).is_file()),None)
    if path is None:raise ValueError('The registered PDF is missing.')
    if digest(path)!=info['sha256']:raise ValueError('The PDF changed; re-import before rendering.')
    with pymupdf.open(path) as doc:
        if number<1 or number>doc.page_count:raise ValueError('Page is outside this PDF.')
        output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
        doc[number-1].get_pixmap(matrix=pymupdf.Matrix(2,2)).save(output)
    return {'path':str(output.resolve()),'paper_id':info['id'],'page':number}

def fetch(library,url):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:raise ValueError('Use a public HTTPS paper URL.')
    inbox=Path(library)/'inbox';inbox.mkdir(parents=True,exist_ok=True)
    temp=inbox/('download-'+hashlib.sha256(url.encode()).hexdigest()[:20]+'.partial')
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'WuLab paper acquisition'})
        with urllib.request.urlopen(req,timeout=40) as response,temp.open('wb') as f:
            if urllib.parse.urlsplit(response.url).scheme!='https':raise ValueError('Download redirected away from HTTPS.')
            for chunk in iter(lambda:response.read(1024*1024),b''):f.write(chunk)
        with pymupdf.open(temp) as doc:
            if not doc.is_pdf or doc.needs_pass or not doc.page_count:raise ValueError('Download was not a readable PDF.')
        sha=digest(temp);dest=inbox/(sha+'.pdf')
        if dest.exists():temp.unlink()
        else:os.replace(temp,dest)
        save_json(inbox/(sha+'.source.json'),{'source':url,'path':str(dest),'sha256':sha,'acquired_at':time.time()})
        return {'path':str(dest),'sha256':sha,'import':import_folder(library,inbox)}
    finally:temp.unlink(missing_ok=True)

def download_request(library,title,url,reason,workspace,requester):
    # The orchestrator posts this payload with the existing dashboard request tool.
    key='paper-download-'+hashlib.sha256((workspace+':'+url).encode()).hexdigest()[:20]
    dest=Path(library).resolve()/'inbox'/(key+'.pdf')
    payload={'workspace':workspace,'action':'submit','key':key,'expected_revision':0,'title':'Paper needed: '+title[:180],'requester':requester,'context':reason,'question':'Please download '+url+' and save the PDF at '+str(dest)+'.','recommendation':'Save the PDF, then tell the orchestrator it is ready.','options':[{'id':'saved','label':'PDF saved','detail':'The file is at the requested location.'},{'id':'unavailable','label':'Cannot obtain it','detail':'Keep the access limitation and review another route.'}],'evidence':[{'note':'Paper download/source link','source':url},{'note':'Exact local destination','source':str(dest)}]}
    path=Path(library)/'requests'/(key+'.json')
    if path.exists():return json.loads(path.read_text())
    save_json(path,{'status':'awaiting_file','destination':str(dest),'dashboard_tool':'orchestrator_request','dashboard_payload':payload})
    return json.loads(path.read_text())

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--library',type=Path,default=DEFAULT_LIBRARY)
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('import').add_argument('folder',type=Path)
    s=sub.add_parser('search');s.add_argument('query');s.add_argument('--limit',type=int,default=10)
    sub.add_parser('show').add_argument('id')
    s=sub.add_parser('read');s.add_argument('id');s.add_argument('--pages',required=True)
    s=sub.add_parser('render');s.add_argument('id');s.add_argument('--page',type=int,required=True);s.add_argument('--output',required=True)
    sub.add_parser('fetch').add_argument('url')
    s=sub.add_parser('request');s.add_argument('--title',required=True);s.add_argument('--url',required=True);s.add_argument('--reason',required=True);s.add_argument('--workspace',required=True);s.add_argument('--requester',required=True)
    a=p.parse_args();library=a.library.resolve()
    if a.command=='import':result=import_folder(library,a.folder)
    elif a.command=='search':result=search(library,a.query,a.limit)
    elif a.command=='show':
        with contextlib.closing(connect(library)) as db:result=record(db,a.id)
    elif a.command=='read':result=read_pages(library,a.id,a.pages)
    elif a.command=='render':result=render(library,a.id,a.page,a.output)
    elif a.command=='fetch':result=fetch(library,a.url)
    else:result=download_request(library,a.title,a.url,a.reason,a.workspace,a.requester)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
