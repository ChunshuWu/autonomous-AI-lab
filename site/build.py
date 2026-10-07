"""Build one deployable Worker from WuLab's small modules; no npm packages."""
import json
import os
import base64
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
assets = {}
for name, mime in [('index.html','text/html'),('style.css','text/css'),('app.js','text/javascript'),('research-tree.js','text/javascript'),('research-views.js','text/javascript'),('markdown.css','text/css'),('figures.css','text/css'),('math.js','text/javascript')]:
    content = (HERE / 'frontend' / name).read_text()
    if name == 'app.js':
        content = content.replace('Saved locally', 'Saved in Wu Lab')
        content = content.replace('wulab-workspace', 'wulab-hosted-workspace')
        content = content.replace("|| 'example';", "|| 'live';")
        content = content.replace('Start the Wu Lab server and refresh.', 'Refresh Wu Lab and try again.')
        content = content.replace('YOUR LAB · Connect external workers to carry out released plans. This dashboard does not start AI agents.', 'YOUR LAB · Plans, reports, and your comments are saved here.')
        content = content.replace('This note is built from saved task status. An AI orchestrator is not running in this prototype.', 'This summary uses saved task status. Your AI orchestrator works in the WuLab chat.')
    if name == 'index.html':
        content = content.replace('Local workspace', 'Your lab')
    assets['/' if name=='index.html' else '/'+name] = {'body':content,'type':mime+'; charset=utf-8'}

markdown=re.sub(r'^export ', '', (HERE/'markdown.mjs').read_text(), flags=re.M)
assets['/markdown.js']={'body':'globalThis.WuLabMarkdown=(()=>{\n'+markdown+'\nreturn {renderMarkdown,renderMarkdownInline};\n})();','type':'text/javascript; charset=utf-8'}
for path in sorted((HERE/'frontend/vendor/katex').rglob('*')):
    if not path.is_file(): continue
    url='/vendor/katex/'+path.relative_to(HERE/'frontend/vendor/katex').as_posix()
    if path.suffix in {'.js','.css','.txt'} or path.name=='LICENSE':
        assets[url]={'body':path.read_text(),'type':{'.js':'text/javascript','.css':'text/css'}.get(path.suffix,'text/plain')+'; charset=utf-8'}
    elif path.suffix in {'.woff2','.woff','.ttf'}:
        assets[url]={'body':base64.b64encode(path.read_bytes()).decode('ascii'),'type':{'.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}[path.suffix],'encoding':'base64'}

identities=(HERE/'identities.mjs').read_text()
browser_identities=re.sub(r'^export ', '', identities, flags=re.M)
assets['/cats.js']={'body':'globalThis.WuLabCats=(()=>{\n'+browser_identities+'\nreturn {cats,catFor,agentName};\n})();','type':'text/javascript; charset=utf-8'}
lifecycle=(HERE/'report-lifecycle.mjs').read_text()
browser_lifecycle=re.sub(r'^export ', '', lifecycle, flags=re.M)
assets['/report-status.js']={'body':'globalThis.WuLabReports=(()=>{\n'+browser_lifecycle+'\nreturn {progressGroup,reportLabel,reportLifecycle,reportCatalog};\n})();','type':'text/javascript; charset=utf-8'}
timeline=re.sub(r'^export ', '', (HERE/'timeline.mjs').read_text(), flags=re.M)
assets['/timeline.js']={'body':'globalThis.WuLabTimeline=(()=>{\n'+timeline+'\nreturn {timelineEntries};\n})();','type':'text/javascript; charset=utf-8'}
visuals=re.sub(r'^export ', '', (HERE/'visuals.mjs').read_text(), flags=re.M)
assets['/visuals.js']={'body':visuals+'\nglobalThis.WuLabVisuals={renderVisual};','type':'text/javascript; charset=utf-8'}
for path in sorted((HERE/'frontend'/'cats').iterdir()):
    if path.suffix not in {'.png','.jpeg'}:
        continue
    assets['/cats/'+path.name]={'body':base64.b64encode(path.read_bytes()).decode('ascii'),'type':'image/png' if path.suffix=='.png' else 'image/jpeg','encoding':'base64'}
assets['/fonts/maodie.ttf']={'body':base64.b64encode((HERE/'frontend/fonts/maodie.ttf').read_bytes()).decode('ascii'),'type':'font/ttf','encoding':'base64'}
assets['/fonts/OFL.txt']={'body':(HERE/'frontend/fonts/OFL.txt').read_text(),'type':'text/plain; charset=utf-8'}

use_local_seeds = os.environ.get('WULAB_LOCAL_SEEDS') == '1'
seeds=json.loads((HERE/'seed.json').read_text()) if use_local_seeds else {}
style=(HERE/'slides.css').read_text()
library_seed=json.loads((HERE/'library-seed.json').read_text()) if use_local_seeds else []
generated = f'export const assets={json.dumps(assets)};\nexport const seeds={json.dumps(seeds)};\nexport const librarySeed={json.dumps(library_seed)};\nexport const slideStyle={json.dumps(style)};\n'
(HERE/'generated.mjs').write_text(generated)
parts=[]
for name in ['generated.mjs','identities.mjs','visuals.mjs','slides.mjs','markdown.mjs','documents.mjs','report-lifecycle.mjs','logic.mjs','presentations.mjs','directions.mjs','report-history.mjs','team.mjs','execution.mjs','deputy.mjs','orchestrator-inbox.mjs','review-chat.mjs','review-runner.mjs','warnings.mjs','requests.mjs','records.mjs','record-handoff.mjs','library-delivery.mjs','usage.mjs','tasks.mjs','workflow.mjs','blocker-recovery.mjs','workspace-codec.mjs','store.mjs','worker.mjs']:
    content=(HERE/name).read_text()
    content=re.sub(r'^import .+?;\n','',content,flags=re.M)
    parts.append(content)
(HERE/'index.mjs').write_text('\n'.join(parts))
output=HERE/'dist'/'server'
output.mkdir(parents=True,exist_ok=True)
(output/'index.js').write_text((HERE/'index.mjs').read_text())
print('Built',HERE/'index.mjs','and',output/'index.js')
