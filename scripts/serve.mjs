import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {database} from './sqlite.mjs';
import worker from '../site/worker.mjs';
import {Store} from '../site/store.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const demo=process.argv.includes('--demo');
const arg=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;};
const port=Number(arg('--port')||process.env.PORT||(demo?8768:8767));
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a port between 1 and 65535.');
const local=join(root,'.wulab');
let token='';
if(!demo){
  mkdirSync(local,{recursive:true,mode:0o700});chmodSync(local,0o700);
  const secrets=join(local,'secrets.json');
  if(!existsSync(secrets))writeFileSync(secrets,JSON.stringify({token:randomBytes(32).toString('hex')})+'\n',{mode:0o600,flag:'wx'});
  token=JSON.parse(readFileSync(secrets,'utf8')).token;
  writeFileSync(join(local,'connection.json'),JSON.stringify({url:`http://127.0.0.1:${port}`,runner_token:token},null,2)+'\n',{mode:0o600});
}
const db=database(demo?':memory:':join(local,'dashboard.sqlite'));
const store=new Store(db,{});await store.init();
if(demo){
  const state=JSON.parse(readFileSync(join(root,'examples/missing-measurements/project.json'),'utf8'));
  await db.prepare('INSERT INTO workspaces(name,document,revision) VALUES(?,?,1)').bind(state.project.id,JSON.stringify(state)).run();
}
const env={DB:db,RUNNER_TOKEN:token,WORKER_TOKEN:token};
const matchesToken=value=>{const a=Buffer.from(value||''),b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b);};
const server=http.createServer(async(req,res)=>{
  const fail=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error}));};
  try{
    // Loopback only; reject DNS rebinding and cross-origin browser reads/writes.
    const host=req.headers.host;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return fail(403,'Use the local WuLab address.');
    const origin=`http://${host}`;
    if(req.headers.origin&&req.headers.origin!==origin)return fail(403,'Use the WuLab tab to make requests.');
    if(req.headers['sec-fetch-site']==='cross-site')return fail(403,'Cross-site requests are not allowed.');
    const url=new URL(req.url,origin);
    if(url.origin!==origin)return fail(403,'Use a local path.');
    if(demo&&!['GET','HEAD'].includes(req.method))return fail(403,'This demo is read-only. Start your own lab to send tasks and questions.');
    if(!demo&&['/mcp','/api/agent'].includes(url.pathname)&&!matchesToken(req.headers.authorization))return fail(403,'A local worker token is required.');
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>32*1024*1024)return fail(413,'HTTP request exceeds 32 MB. Split this upload into files.');chunks.push(chunk);}
    const body=['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks);
    const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,body}),env);
    res.writeHead(response.status,{...Object.fromEntries(response.headers),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    let output=Buffer.from(await response.arrayBuffer());
    if(demo&&url.pathname==='/'){
      // Keep the example's navigation usable, but make its write controls clear.
      // The server above independently rejects every write request in demo mode.
      const readOnly=`<script>
        const lockDemoForms=()=>document.querySelectorAll('form input, form textarea, form select, form button, #pause').forEach(el=>{el.disabled=true;el.title='Read-only example. Start your own lab to send questions and decisions.';});
        new MutationObserver(lockDemoForms).observe(document.body,{childList:true,subtree:true});lockDemoForms();
      </script>`;
      output=Buffer.from(output.toString('utf8').replace('</body>',readOnly+'</body>'));
    }
    res.end(output);
  }catch(e){console.error(e.message);if(!res.headersSent)fail(500,'The local server could not finish the request.');else res.end();}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is busy. Set PORT to another port.`:e.message);db.close();process.exit(1);});
server.listen(port,'127.0.0.1',()=>console.log(`WuLab ${demo?'demo (read-only, no model calls)':'local lab'}: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
