import test from "node:test";
import assert from "node:assert/strict";
import {
  configuration,
  createAdapter,
  parsePage,
} from "../../supabase/functions/ezyvet-import/adapter.ts";
import type { EzyVetConfig } from "../../supabase/functions/ezyvet-import/adapter.ts";
const config: EzyVetConfig = {
  baseUrl: "https://api.trial.ezyvet.com",
  siteUid: "synthetic-site",
  partnerId: "synthetic-partner",
  clientId: "synthetic-client",
  clientSecret: "secret-never-in-output",
  readResources: ["contact", "animal"],
};
const page = (id = 12) => ({
  meta: { items_page: "1", items_page_total: "1" },
  items: [
    {
      contact: {
        id,
        first_name: "Synthetic",
        driver_license_number: "discard-me",
        client_secret: "discard-me",
        nested: { access_token: "discard-me" },
      },
    },
  ],
});
const token = () =>
  Response.json({ access_token: "bearer-never-in-output", expires_in: 43200 });
test("configuration is disabled by default and rejects custom hosts or ungated production", () => {
  assert.throws(() => configuration(() => undefined), /IMPORT_DISABLED/);
  const env: Record<string, string> = {
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_API_URL: "http://localhost",
    EZYVET_SITE_UID: "site",
    EZYVET_PARTNER_ID: "partner",
    EZYVET_CLIENT_ID: "client",
    EZYVET_CLIENT_SECRET: "secret",
  };
  assert.throws(() => configuration((key) => env[key]), /INVALID_API_HOST/);
  env.EZYVET_API_URL = "https://api.ezyvet.com";
  assert.throws(
    () => configuration((key) => env[key]),
    /PRODUCTION_SOURCE_DISABLED/,
  );
  env.EZYVET_API_URL = "https://api.trial.ezyvet.com";
  assert.deepEqual(configuration((key) => env[key]).readResources, [
    "contact",
    "animal",
  ]);
  env.EZYVET_READ_RESOURCES = "contact,write-animal";
  assert.throws(() => configuration((key) => env[key]), /INVALID_READ_SCOPES/);
});
test("read-only adapter caches token, submits site UID and excludes secrets from snapshots", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const adapter = createAdapter(config, {
    now: () => 1700000000000,
    sleep: async () => {},
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init! });
      return url.endsWith("access_token") ? token() : Response.json(page());
    },
  });
  const result = await adapter.page("contact", 1);
  await adapter.page("contact", 1);
  assert.equal(
    calls.filter((call) => call.url.endsWith("access_token")).length,
    1,
  );
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    partner_id: config.partnerId,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    site_uid: config.siteUid,
    grant_type: "client_credentials",
    scope: "read-contact read-animal",
  });
  assert.equal(calls[1].init.method, "GET");
  assert.equal(
    calls[1].url,
    "https://api.trial.ezyvet.com/v1/contact?page=1&limit=50",
  );
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(result.items[0].external_id, "12");
  assert.equal(result.complete, true);
  assert.equal(JSON.stringify(result).includes("discard-me"), false);
  assert.equal(JSON.stringify(result).includes("bearer-never"), false);
});
test("bounded transient retries and one 401 token renewal", async () => {
  let tokens = 0,
    gets = 0,
    sleeps = 0;
  const adapter = createAdapter(config, {
    now: Date.now,
    sleep: async () => {
      sleeps++;
    },
    fetch: async (input) => {
      if (String(input).endsWith("access_token")) {
        tokens++;
        return token();
      }
      gets++;
      if (gets === 1) {
        return new Response("sensitive upstream body", { status: 503 });
      }
      if (gets === 2) return new Response("", { status: 401 });
      return Response.json(page());
    },
  });
  await adapter.page("contact", 1);
  assert.equal(tokens, 2);
  assert.equal(gets, 3);
  assert.equal(sleeps, 1);
  let attempts = 0;
  const failing = createAdapter(config, {
    now: Date.now,
    sleep: async () => {},
    fetch: async () => {
      attempts++;
      throw new Error("network details and secret");
    },
  });
  await assert.rejects(failing.page("contact", 1), /UPSTREAM_UNAVAILABLE/);
  assert.equal(attempts, 3);
});
test("rate limit schedules durable retry rather than sleeping or exposing upstream body", async () => {
  let calls = 0;
  const adapter = createAdapter(config, {
    now: Date.now,
    sleep: async () => assert.fail("must not sleep on rate limit"),
    fetch: async () => {
      calls++;
      return new Response("secret provider response", {
        status: 429,
        headers: { "x-ratelimit-reset": "90" },
      });
    },
  });
  await assert.rejects(
    adapter.page("contact", 1),
    (error: { code: string; retryAfter: number }) =>
      error.code === "RATE_LIMITED" && error.retryAfter === 90,
  );
  assert.equal(calls, 1);
});
test("malformed cursors, duplicates, missing pages and unsafe IDs cannot advance", () => {
  assert.throws(
    () =>
      parsePage(
        { ...page(), meta: { items_page: 2, items_page_total: 3 } },
        "contact",
        1,
      ),
    /INVALID_UPSTREAM_CURSOR/,
  );
  assert.throws(
    () =>
      parsePage(
        { meta: { items_page: 1, items_page_total: 2 }, items: [] },
        "contact",
        1,
      ),
    /EMPTY_INTERMEDIATE_PAGE/,
  );
  assert.throws(
    () =>
      parsePage(
        { ...page(), items: [...page().items, ...page().items] },
        "contact",
        1,
      ),
    /DUPLICATE_OR_INVALID/,
  );
  assert.throws(
    () =>
      parsePage(
        { ...page(), items: [{ contact: { id: "../../secret" } }] },
        "contact",
        1,
      ),
    /DUPLICATE_OR_INVALID/,
  );
  assert.throws(
    () => parsePage({ items: [] }, "contact", 1),
    /INVALID_UPSTREAM_SHAPE/,
  );
  assert.equal(
    parsePage(
      { meta: { items_page: 1, items_page_total: 0 }, items: [] },
      "contact",
      1,
    ).complete,
    true,
  );
});
test("bounded payload size and non-JSON errors never enter staging", async () => {
  const adapter = createAdapter(config, {
    now: Date.now,
    sleep: async () => {},
    fetch: async (input) =>
      String(input).endsWith("access_token")
        ? token()
        : new Response("x".repeat(2 * 1024 * 1024 + 1)),
  });
  await assert.rejects(
    adapter.page("contact", 1),
    /UPSTREAM_RESPONSE_TOO_LARGE/,
  );
  const invalid = createAdapter(config, {
    now: Date.now,
    sleep: async () => {},
    fetch: async () => new Response("secret HTML invalid token body"),
  });
  await assert.rejects(invalid.page("contact", 1), /INVALID_UPSTREAM_JSON/);
});

