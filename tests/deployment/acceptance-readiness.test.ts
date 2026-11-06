import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

interface Decision {
  id: string; decision: string; evidence: string[]; reviewer: string; reviewedAt: string | null;
}
interface Register {
  targetProjectRef: string;
  clinicalDecisions: Decision[];
  staffAcceptanceRun: {
    operator: string | null; dateTime: string | null; frontendUrl: string | null;
    commitOrDeployment: string | null; supabaseProject: string; steps: Decision[];
  };
}
function acceptedFixture(): Register {
  const register: Register = JSON.parse(readFileSync("docs/clinical-staff-acceptance-register.json", "utf8"));
  for (const row of [...register.clinicalDecisions, ...register.staffAcceptanceRun.steps]) {
    row.decision = "Accept"; row.evidence = ["synthetic-test-receipt-only"];
    row.reviewer = "Synthetic reviewer"; row.reviewedAt = "2026-11-06T20:00:00Z";
  }
  Object.assign(register.staffAcceptanceRun, { operator: "Synthetic operator", dateTime: "2026-11-06T20:00:00Z", frontendUrl: "http://127.0.0.1:18080", commitOrDeployment: "synthetic-candidate" });
  return register;
}
function run(register: Register, project = register.targetProjectRef) {
  const directory = mkdtempSync(join(tmpdir(), "lrv-acceptance-"));
  try {
    const file = join(directory, "register.json"); writeFileSync(file, JSON.stringify(register));
    const result = spawnSync(process.execPath, ["scripts/clinical-staff-acceptance-readiness.mjs", "--register", file, "--project-ref", project], { encoding: "utf8" });
    return { code: result.status, report: JSON.parse(result.stdout) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("dated attributable acceptance is scoped to the chosen environment", () => {
  const r = run(acceptedFixture()); assert.equal(r.code, 0); assert.equal(r.report.status, "accepted");
  assert.equal(run(acceptedFixture(), "mgadheotkdnrsatfivjy").code, 1);
  const unknown = acceptedFixture(); unknown.targetProjectRef = "legacy-or-unknown";
  assert.equal(run(unknown).code, 1);
});

test("missing evidence, date, reviewer, omitted rows and pending decisions block acceptance", () => {
  for (const change of [
    (r: Register) => { r.clinicalDecisions[0].evidence = []; },
    (r: Register) => { r.staffAcceptanceRun.steps[0].evidence = [" "]; },
    (r: Register) => { r.clinicalDecisions[0].reviewedAt = null; },
    (r: Register) => { r.staffAcceptanceRun.steps[0].reviewer = ""; },
    (r: Register) => { r.clinicalDecisions[0].reviewer = "  "; },
    (r: Register) => { r.clinicalDecisions[0].reviewedAt = "2099-01-01T00:00:00Z"; },
    (r: Register) => { r.clinicalDecisions[0].reviewedAt = "2026-02-30T00:00:00Z"; },
    (r: Register) => { r.staffAcceptanceRun.operator = " "; },
    (r: Register) => { r.staffAcceptanceRun.commitOrDeployment = " "; },
    (r: Register) => { r.staffAcceptanceRun.frontendUrl = "file:///tmp/fixture"; },
    (r: Register) => { r.staffAcceptanceRun.frontendUrl = " "; },
    (r: Register) => { r.staffAcceptanceRun.dateTime = "invalid"; },
    (r: Register) => { r.staffAcceptanceRun.dateTime = "2099-01-01T00:00:00Z"; },
    (r: Register) => { r.clinicalDecisions.pop(); },
    (r: Register) => { r.staffAcceptanceRun.steps[0].decision = "Pending"; },
    (r: Register) => { r.clinicalDecisions[0].decision = "Not in pilot scope"; r.clinicalDecisions[0].evidence = []; },
  ]) { const r = acceptedFixture(); change(r); assert.equal(run(r).code, 1); }
});
