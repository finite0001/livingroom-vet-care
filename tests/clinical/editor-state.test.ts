import test from 'node:test';
import assert from 'node:assert/strict';
import { denverDateTime, denverInstant, encounterDraft, errorText } from '../../src/hub/features/clinical/editor-state.ts';

test('Denver visit time remains in the practice timezone regardless of browser timezone', () => {
  assert.equal(denverInstant('2026-09-12T09:30'), '2026-09-12T15:30:00.000Z');
  assert.equal(denverInstant('2026-01-12T09:30'), '2026-01-12T16:30:00.000Z');
  assert.equal(denverDateTime('2026-09-13T01:30:00Z'), '2026-09-12T19:30');
});

test('DST gap and repeated hour cannot silently shift the recorded visit time', () => {
  assert.throws(() => denverInstant('2026-03-08T02:30'), /daylight saving/);
  assert.throws(() => denverInstant('2026-11-01T01:30'), /daylight saving/);
  assert.throws(() => denverInstant(''), /valid visit date/);
});

test('loading a SOAP record preserves clinical text exactly while presenting Denver time', () => {
  const draft = encounterDraft({ visit_at: '2026-09-13T01:30:00Z', visit_type: 'housecall', location: null, subjective: '  client words\nsecond line', objective: 'exam', assessment: 'assessment', plan: 'plan' });
  assert.equal(draft.subjective, '  client words\nsecond line');
  assert.equal(draft.location, '');
  assert.equal(draft.visit_at, '2026-09-12T19:30');
  assert.equal(draft.visit_type, 'housecall');
});

test('version conflicts explain draft retention and explicit reload', () => {
  assert.match(errorText({ message: 'Record version conflict' }), /Your draft is preserved/);
  assert.match(errorText({ message: 'Record version conflict' }), /discard your changes/);
});