test("animal birth date survives contact-only personal-data filtering", () => {
  const result = parsePage(
    {
      meta: { items_page: 1, items_page_total: 1 },
      items: [{ animal: { id: 1, date_of_birth: 1672531200 } }],
    },
    "animal",
    1,
  );
  assert.equal(result.items[0].payload.date_of_birth, 1672531200);
  const contact = parsePage(
    {
      meta: { items_page: 1, items_page_total: 1 },
      items: [{ contact: { id: 1, date_of_birth: 1672531200 } }],
    },
    "contact",
    1,
  );
  assert.equal(contact.items[0].payload.date_of_birth, undefined);
});

test("animal reads use documented v2 contract and healthstatus requires scoped patient", async () => {
  const calls: string[] = [];
  const adapter = createAdapter(
    { ...config, readResources: ["animal", "healthstatus"] },
    {
      now: () => 1700000000000,
      sleep: async () => {},
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("access_token")) return token();
        return Response.json({
          meta: { items_page: 1, items_page_total: 1 },
          items: url.includes("healthstatus")
            ? [
              {
                healthstatus: {
                  id: "9",
                  animal_id: "77",
                  weight: "12",
                  weight_unit: "unknown",
                  timestamp: "unknown",
                },
              },
            ]
            : [{ animal: { id: 77, contact_id: 8 } }],
        });
      },
    },
  );
  await adapter.page("animal", 1);
  assert.match(calls[1], /\/v2\/animal\?page=1&limit=50$/);
  await assert.rejects(
    () => adapter.page("healthstatus", 1),
    /PATIENT_MAPPING_REQUIRED/,
  );
  await adapter.page("healthstatus", 1, "77");
  assert.match(
    calls.at(-1)!,
    /\/v1\/healthstatus\?page=1&limit=10&animal_id=77$/,
  );
});
test("healthstatus patient mismatch never stages a plausible unrelated weight", async () => {
  const adapter = createAdapter(
    { ...config, readResources: ["healthstatus"] },
    {
      now: () => 1700000000000,
      sleep: async () => {},
      fetch: async (input) =>
        String(input).endsWith("access_token") ? token() : Response.json({
          meta: { items_page: 1, items_page_total: 1 },
          items: [{ healthstatus: { id: 1, animal_id: 999 } }],
        }),
    },
  );
  await assert.rejects(
    () => adapter.page("healthstatus", 1, "77"),
    /SOURCE_PATIENT_MISMATCH/,
  );
});

