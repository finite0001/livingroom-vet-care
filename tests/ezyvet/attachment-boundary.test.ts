import test from "node:test";
import assert from "node:assert/strict";
import {
  configuration,
  createAdapter,
  parsePage,
} from "../../supabase/functions/ezyvet-import/adapter.ts";
import type { Resource } from "../../supabase/functions/ezyvet-import/adapter.ts";

// Exercise the JavaScript boundary too: an accidental future type/allowlist
// expansion must not route attachment capabilities into generic snapshots.
const attachment = "attachment" as Resource;

test("generic snapshots reject attachments instead of exposing download capabilities", () => {
  assert.throws(
    () => parsePage({
      meta: { items_page: "1", items_page_total: "1" },
      items: [{ attachment: {
        id: 1,
        record_type: "Animal",
        record_id: 2,
        file_id: 3,
        file_download_url: "https://files.example.test/original?token=private-capability",
      } }],
    }, attachment, 1),
    (error: Error) => error.message === "ATTACHMENT_REQUIRES_METADATA_INTAKE",
  );
});

test("generic attachment reads are refused before OAuth or provider requests", async () => {
  let requests = 0;
  const adapter = createAdapter({
    baseUrl: "https://api.trial.ezyvet.com",
    siteUid: "synthetic-site",
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
    readResources: [attachment],
  }, {
    fetch: async () => {
      requests++;
      throw new Error("Provider must not be called");
    },
    now: Date.now,
    sleep: async () => {},
  });
  await assert.rejects(adapter.page(attachment, 1, "2"), {
    message: "ATTACHMENT_REQUIRES_METADATA_INTAKE",
  });
  assert.equal(requests, 0);
});

test("attachment commissioning remains unavailable until scoped durable intake exists", () => {
  const env: Record<string, string> = {
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_SITE_UID: "synthetic-site",
    EZYVET_CLIENT_ID: "synthetic-client",
    EZYVET_CLIENT_SECRET: "synthetic-secret",
  };
  assert.deepEqual(configuration((key) => env[key]).readResources, ["contact", "animal"]);
  env.EZYVET_READ_RESOURCES = "contact,animal,attachment";
  assert.throws(() => configuration((key) => env[key]), { message: "INVALID_READ_SCOPES" });
});
