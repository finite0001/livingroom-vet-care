import { test } from "node:test";
import assert from "node:assert/strict";
import { renderVaccineCertificate } from "../../src/hub/features/certificates/print.ts";
import { certificate } from "./fixture.ts";

test("deterministic snapshot-only print includes rabies metadata and escapes untrusted text", () => {
  const html = renderVaccineCertificate(certificate, []);
  assert.equal(
    html,
    renderVaccineCertificate(structuredClone(certificate), []),
  );
  for (const value of [
    "Rabies Vaccination Certificate",
    "Frozen manufacturer",
    "LOT-1",
    "2027-01-01",
    "2027-09-12",
    "Actual administrator",
    "TAG-1",
    "TEST-ONLY",
    "Electronically signed by Dr Test",
    "estimated",
  ])
    assert.ok(html.includes(value), value);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("src="));
  assert.ok(html.includes("default-src 'none'"));
});
test("status lookup fails closed and invalidated originals remain visibly marked", () => {
  assert.throws(
    () => renderVaccineCertificate(certificate, null),
    /Refresh certificate status/,
  );
  const html = renderVaccineCertificate(certificate, [
    {
      id: "event",
      kind: "treatment_corrected",
      reason: "<img src=x onerror=alert(1)>",
      created_at: "2026-09-13T00:00:00Z",
      replacement_id: null,
    },
  ]);
  assert.ok(html.includes("INVALIDATED"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("Frozen manufacturer"));
});
test("general history preserves all recorded dates and clearly marks missing dates", () => {
  const general = structuredClone(certificate);
  general.snapshot.kind = "vaccine_history";
  general.snapshot.vaccinations.push({
    ...general.snapshot.vaccinations[0],
    treatment_id: "dose-2",
    historical: true,
    next_due_on: null,
    source: "External original",
  });
  const html = renderVaccineCertificate(general, []);
  assert.ok(html.includes("Vaccine History Certificate"));
  assert.ok(html.includes("2027-09-12"));
  assert.ok(html.includes("Not recorded — no due date certified"));
  assert.ok(html.includes("External history: External original"));
  assert.ok(
    html.includes("does not determine which date is currently applicable"),
  );
  assert.ok(!html.includes("<h2>Rabies administration details</h2>"));
});
