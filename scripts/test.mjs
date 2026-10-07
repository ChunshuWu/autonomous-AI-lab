import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
let failures=0;
for(const file of readdirSync(resolve(root,'site')).filter(f=>f==='tests.mjs'||f.endsWith('-test.mjs')).sort()){
  const result=spawnSync(process.execPath,['site/'+file],{cwd:root,encoding:'utf8',env:{...process.env,NODE_NO_WARNINGS:'1'}});
  if(result.status!==0){failures++;console.error('FAIL: '+file+'\n'+result.stdout+result.stderr);}
  else console.log('PASS: '+file);
}
for(const args of [
  ['-m','unittest','discover','-s','runtime/task-service','-p','test_*.py'],
  ['scripts/check_package.py']
]){
  const result=spawnSync('python3',args,{cwd:root,encoding:'utf8'});
  console.log(result.stdout);if(result.status!==0){failures++;console.error(result.stderr);}else console.log(result.stderr);
}
if(failures)process.exitCode=1;
else console.log('All package checks passed. Browser screenshots are checked separately.');
