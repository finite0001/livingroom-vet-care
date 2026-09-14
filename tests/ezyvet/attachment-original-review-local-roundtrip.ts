/** Chart review through actual local Auth/PostgREST/Storage and the HTTP handler. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RequestListener } from "node:http";
import { createHandler } from "../../supabase/functions/retrieve-reviewed-ezyvet-attachment/handler.ts";
interface Fixture {
  apiUrl: string; anonKey: string; serviceHeaders: Record<string, string>;
  staffHeaders: Record<string, string>; actor: string; pet: string; captureId: string; captureHash: string;
  originalBytes: Uint8Array; origin: string;
  sql(query: string): string;
  serve(handler: RequestListener): Promise<string>;
}
export async function verifyOriginalChartReview(f: Fixture): Promise<number> {
  let checks = 0;
  const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const api = async (path: string, body: unknown, headers = f.staffHeaders) => {
    const response = await fetch(f.apiUrl + path, { method: "POST", headers, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error("Local review request rejected"), { code: result.code || String(response.status) });
    return result;
  };
  const rpc = (name: string, args: object, headers = f.staffHeaders) => api(`/rest/v1/rpc/${name}`, args, headers);
  const candidates = await rpc("list_ezyvet_attachment_original_candidates", { p_pet_id: f.pet, p_limit: 1 });
  check(candidates.candidates.some((c: { capture_id: string }) => c.capture_id === f.captureId), "Owned ready original is discoverable for chart review");
  const candidate = candidates.candidates[0];
  const approval = { p_id: randomUUID(), p_pet_id: f.pet, p_capture_id: f.captureId,
    p_expected_capture_hash: f.captureHash, p_expected_patient_version: candidate.patient_version,
    p_previous_record_id: null, p_review_reason: "Synthetic provenance review", p_attest: true };
  const absent = await rpc("recover_ezyvet_attachment_review_action", { p_id: approval.p_id, p_pet_id: f.pet });
  check(absent === null, "Absent action recovery does not invent a commitment");
  const approved = await rpc("approve_ezyvet_attachment_original", approval);
  check(approved.status === "committed" && approved.record.capture_hash === f.captureHash && approved.record.entry_method === "staff_reviewed_ezyvet_api_attachment_v1", "Atomic admission retains exact API byte provenance");
  const recovered = await rpc("recover_ezyvet_attachment_review_action", { p_id: approval.p_id, p_pet_id: f.pet });
  check(JSON.stringify(recovered) === JSON.stringify(approved), "Lost admission response recovers exact immutable action");
  check(JSON.stringify(await rpc("approve_ezyvet_attachment_original", approval)) === JSON.stringify(approved), "Approval replay does not create another chart version");
  await assert.rejects(rpc("approve_ezyvet_attachment_original", { ...approval, p_review_reason: "Substituted reason" })); checks++;
  const abandonedArgs = { ...approval, p_id: randomUUID(), p_expected_patient_version: 99999 };
  check((await rpc("abandon_ezyvet_attachment_original_approval", abandonedArgs)).status === "abandoned", "Unsubmitted stale admission can be durably abandoned");
  check((await rpc("approve_ezyvet_attachment_original", abandonedArgs)).status === "abandoned", "Delayed admission cannot revive abandoned intent");
  const record = approved.record;
  const history = await rpc("read_ezyvet_attachment_original_history", { p_pet_id: f.pet, p_limit: 1 });
  check(history.records[0].record.id === record.id && history.records[0].acknowledgments.length === 0, "Admission does not imply clinical acknowledgment");
  const email = `chart-dvm-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}-Aa1!`;
  const dvm = (await api("/auth/v1/admin/users", { email, password, email_confirm: true }, f.serviceHeaders)).id;
  f.sql(`insert into public.user_roles(user_id,role) values(${quote(dvm)},'DVM');`);
  const auth = await api("/auth/v1/token?grant_type=password", { email, password }, { apikey: f.anonKey, "Content-Type": "application/json" });
  const dvmHeaders = { ...f.staffHeaders, Authorization: `Bearer ${auth.access_token}` };
  let reads = 0;
  let afterRead: (() => void) | null = null;
  const handler = createHandler({ env: (key: string) => key === "APP_URL" ? f.origin : undefined, gateway: {
    authenticate: async (bearer: string) => {
      const response = await fetch(f.apiUrl + "/auth/v1/user", { headers: { apikey: f.anonKey, Authorization: `Bearer ${bearer}` } });
      if (!response.ok) return null;
      const user = await response.json();
      const [active, role] = await Promise.all([
        rpc("is_active_staff", { _user_id: user.id }, f.serviceHeaders),
        rpc("has_role", { _user_id: user.id, _role: "DVM" }, f.serviceHeaders),
      ]);
      return { id: user.id, activeDvm: active === true && role === true };
    },
    context: (recordId: string, petId: string, actor: string) => rpc("get_ezyvet_attachment_original_review_context", { p_record_id: recordId, p_pet_id: petId, p_actor: actor }, f.serviceHeaders),
    readOriginal: async original => {
      reads++;
      const response = await fetch(f.apiUrl + "/storage/v1/object/authenticated/" + encodeURIComponent(original.bucket_id) + "/" + original.object_path.split("/").map(encodeURIComponent).join("/"), {
        headers: { ...f.serviceHeaders, "Accept-Encoding": "identity" }, redirect: "error", signal: AbortSignal.timeout(20_000),
      });
      if (afterRead) { const action = afterRead; afterRead = null; action(); }
      return response;
    },
  } });
  const endpoint = await f.serve(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const response = await handler(new Request("http://127.0.0.1/retrieve-reviewed-ezyvet-attachment", { method: req.method, headers: req.headers as Record<string, string>, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(new Uint8Array(await response.arrayBuffer()));
  });
  const download = (headers = dvmHeaders, petId = f.pet, recordId = record.id) => fetch(endpoint, { method: "POST", headers: { ...headers, Origin: f.origin }, body: JSON.stringify({ record_id: recordId, pet_id: petId }) });
  check((await download(f.staffHeaders)).status === 403 && reads === 0, "ADMIN alone cannot use DVM chart retrieval");
  check((await download(dvmHeaders, randomUUID())).status === 403 && reads === 0, "Wrong patient denied before private byte read");
  check((await download(dvmHeaders, f.pet, randomUUID())).status === 403 && reads === 0, "Unadmitted record denied before private byte read");
  const response = await download();
  check(response.ok && response.headers.get("cache-control")?.includes("no-store") && response.headers.get("x-content-type-options") === "nosniff", "DVM chart download is private and non-sniffable");
  check(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(f.originalBytes)), "DVM retrieves exact original bytes using admitted provenance");
  afterRead = () => { f.sql(`delete from public.user_roles where user_id=${quote(dvm)} and role='DVM';`); };
  check((await download()).status === 403, "Role removal during Storage read prevents returning bytes");
  f.sql(`insert into public.user_roles(user_id,role) values(${quote(dvm)},'DVM');`);
  await assert.rejects(rpc("list_ezyvet_attachment_original_candidates", { p_pet_id: f.pet }, dvmHeaders)); checks++;
  const acknowledgment = { p_id: randomUUID(), p_pet_id: f.pet, p_record_id: record.id, p_expected_record_hash: record.record_hash, p_expected_capture_hash: f.captureHash, p_attest: true };
  await assert.rejects(rpc("acknowledge_ezyvet_attachment_original", acknowledgment)); checks++;
  const ack = await rpc("acknowledge_ezyvet_attachment_original", acknowledgment, dvmHeaders);
  check(ack.acknowledgment.actor_id === dvm && ack.acknowledgment.record_hash === record.record_hash, "Separate DVM acknowledgment pins the admitted version");
  check(JSON.stringify(await rpc("recover_ezyvet_attachment_review_action", { p_id: acknowledgment.p_id, p_pet_id: f.pet }, dvmHeaders)) === JSON.stringify(ack), "DVM recovers acknowledgment by its original UUID");
  const privateContext = await rpc("get_ezyvet_attachment_original_review_context", { p_record_id: record.id, p_pet_id: f.pet, p_actor: dvm }, f.serviceHeaders);
  const path = f.apiUrl + "/storage/v1/object/" + privateContext.original.bucket_id + "/" + privateContext.original.object_path;
  check(!(await fetch(path, { headers: dvmHeaders })).ok, "DVM cannot bypass verification with direct Storage read");
  const corrupt = new Uint8Array(f.originalBytes); corrupt[corrupt.length - 2] ^= 1;
  const write = (bytes: Uint8Array) => fetch(path, { method: "PUT", headers: { ...f.serviceHeaders, "Content-Type": privateContext.original.mime_type, "x-upsert": "true" }, body: bytes });
  check((await write(corrupt)).ok, "Owned local fixture simulates same-size byte corruption");
  check(!(await download()).ok, "Same-size corrupted original cannot be returned as verified");
  check((await write(f.originalBytes)).ok && (await download()).ok, "Restoring exact fixture bytes restores verified retrieval");
  const withdrawal = { p_id: randomUUID(), p_pet_id: f.pet, p_record_id: record.id, p_expected_record_hash: record.record_hash, p_reason: "Synthetic mistaken admission correction" };
  const withdrawn = await rpc("withdraw_ezyvet_attachment_original", withdrawal);
  check(withdrawn.withdrawal.record_id === record.id, "Withdrawal appends a correction against the exact chart record");
  check((await download()).ok, "Withdrawn originals remain available to DVMs as historical evidence");
  check(JSON.stringify(await rpc("acknowledge_ezyvet_attachment_original", acknowledgment, dvmHeaders)) === JSON.stringify(ack), "Committed acknowledgment recovers after withdrawal");
  await assert.rejects(rpc("acknowledge_ezyvet_attachment_original", { ...acknowledgment, p_id: randomUUID() }, dvmHeaders)); checks++;
  const finalHistory = await rpc("read_ezyvet_attachment_original_history", { p_pet_id: f.pet }, dvmHeaders);
  check(finalHistory.records[0].withdrawal.id === withdrawn.withdrawal.id && finalHistory.records[0].acknowledgments[0].id === ack.acknowledgment.id, "History retains both acknowledgment and later withdrawal");
  check((await rpc("recover_ezyvet_attachment_review_action", { p_id: approval.p_id, p_pet_id: f.pet }, dvmHeaders)) === null, "Another actor cannot recover owned review actions");
  f.sql(`delete from public.user_roles where user_id=${quote(dvm)} and role='DVM';`);
  const beforeRoleRead = reads;
  check((await download()).status === 403 && reads === beforeRoleRead, "Removed DVM role denies bytes before Storage");
  return checks;
}
