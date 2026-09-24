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
  for (
    const extra of [
      { client_secret: "secret" },
      { page: 3 },
      { actor: "another" },
      { api_url: "https://other.test" },
    ]
  ) {
    assert.equal(
      (
        await f.handler(
          f.request({ run_id: id, resource: "contact", ...extra }),
        )
      ).status,
      400,
    );
  }
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

test("healthstatus accepts only reviewed mapping input and uses server-derived animal ID", async () => {
  const env: Record<string, string> = {
    APP_URL: "https://thelivingroom.vet",
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_SITE_UID: "site",
    EZYVET_PARTNER_ID: "partner",
    EZYVET_CLIENT_ID: "client",
    EZYVET_CLIENT_SECRET: "secret",
    EZYVET_READ_RESOURCES: "healthstatus",
  };
  const urls: string[] = [];
  const handler = createHandler({
    env: (k) => env[k],
    now: Date.now,
    sleep: async () => {},
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      return url.endsWith("access_token")
        ? Response.json({ access_token: "token", expires_in: 43200 })
        : Response.json({
          meta: { items_page: 1, items_page_total: 1 },
          items: [{ healthstatus: { id: 9, animal_id: 77 } }],
        });
    },
    gateway: {
      authenticate: async () => ({ id: "actor", activeAdmin: true }),
      claim: async () => {
        throw new Error("Generic claim must not run");
      },
      claimWeight: async (run, actor, site, origin, mapping) => {
        assert.equal(mapping, "e5200000-0000-4000-8000-000000000001");
        return {
          id: run,
          requested_by: actor,
          source_site_uid: site,
          resource: "healthstatus",
          status: "running",
          next_page: 1,
          lease_id: "lease",
          animal_external_id: "77",
        };
      },
      stage: async (run) => ({ ...run, status: "review_ready", next_page: 2 }),
      fail: async () => {},
    },
  });
  const req = (extra: Record<string, unknown>) =>
    new Request("https://edge.test", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ run_id: id, resource: "healthstatus", ...extra }),
    });
  assert.equal((await handler(req({}))).status, 400);
  assert.equal(
    (
      await handler(
        req({
          animal_link_id: "e5200000-0000-4000-8000-000000000001",
          animal_id: "999",
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handler(
        req({ animal_link_id: "e5200000-0000-4000-8000-000000000001" }),
      )
    ).status,
    200,
  );
  assert.match(urls.at(-1)!, /animal_id=77$/);
});

test("clinical claims bind mapping and resource; legacy UUIDs cannot silently rebind", async () => {
  for (const resource of ["consult", "history"] as const) {
    const env: Record<string, string> = {
      APP_URL: "https://thelivingroom.vet",
      APP_ENV: "staging",
      EZYVET_IMPORT_MODE: "staging",
      EZYVET_SITE_UID: "site",
      EZYVET_PARTNER_ID: "partner",
      EZYVET_CLIENT_ID: "client",
      EZYVET_CLIENT_SECRET: "secret",
      EZYVET_READ_RESOURCES: resource,
    };
    let calls = 0, claims = 0, legacy = false, terminal = false;
    const mapping = "e5200000-0000-4000-8000-000000000001";
    const handler = createHandler({
      env: (k) => env[k],
      now: Date.now,
      sleep: async () => {},
      fetch: async (input) => {
        calls++;
        return String(input).endsWith("access_token")
          ? Response.json({ access_token: "token", expires_in: 43200 })
          : Response.json({
            meta: { items_page: 1, items_page_total: 1 },
            items: [{ [resource]: { id: 3, animal_id: 77 } }],
          });
      },
      gateway: {
        authenticate: async () => ({ id: "actor", activeAdmin: true }),
        claim: async () => {
          throw new Error("No generic clinical claim");
        },
        claimClinical: async (run, actor, site, selected, origin, link) => {
          claims++;
          assert.equal(link, mapping);
          assert.equal(selected, resource);
          assert.equal(origin, "https://api.trial.ezyvet.com");
          if (legacy) {
            throw {
              code: "22023",
              message: "CLINICAL_RUN_REQUIRES_NEW_MAPPING",
            };
          }
          return {
            id: run,
            requested_by: actor,
            source_site_uid: site,
            resource,
            status: terminal ? "review_ready" : "running",
            next_page: 1,
            lease_id: "lease",
            animal_external_id: "77",
          };
        },
        stage: async (run) => {
          terminal = true;
          return { ...run, status: "review_ready", next_page: 2 };
        },
        fail: async () => {},
      },
    });
    const req = (extra: Record<string, unknown> = {}) =>
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: "Bearer staff" },
        body: JSON.stringify({ run_id: id, resource, ...extra }),
      });
    assert.equal((await handler(req())).status, 400);
    assert.equal(
      (await handler(req({ animal_link_id: mapping, animal_id: "999" })))
        .status,
      400,
    );
    assert.equal(claims, 0);
    assert.equal((await handler(req({ animal_link_id: mapping }))).status, 200);
    const before = calls;
    assert.equal((await handler(req({ animal_link_id: mapping }))).status, 200);
    assert.equal(calls, before);
    legacy = true;
    const rejected = await handler(req({ animal_link_id: mapping }));
    assert.equal(rejected.status, 409);
    assert.deepEqual(await rejected.json(), {
      error: "CLINICAL_RUN_REQUIRES_NEW_MAPPING",
      retry_after_seconds: 5,
      retry_safe: false,
    });
    assert.equal(calls, before);
  }
});

