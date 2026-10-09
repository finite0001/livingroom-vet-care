import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import {
  photoDigest,
  photoDimensions,
  verifyNormalizedPhoto,
} from "../../supabase/functions/_shared/patient-photo-image.ts";
import { createPatientPhotoVerificationHandler } from "../../supabase/functions/_shared/patient-photo-verification.ts";

function chunk(name: string, bytes: Buffer) {
  const kind = Buffer.from(name), out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length);
  kind.copy(out, 4);
  bytes.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([kind, bytes])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + bytes.length);
  return out;
}
export function png(width = 1, height = 1) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const id = "11111111-1111-4111-8111-111111111111",
  actor = "22222222-2222-4222-8222-222222222222",
  pet = "33333333-3333-4333-8333-333333333333",
  object = "44444444-4444-4444-8444-444444444444";
const request = (body: unknown = { id }) =>
  new Request("https://local.test", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic" },
    body: JSON.stringify(body),
  });
async function fixture(
  change: Record<string, unknown> = {},
  bytes = png(),
  transform: (v: Record<string, unknown>) => unknown = (v) => v,
) {
  const calls: Record<string, unknown>[] = [];
  const blob = new Blob([bytes], { type: "image/png" });
  const doc = {
    id,
    pet_id: pet,
    created_by: actor,
    file_path: `${actor}/${pet}/${id}/original`,
    file_size: blob.size,
    mime_type: "image/png",
    visibility: "internal",
    source: "Patient identity photo",
    status: "uploading",
  };
  const handler = createPatientPhotoVerificationHandler({
    authenticate: async () => ({
      actorId: actor,
      read: async () => ({
        document: doc,
        object_id: object,
        expected_sha256: await photoDigest(png()),
        ...change,
      }),
      download: async (path) => {
        calls.push({ download: path });
        return blob;
      },
    }),
    verify: async (args) => {
      calls.push(args);
      return transform({
        id,
        actor_id: actor,
        sha256: args.p_sha256,
        width: args.p_width,
        height: args.p_height,
      });
    },
  });
  return { handler, calls, doc };
}
test("PNG dimensions require a complete CRC-valid container and digest binds every byte", async () => {
  const bytes = png();
  assert.deepEqual(photoDimensions(bytes, "image/png"), {
    width: 1,
    height: 1,
  });
  for (
    const broken of [
      bytes.subarray(0, bytes.length - 1),
      Buffer.concat([bytes, Buffer.from([0])]),
      Buffer.from("not a png"),
    ]
  ) assert.throws(() => photoDimensions(broken, "image/png"));
  const changed = Buffer.from(bytes);
  changed[20] ^= 1;
  assert.throws(() => photoDimensions(changed, "image/png"));
  assert.notEqual(await photoDigest(bytes), await photoDigest(changed));
  assert.throws(() => photoDimensions(bytes, "image/jpeg"));
});
test("server binds original object identity, actual bytes and dimensions to its receipt", async () => {
  const f = await fixture();
  assert.equal((await f.handler(request())).status, 200);
  assert.deepEqual(f.calls, [{ download: f.doc.file_path }, {
    p_id: id,
    p_actor_id: actor,
    p_object_id: object,
    p_sha256: await photoDigest(png()),
    p_width: 1,
    p_height: 1,
  }]);
  assert.equal((await f.handler(request())).status, 200);
});
test("strict request and size bounds stop downloads", async () => {
  for (
    const [body, status] of [
      [{ id, sha256: "a".repeat(64) }, 400],
      [{ id, path: "other" }, 400],
      [{ id: "bad" }, 400],
      [{ id, padding: "x".repeat(2000) }, 413],
    ] as const
  ) {
    const f = await fixture();
    assert.equal((await f.handler(request(body))).status, status);
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture();
  assert.equal(
    (await f.handler(new Request("https://local.test", { method: "POST" })))
      .status,
    401,
  );
  const unauth = createPatientPhotoVerificationHandler({
    authenticate: async () => null,
    verify: async () => {
      throw Error("must not verify");
    },
  });
  assert.equal((await unauth(request())).status, 401);
});
test("foreign, missing-object and unready reservations cannot fetch private bytes", async () => {
  const f = await fixture();
  for (
    const [change, status] of [
      [{ document: { ...f.doc, created_by: pet } }, 403],
      [{ document: { ...f.doc, file_path: "other" } }, 403],
      [{ object_id: null }, 409],
      [{ document: { ...f.doc, status: "void" } }, 409],
    ] as const
  ) {
    const next = await fixture(change);
    assert.equal((await next.handler(request())).status, status);
    assert.equal(next.calls.length, 0);
  }
});
test("corrupt, changed, oversize dimensions and mislabeled bytes never reach service verification", async () => {
  const original = await fixture();
  for (
    const [change, bytes] of [
      [{ expected_sha256: "a".repeat(64) }, png()],
      [{}, png(4097, 1)],
      [{ document: { ...original.doc, file_size: 1 } }, png()],
      [{}, Buffer.from("bad bytes")],
    ] as const
  ) {
    const f = await fixture(change, bytes);
    assert.equal((await f.handler(request())).status, 422);
    assert.equal(f.calls.some((call) => "p_id" in call), false);
  }
});
test("lost or mismatched verification receipts remain retryable", async () => {
  for (
    const transform of [
      () => null,
      () => ({}),
      (v: Record<string, unknown>) => ({ ...v, id: pet }),
      (v: Record<string, unknown>) => ({ ...v, sha256: "a".repeat(64) }),
      () => {
        throw Error("lost ack");
      },
    ]
  ) {
    const f = await fixture({}, png(), transform);
    const res = await f.handler(request());
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /Retry the same photo/);
  }
});

test("normalized PNG pixels require exact bounded decompression and valid filters", async () => {
  assert.deepEqual(await verifyNormalizedPhoto(png()), { width: 1, height: 1 });
  await assert.rejects(verifyNormalizedPhoto(png(2, 1)));
  await assert.rejects(verifyNormalizedPhoto(png(1025, 1)));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  for (
    const pixels of [
      Buffer.from([5, 1, 2, 3, 4]),
      Buffer.from([0, 1, 2, 3, 4, 5]),
    ]
  ) {
    const bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    assert.deepEqual(photoDimensions(bytes, "image/png"), {
      width: 1,
      height: 1,
    });
    await assert.rejects(verifyNormalizedPhoto(bytes));
  }
});
