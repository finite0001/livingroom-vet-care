import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

interface SchemaInventory {
  generatedAt: string;
  projectRef?: string;
  dump: { ok: boolean };
  objects: { tables: string[]; functions: string[] };
}
interface FunctionInventory {
  generatedAt: string;
  projectRef?: string;
  command: { ok: boolean };
  remoteFunctions: { slug: string; status: string; verifyJwt: boolean }[];
}

function runInventory(change: (schema: SchemaInventory, functions: FunctionInventory) => void = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "lrv-hub-readiness-"));
  try {
    const schema: SchemaInventory = { generatedAt: new Date().toISOString(), projectRef: "mgadheotkdnrsatfivjy", dump: { ok: true }, objects: {
      tables: ["public.outbound_deliveries"],
      functions: ["list_website_inquiries", "read_website_inquiry", "update_website_inquiry", "authorize_website_inquiry_reply", "save_appointment", "schedule_clinicians", "list_daily_communications", "read_daily_communication", "retry_outbound_delivery", "cancel_outbound_delivery"].map(name => `public.${name}`),
    } };
    const config = readFileSync("supabase/config.toml", "utf8");
    const functions: FunctionInventory = { generatedAt: new Date().toISOString(), projectRef: schema.projectRef, command: { ok: true }, remoteFunctions: ["public-contact", "enqueue-message", "dispatch-outbound-deliveries", "dispatch-outbox", "resend-delivery-webhook", "cloudtalk-webhook"].map(slug => ({ slug, status: "ACTIVE", verifyJwt: config.split(`[functions.${slug}]`)[1].split(/\n\[/)[0].match(/verify_jwt\s*=\s*(true|false)/)?.[1] === "true" })) };
    change(schema, functions);
    writeFileSync(join(directory, "schema.json"), JSON.stringify(schema));
    writeFileSync(join(directory, "functions.json"), JSON.stringify(functions));
    const result = spawnSync(process.execPath, ["scripts/hub-workflow-readiness.mjs", "--schema-inventory", join(directory, "schema.json"), "--functions-inventory", join(directory, "functions.json"), "--fail-on-blockers"], { encoding: "utf8" });
    return { status: result.status, report: JSON.parse(result.stdout) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("readiness follows current inquiry, editor and daily communication wiring", () => {
  const { status, report } = runInventory();
  assert.equal(status, 0);
  assert.equal(report.summary.blockers, 0);
  assert.equal(report.summary.hostedBlockers, 0);
  assert.match(report.scope, /not full beta acceptance/);
});

test("old, failed, or cross-project evidence cannot certify hosted readiness", () => {
  for (const change of [
    (schema: SchemaInventory) => { schema.generatedAt = "2026-01-01T00:00:00Z"; },
    (schema: SchemaInventory) => { schema.dump.ok = false; },
    (schema: SchemaInventory) => { delete schema.projectRef; },
    (_: SchemaInventory, functions: FunctionInventory) => { functions.projectRef = "kothoqicubowyhwfsrte"; },
  ]) assert.equal(runInventory(change).status, 1);
});

test("presence alone cannot admit inactive or incorrectly authenticated edge workers", () => {
  for (const change of [
    (_: SchemaInventory, functions: FunctionInventory) => { functions.remoteFunctions[0].status = "INACTIVE"; },
    (_: SchemaInventory, functions: FunctionInventory) => { functions.remoteFunctions[0].verifyJwt = !functions.remoteFunctions[0].verifyJwt; },
    (_: SchemaInventory, functions: FunctionInventory) => { functions.remoteFunctions = []; },
  ]) assert.equal(runInventory(change).status, 1);
});