function vaccinationFixture() {
  const mapping = "e5200000-0000-4000-8000-000000000001";
  const snapshot = "e5200000-0000-4000-8000-000000000002";
  const hash = "a".repeat(64);
  const env: Record<string, string> = {
    APP_URL: "https://thelivingroom.vet",
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_SITE_UID: "site",
    EZYVET_PARTNER_ID: "partner",
    EZYVET_CLIENT_ID: "client",
    EZYVET_CLIENT_SECRET: "secret",
    EZYVET_READ_RESOURCES: "vaccination,contact,history",
  };
  const state = {
    claims: 0,
    calls: [] as string[],
    stages: 0,
    terminal: false,
    claimError: null as { code: string; message: string } | null,
    missingScope: false,
    wrongConsult: false,
    failStage: false,
    failures: [] as string[],
  };
  const handler = createHandler({
    env: (k) => env[k],
    now: Date.now,
    sleep: async () => {},
    fetch: async (input) => {
      const url = String(input);
      state.calls.push(url);
      return url.endsWith("access_token")
        ? Response.json({ access_token: "token", expires_in: 43200 })
        : Response.json({
          meta: { items_page: 1, items_page_total: 1 },
          items: [{
            vaccination: { id: 3, consult_id: state.wrongConsult ? 83 : 82 },
          }],
        });
    },
    gateway: {
      authenticate: async () => ({ id: "actor", activeAdmin: true }),
      claim: async () => {
        throw new Error("Generic claim must never handle vaccinations");
      },
      claimVaccination: async (
        run,
        actor,
        site,
        origin,
        link,
        consult,
        digest,
        version,
      ) => {
        state.claims++;
        assert.equal(link, mapping);
        assert.equal(consult, snapshot);
        assert.equal(digest, hash);
        assert.equal(version, 4);
        assert.equal(origin, "https://api.trial.ezyvet.com");
        if (state.claimError) throw state.claimError;
        return {
          id: run,
          requested_by: actor,
          source_site_uid: site,
          resource: "vaccination",
          status: state.terminal ? "review_ready" : "running",
          next_page: 1,
          lease_id: "lease",
          animal_external_id: "77",
          consult_external_id: state.missingScope ? undefined : "82",
        };
      },
      stage: async (run, actor, page) => {
        state.stages++;
        assert.equal(actor, "actor");
        assert.equal(page.items[0].payload.consult_id, 82);
        if (state.failStage) {
          throw { code: "40001", message: "SOURCE_CONSULT_STALE" };
        }
        state.terminal = true;
        return { ...run, status: "review_ready", next_page: 2 };
      },
      fail: async (_run, _actor, code) => {
        state.failures.push(code);
      },
    },
  });
  const body = {
    run_id: id,
    resource: "vaccination",
    animal_link_id: mapping,
    consult_snapshot_id: snapshot,
    consult_payload_hash: hash,
    consult_observed_head_version: 4,
  };
  const request = (value: Record<string, unknown> = body) =>
    new Request("https://edge.test", {
      method: "POST",
      headers: { Authorization: "Bearer staff" },
      body: JSON.stringify(value),
    });
  return { state, env, handler, body, request };
}

