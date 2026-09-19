import test from 'node:test';
import assert from 'node:assert/strict';
import { addConversationAttachments } from '../../src/hub/features/communications/attachment-selection.ts';
const file = () => new File(['%PDF-'], 'file.pdf', { type: 'application/pdf' });
test('adding files preserves prior upload identities for retry', () => {
  const first = addConversationAttachments([], [file()]);
  const second = addConversationAttachments(first, [file()]);
  assert.equal(second[0], first[0]); assert.notEqual(second[1].id, first[0].id);
  assert.equal(second[0].file, first[0].file);
});
test('invalid selection leaves existing files unchanged', () => {
  const existing = addConversationAttachments([], [file()]);
  for (const invalid of [new File(['x'], 'script.html', { type: 'text/html' }),
    new File([], 'empty.pdf', { type: 'application/pdf' }),
    new File(['x'], '../file.pdf', { type: 'application/pdf' })])
    assert.throws(() => addConversationAttachments(existing, [invalid]));
  assert.equal(existing.length, 1);
});
test('enforces count and aggregate limits before allocating upload IDs', () => {
  assert.throws(() => addConversationAttachments([], Array.from({ length: 6 }, file)), /five/);
  const maximum = file(); Object.defineProperty(maximum, 'size', { value: 10485760 });
  assert.equal(addConversationAttachments([], [maximum, maximum]).length, 2);
  assert.throws(() => addConversationAttachments([], [maximum, maximum, file()]), /20 MB/);
  const oversized = file(); Object.defineProperty(oversized, 'size', { value: 10485761 });
  assert.throws(() => addConversationAttachments([], [oversized]), /10 MB/);
});
