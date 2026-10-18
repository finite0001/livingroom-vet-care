/** Real handler plus owned Auth/PostgREST. OpenAI transport is an explicit in-process stub. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { proveCallNoteBrowser } from "./browser-proof.ts";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { createClinicalCallNoteHandler } from "../../supabase/functions/_shared/clinical-call-note-handler.ts";
import { validateCallNoteProcessingRead } from "../../supabase/functions/_shared/clinical-call-note-processing-model.ts";

const project = process.env.CALL_GENERATION_TEST_PROJECT;
assert.ok(project && process.env.CALL_GENERATION_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(/^project_id = "(lrv-call-generation-[a-f0-9]+)"/m)?.[1];
assert.ok(identity);
const labels = JSON.parse(execFileSync("docker", ["inspect", "supabase_db_" + identity], { encoding: "utf8" }))[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(realpathSync(labels["com.supabase.cli.workdir"]), realpathSync(project));
const status = parseOwnedRuntimeStatus(execFileSync("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert.equal(status.API_URL, "http://127.0.0.1:65521");
const seed = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.match(seed.actor_id, /^[a-f0-9-]{36}$/);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
async function rpc(db: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}
let enabled = false, providers = 0, finishes = 0;
const handler = createClinicalCallNoteHandler({
  get enabled() { return enabled; }, callEnabled: true, apiKey: "synthetic-not-an-api-key",
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const actorId = data.user.id;
    const db = createClient(status.API_URL, status.ANON_KEY, { ...options, global: { headers: { Authorization: "Bearer " + token } } });
    return { actorId,
      read: (id) => rpc(db, "read_clinical_call_note_processing_v1", { p_actor_id: actorId, p_id: id }),
      claim: (id, request) => rpc(db, "claim_clinical_call_note_v1", { p_actor_id: actorId, p_id: id, p_request: request }),
    };
  },
  dispatch: (jobId, attemptId) => rpc(service, "dispatch_clinical_call_note_v1", { p_job_id: jobId, p_attempt_id: attemptId }),
  finish: async (jobId, attemptId, result) => {
    finishes++;
    const value = await rpc(service, "finish_clinical_call_note_v1", { p_job_id: jobId, p_attempt_id: attemptId, p_result: result });
    if (finishes === 1) throw Error("Synthetic lost acknowledgement after committed finish");
    return value;
  },
  fail: async (jobId, attemptId, uncertain, code, details) => { await rpc(service, "fail_clinical_call_note_v1", { p_job_id: jobId, p_attempt_id: attemptId, p_uncertain: uncertain, p_code: code, p_details: details }); },
  providerFetch: async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init?.redirect, "error");
    providers++;
    const request = JSON.parse(String(init?.body)), input = JSON.parse(request.input);
    assert.equal(request.store, false);
    assert.match(input.job_id, /^[a-f0-9-]{36}$/);
    const segment = input.segments[0];
    const payload = { contract_version: "clinical-call-note-payload-v1", review_flags: [],
      fields: input.template.definition.fields.map((field: { id: string }, index: number) => ({
        field_id: field.id, status: index === 0 ? "supported" : "missing", uncertainty: "",
        claims: index === 0 ? [{ text: "Owner reports historical vomiting; vaccine declined.", patient_scope: "selected_patient",
          supports: [{ segment_ordinal: segment.ordinal, segment_sha256: segment.text_sha256, from: 0, to: segment.text.length, quote: segment.text }] }] : [],
      })),
    };
    return new Response(JSON.stringify({ id: "synthetic-call-response-handler", model: "gpt-6-luna", status: "completed", error: null, incomplete_details: null,
      output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    }), { headers: { "content-type": "application/json", "x-request-id": "synthetic-owned-worker-request" } });
  },
});
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const response = await handler(new Request("http://127.0.0.1/call-note", { method: "POST", headers: {
      "content-type": "application/json", Authorization: incoming.headers.authorization ?? "",
    }, body: Buffer.concat(chunks) }));
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end("Synthetic worker bridge failed"); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address === "object");
const post = () => fetch(`http://127.0.0.1:${address.port}/call-note`, { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + seed.token },
  body: JSON.stringify({ job_id: seed.job_id, attempt_id: seed.attempt_id, retry_of: null, reason: "", ack_cost: false }),
});
try {
  assert.equal((await post()).status, 503);
  assert.equal(providers, 0);
  enabled = true;
  const first = await post();
  const firstBody = await first.json();
  assert.equal(first.status, 200, "Actual SQL/handler bridge: " + JSON.stringify(firstBody));
  const saved = await validateCallNoteProcessingRead(firstBody);
  assert.equal(saved.job.proposal_id, seed.attempt_id);
  assert.equal(saved.attempts[0].state, "completed");
  assert.equal(providers, 1);
  assert.equal(finishes, 2, "Lost finish ACK repeats only the exact DB result");
  const recovered = await post();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), saved);
  assert.equal(providers, 1, "Repeating HTTP request cannot send a second provider request");
  const workerProof = { actual_worker_http_assertions: 15, stub_provider_requests: providers,
    real_provider_requests: 0, committed_finish_requests: finishes, lost_finish_ack_recovered: true };
  const browser = await proveCallNoteBrowser({ status, session: seed.owner_session, staffSession: seed.staff_session,
    petId: seed.browser_fixture.pet, encounterId: seed.browser_fixture.encounter, sourceId: seed.browser_source,
    bridgeUrl: `http://127.0.0.1:${address.port}`, evidenceBase: seed.evidence_base,
    sql: (query: string) => execFileSync("docker", ["exec", "-i", "supabase_db_" + identity, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim(),
  });
  process.stdout.write(JSON.stringify({ ...workerProof, browser, all_stub_provider_requests: providers }) + "\n");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
