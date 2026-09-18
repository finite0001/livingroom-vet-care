/** Synthetic review copies from the real renderer. No patient/provider access. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderNativePrescription } from '../../supabase/functions/_shared/native-prescription-renderer.ts';
import { prescription, status, dispense } from '../../tests/prescriptions/renderer-fixture.ts';
const source = new URL('../../supabase/functions/_shared/native-prescription-renderer.ts', import.meta.url);
const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
const fixtureHash = createHash('sha256').update(readFileSync(new URL('../../tests/prescriptions/renderer-fixture.ts', import.meta.url))).digest('hex');
const banner = `<aside role="alert"><strong>SYNTHETIC REVIEW EXAMPLE — NOT A VALID PRESCRIPTION</strong><p>No clinical approval, dispensing or provider delivery occurred. All people, medication values and records are synthetic.</p><p>Renderer SHA-256: ${sourceHash}<br>Fixture SHA-256: ${fixtureHash}</p></aside>`;
const examples = [
  ['native-prescription-order-example.html', renderNativePrescription(prescription, status)],
  ['native-prescription-partial-fill-example.html', renderNativePrescription(prescription, status, dispense)],
  ['native-prescription-cancelled-example.html', renderNativePrescription(prescription, { ...status, state: 'cancelled', reason: 'Synthetic cancellation after a partial fill; prior dispensing remains in the record.' }, dispense)],
] as const;
for (const [name, html] of examples) {
  writeFileSync(new URL(name, import.meta.url), html.replace('<body>', `<body>${banner}`).replace('<title>', '<title>SYNTHETIC — '));
}
console.log(`Generated ${examples.length} synthetic examples from renderer ${sourceHash}`);
