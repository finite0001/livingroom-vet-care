import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { renderVaccineCertificate } from "../../src/hub/features/certificates/print.ts";
import { certificate } from "./fixture.ts";

// Golden renderer snapshots. Regenerate deliberately with UPDATE_CERTIFICATE_SNAPSHOTS=1
// and review the diff: issued certificates are legal documents.
function matchesSnapshot(name: string, html: string) {
  const url = new URL(`./snapshots/${name}.html`, import.meta.url);
  if (process.env.UPDATE_CERTIFICATE_SNAPSHOTS === "1") writeFileSync(url, html);
  assert.equal(html, readFileSync(url, "utf8"), `${name} snapshot differs`);
}
function rabies(serial: string | null | undefined) {
  const value = structuredClone(certificate);
  if (serial !== undefined) value.snapshot.details.vaccine_serial_number = serial;
  return value;
}

test("new rabies snapshot renders lot and serial as separate fields", () => {
  const html = renderVaccineCertificate(rabies("SER-<9>"), []);
  assert.ok(html.includes("<dt>Lot number</dt><dd>LOT-1</dd>"));
  assert.ok(html.includes("<dt>Vaccine serial number</dt><dd>SER-&lt;9&gt;</dd>"));
  assert.ok(!html.includes("Lot / serial number"));
  matchesSnapshot("rabies-with-serial", html);
});

test("new rabies snapshot without a serial says so and never copies the lot", () => {
  const html = renderVaccineCertificate(rabies(null), []);
  assert.ok(html.includes("<dt>Lot number</dt><dd>LOT-1</dd>"));
  assert.ok(
    html.includes("<dt>Vaccine serial number</dt><dd>Not recorded — no separate serial number certified</dd>"),
  );
  matchesSnapshot("rabies-serial-not-recorded", html);
});

test("earlier rabies snapshots keep their original combined lot/serial wording", () => {
  const html = renderVaccineCertificate(rabies(undefined), []);
  assert.ok(html.includes("<dt>Lot / serial number</dt><dd>LOT-1</dd>"));
  assert.ok(!html.includes("Vaccine serial number"));
  matchesSnapshot("rabies-legacy-lot-serial", html);
});

test("general history certificates are unchanged by the rabies serial field", () => {
  const general = structuredClone(certificate);
  general.snapshot.kind = "vaccine_history";
  general.snapshot.details = {};
  const html = renderVaccineCertificate(general, []);
  assert.ok(html.includes("Lot / serial number"));
  assert.ok(!html.includes("Vaccine serial number"));
  matchesSnapshot("vaccine-history-v1", html);
});
