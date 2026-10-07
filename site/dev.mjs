// Local test adapter. Hosted requests run in the Sites Worker runtime.
import http from 'node:http';
import worker from './worker.mjs';
import {adapter} from './tests.mjs';
const env={DB:adapter(),WORKER_TOKEN:'test-worker-only'};
const port=Number(process.env.WULAB_TEST_PORT||8767);
http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=Buffer.concat(chunks);
  const response=await worker.fetch(new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body}),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port,'127.0.0.1',()=>console.log('WuLab hosted-build test: http://127.0.0.1:'+port));