test("vaccination requires complete immutable consult intent and rejects browser-supplied upstream IDs", async () => {
  const f = vaccinationFixture();
  for (
    const field of [
      "animal_link_id",
      "consult_snapshot_id",
      "consult_payload_hash",
      "consult_observed_head_version",
    ]
  ) {
    const body: Record<string, unknown> = { ...f.body };
    delete body[field];
    assert.equal((await f.handler(f.request(body))).status, 400);
  }
  for (
    const patch of [
      { consult_id: "82" },
      { consult_external_id: "82" },
      { animal_id: "77" },
      { consult_snapshot_id: "bad" },
      { consult_payload_hash: "A".repeat(64) },
      { consult_observed_head_version: 0 },
      { consult_observed_head_version: 1.5 },
      { consult_observed_head_version: "4" },
      { consult_observed_head_version: 2147483648 },
    ]
  ) {
    assert.equal(
      (await f.handler(f.request({ ...f.body, ...patch }))).status,
      400,
    );
  }
  for (const resource of ["contact", "history"]) {
    assert.equal(
      (await f.handler(f.request({ ...f.body, resource }))).status,
      400,
    );
  }
  assert.equal(f.state.claims, 0);
  assert.equal(f.state.calls.length, 0);
  f.env.EZYVET_READ_RESOURCES = "contact";
  assert.equal((await f.handler(f.request())).status, 400);
  assert.equal(f.state.claims, 0);
});

test("vaccination uses claimed consult scope and terminal recovery makes no additional provider request", async () => {
  const f = vaccinationFixture();
  const result = await f.handler(f.request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    run_id: id,
    status: "review_ready",
    next_page: 2,
    review_only: true,
    staged_count: 1,
  });
  assert.match(f.state.calls.at(-1)!, /limit=10&consult_id=82$/);
  assert.equal(f.state.calls.at(-1)!.includes("animal_id"), false);
  const calls = f.state.calls.length;
  assert.equal((await f.handler(f.request())).status, 200);
  assert.equal(f.state.calls.length, calls);
  assert.equal(f.state.stages, 1);
});

test("vaccination missing claimed scope and mixed-consult payload cannot be staged", async () => {
  for (const missingScope of [true, false]) {
    const f = vaccinationFixture();
    f.state.missingScope = missingScope;
    f.state.wrongConsult = !missingScope;
    const response = await f.handler(f.request());
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(
      result.error,
      missingScope ? "CONSULT_MAPPING_REQUIRED" : "SOURCE_CONSULT_MISMATCH",
    );
    assert.equal(f.state.stages, 0);
    assert.equal(f.state.calls.length, missingScope ? 0 : 2);
    assert.deepEqual(f.state.failures, [result.error]);
  }
});

