import test from 'node:test';
import assert from 'node:assert/strict';
import { classHierarchyRows } from '../class-hierarchy-client.js';

const node = id => ({ id, qualified:id, path:id+'.py', methods:[{name:'run',line:1,character:4}], unresolved:[] });

test('hierarchies retain multiple parents as references and expose methods only in expanded classes', () => {
 const graph={nodes:['Parent','Other','Client'].map(node),edges:[{from:'Client',to:'Parent',kind:'factory'},{from:'Client',to:'Other'}]};
 const first=classHierarchyRows(graph,new Map());
 assert.deepEqual(first.rows.filter(row=>row.kind==='class').map(row=>[row.node.id,row.reference,row.depth]),[['Parent',false,0],['Client',false,1],['Other',false,0],['Client',true,1]]);
 assert.equal(first.rows.find(row=>row.node.id==='Client').edge.kind,'factory');
 assert.equal(first.rows.filter(row=>row.kind==='method'&&row.node.id==='Client').length,0);
 const expanded=classHierarchyRows(graph,new Map([['Client',true]]));
 assert.equal(expanded.rows.filter(row=>row.kind==='method'&&row.node.id==='Client').length,1);
 const collapsed=classHierarchyRows(graph,new Map([['Parent',false]]));
 assert.ok(collapsed.rows.some(row=>row.node.id==='Client'&&!row.reference),'a collapsed first parent does not hide the other branch');
});

test('cyclic and dense class graphs terminate within the hierarchy row budget', () => {
 const cycle=classHierarchyRows({nodes:['A','B'].map(node),edges:[{from:'A',to:'B'},{from:'B',to:'A'}]},new Map());
 assert.equal(cycle.rows.filter(row=>row.reference).length,1);assert.equal(cycle.limited,false);
 const nodes=Array.from({length:100},(_,i)=>node(String(i))),edges=[];
 for(let i=1;i<100;i++)for(let p=0;p<i;p++)edges.push({from:String(i),to:String(p)});
 const dense=classHierarchyRows({nodes,edges},new Map());assert.equal(dense.rows.length,300);assert.equal(dense.limited,true);
 assert.deepEqual(classHierarchyRows({nodes:[],edges:[]},new Map()),{rows:[],limited:false});
});

test('field types remain distinct from inheritance and can target related source', () => {
 const owner={...node('Message'),fields:[{name:'role',annotation:'Role',line:3,character:1}]};
 const graph={nodes:[owner,node('Role')],edges:[{from:'Message',to:'Role',kind:'field',fields:['role']}]};
 const result=classHierarchyRows(graph,new Map([['Message',true]]));
 const field=result.rows.find(row=>row.kind==='field');
 assert.equal(field.target.id,'Role');
 assert.equal(field.member.name,'role');
 assert.deepEqual(result.rows.filter(row=>row.kind==='class').map(row=>row.depth),[0,0]);
});
