import assert from "node:assert/strict";
import test from "node:test";
import {
  inboundEmailBody,
  parseInboundEmailAttachments,
  parseInboundMediaCount,
} from "../../supabase/functions/_shared/inbound/attachment-metadata.ts";
import { processOneInbound } from "../../supabase/functions/_shared/inbound/process.ts";
import type { ProviderEvent } from "../../supabase/functions/_shared/inbound/handlers.ts";
const attachment = {
  id: "file-1",
  filename: "report.pdf",
  content_type: "application/pdf",
  size: 42,
};
const resource = "11111111-1111-4111-8111-111111111111";
const email = {
  id: resource,
  from: "family@example.test",
  to: ["care@example.test"],
  text: "",
  html: "",
  created_at: "2026-09-12T12:00:00Z",
  attachments: [attachment],
};
function fixture(
  event: ProviderEvent = {
    id: "event",
    provider: "resend",
    event_type: "inbound",
    resource_id: resource,
    lease_token: "lease",
    metadata: { from: email.from, to: email.to[0] },
  },
) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  return {
    calls,
    db: {
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: name === "claim_communication_event"
            ? event
            : name === "release_communication_event_outcome"
            ? { id: event.id, state: "review" }
            : { id: "inbound" },
          error: null,
        };
      },
    },
  };
}
test("attachment metadata preserves an unnamed or empty file but strips remote URLs", () => {
  assert.deepEqual(
    parseInboundEmailAttachments([{
      ...attachment,
      filename: null,
      size: 0,
      download_url: "https://private.test",
      content: "untrusted",
    }]),
    [{ ...attachment, filename: null, size: 0 }],
  );
  assert.deepEqual(parseInboundEmailAttachments(undefined), []);
});
test("malformed, duplicate and unbounded attachment metadata requires review", () => {
  for (
    const value of [
      {},
      [null],
      ["file"],
      [attachment, attachment],
      [{ ...attachment, size: -1 }],
      [{ ...attachment, size: "42" }],
      [{ ...attachment, size: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...attachment, filename: "bad\r\nname" }],
      [{ ...attachment, filename: "x".repeat(256) }],
      Array.from(
        { length: 101 },
        (_, index) => ({ ...attachment, id: `file-${index}` }),
      ),
    ]
  ) {
    assert.throws(() => parseInboundEmailAttachments(value));
  }
});
test("fallback distinguishes file-only, HTML-only and genuinely empty email", () => {
  assert.match(inboundEmailBody("", "", 1), /1 attachment and no text body/);
  assert.match(
    inboundEmailBody(null, "<p>Hello</p>", 2),
    /2 attachments and an HTML body/,
  );
  assert.match(
    inboundEmailBody("", "<p>Hello</p>", 0),
    /HTML original retained/,
  );
  assert.equal(
    inboundEmailBody(" ", null, 0),
    "[Email has no text body or attachments.]",
  );
  assert.equal(inboundEmailBody("Original reply", "", 1), "Original reply");
});
test("file-only email completes once with visible text and no attachment fetch", async () => {
  const f = fixture();
  let requests = 0;
  const result = await processOneInbound(
    f.db,
    { RESEND_API_KEY: "synthetic" },
    async () => {
      requests++;
      return Response.json(email);
    },
  );
  assert.equal(result.processed, true);
  assert.equal(requests, 1);
  const completed = f.calls.find((call) =>
    call.name === "complete_inbound_communication"
  )!;
  assert.match(
    String(completed.args?.p_body),
    /Attachment contents have not been retrieved/,
  );
  assert.deepEqual(completed.args?.p_attachments, [attachment]);
});
test("malformed attachment metadata is held for review instead of transient retry", async () => {
  for (
    const attachments of [[null], [{ ...attachment, size: "42" }], {
      file: attachment,
    }]
  ) {
    const f = fixture();
    const result = await processOneInbound(f.db, {
      RESEND_API_KEY: "synthetic",
    }, async () => Response.json({ ...email, attachments }));
    assert.equal(result.review_required, true);
    assert.equal(result.retry_pending, false);
    assert.equal(
      f.calls.some((call) => call.name === "complete_inbound_communication"),
      false,
    );
    assert.equal(
      f.calls.at(-1)?.args?.p_error,
      "provider_content_requires_review",
    );
  }
});
test("media counts reject malformed or unbounded provider values", () => {
  assert.equal(parseInboundMediaCount("0"), 0);
  assert.equal(parseInboundMediaCount("2"), 2);
  for (
    const value of [
      null,
      undefined,
      -1,
      1,
      "-1",
      "1.5",
      "Infinity",
      "101",
      " 1",
      "01",
    ]
  ) assert.throws(() => parseInboundMediaCount(value));
});
test("media-only SMS stays visible after exact signed-body verification", async () => {
  const account = "AC" + "a".repeat(32), sid = "SM" + "b".repeat(32);
  const f = fixture({
    id: "event",
    provider: "twilio",
    event_type: "inbound",
    resource_id: sid,
    lease_token: "lease",
    metadata: { from: "+13035550100", to: "+13035550199", body: "" },
  });
  await processOneInbound(
    f.db,
    { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: "synthetic" },
    async () =>
      Response.json({
        sid,
        account_sid: account,
        direction: "inbound",
        from: "+13035550100",
        to: "+13035550199",
        body: "",
        date_created: email.created_at,
        num_media: "2",
      }),
  );
  const complete = f.calls.find((call) =>
    call.name === "complete_inbound_communication"
  )!;
  assert.match(String(complete.args?.p_body), /2 media attachments/);
  assert.deepEqual(complete.args?.p_attachments, [{
    count: 2,
    review_required: true,
  }]);
});
