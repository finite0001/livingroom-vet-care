/** Synthetic, uniquely owned Auth/HTTP/browser/restore verification. No real provider calls. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { chromium } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { createClinicalNoteHandler } from "../../supabase/functions/_shared/clinical-note-handler.ts";
import {
  noteJobReadSchema,
  type noteTemplateDefinitionSchema,
} from "../../supabase/functions/_shared/clinical-note-model.ts";
import { z } from "zod";

const project = process.env.NOTE_TEST_PROJECT;
assert.ok(project && process.env.NOTE_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "(lrv-clinical-notes-[a-f0-9]+)"/m,
)?.[1];
assert.ok(identity);
const container = "supabase_db_" + identity;
const labels = JSON.parse(
  execFileSync("docker", ["inspect", container], { encoding: "utf8" }),
)[0].Config.Labels;
assert.equal(labels["com.supabase.cli.project"], identity);
assert.equal(
  realpathSync(labels["com.supabase.cli.workdir"]),
  realpathSync(project),
);
const status = parseOwnedRuntimeStatus(
  execFileSync("supabase", [
    "status",
    "--workdir",
    project,
    "--output",
    "json",
    "--agent",
    "no",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
);
assert.equal(status.API_URL, "http://127.0.0.1:65121");
function sql(query: string, database = "postgres") {
  try {
    return execFileSync("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
    ], {
      input: query,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (failure) {
    mkdirSync("tmp", { recursive: true, mode: 0o700 });
    writeFileSync(
      "tmp/clinical-notes-sql-failure.txt",
      query + "\n" + String(failure),
      { mode: 0o600 },
    );
    throw Error(
      "Owned note SQL failed; see private tmp/clinical-notes-sql-failure.txt.",
    );
  }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
interface Actor {
  id: string;
  db: SupabaseClient;
  session: Session;
}
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    throw Object.assign(Error(name + ": " + error.message), {
      code: error.code,
    });
  }
  return data;
}
async function actor(admin: boolean): Promise<Actor> {
  const email = "synthetic-notes-" + randomUUID() + "@example.test",
    password = randomUUID() + randomUUID();
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error) throw created.error;
  const id = created.data.user!.id,
    db = createClient(status.API_URL, status.ANON_KEY, options);
  sql(
    `update profiles set is_active=true,full_name='Synthetic notes staff'where id='${id}';insert into user_roles(user_id,role)values('${id}','${
      admin ? "ADMIN" : "STAFF"
    }')on conflict do nothing;`,
  );
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id, db, session: signed.data.session! };
}
let apiChecks = 0,
  browserChecks = 0,
  restoreChecks = 0,
  providerRequests = 0,
  finishRequests = 0;
const apiCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  apiChecks++;
};
const browserCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  browserChecks++;
};
const restoreCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  restoreChecks++;
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 600; i++) {
    if (await test()) return;
    await pause(25);
  }
  throw Error("Did not observe " + label);
}
const source =
  "FICTIONAL TEST ONLY. Owner reports cough for two days. Heart and lungs were not examined. CBC was discussed but declined; not performed.";
let definition: z.infer<typeof noteTemplateDefinitionSchema>;
let loseFinishAck = false,
  processingEnabled = true,
  providerHold: Promise<void> | null = null;
const handler = createClinicalNoteHandler({
  get enabled() {
    return processingEnabled;
  },
  audioEnabled: true,
  apiKey: "owned-stub-only",
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const actorId = data.user.id,
      db = createClient(status.API_URL, status.ANON_KEY, {
        ...options,
        global: { headers: { Authorization: "Bearer " + token } },
      });
    return {
      actorId,
      read: (id) =>
        rpc(db, "read_clinical_note_job", { p_actor_id: actorId, p_id: id }),
      claim: (args) => rpc(db, "claim_clinical_note", args),
    };
  },
  dispatch: (id) => rpc(service, "dispatch_clinical_note", { p_id: id }),
  finish: async (id, result) => {
    finishRequests++;
    const saved = await rpc(service, "finish_clinical_note", {
      p_id: id,
      p_result: result,
    });
    if (loseFinishAck) {
      loseFinishAck = false;
      throw Error("Dropped committed synthetic result response");
    }
    return saved;
  },
  fail: async (id, uncertain, code, details) => {
    await rpc(service, "fail_clinical_note", {
      p_id: id,
      p_uncertain: uncertain,
      p_code: code,
      p_details: details ?? {},
    });
  },
  providerFetch: async (url) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    providerRequests++;
    if (providerHold) await providerHold;
    const first = definition.fields.find((f) =>
      f.destination === "subjective"
    )!.id;
    const payload = {
      fields: definition.fields.map((f) =>
        f.id === first
          ? {
            field_id: f.id,
            status: "supported",
            claims: [{
              text: "Owner reports cough for two days.",
              quote: "Owner reports cough for two days.",
            }],
            uncertainty: "",
          }
          : { field_id: f.id, status: "missing", claims: [], uncertainty: "" }
      ),
      review_flags: [
        "Heart and lungs were not examined; declined CBC was not performed.",
      ],
    };
    return new Response(
      JSON.stringify({
        id: "synthetic-" + randomUUID(),
        model: "synthetic-model",
        status: "completed",
        error: null,
        incomplete_details: null,
        output: [{
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(payload) }],
        }],
      }),
      {
        headers: {
          "content-type": "application/json",
          "x-request-id": "synthetic-request",
        },
      },
    );
  },
});
const bridge = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const response = await handler(
      new Request("http://localhost/process", {
        method: req.method,
        headers,
        ...(req.method !== "OPTIONS" ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("{}");
  }
});
bridge.listen(0, "127.0.0.1");
await once(bridge, "listening");
const address = bridge.address();
assert.ok(address && typeof address !== "string");
const bridgeUrl = "http://127.0.0.1:" + address.port + "/process";
const intent = (job_id: string) => ({
  job_id,
  attempt_id: randomUUID(),
  retry_of: null,
  reason: "",
  ack_cost: false,
});
async function send(a: Actor, value: ReturnType<typeof intent>) {
  return fetch(bridgeUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + a.session.access_token,
      "content-type": "application/json",
      "x-note-intent": encodeURIComponent(JSON.stringify(value)),
    },
    body: "{}",
  });
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null,
  vite: ReturnType<typeof spawn> | null = null;
mkdirSync("tmp/clinical-notes-browser", { recursive: true, mode: 0o700 });

// End-to-end scenarios are below; every fixture is confined to the marked local runtime.
try {
  apiCheck(
    sql("select count(*)from supabase_migrations.schema_migrations;"),
    "199",
  );
  const first = await actor(true), second = await actor(false);
  const configuration = (a = first) =>
    rpc(a.db, "read_clinical_note_configuration", { p_actor_id: a.id });
  const saveConfiguration = (
    operation: string,
    request: unknown,
    id = randomUUID(),
  ) =>
    rpc(first.db, "save_clinical_note_configuration", {
      p_actor_id: first.id,
      p_id: id,
      p_operation: operation,
      p_request: request,
    });
  let config = await configuration();
  apiCheck(config.policy.status, "draft");
  let template = config.templates.find((t: { approved: unknown }) =>
    t.approved
  );
  assert.ok(template);
  definition = template.approved.definition;
  const policyRequest = {
    expected_version: config.policy.version,
    status: "approved",
    consent_text:
      "SYNTHETIC LOCAL POLICY ONLY. Authorized fictional text, reviewed draft outputs and record retention.",
    attest_reviewed: true,
  };
  await assert.rejects(
    rpc(second.db, "save_clinical_note_configuration", {
      p_actor_id: second.id,
      p_id: randomUUID(),
      p_operation: "policy",
      p_request: policyRequest,
    }),
    { code: "42501" },
  );
  apiChecks++;
  const client = (await rpc(first.db, "save_client", {
    p_actor_id: first.id,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Notes",
    p_primary_phone: "+13035555581",
    p_primary_email: "synthetic-notes@example.test",
    p_preferred_channel: "EMAIL",
    p_housecall_address: null,
    p_mailing_address: null,
  })).id;
  async function patient(name: string) {
    return (await rpc(first.db, "save_patient", {
      p_id: null,
      p_client_id: client,
      p_expected_version: null,
      p_name: name,
      p_species: "Dog",
      p_breed: "Mixed",
      p_dob: null,
      p_birth_date_precision: "unknown",
      p_color: "",
      p_sex: "unknown",
      p_neuter_status: "unknown",
      p_microchip_id: null,
      p_archived_at: null,
      p_deceased_at: null,
    })).id as string;
  }
  async function encounter(pet: string) {
    return rpc(first.db, "save_clinical_encounter", {
      p_id: null,
      p_pet_id: pet,
      p_expected_version: null,
      p_visit_at: new Date().toISOString(),
      p_visit_type: "clinic",
      p_location: "Synthetic clinic",
      p_subjective: "Original history",
      p_objective: "Original exam",
      p_assessment: "Original assessment",
      p_plan: "Original plan",
    });
  }
  const pet = await patient("Synthetic API Notes"),
    uiPet = await patient("Synthetic Browser Notes");
  const initial = await encounter(pet), uiEncounter = await encounter(uiPet);
  function requestFor(row = initial, text = source) {
    return {
      pet_id: row.pet_id,
      encounter_id: row.id,
      expected_version: row.version,
      policy_version: config.policy.version,
      template_id: template.id,
      template_version: template.approved.version,
      template_hash: template.approved.sha256,
      source_kind: "typed",
      source_text: text,
      audio_job_id: null,
      source_note: "Fictional owned test source",
      attest_authorized: true,
    };
  }
  const reserve = (id: string, request: unknown) =>
    rpc(first.db, "reserve_clinical_note", {
      p_actor_id: first.id,
      p_id: id,
      p_request: request,
    });
  await assert.rejects(reserve(randomUUID(), requestFor()), { code: "42501" });
  apiChecks++;
  apiCheck(providerRequests, 0);
  config = (await saveConfiguration("policy", policyRequest)).configuration;
  const customId = randomUUID();
  definition = {
    ...definition,
    name: "Synthetic note test template",
    fields: definition.fields.map((field) => ({
      ...field,
      required: field.destination === "objective",
    })),
  };
  config = (await saveConfiguration("create_template", {
    template_id: customId,
    definition,
  })).configuration;
  const draftTemplate = config.templates.find((item: { id: string }) =>
    item.id === customId
  );
  apiCheck(draftTemplate.approved, null);
  config = (await saveConfiguration("approve_template", {
    template_id: customId,
    expected_revision: draftTemplate.revision,
    version: draftTemplate.latest.version,
    sha256: draftTemplate.latest.sha256,
    attest_reviewed: true,
  })).configuration;
  template = config.templates.find((item: { id: string }) =>
    item.id === customId
  );
  definition = template.approved.definition;
  const request = requestFor(), jobId = randomUUID();
  const reservations = await Promise.all([
    reserve(jobId, request),
    reserve(jobId, request),
  ]);
  apiCheck(reservations[0], reservations[1]);
  apiCheck(reservations[0].source_text, source);
  await assert.rejects(
    reserve(jobId, { ...request, source_text: "Changed text" }),
    { code: "23505" },
  );
  apiChecks++;
  const cancelled = randomUUID();
  apiCheck(
    (await rpc(first.db, "cancel_clinical_note_reservation", {
      p_actor_id: first.id,
      p_id: cancelled,
    })).cancelled,
    true,
  );
  await assert.rejects(reserve(cancelled, request), { code: "PT409" });
  apiChecks++;
  const originalIntent = intent(jobId);
  let release = () => {};
  providerHold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = send(first, originalIntent);
  await until(() => providerRequests === 1, "first note provider request");
  const duplicate = await send(first, originalIntent);
  apiCheck(duplicate.status, 200);
  apiCheck(providerRequests, 1);
  providerHold = null;
  release();
  const generated = await running;
  apiCheck(generated.status, 200);
  const result = noteJobReadSchema.parse(await generated.json());
  assert.ok(result.job.proposal_id);
  apiCheck((await send(first, originalIntent)).status, 200);
  apiCheck(providerRequests, 1);
  apiCheck(
    sql(
      `select subjective||'|'||objective from clinical_encounters where id='${initial.id}';`,
    ),
    "Original history|Original exam",
  );
  const provenance = await rpc(first.db, "read_clinical_note_provenance", {
    p_actor_id: first.id,
    p_proposal_id: result.job.proposal_id,
  });
  apiCheck(provenance.source_sha256, result.job.source_sha256);
  apiCheck(provenance.template_snapshot.sha256, result.template.sha256);
  apiCheck(provenance.payload.fields.length, definition.fields.length);
  // Committed finish acknowledgement can be retried with the exact received result without repeating paid work.
  const secondId = randomUUID();
  await reserve(secondId, request);
  loseFinishAck = true;
  const finishBefore = finishRequests;
  const secondResponse = await send(first, intent(secondId));
  apiCheck(secondResponse.status, 200);
  apiCheck(finishRequests - finishBefore, 2);
  apiCheck(providerRequests, 2);
  await assert.rejects(
    rpc(second.db, "claim_clinical_note", {
      p_actor_id: second.id,
      p_id: randomUUID(),
      p_job_id: secondId,
    }),
    { code: "42501" },
  );
  apiChecks++;
  const raceId = randomUUID();
  await reserve(raceId, request);
  const raceIntent = intent(raceId);
  const raceArgs = {
    p_actor_id: first.id,
    p_id: raceIntent.attempt_id,
    p_job_id: raceId,
    p_retry_of: raceIntent.retry_of,
    p_reason: raceIntent.reason,
    p_ack_cost: raceIntent.ack_cost,
  };
  const race = await Promise.allSettled([
    rpc(first.db, "claim_clinical_note", raceArgs),
    rpc(first.db, "cancel_clinical_note_attempt", raceArgs),
  ]);
  apiCheck(race[1].status, "fulfilled");
  if (race[1].status === "fulfilled") apiCheck(race[1].value.cancelled, true);
  apiCheck((await send(first, raceIntent)).status, 409);
  apiCheck(providerRequests, 2);

  // Observe an actual worker lock wait, revoke its original session, then prove no dispatch is admitted.
  const revoked = await actor(false),
    revokedId = randomUUID(),
    revokedAttempt = randomUUID();
  await rpc(revoked.db, "reserve_clinical_note", {
    p_actor_id: revoked.id,
    p_id: revokedId,
    p_request: request,
  });
  await rpc(revoked.db, "claim_clinical_note", {
    p_actor_id: revoked.id,
    p_id: revokedAttempt,
    p_job_id: revokedId,
  });
  const blocker = spawn("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-X",
    "-qAt",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let blockerOutput = "";
  blocker.stdout.on("data", (data) => {
    blockerOutput += data.toString();
  });
  try {
    blocker.stdin.write(
      "begin;select pg_advisory_xact_lock(hashtextextended('clinical-note-policy',0));select 'LOCKED';\n",
    );
    await until(
      () => blockerOutput.includes("LOCKED"),
      "owned note policy lock",
    );
    const dispatch = rpc(service, "dispatch_clinical_note", {
      p_id: revokedAttempt,
    }).then(
      (value) => ({ value, code: "" }),
      (failure) => ({ value: null, code: failure.code }),
    );
    await until(
      () =>
        Number(
          sql(
            "select count(*)from pg_stat_activity where wait_event_type='Lock'and query like '%dispatch_clinical_note%';",
          ),
        ) > 0,
      "HTTP note dispatch waiting on policy lock",
    );
    sql(`delete from auth.sessions where user_id='${revoked.id}';`);
    blocker.stdin.end("commit;\n");
    apiCheck((await dispatch).code, "42501");
    apiCheck(
      sql(
        `select state from clinical_note_attempts where id='${revokedAttempt}';`,
      ),
      "claimed",
    );
  } finally {
    if (blocker.exitCode === null) {
      if (!blocker.stdin.writableEnded) blocker.stdin.end("rollback;\n");
      await once(blocker, "exit");
    }
  }

  // Browser uses actual Auth/REST and the real handler with a synthetic provider dependency.
  const origin = "http://127.0.0.1:65181";
  vite = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "65181",
    "--strictPort",
  ], {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    },
    stdio: "ignore",
  });
  await until(async () => {
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "owned notes browser app");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  await context.route(
    "**/*",
    (route) =>
      [origin, status.API_URL].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort(),
  );
  await context.addInitScript((session) => {
    if (!localStorage.getItem("synthetic:notes-bootstrap")) {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("synthetic:notes-bootstrap", "true");
    }
  }, first.session);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let lostReservation = false, lostGeneration = false;
  let blockedIntent: ReturnType<typeof intent> | null = null;
  await page.route("**/rest/v1/rpc/reserve_clinical_note", async (route) => {
    try {
      const response = await route.fetch();
      if (!lostReservation && response.ok()) {
        lostReservation = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    } catch {
      errors.push("Synthetic source interception failed.");
      await route.abort("failed").catch(() => {});
    }
  });
  await page.route("**/functions/v1/clinical-note-process", async (route) => {
    try {
      const request = route.request();
      if (!processingEnabled) {
        blockedIntent = JSON.parse(
          decodeURIComponent(request.headers()["x-note-intent"]),
        );
      }
      const response = await fetch(bridgeUrl, {
        method: request.method(),
        headers: request.headers(),
        body: request.postData(),
      });
      const body = await response.text();
      if (!lostGeneration && response.ok && JSON.parse(body).job.proposal_id) {
        lostGeneration = true;
        await route.abort("failed");
      } else {await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body,
        });}
    } catch {
      errors.push("Synthetic generation interception failed.");
      await route.abort("failed").catch(() => {});
    }
  });
  await page.goto(origin + "/hub/patient/" + uiPet, {
    waitUntil: "domcontentloaded",
  });
  async function openEncounter() {
    await page.getByRole("tab", { name: /^Medical/ }).click();
    const clinical = page.getByRole("region", {
      name: "Clinical records",
      exact: true,
    });
    await clinical.getByRole("button", { name: / · clinic · draft$/ }).click();
    await clinical.getByRole("region", {
      name: "Template note drafts",
      exact: true,
    }).waitFor();
    return clinical;
  }
  let clinical = await openEncounter();
  let notes = clinical.getByRole("region", {
    name: "Template note drafts",
    exact: true,
  });
  const manager = notes.locator(
    'details[aria-label="Clinical note templates"]',
  );
  await manager.getByText("Practice templates and approval", { exact: true })
    .click();
  await manager.getByRole("button").filter({
    hasText: definition.name + " · latest v",
  }).click();
  const policyAttestation = manager.getByRole("checkbox", {
    name: /I reviewed this exact policy/,
  });
  const templateAttestation = manager.getByRole("checkbox", {
    name: /I reviewed every heading and instruction/,
  });
  await policyAttestation.check();
  browserCheck(await templateAttestation.isChecked(), false);
  await policyAttestation.uncheck();
  await templateAttestation.check();
  browserCheck(await policyAttestation.isChecked(), false);
  await templateAttestation.uncheck();
  await manager.getByText("Practice templates and approval", { exact: true })
    .click();
  await notes.getByLabel("Approved template", { exact: true }).selectOption(
    template.id,
  );
  await notes.getByLabel("Typed observations", { exact: true }).fill(source);
  await notes.getByLabel("Source and permission", { exact: true }).fill(
    "Fictional browser test, authorized synthetic source only",
  );
  await notes.getByRole("checkbox", { name: /I verified this source/ }).check();
  await notes.getByRole("button", {
    name: "Save source for template generation",
    exact: true,
  }).click();
  await notes.getByRole("region", {
    name: "Unconfirmed note action",
    exact: true,
  }).waitFor();
  await until(
    () => lostReservation,
    "dropped committed browser source response",
  );
  browserCheck(lostReservation, true);
  browserCheck(
    await page.evaluate(
      (value) => !Object.values(sessionStorage).some((s) => s.includes(value)),
      source,
    ),
    true,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload({ waitUntil: "domcontentloaded" });
  clinical = await openEncounter();
  notes = clinical.getByRole("region", {
    name: "Template note drafts",
    exact: true,
  });
  await notes.getByRole("button", {
    name: "Recover original note action",
    exact: true,
  }).click();
  await notes.getByRole("region", {
    name: "Unconfirmed note action",
    exact: true,
  }).waitFor({ state: "hidden" });
  await notes.getByRole("region", {
    name: "Saved template note source",
    exact: true,
  }).waitFor();
  browserCheck(
    await notes.getByLabel("Typed observations", { exact: true }).inputValue(),
    "",
  );
  processingEnabled = false;
  await notes.getByRole("checkbox", {
    name: /I authorize this source to be sent to OpenAI/,
  }).check();
  await notes.getByRole("button", {
    name: "Generate template proposal",
    exact: true,
  }).click();
  await notes.getByText(
    "OpenAI clinical note processing is not commissioned.",
    { exact: true },
  ).waitFor();
  await notes.getByRole("button", {
    name: "Cancel undispatched note attempt",
    exact: true,
  }).click();
  await notes.getByRole("region", {
    name: "Unconfirmed note action",
    exact: true,
  }).waitFor({ state: "hidden" });
  browserCheck(
    await notes.getByRole("checkbox", {
      name: /I authorize this source to be sent to OpenAI/,
    }).isChecked(),
    false,
  );
  assert.ok(blockedIntent);
  processingEnabled = true;
  const paidBefore = providerRequests;
  browserCheck((await send(first, blockedIntent)).status, 409);
  browserCheck(providerRequests, paidBefore);
  await notes.getByRole("checkbox", {
    name: /I authorize this source to be sent to OpenAI/,
  }).check();
  await notes.getByRole("button", {
    name: "Generate template proposal",
    exact: true,
  }).click();
  await until(
    () => lostGeneration,
    "dropped committed browser generation response",
  );
  await notes.getByRole("button", {
    name: "Recover original note action",
    exact: true,
  }).click();
  await notes.getByRole("region", {
    name: "Unconfirmed note action",
    exact: true,
  }).waitFor({ state: "hidden" });
  browserCheck(
    sql(
      `select subjective||'|'||objective from clinical_encounters where id='${uiEncounter.id}';`,
    ),
    "Original history|Original exam",
  );
  const drafts = clinical.locator('details[aria-label="Dictation drafts"]');
  await drafts.locator("summary").click();
  await drafts.getByRole("button", { name: /Awaiting review/ }).click();
  const evidence = drafts.getByRole("region", {
    name: "Template field evidence",
    exact: true,
  });
  await evidence.waitFor();
  browserCheck(
    (await evidence.textContent())!.includes("Required information missing"),
    true,
  );
  await evidence.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "tmp/clinical-notes-browser/desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await evidence.scrollIntoViewIfNeeded();
  browserCheck(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= innerWidth
    ),
    true,
  );
  await page.screenshot({
    path: "tmp/clinical-notes-browser/mobile.png",
    fullPage: false,
  });
  await drafts.getByRole("checkbox", { name: "Accept Subjective", exact: true })
    .check();
  await drafts.getByRole("checkbox", {
    name: /I reviewed the patient attribution/,
  }).check();
  await drafts.getByRole("button", {
    name: "Accept selected sections into saved draft",
    exact: true,
  }).click();
  await until(
    () =>
      sql(
        `select version from clinical_encounters where id='${uiEncounter.id}';`,
      ) === "2",
    "reviewed selective encounter acceptance",
  );
  browserCheck(
    sql(
      `select objective||'|'||status from clinical_encounters where id='${uiEncounter.id}';`,
    ),
    "Original exam|draft",
  );
  browserCheck(
    sql(
      `select count(*)from clinical_dictation_reviews r join clinical_dictation_proposals p on p.id=r.proposal_id where p.encounter_id='${uiEncounter.id}';`,
    ),
    "1",
  );
  browserCheck(errors, []);
  await context.close();

  const snapshot =
    `set timezone='UTC';create temp table note_snapshot(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;insert into note_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from note_snapshot;`;
  const before = JSON.parse(sql(snapshot));
  let dump = execFileSync("docker", [
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "--no-owner",
    "--schema=public",
    "--schema=auth",
    "--schema=storage",
    "--schema=extensions",
    "postgres",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  dump = dump.split("\n").filter((line) =>
    !line.startsWith("ALTER DEFAULT PRIVILEGES")
  ).join("\n").replace(
    "CREATE SCHEMA extensions;",
    "CREATE SCHEMA IF NOT EXISTS extensions;",
  );
  const clone = "owned_notes_restore_" +
      randomUUID().replaceAll("-", "").slice(0, 10),
    marker = randomUUID();
  sql(`create database ${clone};comment on database ${clone} is '${marker}';`);
  try {
    sql(
      'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',
      clone,
    );
    sql(dump, clone);
    restoreCheck(JSON.parse(sql(snapshot, clone)), before);
    restoreCheck(JSON.parse(sql(snapshot)), before);
  } finally {
    assert.equal(
      sql(
        `select shobj_description(oid,'pg_database')from pg_database where datname='${clone}';`,
      ),
      marker,
    );
    sql(`drop database ${clone} with(force);`);
    restoreCheck(
      sql(`select count(*)from pg_database where datname='${clone}';`),
      "0",
    );
  }
  sql(`delete from auth.sessions where user_id='${second.id}';`);
  await assert.rejects(configuration(second), { code: "42501" });
  apiChecks++;
  const proof = {
    apiAssertions: apiChecks,
    browserAssertions: browserChecks,
    restoreAssertions: restoreChecks,
    restoredRelations: Object.keys(before).length,
    fakeProviderRequests: providerRequests,
    realProviderRequests: 0,
    droppedCommittedBrowserResponses: Number(lostReservation) +
      Number(lostGeneration),
  };
  writeFileSync(
    "tmp/clinical-notes-roundtrip.json",
    JSON.stringify(proof, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(proof));
} catch (failure) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    writeFileSync(
      "tmp/clinical-notes-browser/failure.html",
      await failedPage.content().catch(() => ""),
      { mode: 0o600 },
    );
    await failedPage.screenshot({
      path: "tmp/clinical-notes-browser/failure.png",
      fullPage: false,
    }).catch(() => {});
  }
  throw failure;
} finally {
  if (browser) await browser.close();
  if (vite) {
    const exited = once(vite, "exit");
    vite.kill("SIGTERM");
    await exited;
  }
  bridge.closeAllConnections();
  await new Promise<void>((resolve) => bridge.close(() => resolve()));
}