test("consult and history require mapped animals, bounded pages and intact opaque source fields", async () => {
  for (const resource of ["consult", "history"] as const) {
    const calls: string[] = [];
    let payload: Record<string, unknown> = {
      id: "31",
      animal_id: "77",
      consult_id: "2",
      comments: "<script>outside prose</script>",
      history_system: "opaque",
      chain: "unknown",
      timestamp: "1700000000",
      vet_id: "outside-clinician-opaque",
    };
    let count = 1;
    const adapter = createAdapter({ ...config, readResources: [resource] }, {
      now: Date.now,
      sleep: async () => {},
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        return url.endsWith("access_token") ? token() : Response.json({
          meta: { items_page: 1, items_page_total: 1 },
          items: Array.from(
            { length: count },
            (_, i) => ({ [resource]: { ...payload, id: String(31 + i) } }),
          ),
        });
      },
    });
    await assert.rejects(adapter.page(resource, 1), /PATIENT_MAPPING_REQUIRED/);
    assert.equal(calls.length, 0);
    const result = await adapter.page(resource, 1, "77");
    assert.equal(new URL(calls.at(-1)!).pathname, `/v1/${resource}`);
    assert.equal(
      new URL(calls.at(-1)!).search,
      "?page=1&limit=10&animal_id=77",
    );
    assert.deepEqual(result.items[0].payload, payload);
    payload = { ...payload, animal_id: "78" };
    await assert.rejects(
      adapter.page(resource, 1, "77"),
      /SOURCE_PATIENT_MISMATCH/,
    );
    payload = { ...payload, animal_id: { id: 77 } };
    await assert.rejects(
      adapter.page(resource, 1, "77"),
      /INVALID_UPSTREAM_SHAPE/,
    );
    payload = {
      ...payload,
      animal_id: "77",
      [resource === "history" ? "comments" : "description"]: [],
    };
    await assert.rejects(
      adapter.page(resource, 1, "77"),
      /INVALID_UPSTREAM_SHAPE/,
    );
    payload = {
      ...payload,
      [resource === "history" ? "comments" : "description"]: "Synthetic",
    };
    count = 11;
    await assert.rejects(
      adapter.page(resource, 1, "77"),
      /INVALID_UPSTREAM_SHAPE/,
    );
    assert.throws(
      () =>
        parsePage(
          { meta: { items_page: 2, items_page_total: 1 }, items: [] },
          resource,
          2,
        ),
      /INVALID_UPSTREAM_CURSOR/,
    );
  }
});

test("vaccination fetch is read-only, consult-scoped and retains unresolved source values", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const payload = {
    id: "31",
    consult_id: "82",
    product_id: "54",
    qty: "unknown",
    date_of_administration: "0",
    date_of_next_administration: null,
    vet_id: "outside",
    active: "false",
    description: "<script>source</script>",
    notes: "Uninterpreted vaccine history",
    nested: { client_secret: "discard-me" },
  };
  const adapter = createAdapter({ ...config, readResources: ["vaccination"] }, {
    now: Date.now,
    sleep: async () => {},
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init! });
      return url.endsWith("access_token") ? token() : Response.json({
        meta: { items_page: 1, items_page_total: 1 },
        items: [{ vaccination: payload }],
      });
    },
  });
  for (const scope of [undefined, "", "oops", "9007199254740992", "-1"]) {
    await assert.rejects(
      adapter.page("vaccination", 1, undefined, scope),
      /CONSULT_MAPPING_REQUIRED/,
    );
  }
  await assert.rejects(
    adapter.page("vaccination", 1, "77", "82"),
    /CONSULT_MAPPING_REQUIRED/,
  );
  assert.equal(calls.length, 0);
  const result = await adapter.page("vaccination", 1, undefined, "82");
  assert.equal(
    calls[1].url,
    "https://api.trial.ezyvet.com/v1/vaccination?page=1&limit=10&consult_id=82",
  );
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].init.redirect, "error");
  assert.equal(
    JSON.parse(calls[0].init.body as string).scope,
    "read-vaccination",
  );
  assert.deepEqual(result.items[0].payload, { ...payload, nested: {} });
  assert.equal(JSON.stringify(result).includes("discard-me"), false);
});

