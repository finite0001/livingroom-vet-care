import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { storageMetadata } from '../../scripts/restore-rehearsal/storage-metadata.mjs';

test('Storage restore preserves original MIME bytes and refuses altered file/attribute evidence', async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'lrv-xattr-unit-'));
  const attrs=new Map();
  const xattr={
    async listAttributes(file){return Object.keys(attrs.get(file)||{});},
    async getAttribute(file,name){return attrs.get(file)[name];},
    async setAttribute(file,name,value){attrs.set(file,{...attrs.get(file),[name]:value});}
  };
  try {
    const file=path.join(root,'original');
    await writeFile(file,'%PDF-original');
    attrs.set(file,{'user.supabase.content-type':Buffer.from('application/pdf'),'user.supabase.cache-control':Buffer.from('max-age=3600')});
    const original=await storageMetadata(root,xattr);
    attrs.clear();
    assert.notDeepEqual(await storageMetadata(root,xattr),original);
    assert.deepEqual(await storageMetadata(root,xattr,original),original);
    assert.equal(attrs.get(file)['user.supabase.content-type'].toString(),'application/pdf');
    const malformed=structuredClone(original);malformed[0].attributes['user.bad']='!notbase64';
    await assert.rejects(storageMetadata(root,xattr,malformed));
    attrs.get(file)['user.unexpected']=Buffer.from('no');
    await assert.rejects(storageMetadata(root,xattr,original),/Unexpected destination/);
    attrs.clear();await writeFile(file,'%PDF-corrupt');
    await assert.rejects(storageMetadata(root,xattr,original),/exact physical inventory/);
    assert.equal(attrs.size,0);
    await symlink(file,path.join(root,'alias'));
    await assert.rejects(storageMetadata(root,xattr),/symlinks/);
  } finally {await rm(root,{recursive:true,force:true});}
});
