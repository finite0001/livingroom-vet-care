/** Owned local Auth/Storage integration; no provider calls and no hosted fallback. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createVerifyConversationAttachmentHandler } from "../../supabase/functions/_shared/verify-conversation-attachment.ts";
const project = process.env.PAYMENT_TEST_PROJECT;
assert.ok(project, "Explicit disposable local project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId, "Local project ID required");
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
  const id = created.data.user.id;
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
try {
  const owner = await staff(), other = await staff();
  const saved = await owner.client.rpc("save_client", {
    p_actor_id: owner.id,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Upload",
    p_last_name: "Fixture",
    p_primary_phone: null,
    p_primary_email: null,
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  });
  // Use the same canonical household API shape as existing clinical fixtures.
  if (saved.error) throw new Error("Synthetic household creation failed");
  const household = Array.isArray(saved.data) ? saved.data[0] : saved.data;
  const conversation = await owner.client.rpc("ensure_active_conversation", {
    p_client_id: household.id,
  });
  if (conversation.error) {
    throw new Error("Synthetic conversation creation failed");
  }
  const content = new Blob(["%PDF-synthetic-upload"], {
      type: "application/pdf",
    }),
    id = randomUUID();
  const reservation = await owner.client.rpc(
    "prepare_conversation_attachment",
    {
      p_id: id,
      p_conversation_id: conversation.data.id,
      p_file_name: "fixture.pdf",
      p_mime_type: content.type,
      p_byte_length: content.size,
    },
  );
  if (reservation.error) {
    throw new Error("Synthetic attachment reservation failed");
  }
  check(
    reservation.data.actor_id === owner.id,
    "Reservation uses authenticated owner",
  );
  const path = reservation.data.storage_path;
  const upload = await owner.client.storage.from(
    "conversation-attachment-uploads",
  ).upload(path, content, { contentType: content.type, upsert: false });
  check(!upload.error, "Owned reserved bytes upload through actual Storage");
  check(
    !!(await other.client.storage.from("conversation-attachment-uploads")
      .download(path)).error,
    "Other staff cannot read draft bytes",
  );
  check(
    !!(await owner.client.storage.from("conversation-attachment-uploads")
      .upload(path, content, { upsert: true })).error,
    "Storage rejects overwrite before verification",
  );
  const anon = createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  check(
    !!(await anon.storage.from("conversation-attachment-uploads").download(
      path,
    )).error,
    "Anonymous cannot read bytes",
  );
  const handler = createVerifyConversationAttachmentHandler({
    authenticate: async (token) => {
      const auth = await service.auth.getUser(token);
      if (auth.error || !auth.data.user) return null;
      const client = userClient(token);
      return {
        actorId: auth.data.user.id,
        readUpload: async (uploadId) => {
          const r = await client.from("conversation_attachment_uploads").select(
            "id,actor_id,storage_path,mime_type,byte_length,status",
          ).eq("id", uploadId).maybeSingle();
          if (r.error) throw new Error("Reservation read failed");
          return r.data;
        },
        download: async (objectPath) => {
          const r = await client.storage.from("conversation-attachment-uploads")
            .download(objectPath);
          if (r.error || !r.data) throw new Error("Byte read failed");
          return r.data;
        },
      };
    },
    verify: async (args) => {
      const r = await service.rpc("verify_conversation_attachment", args);
      if (r.error) throw new Error("Finalization failed");
      return r.data;
    },
  });
  const request = (token: string) =>
    new Request("http://127.0.0.1/verify-conversation-attachment", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
  const response = await handler(request(owner.token));
  check(response.status === 200, "Handler verifies actual stored bytes");
  const verified = await response.json();
  check(
    verified.status === "ready" && /^[a-f0-9]{64}$/.test(verified.sha256),
    "Verified receipt contains immutable hash",
  );
  const retry = await handler(request(owner.token));
  check(retry.status === 200, "Verification retry succeeds");
  check(
    (await retry.json()).sha256 === verified.sha256,
    "Retry retains exact byte hash",
  );
  check(
    (await handler(request(other.token))).status === 403,
    "Foreign actor cannot verify upload",
  );
  check(
    !!(await owner.client.rpc("verify_conversation_attachment", {
      p_id: id,
      p_actor_id: owner.id,
      p_byte_length: content.size,
      p_mime_type: content.type,
      p_sha256: "a".repeat(64),
    })).error,
    "Staff cannot forge trusted finalization",
  );
  check(
    !!(await owner.client.storage.from("conversation-attachment-uploads")
      .upload(path, content, { upsert: true })).error,
    "Verified bytes reject replacement",
  );
  const removed = await owner.client.storage.from(
    "conversation-attachment-uploads",
  ).remove([path]);
  check(
    !!removed.error || removed.data?.length === 0,
    "Verified object deletion has no permitted row",
  );
  check(
    !(await owner.client.storage.from("conversation-attachment-uploads")
      .download(path)).error,
    "Verified bytes remain after denied deletion",
  );
  console.log(
    `Conversation attachment Auth/Storage: ${checks} checks passed. Synthetic files only; no provider requests.`,
  );
} catch {
  console.error(
    "Conversation attachment local integration failed; no credential-bearing response emitted.",
  );
  process.exitCode = 1;
}
// Caller owns and tears down this disposable database, including synthetic users/files.