test("vaccination stale context and legacy run errors are actionable without leaking database bodies", async () => {
  for (
    const error of [
      { code: "22023", message: "VACCINATION_RUN_REQUIRES_NEW_CONTEXT" },
      { code: "40001", message: "SOURCE_CONSULT_STALE" },
    ]
  ) {
    const f = vaccinationFixture();
    f.state.claimError = error;
    const response = await f.handler(f.request());
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: error.message,
      retry_after_seconds: 5,
      retry_safe: false,
    });
    assert.equal(f.state.calls.length, 0);
  }
  const f = vaccinationFixture();
  f.state.failStage = true;
  const response = await f.handler(f.request());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "SOURCE_CONSULT_STALE");
  assert.deepEqual(f.state.failures, ["SOURCE_CONSULT_STALE"]);
  const privateError = vaccinationFixture();
  privateError.state.claimError = {
    code: "40001",
    message: "secret source context details",
  };
  const redacted = await privateError.handler(privateError.request());
  assert.equal((await redacted.json()).error, "IMPORT_FAILED");
});

test("prescription resources cannot fall through to generic claims before scoped intake exists", async () => {
  const f = fixture();
  f.env.EZYVET_READ_RESOURCES = "prescription,prescriptionitem";
  for (const resource of ["prescription", "prescriptionitem"]) {
    const response = await f.handler(f.request({ run_id: id, resource, animal_link_id: id, ...(resource === "prescriptionitem" ? { prescription_snapshot_id: id, prescription_payload_hash: "a".repeat(64), prescription_observed_head_version: 1 } : {}) }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "PRESCRIPTION_INTAKE_UNAVAILABLE" });
  }
  assert.equal(f.state.calls, 0);
  assert.equal(f.state.claims, 0);
  assert.equal(f.state.stages, 0);
});

function prescriptionitemFixture() {
  const mapping = "e5200000-0000-4000-8000-000000000001";
  const snapshot = "e5200000-0000-4000-8000-000000000002";
  const hash = "a".repeat(64);
  const env: Record<string, string> = {
    APP_URL: "https://thelivingroom.vet",
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_SITE_UID: "site",
    EZYVET_PARTNER_ID: "partner",
    EZYVET_CLIENT_ID: "client",
    EZYVET_CLIENT_SECRET: "secret",
    EZYVET_READ_RESOURCES: "prescriptionitem,contact,history",
  };
  const state = {
    claims: 0,
    calls: [] as string[],
    stages: 0,
    terminal: false,
    claimError: null as { code: string; message: string } | null,
    missingScope: false,
    wrongPrescription: false,
    failStage: false,
    failures: [] as string[],
  };
  const handler = createHandler({
    env: (k) => env[k],
    now: Date.now,
    sleep: async () => {},
    fetch: async (input) => {
      const url = String(input);
      state.calls.push(url);
      return url.endsWith("access_token")
        ? Response.json({ access_token: "token", expires_in: 43200 })
        : Response.json({
          meta: { items_page: 1, items_page_total: 1 },
          items: [{
            prescriptionitem: { id: 3, prescription_id: state.wrongPrescription ? 83 : 82 },
          }],
        });
    },
    gateway: {
      authenticate: async () => ({ id: "actor", activeAdmin: true }),
      claim: async () => {
        throw new Error("Generic claim must never handle prescriptionitems");
      },
      claimPrescriptionItem: async (
        run,
        actor,
        site,
        origin,
        link,
        prescription,
        digest,
        version,
      ) => {
        state.claims++;
        assert.equal(link, mapping);
        assert.equal(prescription, snapshot);
        assert.equal(digest, hash);
        assert.equal(version, 4);
        assert.equal(origin, "https://api.trial.ezyvet.com");
        if (state.claimError) throw state.claimError;
        return {
          id: run,
          requested_by: actor,
          source_site_uid: site,
          resource: "prescriptionitem",
          status: state.terminal ? "review_ready" : "running",
          next_page: 1,
          lease_id: "lease",
          animal_external_id: "77",
          prescription_external_id: state.missingScope ? undefined : "82",
        };
      },
      stage: async (run, actor, page) => {
        state.stages++;
        assert.equal(actor, "actor");
        assert.equal(page.items[0].payload.prescription_id, 82);
        if (state.failStage) {
          throw { code: "40001", message: "SOURCE_PRESCRIPTION_STALE" };
        }
        state.terminal = true;
        return { ...run, status: "review_ready", next_page: 2 };
      },
      fail: async (_run, _actor, code) => {
        state.failures.push(code);
      },
    },
  });
  const body = {
    run_id: id,
    resource: "prescriptionitem",
    animal_link_id: mapping,
    prescription_snapshot_id: snapshot,
    prescription_payload_hash: hash,
    prescription_observed_head_version: 4,
  };
  const request = (value: Record<string, unknown> = body) =>
    new Request("https://edge.test", {
      method: "POST",
      headers: { Authorization: "Bearer staff" },
      body: JSON.stringify(value),
    });
  return { state, env, handler, body, request };
}

