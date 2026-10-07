// A self-contained, lossless storage format. Public state and task packets are unchanged.
const workspaceFormat='wulab-gzip-intern-v1';
const workspaceTextMarker='\u001f';
export async function encodeWorkspace(state){
 const plain=JSON.stringify(state);if(new TextEncoder().encode(plain).length<256000)return plain;
 const strings=[],ids=new Map();
 const data=JSON.parse(JSON.stringify(state,(_key,value)=>{
  if(typeof value!=='string'||(value.length<1024&&!value.startsWith(workspaceTextMarker)))return value;
  if(!ids.has(value)){ids.set(value,strings.length);strings.push(value);}
  return workspaceTextMarker+ids.get(value);
 }));
 const packed=JSON.stringify({strings,data});
 const bytes=new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return JSON.stringify({_wulab_storage:workspaceFormat,project:state.project||null,payload:btoa(binary)});
}
export async function decodeWorkspace(document){
 const value=JSON.parse(document);if(value._wulab_storage!==workspaceFormat)return value;
 if(typeof value.payload!=='string')throw new Error('The saved workspace data is incomplete.');
 const bytes=Uint8Array.from(atob(value.payload),c=>c.charCodeAt(0));
 const packed=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 if(!Array.isArray(packed.strings)||packed.strings.some(v=>typeof v!=='string')||!packed.data)throw new Error('The saved workspace dictionary is invalid.');
 return JSON.parse(JSON.stringify(packed.data),(_key,v)=>{
  if(typeof v!=='string'||!v.startsWith(workspaceTextMarker))return v;
  const id=v.slice(1);if(!/^(0|[1-9]\d*)$/.test(id)||!Object.hasOwn(packed.strings,id))throw new Error('A saved workspace text reference is missing.');
  return packed.strings[id];
 });
}
