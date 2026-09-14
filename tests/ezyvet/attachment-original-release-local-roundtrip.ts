/** Real local Auth, Storage and release capture; called only by the owned disposable runner. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RequestListener } from "node:http";
import { createReleaseApiOriginalReader } from "../../supabase/functions/_shared/release-api-original-download.ts";
import { createPrepareReleaseEmailHandler } from "../../supabase/functions/_shared/prepare-release-email.ts";
import { createStaffDocumentLinkHandler, createRetrieveDocumentLinkHandler } from "../../supabase/functions/_shared/document-link-http.ts";
import { documentLinkConfig, materializeDocumentLink } from "../../supabase/functions/_shared/document-link-capability.ts";
import { buildReleaseEmailPayload } from "../../supabase/functions/_shared/release-email-payload.ts";
import { buildDocumentLinkArtifacts } from "../../supabase/functions/_shared/document-link-artifacts.ts";
import { renderRecordRelease } from "../../supabase/functions/_shared/record-release-renderer.ts";
interface Fixture {
  apiUrl: string; anonKey: string; serviceHeaders: Record<string, string>;
  staffHeaders: Record<string, string>; actor: string; pet: string; recordId: string;
  originalBytes: Uint8Array; origin: string;
  sql(query: string): string;
  serve(handler: RequestListener): Promise<string>;
}
export async function prepareOriginalReleaseChecks(f: Fixture) {
  let checks = 0, reads = 0;
  const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const rpc = async (name: string, args: object, headers = f.staffHeaders) => {
    const response = await fetch(`${f.apiUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw Object.assign(new Error(`Local release RPC rejected: ${name}`), { code: data?.code || String(response.status) });
    return data;
  };
  const database = (headers: Record<string, string>) => ({ rpc: async (name: string, args: object) => {
    try { return { data: await rpc(name, args, headers), error: null }; }
    catch (error) { return { data: null, error }; }
  } });
  const service = database(f.serviceHeaders), staff = database(f.staffHeaders);
  const authenticate = async (token: string) => {
    const response = await fetch(`${f.apiUrl}/auth/v1/user`, { headers: { apikey: f.anonKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const user = await response.json();
    return user.id === f.actor ? { actorId: user.id, db: staff } : null;
  };
  const readApiOriginal = createReleaseApiOriginalReader({ service, url: f.apiUrl,
    serviceKey: f.serviceHeaders.Authorization.replace(/^Bearer /, ""), apiKey: f.anonKey,
    fetch: async (input, init) => { reads++; return fetch(input, init); },
  });
  const download = async () => { throw new Error("API-only release must not read patient-documents"); };
  const sender = { from: "care@example.test", replyTo: "care@example.test" };
  const policy = f.sql("select coalesce((select to_jsonb(p)::text from public.record_release_policy p where id),'null');");
  const ids: string[] = [];
  const record = JSON.parse(f.sql(`select to_jsonb(r)::text from public.ezyvet_attachment_review_records r where id=${quote(f.recordId)};`));
  const client = record.client_id;
  const email = f.sql(`select primary_email from public.clients where id=${quote(client)};`);
  const phone = "+13035550492";
  const conversation = randomUUID(); ids.push(conversation);
  f.sql(`insert into public.conversations(id,client_id) values(${quote(conversation)},${quote(client)});`);
  const candidates = await rpc("list_record_release_sources_v9", { p_pet_id: f.pet });
  check(candidates.policy_v9_accepted === false && candidates.api_original_ids.some((r: { id: string }) => r.id === record.id), "Reviewed original is selectable while new clinical policy remains unaccepted");
  const selection = { api_original_ids: [record.id] };
  const args = (channel: "EMAIL" | "SMS") => ({ p_pet_id: f.pet, p_client_id: client, p_channel: channel,
    p_recipient: channel === "EMAIL" ? email : phone, p_selection: selection });
  const unaccepted = await rpc("preview_record_release_v9", args("EMAIL"));
  await assert.rejects(rpc("confirm_record_release", { ...args("EMAIL"), p_id: randomUUID(),
    p_reviewed_snapshot: unaccepted.snapshot, p_reviewed_hash: unaccepted.source_hash, p_attest_review: true })); checks++;
  f.sql(`select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: f.actor, role: "authenticated" }))},false);
    insert into public.record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version)
    values(true,true,${quote(f.actor)},now(),'Synthetic owned local test only',9)
    on conflict(id) do update set enabled=true,accepted_by=excluded.accepted_by,accepted_at=now(),accepted_schema_version=9;`);
  await rpc("record_sms_consent", { p_actor_id: f.actor, p_client_id: client, p_phone: phone, p_opted_in: true,
    p_method: "WRITTEN", p_details: "Synthetic local acceptance only", p_expected_updated_at: null });
  const release = async (channel: "EMAIL" | "SMS") => {
    const preview = await rpc("preview_record_release_v9", args(channel));
    check(preview.snapshot.schema_version === 9 && preview.snapshot.attachments.length === 0 && preview.snapshot.api_originals.length === 1,
      "Actual API-only preview normalizes inherited selection families");
    check(!JSON.stringify(preview).includes("object_path") && !JSON.stringify(preview).includes("bucket_id"), "Staff snapshot contains evidence without private Storage locators");
    const id = randomUUID(); ids.push(id);
    await rpc("confirm_record_release", { ...args(channel), p_id: id, p_reviewed_snapshot: preview.snapshot,
      p_reviewed_hash: preview.source_hash, p_attest_review: true });
    return rpc("read_record_release", { p_id: id });
  };
  const e = await release("EMAIL"), s = await release("SMS");
  const original = e.release.snapshot.api_originals[0];
  check(original.record.record_hash === record.record_hash && original.acknowledgment.record_hash === record.record_hash,
    "Snapshot pins admitted file and exact DVM acknowledgment");
  const rendered = renderRecordRelease({ preview: e.release });
  check(rendered.includes(record.content_sha256) && rendered.includes(record.source_attachment_id), "Shared renderer accepts actual SQL evidence and discloses source/checksum");
  const requestId = randomUUID(); ids.push(requestId);
  const emailArgs = { p_request_id: requestId, p_release_id: e.release.id, p_conversation_id: conversation,
    p_subject: "Synthetic reviewed API originals", p_body: "Synthetic local release", p_release_hash: e.release.source_hash };
  const prepared = await rpc("prepare_release_email", emailArgs);
  const contextArgs = { p_family: "release_email", p_id: requestId, p_actor_id: f.actor, p_record_id: record.id };
  await assert.rejects(rpc("get_release_api_original_context", contextArgs)); checks++;
  await assert.rejects(rpc("get_release_api_original_context", { ...contextArgs, p_actor_id: randomUUID() }, f.serviceHeaders)); checks++;
  const context = await rpc("get_release_api_original_context", contextArgs, f.serviceHeaders);
  check(context.record_hash === record.record_hash && context.content_sha256 === record.content_sha256, "Service context derives exact prepared delivery and frozen original");
  const frozen = await buildReleaseEmailPayload(prepared.request, e, sender, download,
    item => readApiOriginal(item, "release_email", requestId, f.actor));
  const payload = JSON.parse(frozen.payload_text);
  check(payload.attachments.length === 2 && Buffer.from(payload.attachments[1].content, "base64").equals(Buffer.from(f.originalBytes)), "Native bounded Storage reader returns exact original for email");
  const altered = new Uint8Array(f.originalBytes); altered[altered.length - 2] ^= 1;
  const changed = structuredClone(payload); changed.attachments[1].content = Buffer.from(altered).toString("base64");
  await assert.rejects(rpc("capture_release_email_payload", { p_request_id: requestId, p_actor_id: f.actor,
    p_payload_text: JSON.stringify(changed) }, f.serviceHeaders)); checks++;
  const wrap = (handler: (req: Request) => Promise<Response>) => f.serve(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    const response = await handler(new Request("http://127.0.0.1/local-release", { method: req.method,
      headers: req.headers as Record<string, string>, body }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(new Uint8Array(await response.arrayBuffer()));
  });
  const emailEndpoint = await wrap(createPrepareReleaseEmailHandler({ authenticate, service, sender, download, readApiOriginal }));
  const post = (url: string, body: object) => fetch(url, { method: "POST", headers: f.staffHeaders, body: JSON.stringify(body) });
  const objectUrl = `${f.apiUrl}/storage/v1/object/${context.bucket_id}/${context.object_path}`;
  const write = (bytes: Uint8Array) => fetch(objectUrl, { method: "PUT", headers: { ...f.serviceHeaders,
    "Content-Type": context.mime_type, "x-upsert": "true" }, body: bytes });
  check((await write(altered)).ok, "Owned fixture substitutes same-size Storage bytes before capture");
  const beforeCorruptRead = reads;
  check(!(await post(emailEndpoint, emailArgs)).ok && reads > beforeCorruptRead &&
    f.sql(`select count(*) from public.release_email_payloads where request_id=${quote(requestId)};`) === "0",
    "Actual HTTP download rejects corrupt bytes before creating any frozen payload");
  check((await write(f.originalBytes)).ok, "Exact Storage bytes restored before capture");
  const savedEmailResponse = await post(emailEndpoint, emailArgs);
  check(savedEmailResponse.ok, "Actual HTTP email preparation captures verified API original");
  const savedEmail = await savedEmailResponse.json();
  check(savedEmail.payload_hash === frozen.payload_hash, "Handler and independently built email freeze identical bytes");
  const linkId = randomUUID(); ids.push(linkId);
  const linkPreview = await rpc("preview_document_link", { p_family: "record_release", p_source_id: s.release.id, p_client_id: client });
  const config = documentLinkConfig({ origin: f.origin, activeKeyVersion: "synthetic",
    keys: JSON.stringify({ synthetic: Buffer.from("synthetic-local-secret-00000000000").toString("base64") }), publicEnabled: "true" });
  const linkArgs = { p_request_id: linkId, p_family: "record_release", p_source_id: s.release.id,
    p_client_id: client, p_conversation_id: conversation, p_recipient: phone, p_source_hash: linkPreview.source_hash,
    p_expires_at: new Date(Date.now() + 86400000).toISOString(), p_message_template: "Synthetic records: {{document_link}}" };
  await rpc("prepare_document_link", { ...linkArgs, p_origin: config.origin, p_key_version: config.activeKeyVersion });
  const linkContext = await rpc("document_link_capture_context", { p_id: linkId, p_actor_id: f.actor }, f.serviceHeaders);
  const capability = await materializeDocumentLink(linkContext.grant, config);
  const practice = { name: "Synthetic", address: "Synthetic", domain: null };
  const artifacts = await buildDocumentLinkArtifacts(linkContext.grant, practice, download,
    item => readApiOriginal(item, "document_link", linkId, f.actor));
  const parsed = JSON.parse(artifacts.payload_text);
  check(parsed.artifacts[1].api_original_id === record.id && parsed.artifacts[1].document_id === null,
    "Document-link API original is identified separately from patient documents");
  const wrongIdentity = structuredClone(parsed); wrongIdentity.artifacts[1].api_original_id = randomUUID();
  const captureArgs = { p_id: linkId, p_actor_id: f.actor, p_token_hash: capability.token_hash, p_message_hash: capability.message_hash };
  await assert.rejects(rpc("capture_document_link", { ...captureArgs, p_payload_text: JSON.stringify(wrongIdentity) }, f.serviceHeaders)); checks++;
  const changedLink = structuredClone(parsed); changedLink.artifacts[1].content = Buffer.from(altered).toString("base64");
  await assert.rejects(rpc("capture_document_link", { ...captureArgs, p_payload_text: JSON.stringify(changedLink) }, f.serviceHeaders)); checks++;
  const linkEndpoint = await wrap(createStaffDocumentLinkHandler({ config, authenticate, service, download, readApiOriginal, practice }, "prepare"));
  const savedLinkResponse = await post(linkEndpoint, linkArgs);
  check(savedLinkResponse.ok && (await savedLinkResponse.json()).artifact_hash === artifacts.artifact_hash,
    "Actual HTTP document-link preparation freezes exact original and deterministic manifest");
  // Byte recovery must not depend on the private object being readable again.
  check((await write(altered)).ok, "Owned fixture simulates same-size Storage corruption");
  const beforeRecovery = reads;
  check((await post(emailEndpoint, emailArgs)).ok && (await post(linkEndpoint, linkArgs)).ok && reads === beforeRecovery,
    "Captured HTTP retries recover without rereading corrupt private Storage");
  check((await write(f.originalBytes)).ok, "Exact owned Storage fixture restored");
  await rpc("attest_document_link", { p_request_id: linkId, p_reviewed_artifact_hash: artifacts.artifact_hash,
    p_reviewed_message_hash: capability.message_hash, p_attest: true });
  const publicEndpoint = await wrap(createRetrieveDocumentLinkHandler({ service, config }));
  const publicOriginal = await post(publicEndpoint, { grant_id: linkId, token: capability.token, artifact_index: 1 });
  check(publicOriginal.ok && Buffer.from(await publicOriginal.arrayBuffer()).equals(Buffer.from(f.originalBytes)),
    "Reviewed public capability returns exact frozen original before withdrawal");
  return async () => {
    const after = await rpc("read_record_release", { p_id: e.release.id });
    check(!after.eligible && JSON.stringify(after.release.snapshot) === JSON.stringify(e.release.snapshot),
      "Withdrawal invalidates delivery without changing issued snapshot");
    await assert.rejects(rpc("enqueue_release_email", { p_request_id: requestId, p_reviewed_payload_hash: frozen.payload_hash, p_attest: true })); checks++;
    await assert.rejects(rpc("enqueue_document_link_sms", { p_request_id: linkId, p_reviewed_artifact_hash: artifacts.artifact_hash,
      p_reviewed_message_hash: capability.message_hash, p_attest: true })); checks++;
    const before = reads;
    const emailRecovery = await post(emailEndpoint, emailArgs), linkRecovery = await post(linkEndpoint, linkArgs);
    check(emailRecovery.ok && (await emailRecovery.json()).payload_hash === frozen.payload_hash && linkRecovery.ok &&
      (await linkRecovery.json()).artifact_hash === artifacts.artifact_hash && reads === before,
      "Both HTTP retries recover exact frozen packages after withdrawal without private reads");
    check(!(await post(publicEndpoint, { grant_id: linkId, token: capability.token, artifact_index: 1 })).ok,
      "Public capability cannot return a withdrawn original");
    await assert.rejects(rpc("get_release_api_original_context", contextArgs, f.serviceHeaders)); checks++;
    // Only exact synthetic release/request descendants are removed; chart evidence is retained.
    const patterns = ids.map(id => quote(`%${id}%`)).join(",");
    f.sql(`begin; set local session_replication_role=replica;
      do $cleanup$ declare t record; begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop
      execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;
      delete from public.record_release_policy where id;
      ${policy === "null" ? "" : `insert into public.record_release_policy select * from jsonb_populate_record(null::public.record_release_policy,${quote(policy)}::jsonb);`}
      commit;`);
    check(f.sql("select coalesce((select to_jsonb(p)::text from public.record_release_policy p where id),'null');") === policy,
      "Synthetic policy acceptance restored exactly");
    check(f.sql(`select count(*) from public.ezyvet_attachment_review_records where id=${quote(record.id)};`) === "1",
      "Release fixture cleanup preserves original chart evidence");
    return checks;
  };
}
