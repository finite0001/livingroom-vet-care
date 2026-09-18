import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveResendAttachment } from '../../supabase/functions/_shared/inbound/resend-attachment.ts';
const email = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const expected = { id, filename: 'file.pdf', content_type: 'application/pdf', size: 5 };
const link = `https://inbound-cdn.resend.com/${email}/attachments/${id}?signature=synthetic`;
function fixture(change: Record<string, unknown> = {}, body: BodyInit = '%PDF-', headers: Record<string, string> = {}) {
  const calls: { url: string; options?: RequestInit }[] = [];
  const transport = (async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? Response.json({ object: 'attachment', ...expected, download_url: link, expires_at: '2099-01-01T00:00:00Z', ...change }) : new Response(body, { headers: { 'content-type': 'application/pdf', ...headers } });
  }) as typeof fetch;
  return { calls, transport };
}
test('authenticates metadata, downloads bound bytes without API key and hashes actual content', async () => {
  const f = fixture(); const result = await retrieveResendAttachment(email, expected, 'synthetic-key', f.transport);
  assert.equal(new TextDecoder().decode(result.bytes), '%PDF-'); assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(f.calls[0].url, `https://api.resend.com/emails/receiving/${email}/attachments/${id}`);
  assert.equal(new Headers(f.calls[0].options?.headers).get('Authorization'), 'Bearer synthetic-key');
  assert.equal(new Headers(f.calls[1].options?.headers).get('Authorization'), null);
  assert.equal(f.calls[1].options?.credentials, 'omit');
  assert.ok(f.calls.every(call => call.options?.redirect === 'error'));
});
test('rejects arbitrary, insecure, credential-bearing and mismatched download locations before fetching bytes', async () => {
  for (const download_url of ['https://127.0.0.1/file', 'https://inbound-cdn.resend.com.evil.test/file', link.replace('https:', 'http:'),
    link.replace('https://', 'https://user:password@'), link.replace(`/${email}/`, `/${id}/`), `${link}#fragment`]) {
    const f = fixture({ download_url });
    await assert.rejects(retrieveResendAttachment(email, expected, 'key', f.transport)); assert.equal(f.calls.length, 1);
  }
});
test('metadata mismatch and expired capability prevent byte retrieval', async () => {
  for (const changed of [{ id: email }, { filename: 'other.pdf' }, { size: 6 }, { content_type: 'text/html' }, { expires_at: '2000-01-01T00:00:00Z' }]) {
    const f = fixture(changed); await assert.rejects(retrieveResendAttachment(email, expected, 'key', f.transport)); assert.equal(f.calls.length, 1);
  }
});
test('rejects unsupported type, oversized file and invalid identifiers without network calls', async () => {
  const f = fixture();
  for (const changed of [{ ...expected, id: '../secret' }, { ...expected, size: 10485761 }, { ...expected, content_type: 'text/html' }])
    await assert.rejects(retrieveResendAttachment(email, changed, 'key', f.transport));
  assert.equal(f.calls.length, 0);
});
test('streamed overflow cancels the response and never returns partial content', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('%PDF-too-big')); }, cancel() { cancelled = true; } });
  const f = fixture({}, stream);
  await assert.rejects(retrieveResendAttachment(email, expected, 'key', f.transport)); assert.equal(cancelled, true);
});
test('truncation, false size/type and unsupported actual bytes are rejected', async () => {
  for (const [body, headers] of [['%PDF', {}], ['%PDF-', { 'content-length': '6' }], ['%PDF-', { 'content-type': 'text/html' }], ['<html', {}]] as [string, Record<string, string>][]) {
    const f = fixture({}, body, headers);
    await assert.rejects(retrieveResendAttachment(email, expected, 'key', f.transport));
  }
});
