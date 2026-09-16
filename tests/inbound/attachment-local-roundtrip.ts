import { runAbandonedUploadCleanup } from "../../supabase/functions/_shared/abandoned-cleanup-adapter.ts";
import { createServer, type Server } from "node:http";
import { createIncomingAttachmentReadHandler } from "../../supabase/functions/_shared/inbound/read-attachment.ts";
/** Actual localhost HTTP/Auth/RPC/Storage; Node-hosted shared handlers, provider bytes synthetic. */
import { createInboundAttachmentCaptureHandler } from "../../supabase/functions/_shared/inbound/capture-attachment.ts";
import { storeIncomingOriginal } from "../../supabase/functions/_shared/inbound/store-attachment.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const project = process.env.PAYMENT_TEST_PROJECT;
assert.ok(project, "Explicit disposable local project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId, "Local project ID required");
const containerProject = execFileSync("docker", ["inspect", `supabase_db_${projectId}`, "--format", '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
assert.equal(containerProject, projectId, "Disposable database project label must match");
const local = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) =>
  execFileSync("docker", [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    .trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = (token: string) =>
  createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
let checks = 0;
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks++;
};
async function staff() {
  const email = `upload-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error("Synthetic staff creation failed");
  }
  const id = created.data.user.id; actor = id;
  sql(`insert into user_roles(user_id,role) values(${quote(id)},'ADMIN');`);
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) {
    throw new Error("Synthetic staff sign-in failed");
  }
  return {
    id,
    token: login.data.session.access_token,
    client: userClient(login.data.session.access_token),
  };
}

const ids = { client: randomUUID(), conversation: randomUUID(), message: randomUUID(), inbound: randomUUID(), event: randomUUID(), email: randomUUID(), attachment: randomUUID() };
const paths = new Set<string>();
const abandonedPaths = new Set<string>();
const extraFixtureIds: string[] = [];
let actor = "";
let server: Server | null = null;
const failures: unknown[] = [];
try {
  const owner = await staff(); actor = owner.id;
  const bytes = new TextEncoder().encode("%PDF-synthetic-incoming-original");
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  const metadata = { id: ids.attachment, filename: "incoming.pdf", content_type: "application/pdf", size: bytes.length };
  const saved = await owner.client.rpc("save_client", { p_actor_id: actor, p_client_id: null, p_expected_version: null, p_first_name: "Incoming", p_last_name: "Fixture", p_primary_phone: null, p_primary_email: "incoming@example.test", p_preferred_channel: "EMAIL", p_mailing_address: null, p_housecall_address: null });
  if (saved.error) throw saved.error;
  ids.client = (Array.isArray(saved.data) ? saved.data[0] : saved.data).id;
  sql(`begin;
    insert into conversations(id,client_id) values(${quote(ids.conversation)},${quote(ids.client)});
    insert into messages(id,conversation_id,type,sender_type,content,is_internal) values(${quote(ids.message)},${quote(ids.conversation)},'EMAIL','CLIENT','Synthetic file',false);
    insert into communication_provider_events(id,provider,event_id,resource_id,event_type,payload_hash,metadata,state) values(${quote(ids.event)},'resend',${quote(ids.event)},${quote(ids.email)},'inbound',repeat('a',64),'{}','processed');
    insert into communication_inbound(id,provider,resource_id,event_id,channel,sender,recipient,body,attachment_metadata,occurred_at,client_id,conversation_id,message_id) values(${quote(ids.inbound)},'resend',${quote(ids.email)},${quote(ids.event)},'EMAIL','incoming@example.test','care@example.test','Synthetic file',${quote(JSON.stringify([metadata]))}::jsonb,now(),${quote(ids.client)},${quote(ids.conversation)},${quote(ids.message)});
    commit;`);
  const bucket = service.storage.from("inbound-attachment-originals");
  let downloads = 0, writes = 0, loseReceipt = true;
  const handler = createInboundAttachmentCaptureHandler({
    authenticate: async token => { const { data, error } = await service.auth.getUser(token); if (error) return null; return data.user?.id ?? null; },
    claim: async input => {
      const { data, error } = await service.rpc("claim_inbound_attachment", { p_inbound_id: input.inboundId, p_attachment_id: input.attachmentId, p_version: input.version, p_actor_id: input.actorId });
      if (error) throw error; return data;
    },
    retrieve: async (email, meta) => {
      assert.equal(email, ids.email); assert.deepEqual(meta, metadata); downloads++;
      return { bytes, mimeType: metadata.content_type, filename: metadata.filename, sha256 };
    },
    store: async (path, captured) => { paths.add(path); writes++; await storeIncomingOriginal(bucket, path, captured); },
    finalize: async (lease, captured) => {
      const { data, error } = await service.rpc("finalize_inbound_attachment", { p_id: lease.id, p_actor_id: lease.actor_id, p_token: lease.token, p_sha256: captured.sha256, p_byte_length: captured.bytes.length, p_mime_type: captured.mimeType });
      if (error) throw error;
      if (loseReceipt) { loseReceipt = false; throw new Error("Synthetic lost committed receipt"); }
      return data;
    },
  });
  let reader: ReturnType<typeof createIncomingAttachmentReadHandler> | null = null;
  server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) { res.writeHead(413).end(); return; }
        chunks.push(Buffer.from(chunk));
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
      const selected = req.url === "/capture" ? handler : req.url === "/read" ? reader : null;
      if (!selected) { res.writeHead(404).end(); return; }
      const response = await selected(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: Buffer.concat(chunks) }) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500).end(); }
  });
  await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const request = (token = owner.token, version = 1) => fetch(`${endpoint}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ inbound_id: ids.inbound, attachment_id: ids.attachment, version }) });
  check((await fetch(`${endpoint}/capture`)).status === 405, "HTTP method boundary rejects GET");
  check((await fetch(`${endpoint}/capture`, { method: "POST", body: "{}" })).status === 401, "HTTP capture requires bearer authorization");
  check((await request("invalid-token")).status === 401, "Invalid Auth token rejected");
  check((await request(owner.token, 2)).status === 503 && downloads === 0, "Stale identity denied before provider read");
  const denied = await owner.client.rpc("claim_inbound_attachment", { p_inbound_id: ids.inbound, p_attachment_id: ids.attachment, p_version: 1, p_actor_id: actor });
  check(!!denied.error, "Staff cannot call privileged claim directly");
  check((await request()).status === 503, "Lost committed reply remains unconfirmed");
  check(sql(`select status from inbound_attachment_captures where inbound_id=${quote(ids.inbound)}`) === "ready", "Real database committed before simulated lost reply");
  const recovered = await request(); check(recovered.status === 200, "Retry recovers actual committed original");
  const receipt = await recovered.json();
  check(receipt.sha256 === sha256 && receipt.message_id === ids.message && receipt.byte_length === bytes.length, "Recovered receipt binds exact bytes and message");
  check(downloads === 1 && writes === 1, "Recovery does not repeat provider read or Storage write");
  const path = [...paths][0]; assert.ok(path);
  const stored = await bucket.download(path); if (stored.error) throw stored.error;
  check(Buffer.from(await stored.data.arrayBuffer()).equals(Buffer.from(bytes)), "Actual private Storage contains exact original bytes");
  const listed = await owner.client.rpc("list_inbound_message_attachments", { p_message_ids: [ids.message] });
  if (listed.error) throw listed.error;
  check(listed.data.length === 1 && listed.data[0].capture_id === receipt.id && listed.data[0].status === "ready" && !("storage_path" in listed.data[0]), "Staff list returns verified identity without private path");
  reader = createIncomingAttachmentReadHandler({
    authenticate: async token => { const { data, error } = await service.auth.getUser(token); if (error) return null; return data.user?.id ?? null; },
    authorize: async (actorId, captureId, messageId) => {
      const { data, error } = await service.rpc("authorize_inbound_attachment_read", { p_actor_id: actorId, p_capture_id: captureId, p_message_id: messageId });
      if (error) throw error; return data;
    },
    download: async name => { const { data, error } = await bucket.download(name); if (error) throw error; return data; },
  });
  const read = (messageId = ids.message) => fetch(`${endpoint}/read`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ capture_id: receipt.id, message_id: messageId }) });
  const privateRead = await read();
  check(privateRead.headers.get("Cache-Control") === "no-store" && privateRead.headers.get("Content-Disposition")?.startsWith("attachment;") === true, "Private HTTP download cannot be cached and is served as attachment");
  check(privateRead.status === 200 && Buffer.from(await privateRead.arrayBuffer()).equals(Buffer.from(bytes)), "Authorized reader returns exact private bytes through actual RPC and Storage");
  check((await read(randomUUID())).status === 404, "Wrong message cannot retrieve original");
  const hidden = await owner.client.storage.from("inbound-attachment-originals").download(path);
  check(!!hidden.error, "Staff cannot bypass authorized retrieval through Storage");
  const overwritten = await owner.client.storage.from("inbound-attachment-originals").upload(path, bytes, { contentType: metadata.content_type, upsert: true });
  check(!!overwritten.error, "Staff cannot overwrite incoming original");
  // Exercise read-only retention classification against actual stored bytes.
  const supersededPath = `${ids.inbound}/${ids.attachment}/${randomUUID()}/original`;
  const unknownPath = `${randomUUID()}/${randomUUID()}/${randomUUID()}/original`;
  for (const extraPath of [supersededPath, unknownPath]) {
    paths.add(extraPath);
    const { error } = await bucket.upload(extraPath, bytes, { contentType: metadata.content_type, upsert: false });
    if (error) throw error;
  }
  const snapshotQuery = `select jsonb_agg(jsonb_build_object('id',id,'name',name,'metadata',metadata) order by name) from storage.objects where bucket_id='inbound-attachment-originals' and name=any(array[${[...paths].map(quote).join(",")}]);`;
  const beforeInventory = sql(snapshotQuery);
  const inventory = sql(readFileSync(`${project}/scripts/attachment-retention/inventory.sql`, "utf8"));
  check(inventory.includes("retain_verified_incoming") && inventory.includes("superseded_attempt_review") && inventory.includes("unknown_object_review"), "Retention inventory separates verified, superseded and unknown actual objects");
  check(![...paths].some(value => inventory.includes(value)) && !inventory.includes(actor), "Retention inventory exposes aggregate evidence without private paths or actors");
  check(sql(snapshotQuery) === beforeInventory, "Read-only retention report leaves stored object metadata unchanged");
  const abandonedId = randomUUID(); extraFixtureIds.push(abandonedId);
  const abandonedPath = `${actor}/${ids.conversation}/${abandonedId}/original`;
  sql(`insert into conversation_attachment_uploads(id,actor_id,conversation_id,file_name,mime_type,byte_length,storage_path,created_at)
    values(${quote(abandonedId)},${quote(actor)},${quote(ids.conversation)},'abandoned.pdf','application/pdf',${bytes.length},${quote(abandonedPath)},now()-interval '8 days');`);
  abandonedPaths.add(abandonedPath);
  const uploadedDraft = await owner.client.storage.from("conversation-attachment-uploads").upload(abandonedPath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadedDraft.error) throw uploadedDraft.error;
  // Only this synthetic object's creation timestamp is aged for grace acceptance.
  sql(`update storage.objects set created_at=now()-interval '8 days' where bucket_id='conversation-attachment-uploads' and name=${quote(abandonedPath)};`);
  const abandoned = await owner.client.rpc("abandon_conversation_attachment", { p_id: abandonedId });
  if (abandoned.error) throw abandoned.error;
  const cleanupBucket = service.storage.from("conversation-attachment-uploads");
  const cleanup = await runAbandonedUploadCleanup({ rpc: (name, args) => service.rpc(name, args), storage: { from: name => {
    assert.equal(name, "conversation-attachment-uploads");
    return { list: (prefix, options) => cleanupBucket.list(prefix, options), remove: async names => {
      const result = await cleanupBucket.remove(names); if (result.error) throw result.error;
      throw new Error("Synthetic lost successful deletion reply");
    } };
  } } }, abandonedId, 168);
  check(cleanup.status === "complete", "Actual Storage deletion recovers a lost successful API response");
  check(sql(`select state from abandoned_attachment_cleanup where upload_id=${quote(abandonedId)}`) === "complete", "Cleanup persists durable completion receipt");
  check(sql(`select status from conversation_attachment_uploads where id=${quote(abandonedId)}`) === "abandoned", "Cleanup retains original abandoned upload evidence");
  check((await cleanupBucket.list(`${actor}/${ids.conversation}/${abandonedId}`)).data?.length === 0, "Cleaned original is absent from actual Storage listing");
  sql(`update profiles set is_active=false where id=${quote(actor)}`);
  check((await request()).status === 503 && downloads === 1, "Revoked staff cannot recover captured receipt");
  check((await read()).status === 404, "Revoked staff cannot read private original");
  console.log(`Incoming attachment actual HTTP/Auth/RPC/Storage checks passed: ${checks}`);
} catch (error) { failures.push(error); }
try {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
} catch (error) { failures.push(error); }
try {
  if (abandonedPaths.size) { const { error } = await service.storage.from("conversation-attachment-uploads").remove([...abandonedPaths]); if (error) throw error; }
  if (paths.size) {
    const { error } = await service.storage.from("inbound-attachment-originals").remove([...paths]);
    if (error) throw error;
  }
  // Disposable fixture cleanup only, scoped to generated IDs; no hosted fallback.
  const patterns = [...Object.values(ids), ...extraFixtureIds, actor].filter(Boolean).map(value => quote(`%${value}%`)).join(",");
  sql(`begin; set local session_replication_role=replica;
    do $cleanup$ declare t record; begin
      for t in select schemaname,tablename from pg_tables where schemaname='public' loop
        execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];
      end loop;
    end $cleanup$; commit;`);
  if (actor) { const { error } = await service.auth.admin.deleteUser(actor); if (error) throw error; }
} catch (error) { failures.push(error); }
if (failures.length) throw new AggregateError(failures, "Incoming capture integration or cleanup failed");
