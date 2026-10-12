import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiagnosticPdfDownloadHandler } from "../../supabase/functions/_shared/diagnostic-pdf-download.ts";
import {
  diagnosticPdfDigest,
  verifiedDiagnosticPdfResponse,
} from "../../supabase/functions/_shared/diagnostic-pdf-bytes.ts";
const id = "c3300000-0000-4000-8000-000000000001",
  job = "c3300000-0000-4000-8000-000000000002",
  pet = "c3300000-0000-4000-8000-000000000003",
  actor = "c3300000-0000-4000-8000-000000000004";
const bytes = new TextEncoder().encode("synthetic protocol bytes"),
  sha = await diagnosticPdfDigest(bytes);
const authority = {
  authority_id: id,
  job_id: job,
  pet_id: pet,
  actor_id: actor,
  byte_length: bytes.length,
  sha256: sha,
  expires_at: "2026-10-12T20:00:00.000000+00:00",
};
function request(body: unknown = { id, job_id: job, pet_id: pet }) {
  return new Request("https://practice.example/download", {
    method: "POST",
    headers: {
      Authorization: "Bearer synthetic",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
function setup(
  overrides: {
    code?: string;
    sha?: string;
    bytes?: Uint8Array;
    path?: string;
    receipt?: string;
  } = {},
) {
  let reads = 0,
    completions = 0;
  const handler = createDiagnosticPdfDownloadHandler({
    authenticate: async () => ({
      actorId: actor,
      db: { rpc: async () => ({ data: authority, error: null }) },
    }),
    service: {
      rpc: async (name) => {
        if (name === "read_diagnostic_pdf_download_context")
          return {
            data: {
              ...authority,
              ...(overrides.sha ? { sha256: overrides.sha } : {}),
              bucket: "diagnostic-pdfs",
              object_path: overrides.path ?? `${pet}/${job}/${sha}.pdf`,
            },
            error: null,
          };
        completions++;
        const { expires_at: _expires, ...fields } = authority;
        return {
          data: {
            ...fields,
            outcome: overrides.receipt ?? "response_prepared",
          },
          error: overrides.code ? { code: overrides.code } : null,
        };
      },
    },
    download: async () => {
      reads++;
      return new Response(overrides.bytes ?? bytes, {
        headers: { "Content-Type": "application/pdf" },
      });
    },
  });
  return { handler, reads: () => reads, completions: () => completions };
}
test("binary response verifies protocol bytes without claiming PDF admission", async () => {
  const fixture = setup(),
    response = await fixture.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(fixture.completions(), 1);
});
test("caller cannot supply a Storage path", async () => {
  const fixture = setup();
  assert.equal(
    (
      await fixture.handler(
        request({ id, job_id: job, pet_id: pet, object_path: "other" }),
      )
    ).status,
    400,
  );
  assert.equal(fixture.reads(), 0);
});
test("changed cross-layer context rejected before storage", async () => {
  const fixture = setup({ sha: "f".repeat(64) });
  assert.equal((await fixture.handler(request())).status, 503);
  assert.equal(fixture.reads(), 0);
});
test("cross-patient object path rejected before storage", async () => {
  const fixture = setup({ path: `${job}/${job}/${sha}.pdf` });
  assert.equal((await fixture.handler(request())).status, 503);
  assert.equal(fixture.reads(), 0);
});
test("same-length changed bytes never reach completion", async () => {
  const changed = bytes.slice();
  changed[0] ^= 1;
  const fixture = setup({ bytes: changed });
  assert.equal((await fixture.handler(request())).status, 503);
  assert.equal(fixture.completions(), 0);
});
for (const code of ["42501", "PT409"])
  test(`final ${code} cannot return bytes`, async () => {
    const fixture = setup({ code });
    const response = await fixture.handler(request());
    assert.equal(response.status, code === "42501" ? 404 : 409);
    assert.match(response.headers.get("content-type")!, /json/);
  });
test("audit outcome cannot claim user receipt", async () => {
  const fixture = setup({ receipt: "received" });
  assert.equal((await fixture.handler(request())).status, 503);
});
for (const size of [bytes.length - 1, bytes.length + 1])
  test(`stream length ${size} denied`, async () => {
    await assert.rejects(
      verifiedDiagnosticPdfResponse(
        new Response(new Uint8Array(size), {
          headers: { "Content-Type": "application/pdf" },
        }),
        bytes.length,
        sha,
      ),
    );
  });
test("misleading HTTP length or MIME rejected", async () => {
  for (const headers of [
    { "Content-Type": "text/html" },
    { "Content-Type": "application/pdf", "Content-Length": "0" },
  ])
    await assert.rejects(
      verifiedDiagnosticPdfResponse(
        new Response(bytes, { headers }),
        bytes.length,
        sha,
      ),
    );
});
