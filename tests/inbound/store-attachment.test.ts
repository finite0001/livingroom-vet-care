import test from 'node:test';
import assert from 'node:assert/strict';
import { storeIncomingOriginal } from '../../supabase/functions/_shared/inbound/store-attachment.ts';
const id = '11111111-1111-4111-8111-111111111111';
const path = `${id}/${id}/${id}/original`;
async function captured() {
  const bytes = new TextEncoder().encode('%PDF-');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { bytes, mimeType: 'application/pdf', filename: 'file.pdf', sha256: [...digest].map(v => v.toString(16).padStart(2, '0')).join('') };
}
test('upload is immutable and successful capture requires matching actual read-back', async () => {
  const file = await captured(); let read = false;
  await storeIncomingOriginal({ upload: async (name, bytes, options) => { assert.equal(name, path); assert.equal(bytes, file.bytes); assert.equal(options.upsert, false); return { error: null }; },
    download: async () => { read = true; return { data: new Blob([file.bytes], { type: file.mimeType }), error: null }; } }, path, file);
  assert.equal(read, true);
});
test('lost upload reply and duplicate-object errors recover only exact stored bytes', async () => {
  const file = await captured();
  for (const throws of [true, false]) {
    await storeIncomingOriginal({ upload: async () => { if (throws) throw new Error('Lost response'); return { error: new Error('Already exists') }; },
      download: async () => ({ data: new Blob([file.bytes], { type: file.mimeType }), error: null }) }, path, file);
  }
});
test('missing, changed and wrong-type stored bytes cannot finalize', async () => {
  const file = await captured();
  for (const data of [null, new Blob(['%PDFx'], { type: file.mimeType }), new Blob([file.bytes], { type: 'text/html' })]) {
    await assert.rejects(storeIncomingOriginal({ upload: async () => ({ error: null }), download: async () => ({ data, error: null }) }, path, file));
  }
});
test('invalid path cannot perform a storage operation', async () => {
  let calls = 0;
  await assert.rejects(storeIncomingOriginal({ upload: async () => { calls++; return { error: null }; }, download: async () => { calls++; return { data: null, error: null }; } }, '../other', await captured()));
  assert.equal(calls, 0);
});