test("prescriptionitem requires complete immutable prescription intent and rejects browser-supplied upstream IDs", async () => {
  const f = prescriptionitemFixture();
  for (
    const field of [
      "animal_link_id",
      "prescription_snapshot_id",
      "prescription_payload_hash",
      "prescription_observed_head_version",
    ]
  ) {
    const body: Record<string, unknown> = { ...f.body };
    delete body[field];
    assert.equal((await f.handler(f.request(body))).status, 400);
  }
  for (
    const patch of [
      { prescription_id: "82" },
      { prescription_external_id: "82" },
      { animal_id: "77" },
      { prescription_snapshot_id: "bad" },
      { prescription_payload_hash: "A".repeat(64) },
      { prescription_observed_head_version: 0 },
      { prescription_observed_head_version: 1.5 },
      { prescription_observed_head_version: "4" },
      { prescription_observed_head_version: 2147483648 },
    ]
  ) {
    assert.equal(
      (await f.handler(f.request({ ...f.body, ...patch }))).status,
      400,
    );
  }
  for (const resource of ["contact", "history"]) {
    assert.equal(
      (await f.handler(f.request({ ...f.body, resource }))).status,
      400,
    );
  }
  assert.equal(f.state.claims, 0);
  assert.equal(f.state.calls.length, 0);
  f.env.EZYVET_READ_RESOURCES = "contact";
  assert.equal((await f.handler(f.request())).status, 400);
  assert.equal(f.state.claims, 0);
});

test("prescriptionitem uses claimed prescription scope and terminal recovery makes no additional provider request", async () => {
  const f = prescriptionitemFixture();
  const result = await f.handler(f.request());
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    run_id: id,
    status: "review_ready",
    next_page: 2,
    review_only: true,
    staged_count: 1,
  });
  assert.match(f.state.calls.at(-1)!, /limit=10&prescription_id=82$/);
  assert.equal(f.state.calls.at(-1)!.includes("animal_id"), false);
  const calls = f.state.calls.length;
  assert.equal((await f.handler(f.request())).status, 200);
  assert.equal(f.state.calls.length, calls);
  assert.equal(f.state.stages, 1);
});

test("prescriptionitem missing claimed scope and mixed-prescription payload cannot be staged", async () => {
  for (const missingScope of [true, false]) {
    const f = prescriptionitemFixture();
    f.state.missingScope = missingScope;
    f.state.wrongPrescription = !missingScope;
    const response = await f.handler(f.request());
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(
      result.error,
      missingScope ? "PRESCRIPTION_MAPPING_REQUIRED" : "SOURCE_PRESCRIPTION_MISMATCH",
    );
    assert.equal(f.state.stages, 0);
    assert.equal(f.state.calls.length, missingScope ? 0 : 2);
    assert.deepEqual(f.state.failures, [result.error]);
  }
});

