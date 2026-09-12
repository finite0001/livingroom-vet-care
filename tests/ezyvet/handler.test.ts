import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../supabase/functions/ezyvet-import/handler.ts";
import type { ImportRun } from "../../supabase/functions/ezyvet-import/handler.ts";
const id = "e1000000-0000-4000-8000-000000000001";
function fixture() {
  const env: Record<string, string> = {
    APP_URL: "https://thelivingroom.vet",
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_SITE_UID: "synthetic-site",
    EZYVET_PARTNER_ID: "synthetic-partner",
    EZYVET_CLIENT_ID: "synthetic-client",
    EZYVET_CLIENT_SECRET: "hidden-secret",
  };
  const state = {
    authenticated: true,
    admin: true,
    claims: 0,
    stages: 0,
    failures: [] as string[],
    calls: 0,
    failStage: false,
    run: {
      id,
      source_site_uid: "synthetic-site",
      resource: "contact",
      requested_by: "staff-id",
      next_page: 1,
      status: "running",
      lease_id: "lease",
    } as ImportRun,
  };
  const handler = createHandler({
    env: (key) => env[key],
    now: Date.now,
    sleep: async () => {},
    fetch: async (input) => {
      state.calls++;
      return String(input).endsWith("access_token")
        ? Response.json({ access_token: "hidden-token", expires_in: 43200 })
        : Response.json({
            meta: { items_page: state.run.next_page, items_page_total: 2 },
            items: [
              { contact: { id: state.run.next_page, first_name: "Synthetic" } },
            ],
          });
    },
    gateway: {
      authenticate: async () =>
        state.authenticated
          ? { id: "staff-id", activeAdmin: state.admin }
          : null,
      claim: async (runId, actor, site, resource) => {
        state.claims++;
        assert.equal(runId, id);
        assert.equal(actor, "staff-id");
        assert.equal(site, "synthetic-site");
        assert.equal(resource, "contact");
        return { ...state.run };
      },
      stage: async (run, actor, page) => {
        state.stages++;
        if (state.failStage) throw new Error("database secret");
        assert.equal(actor, "staff-id");
        assert.equal(page.page, run.next_page);
        state.run = {
          ...run,
          next_page: run.next_page + 1,
          status: page.complete ? "review_ready" : "running",
        };
        return state.run;
      },
      fail: async (_run, _actor, code) => {
        state.failures.push(code);
      },
    },
  });
  const request = (
    body: unknown = { run_id: id, resource: "contact" },
    authorization = true,
  ) =>
    new Request("https://functions.example.test/ezyvet-import", {
      method: "POST",
      headers: authorization ? { Authorization: "Bearer synthetic-user" } : {},
      body: JSON.stringify(body),
    });
  return { state, env, handler, request };
}
test("unauthenticated, nonadmin and disabled imports make no provider calls or staging writes", async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request(undefined, false))).status, 401);
  f.state.authenticated = false;
  assert.equal((await f.handler(f.request())).status, 401);
  f.state.authenticated = true;
  f.state.admin = false;
  assert.equal((await f.handler(f.request())).status, 403);
  f.state.admin = true;
  f.env.EZYVET_IMPORT_MODE = "disabled";
  assert.equal((await f.handler(f.request())).status, 503);
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.claims, 0);
  assert.equal(f.state.stages, 0);
});
test("client cannot inject credentials, cursor, actor, API host or arbitrary resource", async () => {
  const f = fixture();
  for (const extra of [
    { client_secret: "secret" },
    { page: 3 },
    { actor: "another" },
    { api_url: "https://other.test" },
  ])
    assert.equal(
      (
        await f.handler(
          f.request({ run_id: id, resource: "contact", ...extra }),
        )
      ).status,
      400,
    );
  assert.equal(
    (await f.handler(f.request({ run_id: id, resource: "../../animal" })))
      .status,
    400,
  );
  assert.equal(f.state.calls, 0);
});
test("server cursor stages one page at a time and completed replay skips provider fetch", async () => {
  const f = fixture();
  const first = await f.handler(f.request());
  const body = await first.json();
  assert.equal(body.next_page, 2);
  assert.equal(body.review_only, true);
  assert.equal(JSON.stringify(body).includes("hidden"), false);
  assert.equal(JSON.stringify(body).includes("Synthetic"), false);
  assert.equal(
    (await (await f.handler(f.request())).json()).status,
    "review_ready",
  );
  const calls = f.state.calls;
  await f.handler(f.request());
  assert.equal(f.state.calls, calls);
  assert.equal(f.state.stages, 2);
});
test("stage failure preserves cursor and persists safe error code, never raw error", async () => {
  const f = fixture();
  f.state.failStage = true;
  const response = await f.handler(f.request());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.equal(text.includes("secret"), false);
  assert.equal(f.state.run.next_page, 1);
  assert.deepEqual(f.state.failures, ["IMPORT_FAILED"]);
});
