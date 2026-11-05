import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './support/host.mjs';

test('memory-card listings skip resolved links outside the card directory before reading or recursing', async t => {
 const h=await fixture(t),cards=join(h.root,'.dsh/cards'),outside=join(h.base,'external-cards');
 await mkdir(cards,{recursive:true});await mkdir(outside);
 await writeFile(join(cards,'good.md'),'# Good card\n\nA local explanation.\n');
 await writeFile(join(h.root,'notes.md'),'# Outside card directory\n');
 await writeFile(join(outside,'private.md'),'# Private fixture\n');
 await symlink(join(outside,'private.md'),join(cards,'outside.md'));
 await symlink(join(h.root,'notes.md'),join(cards,'notes-link.md'));
 await symlink(outside,join(cards,'outside-dir'),process.platform==='win32'?'junction':'dir');
 const read=[],listed=[];
 h.ctx.fs.listDir=async (directory,signal)=>{
  listed.push(directory.targetKey);const entries=[];
  for(const name of await readdir(directory.targetKey)){
   const target=await h.ctx.fs.resolve(name,{cwd:directory.targetKey,signal}),info=await h.ctx.fs.stat(target,signal);
   entries.push({name,target,...info});
  }
  return entries;
 };
 h.ctx.fs.readText=async (target,signal)=>{signal.throwIfAborted();read.push(target.targetKey);return readFile(target.targetKey,'utf8');};
 const result=await h.call('cards');assert.equal(result.status,200,JSON.stringify(result));
 assert.deepEqual(result.cards.map(card=>card.path),['.dsh/cards/good.md']);assert.equal(result.skipped,3);
 assert.deepEqual(read,[join(cards,'good.md')]);assert.deepEqual(listed,[cards]);
 assert.equal((await h.call('card',{path:'.dsh/cards/outside.md'})).code,'CARD_OUTSIDE_WORKSPACE');
 assert.equal((await h.call('card',{path:'.dsh/cards/notes-link.md'})).code,'CARD_OUTSIDE_CARDS_DIR');
});
