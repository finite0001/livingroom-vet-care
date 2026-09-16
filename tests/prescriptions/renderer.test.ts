import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNativePrescription } from '../../supabase/functions/_shared/native-prescription-renderer.ts';
import { prescription, status, dispense } from './renderer-fixture.ts';

test('order copies reproduce signed content without claiming a fill or remaining balance', () => {
  const before = structuredClone(prescription);
  const html = renderNativePrescription(prescription, status);
  assert.equal(html, renderNativePrescription(structuredClone(prescription), structuredClone(status)));
  assert.deepEqual(prescription, before);
  for (const text of ['Signed prescription order copy', 'Synthetic directions only.', 'Refills originally authorized', 'does not confirm dispensing', 'Practice phone not recorded', prescription.authorization_hash]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Recorded dispensing'));
  assert.ok(html.includes("default-src 'none'"));
});

test('every rendered clinical and status string is escaped', () => {
  const s = structuredClone(prescription); const d = structuredClone(dispense);
  const attack = '<script>alert("x")</script><img src=x onerror=alert(1)>&';
  s.medication.directions = attack; s.signature_name = attack; s.household.address = attack;
  d.lots[0].number = attack; d.recorded_by.name = attack;
  const html = renderNativePrescription(s, { ...status, state: 'cancelled', reason: attack }, d);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&amp;'));
  assert.ok(!html.includes('<script')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('CANCELLED — historical copy'));
  assert.ok(html.includes('Recorded prescription dispense'));
});

test('status lookup and exact authorization identity are mandatory', () => {
  assert.throws(() => renderNativePrescription(prescription, null), /Refresh/);
  for (const altered of [
    { ...status, authorization_id: dispense.id }, { ...status, authorization_hash: 'b'.repeat(64) },
    { ...status, checked_at: '2026-09-15T11:00:00Z' },
    { ...status, state: 'replaced' as const },
    { ...status, state: 'cancelled' as const, reason: ' ' },
    { ...status, state: 'replaced' as const, reason: 'Changed', replacement_id: prescription.authorization_id },
  ]) assert.throws(() => renderNativePrescription(prescription, altered));
  const replaced = renderNativePrescription(prescription, { ...status, state: 'replaced', reason: 'New signed instructions', replacement_id: dispense.id });
  assert.ok(replaced.includes('REPLACED — historical copy'));
});

test('partial fills print event quantity, original maximum and truthful pickup disclosure', () => {
  const html = renderNativePrescription(prescription, status, dispense);
  for (const text of ['10 test units', '30 test units', 'Initial fill', 'TEST-LOT', 'partial fill', 'does not establish the remaining refill balance or confirm pickup']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('Administered'));
});

test('lot allocation uses exact decimal arithmetic and rejects duplicates, overfills and mismatches', () => {
  const d = structuredClone(dispense); d.quantity = '0.3';
  d.lots = [{ ...d.lots[0], quantity: '0.1' }, { ...d.lots[0], id: '00000000-0000-4000-8000-000000000008', quantity: '0.2' }];
  assert.ok(renderNativePrescription(prescription, status, d).includes('0.3 test units'));
  for (const alter of [
    (v: typeof d) => { v.lots[1].quantity = '0.201'; },
    (v: typeof d) => { v.lots[1].id = v.lots[0].id; },
    (v: typeof d) => { v.quantity = '31'; v.lots = [{ ...v.lots[0], quantity: '31' }]; },
    (v: typeof d) => { v.fill_index = 3; },
    (v: typeof d) => { v.unit = 'mg'; },
    (v: typeof d) => { v.authorization_hash = 'b'.repeat(64); },
    (v: typeof d) => { v.dispensed_at = '2026-09-15T10:00:00Z'; },
  ]) { const changed = structuredClone(d); alter(changed); assert.throws(() => renderNativePrescription(prescription, status, changed)); }
});

test('malformed snapshots, dates and quantities fail closed instead of printing incomplete orders', () => {
  for (const qty of ['0', '-1', '1.0001', 'NaN', 'Infinity', '1e2', '01', '100000000000']) {
    assert.throws(() => renderNativePrescription({ ...prescription, quantity_per_fill: qty }, status), qty);
  }
  for (const patch of [
    { expires_on: '2026-02-30' }, { starts_on: '2026-12-01' },
    { signed_at: '2026-02-30T10:00:00Z' }, { signed_at: '2026-09-16T24:00:00Z' }, { schema_version: 2 },
    { medication: { ...prescription.medication, directions: '' } }, { refills_authorized: 1.5 },
    { unexpected: true }, { signed_at: null },
  ]) assert.throws(() => renderNativePrescription({ ...prescription, ...patch } as typeof prescription, status));
});

test('external pharmacy orders never fabricate a local dispensing receipt', () => {
  const external = { ...prescription, fulfillment_mode: 'external_pharmacy' as const };
  assert.ok(renderNativePrescription(external, status).includes('External pharmacy — fulfillment not confirmed'));
  assert.throws(() => renderNativePrescription(external, status, dispense));
});

test("a dispense copy requires a status read at least as recent as that event", () => {
  assert.throws(() => renderNativePrescription(prescription, { ...status, checked_at: prescription.signed_at }, dispense));
});

test('text limits count Unicode code points consistently with PostgreSQL', () => {
  const allowed = { ...prescription, medication: { ...prescription.medication, name: '🐾'.repeat(200) } };
  assert.ok(renderNativePrescription(allowed, status).includes('🐾'.repeat(200)));
  assert.throws(() => renderNativePrescription({ ...allowed, medication: { ...allowed.medication, name: '🐾'.repeat(201) } }, status));
});