test("vaccination page rejects malformed identities, duplicate IDs, nested clinical values and over-limit pages", () => {
  const source = (payload: Record<string, unknown>) => ({
    meta: { items_page: 1, items_page_total: 1 },
    items: [{ vaccination: payload }],
  });
  const valid = { id: "31", consult_id: 82, product_id: null };
  for (
    const change of [
      { id: "outside-id" },
      { id: "031" },
      { consult_id: "082" },
      { product_id: "054" },
      { id: "9007199254740992" },
      { id: -1 },
      { consult_id: null },
      { consult_id: [] },
      { consult_id: "9007199254740992" },
      { product_id: {} },
      { product_id: "n/a" },
      { qty: {} },
      { vet_id: [] },
      { date_of_administration: {} },
      { date_of_next_administration: [] },
      { description: [] },
      { notes: {} },
      { active: {} },
    ]
  ) {
    assert.throws(
      () => parsePage(source({ ...valid, ...change }), "vaccination", 1),
      /INVALID_UPSTREAM_SHAPE|DUPLICATE_OR_INVALID_EXTERNAL_ID/,
    );
  }
  const repeated = {
    ...source(valid),
    items: [{ vaccination: valid }, { vaccination: valid }],
  };
  assert.throws(
    () => parsePage(repeated, "vaccination", 1),
    /DUPLICATE_OR_INVALID_EXTERNAL_ID/,
  );
  const tooMany = {
    ...source(valid),
    items: Array.from(
      { length: 11 },
      (_, id) => ({ vaccination: { ...valid, id } }),
    ),
  };
  assert.throws(
    () => parsePage(tooMany, "vaccination", 1),
    /INVALID_UPSTREAM_SHAPE/,
  );
  assert.equal(
    parsePage(source({ ...valid, qty: null, notes: null }), "vaccination", 1)
      .items.length,
    1,
  );
});

test("mixed-consult vaccination page fails as a whole and unrelated resources reject consult scope", async () => {
  let calls = 0;
  const adapter = createAdapter({
    ...config,
    readResources: ["vaccination", "contact"],
  }, {
    now: Date.now,
    sleep: async () => {},
    fetch: async (input) => {
      calls++;
      return String(input).endsWith("access_token") ? token() : Response.json({
        meta: { items_page: 1, items_page_total: 1 },
        items: [
          { vaccination: { id: 1, consult_id: 82 } },
          { vaccination: { id: 2, consult_id: 83 } },
        ],
      });
    },
  });
  await assert.rejects(
    adapter.page("contact", 1, undefined, "82"),
    /INVALID_PAGE_REQUEST/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    adapter.page("vaccination", 1, undefined, "82"),
    /SOURCE_CONSULT_MISMATCH/,
  );
  assert.equal(calls, 2);
});

test("issued clinic credentials may omit partner ID while retaining explicit read-only scopes", async () => {
  const env: Record<string, string> = {
    APP_ENV: "staging",
    EZYVET_IMPORT_MODE: "staging",
    EZYVET_API_URL: "https://api.ezyvet.com",
    EZYVET_ALLOW_PRODUCTION_SOURCE: "true",
    EZYVET_SITE_UID: "synthetic-site",
    EZYVET_CLIENT_ID: "synthetic-client",
    EZYVET_CLIENT_SECRET: "synthetic-secret",
  };
  const config = configuration((key) => env[key]);
  assert.equal(config.partnerId, undefined);
  assert.equal(config.clientId, "synthetic-client");
  assert.equal(config.clientSecret, "synthetic-secret");
  const bodies: Record<string, unknown>[] = [];
  const adapter = createAdapter(config, {
    now: Date.now,
    sleep: async () => {},
    fetch: async (input, init) => {
      if (String(input).endsWith("access_token")) {
        bodies.push(JSON.parse(String(init!.body)));
        return token();
      }
      return Response.json(page());
    },
  });
  await adapter.page("contact", 1);
  assert.equal("partner_id" in bodies[0], false);
  assert.equal(bodies[0].scope, "read-contact read-animal");
  assert.equal(bodies[0].site_uid, "synthetic-site");
  for (const bad of ["partner\nheader", "x".repeat(4097)]) {
    env.EZYVET_PARTNER_ID = bad;
    assert.throws(
      () => configuration((key) => env[key]),
      /INVALID_PARTNER_CONFIGURATION/,
    );
  }
  env.EZYVET_PARTNER_ID = "";
  assert.equal(configuration((key) => env[key]).partnerId, undefined);
  delete env.EZYVET_CLIENT_SECRET;
  assert.throws(
    () => configuration((key) => env[key]),
    /MISSING_CONFIGURATION/,
  );
});