test("prescriptionitem stale context and legacy run errors are actionable without leaking database bodies", async () => {
  for (
    const error of [
      { code: "22023", message: "PRESCRIPTIONITEM_RUN_REQUIRES_NEW_CONTEXT" },
      { code: "40001", message: "SOURCE_PRESCRIPTION_STALE" },
    ]
  ) {
    const f = prescriptionitemFixture();
    f.state.claimError = error;
    const response = await f.handler(f.request());
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: error.message,
      retry_after_seconds: 5,
      retry_safe: false,
    });
    assert.equal(f.state.calls.length, 0);
  }
  const f = prescriptionitemFixture();
  f.state.failStage = true;
  const response = await f.handler(f.request());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "SOURCE_PRESCRIPTION_STALE");
  assert.deepEqual(f.state.failures, ["SOURCE_PRESCRIPTION_STALE"]);
  const privateError = prescriptionitemFixture();
  privateError.state.claimError = {
    code: "40001",
    message: "secret source context details",
  };
  const redacted = await privateError.handler(privateError.request());
  assert.equal((await redacted.json()).error, "IMPORT_FAILED");
});


test("prescription header claims bind mapping and resource; legacy UUIDs cannot silently rebind", async () => {
  for (const resource of ["prescription"] as const) {
    const env: Record<string, string> = {
      APP_URL: "https://thelivingroom.vet",
      APP_ENV: "staging",
      EZYVET_IMPORT_MODE: "staging",
      EZYVET_SITE_UID: "site",
      EZYVET_PARTNER_ID: "partner",
      EZYVET_CLIENT_ID: "client",
      EZYVET_CLIENT_SECRET: "secret",
      EZYVET_READ_RESOURCES: resource,
    };
    let calls = 0, claims = 0, legacy = false, terminal = false;
    const mapping = "e5200000-0000-4000-8000-000000000001";
    const handler = createHandler({
      env: (k) => env[k],
      now: Date.now,
      sleep: async () => {},
      fetch: async (input) => {
        calls++;
        return String(input).endsWith("access_token")
          ? Response.json({ access_token: "token", expires_in: 43200 })
          : Response.json({
            meta: { items_page: 1, items_page_total: 1 },
            items: [{ [resource]: { id: 3, animal_id: 77 } }],
          });
      },
      gateway: {
        authenticate: async () => ({ id: "actor", activeAdmin: true }),
        claim: async () => {
          throw new Error("No generic clinical claim");
        },
        claimPrescription: async (run, actor, site, origin, link) => {
          claims++;
          assert.equal(link, mapping);
          assert.equal(origin, "https://api.trial.ezyvet.com");
          if (legacy) {
            throw {
              code: "22023",
              message: "PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING",
            };
          }
          return {
            id: run,
            requested_by: actor,
            source_site_uid: site,
            resource,
            status: terminal ? "review_ready" : "running",
            next_page: 1,
            lease_id: "lease",
            animal_external_id: "77",
          };
        },
        stage: async (run) => {
          terminal = true;
          return { ...run, status: "review_ready", next_page: 2 };
        },
        fail: async () => {},
      },
    });
    const req = (extra: Record<string, unknown> = {}) =>
      new Request("https://edge.test", {
        method: "POST",
        headers: { Authorization: "Bearer staff" },
        body: JSON.stringify({ run_id: id, resource, ...extra }),
      });
    assert.equal((await handler(req())).status, 400);
    assert.equal(
      (await handler(req({ animal_link_id: mapping, animal_id: "999" })))
        .status,
      400,
    );
    assert.equal(claims, 0);
    assert.equal((await handler(req({ animal_link_id: mapping }))).status, 200);
    const before = calls;
    assert.equal((await handler(req({ animal_link_id: mapping }))).status, 200);
    assert.equal(calls, before);
    legacy = true;
    const rejected = await handler(req({ animal_link_id: mapping }));
    assert.equal(rejected.status, 409);
    assert.deepEqual(await rejected.json(), {
      error: "PRESCRIPTION_RUN_REQUIRES_NEW_MAPPING",
      retry_after_seconds: 5,
      retry_safe: false,
    });
    assert.equal(calls, before);
  }
});
