import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const browser={};vm.runInNewContext(fs.readFileSync(new URL('./frontend/research-tree.js',import.meta.url),'utf8'),browser);
const {layout}=browser.WuLabTree;
function check(nodes){
 const before=JSON.stringify(nodes),g=layout(nodes);
 assert.equal(g.nodes.length,nodes.length+1);assert.equal(g.links.length,nodes.length);assert.equal(JSON.stringify(nodes),before,'Layout must not alter saved directions.');
 for(const a of g.nodes){
  assert.ok(Number.isFinite(a.x)&&Number.isFinite(a.y));
  assert.ok(a.x>=0&&a.y>=0&&a.x+a.width<=g.width&&a.y+a.height<=g.height);
  for(const b of g.nodes)if(a!==b)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y,'Nodes overlap.');
  if(a.id){const parent=g.nodes.find(n=>n.id===a.parent_id);assert.ok(parent.x+parent.width<a.x,'A child must appear after its parent.');assert.equal(g.links.filter(l=>l.to===a.id).length,1);}
 }
 return g;
}
check([]);
check([{id:'one',parent_id:null},{id:'two',parent_id:'one'},{id:'three',parent_id:'one'},{id:'four',parent_id:'three'},{id:'five',parent_id:null}]);
check(Array.from({length:100},(_,i)=>({id:'wide-'+i,parent_id:null})));
check(Array.from({length:100},(_,i)=>({id:'deep-'+i,parent_id:i?'deep-'+(i-1):null})));
const mixed=Array.from({length:100},(_,i)=>({id:'n-'+i,parent_id:i>2?'n-'+Math.floor((i-3)/3):null}));
check(mixed);
console.log('Research tree: parent links, non-overlap, deep and wide maps, and unchanged records passed.');
const saved=[{id:'a',status:'under_exploration',parent_id:null},{id:'u1',status:'unexplored',parent_id:'a'},{id:'u2',status:'unexplored',parent_id:null},{id:'e',status:'explored',parent_id:'u1'},{id:'d',status:'discarded',parent_id:'a'}],snapshot=JSON.stringify(saved);
const grouped=browser.WuLabTree.groupNodes(saved);
assert.equal(grouped.length,5);
const nested=grouped.find(n=>n.node_type==='group'&&n.members.some(m=>m.id==='u1'));
assert.equal(nested.parent_id,'a');assert.equal(grouped.find(n=>n.id==='e').parent_id,nested.id);
assert.equal(grouped.find(n=>n.node_type==='group'&&n.members.some(m=>m.id==='u2')).parent_id,null);
assert.equal(grouped.find(n=>n.status==='discarded').parent_id,'a');
assert.equal(JSON.stringify(saved),snapshot);check(grouped);
assert.equal(browser.WuLabTree.groupNodes([{id:'a',status:'explored'}]).length,1);
console.log('Grouped map preserves every saved idea, keeps active/explored nodes visible, and retains branch ancestry.');

// Four unchosen proposals and five methods for the selected proposal are two branches.
const proposals=Array.from({length:5},(_,i)=>({id:'p'+i,title:'Question '+i,parent_id:null,status:i?'unexplored':'under_exploration',evidence:[{source:'proposal-'+i}]}));
const methods=Array.from({length:5},(_,i)=>({id:'method::m'+i,title:'Method '+i,parent_id:'p0',node_type:'method',status:'unexplored',evidence:[{source:'method-'+i}]}));
const team=[...proposals,...methods],teamBefore=JSON.stringify(team),tree=browser.WuLabTree.groupNodes(team);
const proposalGroup=tree.find(n=>n.member_type==='proposal'),methodGroup=tree.find(n=>n.member_type==='method');
assert.equal(proposalGroup.members.length,4);assert.equal(proposalGroup.parent_id,null);assert.equal(proposalGroup.title,'Unexplored proposals');
assert.equal(methodGroup.members.length,5);assert.equal(methodGroup.parent_id,'p0');assert.equal(methodGroup.title,'Unexplored methods');
assert.equal(new Set(tree.flatMap(n=>n.members||[n]).map(n=>n.id)).size,10);assert.equal(JSON.stringify(team),teamBefore);check(tree);
// Selecting a method moves that item out of its group and keeps the same proposal parent.
methods[0].status='under_exploration';
const selected=browser.WuLabTree.groupNodes(team);
assert.equal(selected.find(n=>n.id===methods[0].id).parent_id,'p0');assert.equal(selected.find(n=>n.member_type==='method').members.length,4);check(selected);
// Methods from different proposals or statuses never enter the same group.
const branchTest=[...team,{id:'other',title:'Other question',status:'explored',parent_id:null},{id:'method::other',parent_id:'other',node_type:'method',status:'unexplored'},{id:'method::discard',parent_id:'p0',node_type:'method',status:'discarded'}];
const branches=browser.WuLabTree.groupNodes(branchTest);
assert.equal(branches.filter(n=>n.member_type==='method').length,3);
assert.equal(branches.find(n=>n.members?.some(m=>m.id==='method::other')).parent_id,'other');
assert.equal(branches.find(n=>n.members?.some(m=>m.id==='method::discard')).parent_id,'p0');check(branches);
console.log('Methods stay under their own proposal; groups separate stage, status and parent, preserving counts, links and evidence.');
