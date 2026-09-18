// Preserve the local Storage backend's original user xattrs, never derive MIME from SQL.
import assert from 'node:assert/strict';
import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function storageMetadata(root, xattr, restore = null) {
  const files = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name), stat = await lstat(file);
      assert(!stat.isSymbolicLink(), 'Storage backup must not traverse symlinks');
      if (stat.isDirectory()) await walk(file);
      else {
        assert(stat.isFile(), 'Unexpected Storage filesystem object');
        const bytes = await readFile(file);
        files.push({ path:path.relative(root,file), bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  await walk(root);
  files.sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (restore !== null) {
    assert.deepEqual(files, restore.map(({ path,bytes,sha256 })=>({ path,bytes,sha256 })), 'Storage metadata must bind the exact physical inventory');
    // Validate every entry before applying any metadata.
    for (const row of restore) {
      assert.deepEqual(Object.keys(row).sort(), ['attributes','bytes','path','sha256']);
      assert(row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes));
      for (const [name,value] of Object.entries(row.attributes)) {
        assert(name.startsWith('user.') && !name.includes('\0'));
        assert(typeof value === 'string' && Buffer.from(value,'base64').toString('base64') === value);
      }
    }
    for (const row of restore) {
      const file = path.join(root,row.path);
      const current = (await xattr.listAttributes(file)).filter(name=>name.startsWith('user.'));
      // Fresh destination bytes must not carry unrelated metadata.
      assert(current.every(name=>Object.hasOwn(row.attributes,name)), 'Unexpected destination Storage attribute');
      for (const [name,value] of Object.entries(row.attributes)) await xattr.setAttribute(file,name,Buffer.from(value,'base64'));
    }
  }
  const result=[];
  for (const row of files) {
    const file=path.join(root,row.path), attributes={};
    for (const name of (await xattr.listAttributes(file)).filter(name=>name.startsWith('user.')).sort()) {
      attributes[name]=Buffer.from(await xattr.getAttribute(file,name)).toString('base64');
    }
    result.push({...row,attributes});
  }
  if (restore !== null) assert.deepEqual(result,restore,'Restored Storage attributes differ');
  return result;
}
