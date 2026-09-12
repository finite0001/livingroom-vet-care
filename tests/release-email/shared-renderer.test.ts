import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRecordRelease as browser } from "../../src/hub/features/record-releases/print.ts";
import { renderRecordRelease as edge } from "../../supabase/functions/_shared/record-release-renderer.ts";
import { renderVaccineCertificate as browserCertificate } from "../../src/hub/features/certificates/print.ts";
import { renderVaccineCertificate as edgeCertificate } from "../../supabase/functions/_shared/vaccine-certificate-renderer.ts";
test("browser and Edge paths expose the same report and certificate renderer functions", () => {
  assert.equal(browser, edge);
  assert.equal(browserCertificate, edgeCertificate);
});
