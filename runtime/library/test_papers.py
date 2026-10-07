import contextlib,json,tempfile,unittest
from pathlib import Path
from papers import import_folder,connect,record,search,read_pages,render,digest,download_request
import pymupdf

class PaperTests(unittest.TestCase):
 def pdf(self,path,text='arXiv:2007.00307v2\nA useful equation and a decoder.'):
  doc=pymupdf.open();page=doc.new_page();page.insert_text((50,50),text);doc.set_metadata({'title':'Example research paper'});doc.save(path);doc.close()
 def test_import_preserves_original_deduplicates_and_is_repeatable(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);source=root/'source';source.mkdir();pdf=source/'first.pdf';self.pdf(pdf);original=digest(pdf);(source/'copy.pdf').write_bytes(pdf.read_bytes());library=root/'library'
   first=import_folder(library,source);self.assertEqual(first['new_papers'],1);self.assertEqual(first['existing_papers'],1);self.assertEqual(digest(pdf),original)
   again=import_folder(library,source);self.assertEqual(again['new_papers'],0);self.assertEqual(again['unique_papers'],1)
   with contextlib.closing(connect(library)) as db:
    paper=record(db,original);self.assertEqual(paper['arxiv'],'2007.00307v2');self.assertTrue(Path(paper['paths'][0]).is_relative_to(library));self.assertIn('not read',paper['reading'])
 def test_search_text_and_render_original(self):
  with tempfile.TemporaryDirectory() as td:
   library=Path(td);inbox=library/'inbox';inbox.mkdir();self.pdf(inbox/'a.pdf');import_folder(library,inbox)
   hit=search(library,'useful equation')[0];self.assertEqual(hit['page'],1)
   read=read_pages(library,hit['paper_id'],'1');self.assertIn('useful equation',read['pages'][0]['text']);self.assertIn('lose equation',read['note'])
   png=library/'page.png';render(library,hit['paper_id'],1,png);self.assertEqual(png.read_bytes()[:8],b'\x89PNG\r\n\x1a\n')
   with self.assertRaises(ValueError):render(library,hit['paper_id'],2,png)
   (inbox/'a.pdf').write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'changed'):render(library,hit['paper_id'],1,png)
 def test_bad_files_do_not_block_the_collection(self):
  with tempfile.TemporaryDirectory() as td:
   library=Path(td);inbox=library/'inbox';inbox.mkdir();self.pdf(inbox/'good.pdf');(inbox/'bad.pdf').write_text('<html>login</html>')
   result=import_folder(library,inbox);self.assertEqual(result['new_papers'],1);self.assertEqual(len(result['errors']),1);self.assertEqual(result['unique_papers'],1)
 def test_request_gives_destination_and_does_not_claim_reading(self):
  with tempfile.TemporaryDirectory() as td:
   library=Path(td);(library/'inbox').mkdir()
   request=download_request(library,'Example','https://example.org/paper.pdf','Need to check the equation.','p','Researcher')
   self.assertIn(request['destination'],request['dashboard_payload']['question'])
   self.pdf(request['destination']);import_folder(library,library/'inbox')
   updated=json.loads(next((library/'requests').glob('*.json')).read_text());self.assertEqual(updated['status'],'file_received_identity_unverified')
 def test_search_finds_unversioned_ids_and_returns_distinct_papers(self):
  with tempfile.TemporaryDirectory() as td:
   library=Path(td);inbox=library/'inbox';inbox.mkdir();self.pdf(inbox/'a.pdf');self.pdf(inbox/'b.pdf','A second useful equation with different content.');import_folder(library,inbox)
   self.assertEqual(len(search(library,'2007.00307')),1);self.assertEqual(len(search(library,'arXiv:2007.00307v2')),1);self.assertEqual(search(library,'2007.00307v1'),[])
   results=search(library,'useful equation');self.assertEqual(len(results),2);self.assertEqual(len({x['paper_id'] for x in results}),2)

if __name__=='__main__':unittest.main()
