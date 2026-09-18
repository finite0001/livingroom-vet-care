import assert from "node:assert/strict";
import test from "node:test";
import {
  type AttachmentUploadApiClient,
  createAttachmentUploadTransport,
} from "../../src/hub/features/communications/attachment-upload-api.ts";
const args = {
  p_id: "file",
  p_conversation_id: "conversation",
  p_file_name: "file.pdf",
  p_mime_type: "application/pdf",
  p_byte_length: 5,
};
function fixture() {
  let actor: string | null = "owner";
  const calls: unknown[] = [];
  const client: AttachmentUploadApiClient = {
    rpc: async (name, values) => {
      calls.push({ name, values });
      return { data: { id: "file" }, error: null };
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, file, options) => {
          calls.push({ bucket, path, file, options });
          return { error: null };
        },
      }),
    },
    functions: {
      invoke: async (name, values) => {
        calls.push({ name, values });
        return { data: { id: "file", status: "ready" }, error: null };
      },
    },
  };
  return {
    client,
    calls,
    setActor: (value: string | null) => {
      actor = value;
    },
    make: () => createAttachmentUploadTransport(client, "owner", () => actor),
  };
}
test("adapter uses reserved bucket, immutable upload and ID-only verifier", async () => {
  const f = fixture(),
    transport = f.make(),
    file = new File(["%PDF-"], "file.pdf", { type: "application/pdf" });
  await transport.reserve(args);
  await transport.upload("owner/conversation/file/original", file);
  await transport.verify("file");
  assert.deepEqual(f.calls, [{
    name: "prepare_conversation_attachment",
    values: args,
  }, {
    bucket: "conversation-attachment-uploads",
    path: "owner/conversation/file/original",
    file,
    options: { contentType: "application/pdf", upsert: false },
  }, {
    name: "verify-conversation-attachment",
    values: { body: { id: "file" } },
  }]);
});
test("signed-out or different actor cannot start any operation", async () => {
  for (const actor of [null, "other"]) {
    const f = fixture(), transport = f.make();
    f.setActor(actor);
    await assert.rejects(transport.reserve(args), /Account changed/);
    await assert.rejects(
      transport.upload("path", new File(["x"], "file")),
      /Account changed/,
    );
    await assert.rejects(transport.verify("file"), /Account changed/);
    assert.deepEqual(f.calls, []);
  }
});
test("account switch during reservation discards its response", async () => {
  const f = fixture();
  f.client.rpc = async () => {
    f.setActor("other");
    return { data: { id: "file" }, error: null };
  };
  await assert.rejects(f.make().reserve(args), /Account changed/);
});
test("account switch during upload or verification cannot confirm readiness", async () => {
  const f = fixture();
  f.client.storage.from = () => ({
    upload: async () => {
      f.setActor(null);
      return { error: null };
    },
  });
  await assert.rejects(
    f.make().upload("path", new File(["x"], "file")),
    /Account changed/,
  );
  const g = fixture();
  g.client.functions.invoke = async () => {
    g.setActor("other");
    return { data: { status: "ready" }, error: null };
  };
  await assert.rejects(g.make().verify("file"), /Account changed/);
});
test("RPC, Storage and verifier errors propagate rather than becoming success", async () => {
  const f = fixture(), error = new Error("synthetic failure");
  f.client.rpc = async () => ({ data: null, error });
  await assert.rejects(f.make().reserve(args), error);
  f.client.storage.from = () => ({ upload: async () => ({ error }) });
  await assert.rejects(f.make().upload("path", new File(["x"], "file")), error);
  f.client.functions.invoke = async () => ({ data: null, error });
  await assert.rejects(f.make().verify("file"), error);
});
