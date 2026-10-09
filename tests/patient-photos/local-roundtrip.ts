/** Run only against an explicitly selected, labelled disposable local stack. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deflateSync } from "node:zlib";
import { photoDigest } from "../../supabase/functions/_shared/patient-photo-image.ts";
import { createPatientPhotoVerificationHandler } from "../../supabase/functions/_shared/patient-photo-verification.ts";
const project = process.env.PHOTO_TEST_PROJECT;
assert.ok(project, "Explicit disposable project required");
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId);
const container = `supabase_db_${projectId}`;
const inspection = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0];
assert.equal(inspection.Config.Labels["com.supabase.cli.project"], projectId);
assert.equal(inspection.Config.Labels["com.supabase.cli.workdir"], project);
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
    container,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    .trim();
const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const userClient = (token: string) =>
  createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function staff() {
  const email = `photo-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id;
  sql(
    `insert into user_roles(user_id,role) values('${id}','STAFF');update profiles set is_active=true where id='${id}';`,
  );
  const login = await createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const token = login.data.session!.access_token;
  return { id, token, client: userClient(token) };
}
function chunk(name: string, data: Buffer) {
  const kind = Buffer.from(name), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  kind.copy(out, 4);
  data.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([kind, data])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1);
header.writeUInt32BE(1, 4);
header[8] = 8;
header[9] = 6;
const bytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  chunk("IEND", Buffer.alloc(0)),
]);
const blob = new Blob([bytes], { type: "image/png" }),
  digest = await photoDigest(bytes);
async function rpc(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
const owner = await staff(), other = await staff();
const household = await rpc(owner.client, "save_client", {
  p_actor_id: owner.id,
  p_client_id: null,
  p_expected_version: null,
  p_first_name: "Photo",
  p_last_name: "Fixture",
  p_primary_phone: "+13035559101",
  p_primary_email: "photo-client@example.test",
  p_preferred_channel: "EMAIL",
  p_mailing_address: null,
  p_housecall_address: null,
});
const pet = await rpc(owner.client, "save_patient", {
  p_id: null,
  p_client_id: household.id,
  p_expected_version: null,
  p_name: "Photo dog",
  p_species: "Dog",
  p_breed: null,
  p_dob: null,
  p_birth_date_precision: "unknown",
  p_color: null,
  p_sex: "unknown",
  p_neuter_status: "unknown",
  p_microchip_id: null,
  p_archived_at: null,
  p_deceased_at: null,
});
const handler = createPatientPhotoVerificationHandler({
  authenticate: async (token) => {
    const auth = await service.auth.getUser(token);
    if (auth.error || !auth.data.user) return null;
    const client = userClient(token);
    return {
      actorId: auth.data.user.id,
      read: (id) => rpc(client, "read_patient_photo_upload", { p_id: id }),
      download: async (path) => {
        const result = await client.storage.from("patient-documents").download(
          path,
        );
        if (result.error) throw result.error;
        return result.data;
      },
    };
  },
  verify: (args) => rpc(service, "verify_patient_photo_bytes", args),
});
const request = (id: string, token = owner.token) =>
  new Request("http://local.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id }),
  });
const id = randomUUID();
const reserved = await rpc(owner.client, "prepare_patient_photo", {
  p_id: id,
  p_pet_id: pet.id,
  p_expected_version: 0,
  p_sha256: digest,
  p_file_size: blob.size,
  p_mime_type: blob.type,
});
const path = reserved.document.file_path;
assert.equal((await handler(request(id, "forged"))).status, 401);
assert.equal(
  (await owner.client.storage.from("patient-documents").upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  })).error,
  null,
);
assert.ok(
  (await other.client.storage.from("patient-documents").download(path)).error,
);
assert.ok(
  (await other.client.rpc("read_patient_photo_upload", { p_id: id })).error,
);
// Capture identity, then delete and reinsert before verification. Stale proof must fail.
const before = await rpc(owner.client, "read_patient_photo_upload", {
  p_id: id,
});
assert.equal(
  (await owner.client.storage.from("patient-documents").remove([path])).error,
  null,
);
assert.equal(
  (await owner.client.storage.from("patient-documents").upload(path, blob, {
    contentType: blob.type,
    upsert: false,
  })).error,
  null,
);
const after = await rpc(owner.client, "read_patient_photo_upload", {
  p_id: id,
});
assert.notEqual(before.object_id, after.object_id);
assert.ok(
  (await service.rpc("verify_patient_photo_bytes", {
    p_id: id,
    p_actor_id: owner.id,
    p_object_id: before.object_id,
    p_sha256: digest,
    p_width: 1,
    p_height: 1,
  })).error,
);
assert.equal((await handler(request(id))).status, 200);
assert.equal((await handler(request(id))).status, 200);
assert.ok(
  (await owner.client.storage.from("patient-documents").upload(path, blob, {
    contentType: blob.type,
    upsert: true,
  })).error,
);
await owner.client.storage.from("patient-documents").remove([path]);
assert.equal(
  sql(`select count(*) from storage.objects where id='${after.object_id}';`),
  "1",
);
await rpc(owner.client, "finalize_patient_document", { p_id: id });
const actionId = randomUUID();
const selection = {
  p_id: actionId,
  p_pet_id: pet.id,
  p_document_id: id,
  p_expected_version: 0,
};
assert.equal(
  (await rpc(owner.client, "set_patient_photo", selection)).version,
  1,
);
const current = await rpc(other.client, "read_patient_photo", {
  p_pet_id: pet.id,
});
assert.equal(current.document.id, id);
const signed = await other.client.storage.from("patient-documents")
  .createSignedUrl(path, 60);
if (signed.error) throw signed.error;
const response = await fetch(signed.data.signedUrl);
assert.equal(response.status, 200);
assert.equal(
  await photoDigest(new Uint8Array(await response.arrayBuffer())),
  digest,
);
await rpc(other.client, "set_patient_photo", {
  p_id: randomUUID(),
  p_pet_id: pet.id,
  p_document_id: null,
  p_expected_version: 1,
});
assert.equal(
  (await rpc(owner.client, "set_patient_photo", selection)).version,
  1,
);
assert.equal(
  (await rpc(owner.client, "read_patient_photo", { p_pet_id: pet.id })).version,
  2,
);
assert.equal(
  (await rpc(owner.client, "read_patient_photo", { p_pet_id: pet.id }))
    .document,
  null,
);
sql(`update profiles set is_active=false where id='${owner.id}';`);
assert.ok(
  (await owner.client.rpc("read_patient_photo", { p_pet_id: pet.id })).error,
);
console.log(
  "Actual local Auth/Storage photo roundtrip passed: byte verification, object replacement rejection, frozen original, shared staff read, signed download, removal and historical retry.",
);
// Immutable synthetic evidence stays inside this disposable runtime until it is stopped.
