import assert from "node:assert/strict";
import test from "node:test";
import {
  type AttachmentUploadIntent,
  type AttachmentUploadTransport,
  AttachmentUploadUnconfirmedError,
  uploadConversationAttachment,
} from "../../src/hub/features/communications/attachment-upload.ts";
const intent: AttachmentUploadIntent = {
  id: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  conversationId: "33333333-3333-4333-8333-333333333333",
  file: new File(["%PDF-test"], "report.pdf", { type: "application/pdf" }),
};
async function fixture() {
  const calls: string[] = [];
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await intent.file.arrayBuffer()),
  );
  const hash = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  const pending = {
    id: intent.id,
    actor_id: intent.actorId,
    conversation_id: intent.conversationId,
    file_name: intent.file.name,
    mime_type: intent.file.type,
    byte_length: intent.file.size,
    storage_path:
      `${intent.actorId}/${intent.conversationId}/${intent.id}/original`,
    status: "uploading",
    sha256: null,
  };
  const ready = { ...pending, status: "ready", sha256: hash };
  const transport: AttachmentUploadTransport = {
    reserve: async () => {
      calls.push("reserve");
      return pending;
    },
    upload: async () => {
      calls.push("upload");
    },
    verify: async () => {
      calls.push("verify");
      return ready;
    },
  };
  return { calls, pending, ready, transport };
}
test("upload returns only exact verified bytes and keeps the intent ID", async () => {
  const f = await fixture();
  assert.deepEqual(
    await uploadConversationAttachment(intent, f.transport),
    f.ready,
  );
  assert.deepEqual(f.calls, ["reserve", "upload", "verify"]);
});
test("lost upload reply recovers existing bytes without a replacement path", async () => {
  const f = await fixture();
  f.transport.upload = async () => {
    f.calls.push("upload");
    throw new Error("connection lost");
  };
  assert.deepEqual(
    await uploadConversationAttachment(intent, f.transport),
    f.ready,
  );
  assert.deepEqual(f.calls, ["reserve", "upload", "verify"]);
});
test("unconfirmed verification retains recoverable intent and never invents readiness", async () => {
  const f = await fixture();
  f.transport.verify = async () => {
    throw new Error("lost reply");
  };
  await assert.rejects(
    uploadConversationAttachment(intent, f.transport),
    AttachmentUploadUnconfirmedError,
  );
  assert.equal(intent.id, "11111111-1111-4111-8111-111111111111");
});
test("wrong owner, conversation or path cannot trigger an upload", async () => {
  for (
    const changed of [{ actor_id: intent.conversationId }, {
      conversation_id: intent.actorId,
    }, { storage_path: "another/object" }]
  ) {
    const f = await fixture();
    f.transport.reserve = async () => ({ ...f.pending, ...changed });
    await assert.rejects(uploadConversationAttachment(intent, f.transport));
    assert.deepEqual(f.calls, []);
  }
});
test("same-name same-size changed bytes are not accepted as the selected file", async () => {
  const f = await fixture();
  f.transport.verify = async () => ({ ...f.ready, sha256: "a".repeat(64) });
  await assert.rejects(
    uploadConversationAttachment(intent, f.transport),
    /Stored bytes differ/,
  );
});
test("ready recovery verifies again without uploading", async () => {
  const f = await fixture();
  f.transport.reserve = async () => f.ready;
  await uploadConversationAttachment(intent, f.transport);
  assert.deepEqual(f.calls, ["verify"]);
});
test("abandoned or invalid file selection creates no upload", async () => {
  const f = await fixture();
  f.transport.reserve = async () => ({ ...f.pending, status: "abandoned" });
  await assert.rejects(
    uploadConversationAttachment(intent, f.transport),
    /abandoned/,
  );
  assert.deepEqual(f.calls, []);
  await assert.rejects(
    uploadConversationAttachment({
      ...intent,
      file: new File(["x"], "script.html", { type: "text/html" }),
    }, f.transport),
  );
  assert.deepEqual(f.calls, []);
});
