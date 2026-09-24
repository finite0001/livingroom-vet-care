import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  validateIntent,
  verifiedArtifact,
  parsePreparation,
} from "../../src/hub/features/document-links/state.ts";
import { clearOtherInvoiceEmailIntents } from "../../src/hub/contexts/session-draft-retention.ts";
const intent = {
  p_request_id: "request",
  p_family: "invoice",
  p_source_id: "source",
  p_client_id: "client",
  p_conversation_id: "conversation",
  p_recipient: "+13035550123",
  p_source_hash: "a".repeat(64),
  p_expires_at: "2026-09-14T00:00:00Z",
  p_message_template: "Documents {{document_link}}",
};
test("durable intent rejects literal capabilities, extra fields and identity changes", () => {
  assert.deepEqual(
    validateIntent(intent, "invoice", "source", "client"),
    intent,
  );
  for (const changed of [
    { ...intent, client_url: "https://example.test/#secret" },
    { ...intent, p_message_template: "https://example.test/{{document_link}}" },
    {
      ...intent,
      p_message_template: "v1." + "z".repeat(43) + " {{document_link}}",
    },
    { ...intent, p_client_id: "other" },
  ])
    assert.throws(() => validateIntent(changed, "invoice", "source", "client"));
});
test("frozen original review validates byte length and digest before creating blob", async () => {
  const bytes = Buffer.from("%PDF synthetic review"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    index: 1,
    filename: "lab.pdf",
    mime_type: "application/pdf" as const,
    file_size: bytes.length,
    sha256,
  };
  const raw = { ...manifest, content: bytes.toString("base64") };
  assert.equal((await verifiedArtifact(raw, manifest)).size, bytes.length);
  await assert.rejects(() =>
    verifiedArtifact(
      { ...raw, content: Buffer.from("corrupt").toString("base64") },
      manifest,
    ),
  );
  await assert.rejects(() =>
    verifiedArtifact({ ...raw, filename: "other.pdf" }, manifest),
  );
});
test("recovered grant cannot cross staff, family or household boundary", () => {
  const raw = {
    grant: {
      id: "id",
      family: "invoice",
      source_id: "source",
      client_id: "client",
      actor_id: "actor",
      state: "preparing",
    },
    artifact_hash: null,
  };
  assert.ok(parsePreparation(raw, "invoice", "source", "client", "actor"));
  assert.throws(() =>
    parsePreparation(raw, "record_release", "source", "client", "actor"),
  );
  assert.throws(() =>
    parsePreparation(raw, "invoice", "source", "other", "actor"),
  );
  assert.throws(() =>
    parsePreparation(raw, "invoice", "source", "client", "other"),
  );
});
test("authentication transition removes document intents for other actors and signout removes all", () => {
  const values = new Map([
    ["document-link-intent:one:invoice:a", "x"],
    ["document-link-intent:two:invoice:b", "x"],
    ["unrelated", "x"],
  ]);
  const storage = {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  clearOtherInvoiceEmailIntents(storage, "one");
  assert.equal(values.has("document-link-intent:two:invoice:b"), false);
  assert.equal(values.has("document-link-intent:one:invoice:a"), true);
  clearOtherInvoiceEmailIntents(storage, null);
  assert.deepEqual([...values.keys()], ["unrelated"]);
});
