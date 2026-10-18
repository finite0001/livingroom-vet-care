/** Offline request/probe-input planner. Never loads credentials or contacts a service. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { verifyFrozenCallBundle } from "./evaluation-offline.ts";
export const CALL_PROVIDER_BUNDLE_SHA256 = "ab55997d352dba503ecd5d654b5ee7e0cbc6e406c3ea575c8b217537c43677a6";
export const CALL_PROVIDER_PROJECT = "kothoqicubowyhwfsrte";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const TRANSPORT_FILES = [
  "tests/clinical-calls/synthetic-provider-plan.ts", "tests/clinical-calls/synthetic-provider.py",
  "tests/clinical-calls/synthetic-provider-probe.ts.in", "tests/clinical-calls/synthetic-provider-plan.test.ts",
  "tests/clinical-calls/test_synthetic_provider.py",
  "supabase/functions/clinical-call-note-process/deno.json", "supabase/functions/clinical-call-note-process/deno.lock",
];
export async function planCallProviderBundle(bytes: Uint8Array) {
  if (bytes.byteLength > 4000000) throw Error("Frozen call bundle exceeds planner limit.");
  const bundle = await verifyFrozenCallBundle(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (bundle.bundle_sha256 !== CALL_PROVIDER_BUNDLE_SHA256 || bundle.requested_model !== "gpt-6-luna"
    || bundle.corpus_revision !== "lrv-call-fidelity-ten-v1" || !bundle.synthetic_only || bundle.cases.length !== 10) {
    throw Error("This transport accepts only the reviewed ten-case frozen candidate.");
  }
  const cases = bundle.cases.map((item, index) => {
    if (item.id !== String.fromCharCode(65 + index)) throw Error("Exact A–J order required.");
    const request = z.object({ model: z.literal("gpt-6-luna"), store: z.literal(false), background: z.literal(false),
      stream: z.literal(false), max_output_tokens: z.literal(8000), input: z.string() }).passthrough().parse(JSON.parse(item.request_json));
    if ("service_tier" in request || "tools" in request || sha(item.request_json) !== item.request_sha256) throw Error("Frozen provider request differs.");
    return { id: item.id, title: item.title, request_sha256: item.request_sha256,
      request_body_base64: Buffer.from(item.request_json).toString("base64"), context_sha256: sha(JSON.stringify(item.context)),
      context_base64: Buffer.from(JSON.stringify(item.context)).toString("base64"), model: request.model,
      maximum_output_tokens: request.max_output_tokens, request_service_tier: "unpinned" };
  });
  return { contract: "lrv-call-provider-frozen-input-v1", staging_project: CALL_PROVIDER_PROJECT,
    bundle_sha256: bundle.bundle_sha256, bundle_file_sha256: sha(bytes), corpus_revision: bundle.corpus_revision,
    requested_model: bundle.requested_model, immutable_model_snapshot: false,
    source_sha256: bundle.source_sha256,
    transport_source_sha256: Object.fromEntries(TRANSPORT_FILES.map((file) => [file, sha(readFileSync(new URL("../../" + file, import.meta.url)))])),
    cases };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { process.stdout.write(JSON.stringify(await planCallProviderBundle(readFileSync(process.argv[2]))) + "\n"); }
  catch { process.stderr.write("Offline fixed call transport planning refused. No hosted/provider operation attempted.\n"); process.exitCode = 1; }
}
