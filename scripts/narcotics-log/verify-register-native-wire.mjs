/** Verify actual disposable HTTP response bytes with the staff report client.
 * No network, Auth creation, database writes, or release acceptance occurs here.
 */
import assert from 'node:assert/strict';
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { parseRegisterPointer } from '../../src/hub/features/controlled-drugs/register/schema.ts';
import { verifyRegisterDownload, verifyRegisterList, verifyRegisterReply } from '../../src/hub/features/controlled-drugs/register/wire.ts';

const folder = realpathSync(process.argv[2]);
assert.match(basename(folder), /^lrv-narcotics-install-[A-Za-z0-9_-]+$/);
const hash = raw => createHash('sha256').update(raw).digest('hex');
function read(name, cap) {
  assert.equal(basename(name), name);
  const fd = openSync(resolve(folder, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    assert(before.isFile() && before.uid === process.getuid() && (before.mode & 0o077) === 0 && before.size <= cap);
    const buffer = Buffer.alloc(cap + 1); let length = 0, size;
    while (length <= cap && (size = readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += size;
    const raw = buffer.subarray(0, length), after = fstatSync(fd);
    assert(raw.length <= cap && raw.length === before.size);
    for (const field of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(after[field], before[field]);
    return raw;
  } finally { closeSync(fd); }
}
const input = JSON.parse(read('register-wire-original-inputs.json', 3145728).toString('utf8'));
assert.deepEqual(Object.keys(input).sort(), ['engineering_only', 'entries']);
assert.equal(input.engineering_only, true);
assert.equal(input.entries.length, 6);
const expected = ['form', 'download', 'report', 'later_report', 'first_page', 'second_page'];
for (const [index, item] of input.entries.entries()) {
  assert.equal(item.kind, expected[index]);
  assert.match(item.response.file, /^http-[0-9]{3}-response\.json$/);
  const raw = read(item.response.file, 2097152);
  assert.equal(raw.length, item.response.bytes); assert.equal(hash(raw), item.response.sha256);
  const request = item.request;
  if (item.kind === 'download') {
    const result = await verifyRegisterDownload(raw, request.form_id);
    assert.equal(result.metadata.document_hash, item.document_hash);
  } else if (item.kind.endsWith('_page')) verifyRegisterList(raw, request);
  else {
    const pointer = parseRegisterPointer({ schema_version: 1, actor_id: request.actor_id, operation_id: request.operation_id,
      product_id: request.product_id, site_id: request.site_id, kind: item.kind === 'form' ? 'form' : 'report' });
    const result = await verifyRegisterReply(raw, pointer, request);
    assert.equal(result.state, 'saved');
  }
}
console.log(JSON.stringify({ engineering_only: true, actual_original_HTTP_response_bytes_verified: true, staff_wire_verifier_passed: true, cases: expected }));
