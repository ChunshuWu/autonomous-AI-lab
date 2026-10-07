"""Check researcher source handoffs against the project-linked shared catalog."""
import argparse,json
from pathlib import Path

def validate_sources(sources):
 if not isinstance(sources,list) or not sources:raise ValueError('Supply a nonempty source list, including access failures.')
 ids=set()
 for s in sources:
  if not isinstance(s,dict):raise ValueError('Each source must be a record.')
  for k in ['id','title','source','version','summary','reading','availability','checks']:
   if not isinstance(s.get(k),str) or not s[k].strip():raise ValueError('Missing source field: '+k)
  if s.get('kind')!='paper':raise ValueError('Paper records are required; proposal notes do not replace them.')
  if s['id'] in ids:raise ValueError('Repeat source ID within a source list: '+s['id'])
  ids.add(s['id'])
  if not isinstance(s.get('read_by'),list):raise ValueError('Supply read_by, empty for unread sources.')
 return sources

def check(catalog,project,source_files):
 rows=catalog['items'];byid={x['id']:x for x in rows};checked=[]
 for p in source_files:
  sources=validate_sources(json.loads(Path(p).read_text()))
  for s in sources:
   item=byid.get(s['id'])
   if not item or item['kind']!='paper':raise ValueError('Paper missing from catalog: '+s['id'])
   if project not in item.get('project_ids',[]):raise ValueError('Project link missing: '+s['id'])
   if not set(s['read_by']).issubset(item.get('read_by',[])):raise ValueError('Reader missing: '+s['id'])
   text='\n'.join(item.get(k,'') for k in ['reading','notes'])
   if s['reading'] not in text:raise ValueError('Actual reading limits missing: '+s['id'])
   if s['availability'] not in '\n'.join(item.get(k,'') for k in ['availability','notes']):raise ValueError('Access limits missing: '+s['id'])
   if s['source']!=item.get('source') and not any(l.get('source')==s['source'] for l in item.get('links',[])):raise ValueError('Source location missing: '+s['id'])
   checked.append({'id':s['id'],'revision':item['revision'],'source_file':str(p),'read_by':s['read_by']})
 return {'passed':True,'project':project,'source_uses':len(checked),'distinct_papers':len(set(x['id'] for x in checked)),'records':checked}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--catalog',required=True);p.add_argument('--project',required=True);p.add_argument('--sources',required=True,nargs='+');p.add_argument('--output');a=p.parse_args();result=check(json.loads(Path(a.catalog).read_text()),a.project,a.sources)
 text=json.dumps(result,indent=2)+'\n'
 if a.output:Path(a.output).write_text(text)
 print(json.dumps({k:v for k,v in result.items() if k!='records'}))
