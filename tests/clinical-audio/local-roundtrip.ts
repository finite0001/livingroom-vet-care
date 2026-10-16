/** Owned synthetic Auth/PostgREST/browser/restore proof. No external provider requests. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";
import { parseOwnedRuntimeStatus } from "../estimates/owned-runtime-status.ts";
import { createClinicalAudioHandler } from "../../supabase/functions/_shared/clinical-audio-handler.ts";
import {
  audioDigest,
  encodeAudioWav,
  inspectAudioWav,
  audioJobReadSchema,
} from "../../supabase/functions/_shared/clinical-audio-model.ts";

const project = process.env.DICTATION_TEST_PROJECT;
assert.ok(project && process.env.DICTATION_RUN_SYNTHETIC_LOCAL === "true");
const identity = readFileSync(project + "/supabase/config.toml", "utf8").match(
  /^project_id = "(lrv-clinical-audio-[a-f0-9]+)"/m,
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
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json", "--agent", "no"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.equal(status.API_URL, "http://127.0.0.1:64921");
function sql(query: string, database = "postgres") {
  try {
    return execFileSync(
      "docker",
      [
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
      ],
      {
        input: query,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      },
    ).trim();
  } catch {
    throw new Error("Owned SQL operation failed; private output withheld.");
  }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options),
  anon = createClient(status.API_URL, status.ANON_KEY, options);
interface Actor {
  id: string;
  db: SupabaseClient;
  session: Session;
}
const actors: Actor[] = [];
let apiChecks = 0,
  browserChecks = 0,
  sqlChecks = 0,
  observedWaits = 0;
const apiCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  apiChecks++;
};
const browserCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  browserChecks++;
};
const sqlCheck = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected);
  sqlChecks++;
};
async function rpc(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw Object.assign(new Error(name + ": " + error.message), {
      code: error.code,
    });
  return data;
}
async function actor(name: string) {
  const email = "synthetic-audio-" + randomUUID() + "@example.test",
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
    `update profiles set is_active=true,full_name='Synthetic audio ${name}'where id='${id}';insert into user_roles(user_id,role)values('${id}','STAFF')on conflict do nothing;`,
  );
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const result = { id, db, session: signed.data.session! };
  actors.push(result);
  return result;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 300; i++) {
    if (await test()) return;
    await pause(25);
  }
  throw new Error("Did not observe " + label);
}
const transcript = "Owner reports cough for two days. No exam was dictated.";
const payload = {
  subjective: [{ text: "Cough for two days.", quote: "cough for two days" }],
  objective: [],
  assessment: [],
  plan: [],
  review_flags: ["No exam was dictated."],
};
const bytes = encodeAudioWav([
  Int16Array.from({ length: 48000 }, (_, i) =>
    Math.round(Math.sin(i / 8) * 5000),
  ),
]);
const metadata = {
  sha256: await audioDigest(bytes),
  ...inspectAudioWav(bytes),
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null,
  vite: ReturnType<typeof spawn> | null = null,
  page: Page | null = null;
let providerRequests = 0,
  finishRequests = 0,
  loseFinishAck = false,
  unknownId = "",
  holdId = "",
  releaseProvider: () => void = () => {},
  providerEntered = false;
const requests: string[] = [];
const fakeProvider = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks),
      id = String(req.headers["x-client-request-id"]);
    requests.push(id);
    providerRequests++;
    if (id === unknownId) {
      req.socket.destroy();
      return;
    }
    if (id === holdId) {
      providerEntered = true;
      await new Promise<void>((r) => {
        releaseProvider = r;
      });
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("x-request-id", "synthetic-" + id);
    if (req.url === "/v1/audio/transcriptions") {
      const form = await new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": String(req.headers["content-type"]) },
        body,
      }).formData();
      assert.equal(form.get("model"), "gpt-transcribe");
      const file = form.get("file") as File;
      inspectAudioWav(new Uint8Array(await file.arrayBuffer()));
      res.end(JSON.stringify({ text: transcript }));
    } else {
      assert.equal(req.url, "/v1/responses");
      const input = JSON.parse(body.toString());
      assert.equal(input.store, false);
      assert.equal(input.background, false);
      assert.equal(input.model, "gpt-6-luna");
      assert.equal(JSON.parse(input.input).transcript, transcript);
      res.end(
        JSON.stringify({
          id: "synthetic-" + id,
          model: "gpt-6-luna",
          status: "completed",
          error: null,
          incomplete_details: null,
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: JSON.stringify(payload) }],
            },
          ],
        }),
      );
    }
  } catch {
    res.statusCode = 500;
    res.end("{}");
  }
});
fakeProvider.listen(0, "127.0.0.1");
await once(fakeProvider, "listening");
const providerAddress = fakeProvider.address();
assert.ok(providerAddress && typeof providerAddress !== "string");
const providerOrigin = "http://127.0.0.1:" + providerAddress.port;
const handler = createClinicalAudioHandler({
  enabled: true,
  apiKey: "owned-fake-provider-only",
  authenticate: async (token) => {
    const { data, error } = await service.auth.getUser(token);
    if (error || !data.user) return null;
    const actorId = data.user.id;
    const db = createClient(status.API_URL, status.ANON_KEY, {
      ...options,
      global: { headers: { Authorization: "Bearer " + token } },
    });
    return {
      actorId,
      read: (id) =>
        rpc(db, "read_clinical_audio_job", { p_actor_id: actorId, p_id: id }),
      claim: (args) => rpc(db, "claim_clinical_audio", args),
    };
  },
  dispatch: (id) => rpc(service, "dispatch_clinical_audio", { p_id: id }),
  finish: async (id, result) => {
    finishRequests++;
    const saved = await rpc(service, "finish_clinical_audio", {
      p_id: id,
      p_result: result,
    });
    if (loseFinishAck) {
      loseFinishAck = false;
      throw Error("Dropped committed result ACK");
    }
    return saved;
  },
  fail: async (id, uncertain, code, details) => {
    await rpc(service, "fail_clinical_audio", {
      p_id: id,
      p_uncertain: uncertain,
      p_code: code,
      p_details: details ?? {},
    });
  },
  providerFetch: (url, opts) => {
    assert.equal(new URL(String(url)).origin, "https://api.openai.com");
    return fetch(providerOrigin + new URL(String(url)).pathname, opts);
  },
});
const bridge = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (typeof v === "string") headers.set(k, v);
    const response = await handler(
      new Request("http://localhost/process", {
        method: req.method,
        headers,
        ...(req.method !== "OPTIONS" ? { body } : {}),
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
const bridgeAddress = bridge.address();
assert.ok(bridgeAddress && typeof bridgeAddress !== "string");
const bridgeUrl = "http://127.0.0.1:" + bridgeAddress.port + "/process";
interface Intent {
  job_id: string;
  attempt_id: string;
  stage: "transcribe" | "generate";
  retry_of: string | null;
  reason: string;
  ack_cost: boolean;
}
function intent(
  job_id: string,
  stage: "transcribe" | "generate" = "transcribe",
): Intent {
  return {
    job_id,
    attempt_id: randomUUID(),
    stage,
    retry_of: null,
    reason: "",
    ack_cost: false,
  };
}
async function send(a: Actor, i: Intent, source = bytes) {
  return fetch(bridgeUrl, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + a.session.access_token,
      "content-type":
        i.stage === "transcribe"
          ? "application/octet-stream"
          : "application/json",
      "x-audio-intent": encodeURIComponent(JSON.stringify(i)),
    },
    body: i.stage === "transcribe" ? new Blob([source]) : "{}",
  });
}
mkdirSync("tmp/clinical-audio-browser", { recursive: true, mode: 0o700 });
let cleanupFailure: unknown = null;
try {
  sqlCheck(
    sql("select count(*)from supabase_migrations.schema_migrations;"),
    "196",
  );
  const first = await actor("First"),
    second = await actor("Second");
  const client = (
    await rpc(first.db, "save_client", {
      p_actor_id: first.id,
      p_client_id: null,
      p_expected_version: null,
      p_first_name: "Synthetic",
      p_last_name: "Audio",
      p_primary_phone: "+13035555581",
      p_primary_email: "synthetic-audio@example.test",
      p_preferred_channel: "EMAIL",
      p_housecall_address: null,
      p_mailing_address: null,
    })
  ).id;
  async function patient(name: string) {
    return (
      await rpc(first.db, "save_patient", {
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
      })
    ).id as string;
  }
  const pet = await patient("Synthetic API Audio"),
    uiPet = await patient("Synthetic Browser Audio");
  async function encounter(petId: string) {
    return rpc(first.db, "save_clinical_encounter", {
      p_id: null,
      p_pet_id: petId,
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
  const initial = await encounter(pet),
    uiEncounter = await encounter(uiPet);
  async function appointment(petId: string, offsetHours: number) {
    return rpc(first.db, "save_appointment", {
      p_actor_id: first.id, p_id: null, p_expected_version: null,
      p_client_id: client, p_pet_id: petId, p_scheduled_at: new Date(Date.now() + offsetHours * 3600000).toISOString(),
      p_duration_minutes: 30, p_appointment_type: "Synthetic dictation", p_status: "CONFIRMED",
      p_assigned_dvm_id: first.id, p_visit_type: "clinic", p_address_snapshot: "Synthetic", p_travel_before_minutes: 0,
      p_travel_after_minutes: 0, p_resource_name: null, p_notes: "Synthetic owned fixture", p_reminder_offsets: [],
    });
  }
  const apiAppointment = await appointment(pet, 2), uiAppointment = await appointment(uiPet, 0);
  const prepareArgs = { p_pet_id: pet, p_appointment_id: apiAppointment.id, p_expected_version: apiAppointment.version, p_existing_encounter_id: null };
  const prepared = await Promise.all([first, second].map(a => rpc(a.db, "prepare_appointment_dictation", { ...prepareArgs, p_actor_id: a.id })));
  apiCheck(prepared[0].id, prepared[1].id);
  sqlCheck(sql("select count(*)from appointment_clinical_links where appointment_id='" + apiAppointment.id + "';"), "1");
  apiCheck((await rpc(first.db, "prepare_appointment_dictation", { ...prepareArgs, p_actor_id: first.id })).id, prepared[0].id);
  const source = {
    pet_id: pet,
    encounter_id: initial.id,
    expected_version: 1,
    policy_version: 1,
    sha256: metadata.sha256,
    frames: metadata.frames,
    byte_size: metadata.byte_size,
    source_note: "Synthetic authorized source",
    attest_authorized: true,
  };
  apiCheck(
    (
      await first.db.rpc("reserve_clinical_audio", {
        p_actor_id: first.id,
        p_id: randomUUID(),
        p_request: source,
      })
    ).error?.code,
    "42501",
  );
  apiCheck(
    (
      await anon.rpc("read_clinical_audio", {
        p_actor_id: first.id,
        p_pet_id: pet,
        p_encounter_id: initial.id,
      })
    ).error?.code,
    "42501",
  );
  apiCheck(
    (await service.from("clinical_audio_jobs").select("*")).error?.code,
    "42501",
  );
  // Approved policy exists only inside this disposable synthetic runtime.
  sql(
    "insert into clinical_audio_policies(version,status,consent_text,audio_retention,transcript_retention,transcription_model,soap_model,reviewed_by,reviewed_at)values(2,'approved','Synthetic LOCAL TEST only; not Susan approval','not_stored','Synthetic fixture retention','gpt-transcribe','gpt-6-luna','" +
      first.id +
      "',now());",
  );
  source.policy_version = 2;
  async function reserve() {
    const id = randomUUID();
    return rpc(first.db, "reserve_clinical_audio", {
      p_actor_id: first.id,
      p_id: id,
      p_request: source,
    });
  }
  const job = await reserve(),
    stt = intent(job.id);
  const beforeProvider = providerRequests;
  apiCheck((await send(second, stt)).status, 403);
  apiCheck(providerRequests, beforeProvider);
  const altered = new Uint8Array(bytes);
  altered[100] ^= 1;
  apiCheck((await send(first, stt, altered)).status, 422);
  apiCheck(providerRequests, beforeProvider);
  // Two genuine HTTP claims wait behind a held row/advisory lock.
  const lock = spawn(
    "docker",
    [
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
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let lockOutput = "";
  lock.stdout.on("data", (v) => {
    lockOutput += String(v);
  });
  lock.stdin.write(
    "begin;select id from clinical_audio_jobs where id='" +
      job.id +
      "'for update;select 'LOCK_READY';\n",
  );
  await until(() => lockOutput.includes("LOCK_READY"), "owned row lock");
  const claimArgs = (i: Intent) => ({
    p_actor_id: first.id,
    p_id: i.attempt_id,
    p_job_id: i.job_id,
    p_stage: i.stage,
    p_retry_of: i.retry_of,
    p_reason: i.reason,
    p_ack_cost: i.ack_cost,
  });
  const competing = intent(job.id);
  const one = first.db.rpc("claim_clinical_audio", claimArgs(stt)),
    two = first.db.rpc("claim_clinical_audio", claimArgs(competing));
  const both = Promise.all([one, two]);
  try {
    await until(() => {
      observedWaits = Number(
        sql(
          "select count(*)from pg_stat_activity where pid<>pg_backend_pid()and state='active'and wait_event_type='Lock'and query like '%claim_clinical_audio%';",
        ),
      );
      return observedWaits >= 2;
    }, "two real HTTP claim lock waits");
  } finally {
    lock.stdin.end("commit;\\q\n");
  }
  const claimResults = await both;
  apiCheck(claimResults.filter((r) => !r.error).length, 1);
  apiCheck(claimResults.filter((r) => r.error?.code === "23514").length, 1);
  const admitted = claimResults[0].error ? competing : stt;
  // Hold upstream; duplicate handler dispatch cannot emit a second provider request.
  holdId = admitted.attempt_id;
  const firstSend = send(first, admitted);
  await until(() => providerEntered, "fake provider entered");
  const duplicate = await send(first, admitted);
  apiCheck(duplicate.status, 200);
  apiCheck(providerRequests, beforeProvider + 1);
  releaseProvider();
  const firstResponse = await firstSend;
  apiCheck(firstResponse.status, 200);
  const completed = audioJobReadSchema.parse(await firstResponse.json());
  apiCheck(completed.job.transcript, transcript);
  const generation = intent(job.id, "generate");
  loseFinishAck = true;
  const finishesBefore = finishRequests;
  const genResponse = await send(first, generation);
  apiCheck(genResponse.status, 200);
  const generated = audioJobReadSchema.parse(await genResponse.json());
  apiCheck(generated.job.proposal_id, generation.attempt_id);
  apiCheck(finishRequests, finishesBefore + 2);
  apiCheck(requests.filter((v) => v === generation.attempt_id).length, 1);
  apiCheck(
    sql(
      "select subjective||'|'||objective||'|'||status from clinical_encounters where id='" +
        initial.id +
        "';",
    ),
    "Original history|Original exam|draft",
  );
  const provenance = await rpc(first.db, "read_clinical_audio_provenance", {
    p_actor_id: first.id,
    p_proposal_id: generation.attempt_id,
  });
  apiCheck(provenance.payload, payload);
  apiCheck(provenance.transcription_context.version, "lrv-vet-en-v1");
  apiCheck(provenance.generation_context.version, "lrv-vet-en-v1");
  apiCheck(
    provenance.transcription_context.bundle_sha256,
    provenance.generation_context.bundle_sha256,
  );
  apiCheck(
    provenance.transcription_context.request_sha256 !==
      provenance.generation_context.request_sha256,
    true,
  );
  // Unknown provider transport is durable, explicit retry is required and late results are fenced.
  const lost = await reserve(),
    lostIntent = intent(lost.id);
  unknownId = lostIntent.attempt_id;
  apiCheck((await send(first, lostIntent)).status, 503);
  apiCheck(
    sql(
      "select state from clinical_audio_attempts where id='" +
        lostIntent.attempt_id +
        "';",
    ),
    "uncertain",
  );
  const retry = {
    ...intent(lost.id),
    retry_of: lostIntent.attempt_id,
    reason: "Reviewed saved uncertain outcome; synthetic explicit retry",
    ack_cost: true,
  };
  apiCheck(
    (
      await first.db.rpc("claim_clinical_audio", {
        ...claimArgs(retry),
        p_ack_cost: false,
      })
    ).error?.code,
    "23514",
  );
  apiCheck((await send(first, retry)).status, 200);
  apiCheck(
    (
      await service.rpc("finish_clinical_audio", {
        p_id: lostIntent.attempt_id,
        p_result: {
          request_id: "late",
          response_id: "",
          provider_model: "",
          contract_version: "clinical-audio-v1",
          payload: { text: transcript },
        },
      })
    ).error?.code,
    "PT409",
  );
  // Save only sanitized provider diagnostics and honor its retry cooldown.
  const cooldown = await reserve(),
    cool = intent(cooldown.id);
  await rpc(first.db, "claim_clinical_audio", claimArgs(cool));
  await rpc(service, "dispatch_clinical_audio", { p_id: cool.attempt_id });
  await rpc(service, "fail_clinical_audio", {
    p_id: cool.attempt_id,
    p_uncertain: false,
    p_code: "provider_rejected",
    p_details: {
      http_status: 429,
      provider_code: "rate_limit_exceeded",
      retry_after_seconds: 60,
      request_id: "synthetic-rate",
    },
  });
  apiCheck(
    (
      await first.db.rpc(
        "claim_clinical_audio",
        claimArgs({
          ...intent(cooldown.id),
          retry_of: cool.attempt_id,
          reason: "Synthetic retry",
          ack_cost: true,
        }),
      )
    ).error?.code,
    "PT409",
  );
  const origin = "http://127.0.0.1:64981";
  vite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "64981",
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        VITE_SUPABASE_URL: status.API_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
      },
      stdio: "ignore",
    },
  );
  await until(async () => {
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "owned browser app");
  const fixturePath =
    realpathSync("tmp") + "/clinical-audio-fake-microphone.wav";
  writeFileSync(fixturePath, bytes, { mode: 0o600 });
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--use-file-for-fake-audio-capture=" + fixturePath,
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    permissions: ["microphone"],
  });
  await context.addInitScript((session) => {
    if (!localStorage.getItem("synthetic:audio-bootstrap")) {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("synthetic:audio-bootstrap", "true");
    }
    const owned: MediaStream[] = [];
    (
      window as unknown as { syntheticStreams: MediaStream[] }
    ).syntheticStreams = owned;
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (c) => {
      const stream = await original(c);
      owned.push(stream);
      return stream;
    };
  }, first.session);
  await context.route("**/*", (route) =>
    [origin, status.API_URL].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let droppedReserve = false,
    droppedGeneration = false;
  await page.route("**/rest/v1/rpc/reserve_clinical_audio", async (route) => {
    if (!droppedReserve) {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      droppedReserve = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.route("**/functions/v1/clinical-audio-process", async (route) => {
    const request = route.request();
    const result = await fetch(bridgeUrl, {
      method: "POST",
      headers: request.headers(),
      body: request.postDataBuffer() ?? "{}",
    });
    const body = await result.text();
    const stage = JSON.parse(
      decodeURIComponent(request.headers()["x-audio-intent"]),
    ).stage;
    if (stage === "generate" && !droppedGeneration) {
      assert.equal(result.status, 200);
      droppedGeneration = true;
      await route.abort("failed");
    } else
      await route.fulfill({
        status: result.status,
        headers: Object.fromEntries(result.headers),
        body,
      });
  });
  let lostPrepare = false;
  await page.route("**/rest/v1/rpc/prepare_appointment_dictation", async route => {
    if (!lostPrepare) {
      const response = await route.fetch();
      assert.equal(response.status(), 200); lostPrepare = true;
      await route.abort("failed");
    } else await route.continue();
  });
  const scheduledDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(uiAppointment.scheduled_at));
  await page.goto(origin + "/hub/schedule?date=" + scheduledDay);
  await page.locator('[data-appointment-id="' + uiAppointment.id + '"]').getByRole("link", { name: "Open dictation", exact: true }).click();
  const confirmation = page.getByRole("region", { name: "Appointment dictation", exact: true });
  // Card uses accessible group semantics through an explicit region.
  await confirmation.getByText("Synthetic Browser Audio · Dog", { exact: true }).waitFor();
  browserCheck(await page.evaluate(() => (window as unknown as { syntheticStreams: MediaStream[] }).syntheticStreams.length), 0);
  await confirmation.getByLabel("Encounter for this appointment", { exact: true }).selectOption(uiEncounter.id);
  await confirmation.getByRole("checkbox", { name: /I confirm the patient/ }).check();
  await confirmation.getByRole("button", { name: "Confirm patient and open dictation", exact: true }).click();
  await confirmation.getByText(/If the response was lost/).waitFor();
  await confirmation.getByRole("button", { name: "Refresh appointment context", exact: true }).click();
  await confirmation.getByText(/already has a linked draft/).waitFor();
  await confirmation.getByRole("checkbox", { name: /I confirm the patient/ }).check();
  await confirmation.getByRole("button", { name: "Confirm patient and open dictation", exact: true }).click();
  browserCheck(await page.evaluate(() => (window as unknown as { syntheticStreams: MediaStream[] }).syntheticStreams.length), 0);
  sqlCheck(sql("select encounter_id from appointment_clinical_links where appointment_id='" + uiAppointment.id + "';"), uiEncounter.id);
  const clinical = page.getByRole("region", {
    name: "Clinical records",
    exact: true,
  });
  await clinical.getByText("Appointment encounter opened. Confirm recording permission below.", { exact: true }).waitFor();
  const panel = clinical.getByRole("region", {
    name: "Audio dictation",
    exact: true,
  });
  await panel
    .getByLabel("Dictation source and permission", { exact: true })
    .fill("Synthetic owned browser microphone; permitted test source.");
  await panel
    .getByRole("checkbox", {
      name: /I verified this patient and have permission/,
    })
    .check();
  sql("update appointments set notes='Synthetic concurrent note change' where id='" + uiAppointment.id + "';");
  await panel
    .getByRole("button", { name: "Start dictation recording", exact: true })
    .click();
  await panel.getByText(/Appointment changed; refresh and confirm again/).waitFor();
  browserCheck(await page.evaluate(() => (window as unknown as { syntheticStreams: MediaStream[] }).syntheticStreams.length), 0);
  page.once("dialog", d => d.accept());
  await panel.getByRole("button", { name: "Discard local audio and controls", exact: true }).click();
  await confirmation.getByRole("button", { name: "Refresh appointment context", exact: true }).click();
  await until(async () => !(await confirmation.getByRole("button", { name: "Refresh appointment context", exact: true }).isDisabled()), "fresh appointment context");
  await confirmation.getByRole("checkbox", { name: /I confirm the patient/ }).check();
  await confirmation.getByRole("button", { name: "Confirm patient and open dictation", exact: true }).click();
  await panel.getByLabel("Dictation source and permission", { exact: true }).fill("Synthetic owned browser microphone; permitted test source.");
  await panel.getByRole("checkbox", { name: /I verified this patient and have permission/ }).check();
  await panel
    .getByRole("button", { name: "Start dictation recording", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Pause recording", exact: true })
    .waitFor();
  await pause(1300);
  await panel
    .getByRole("button", { name: "Pause recording", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Resume recording", exact: true })
    .waitFor();
  await pause(200);
  await panel
    .getByRole("button", { name: "Resume recording", exact: true })
    .click();
  await pause(1100);
  await panel
    .getByRole("button", { name: "Stop and preview recording", exact: true })
    .click();
  await panel.getByText(/Recording finalized locally/).waitFor();
  browserChecks++;
  browserCheck(
    await page.evaluate(() =>
      (
        window as unknown as { syntheticStreams: MediaStream[] }
      ).syntheticStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === "ended"),
      ),
    ),
    true,
  );
  const preview = panel.getByLabel("Local dictation preview", { exact: true });
  await until(
    async () =>
      await preview.evaluate(
        (el: HTMLAudioElement) =>
          Number.isFinite(el.duration) && el.duration > 1,
      ),
    "playable local WAV",
  );
  browserChecks++;
  const downloaded = page.waitForEvent("download");
  await panel
    .getByRole("link", { name: "Download local WAV", exact: true })
    .click();
  const download = await downloaded;
  const downloadPath = await download.path();
  assert.ok(downloadPath);
  const browserBytes = new Uint8Array(readFileSync(downloadPath));
  inspectAudioWav(browserBytes);
  browserChecks++;
  browserCheck(
    await clinical.getByLabel("Subjective", { exact: true }).isDisabled(),
    true,
  );
  await panel
    .getByRole("button", {
      name: "Transcribe recording with OpenAI",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Recover source save", exact: true })
    .waitFor();
  const beforeRecover = providerRequests;
  await panel
    .getByRole("button", { name: "Recover source save", exact: true })
    .click();
  await panel.getByText(/Recording source metadata confirmed/).waitFor();
  browserCheck(providerRequests, beforeRecover);
  await panel
    .getByRole("button", {
      name: "Transcribe recording with OpenAI",
      exact: true,
    })
    .click();
  await panel
    .getByText("Saved transcript — review before generating", { exact: true })
    .waitFor();
  browserChecks++;
  await panel
    .getByRole("button", {
      name: "Generate SOAP draft with OpenAI",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", {
      name: "Resume original processing request",
      exact: true,
    })
    .waitFor();
  const beforeRecovery = providerRequests;
  await panel
    .getByRole("button", { name: "Recover processing status", exact: true })
    .click();
  await panel.getByText(/AI draft is saved/).waitFor();
  browserCheck(providerRequests, beforeRecovery);
  page.once("dialog", (d) => d.accept());
  await panel
    .getByRole("button", {
      name: "Discard local audio and controls",
      exact: true,
    })
    .click();
  const review = clinical.locator('details[aria-label="Dictation drafts"]');
  await review.locator("summary").click();
  const uiProposal = sql(
    "select proposal_id from clinical_audio_jobs where encounter_id='" +
      uiEncounter.id +
      "';",
  );
  await review.getByTestId("dictation-" + uiProposal).click();
  await review
    .getByRole("region", { name: "AI source provenance", exact: true })
    .waitFor();
  browserChecks++;
  browserCheck(
    await review
      .locator('[aria-label="Veterinary vocabulary provenance"]')
      .textContent()
      .then((s) => s?.includes("lrv-vet-en-v1")),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const reviewPanel = review.getByRole("region", {
    name: "Review dictation draft",
    exact: true,
  });
  await reviewPanel.getByLabel("Accept Subjective", { exact: true }).check();
  await reviewPanel
    .getByLabel("Subjective reviewed wording", { exact: true })
    .fill("Reviewed browser cough history.");
  await reviewPanel
    .getByRole("checkbox", {
      name: "I reviewed the patient attribution, transcript and selected wording.",
      exact: true,
    })
    .check();
  await reviewPanel
    .getByRole("button", {
      name: "Accept selected sections into saved draft",
      exact: true,
    })
    .click();
  await review
    .getByText(
      "Selected sections saved to the encounter draft. Review and sign separately.",
      { exact: true },
    )
    .waitFor();
  browserChecks++;
  browserCheck(
    await clinical.getByLabel("Subjective", { exact: true }).inputValue(),
    "Reviewed browser cough history.",
  );
  browserCheck(
    await clinical.getByLabel("Objective", { exact: true }).inputValue(),
    "Original exam",
  );
  apiCheck(
    sql(
      "select status from clinical_encounters where id='" +
        uiEncounter.id +
        "';",
    ),
    "draft",
  );
  browserCheck(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: "tmp/clinical-audio-browser/mobile.png",
    fullPage: false,
  });
  await review.locator("summary").click();
  await panel
    .getByLabel("Dictation source and permission", { exact: true })
    .fill("Synthetic mobile cancellation test.");
  await panel
    .getByRole("checkbox", {
      name: /I verified this patient and have permission/,
    })
    .check();
  await panel
    .getByRole("button", { name: "Start dictation recording", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Pause recording", exact: true })
    .waitFor();
  page.once("dialog", (d) => d.accept());
  await panel
    .getByRole("button", { name: "Cancel local recording", exact: true })
    .click();
  await until(
    async () =>
      page!.evaluate(() =>
        (
          window as unknown as { syntheticStreams: MediaStream[] }
        ).syntheticStreams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ),
      ),
    "tracks closed on cancel",
  );
  browserChecks++;
  await page.goto(origin + "/hub/schedule?date=" + scheduledDay);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.locator('[data-appointment-id="' + uiAppointment.id + '"]').getByRole("link", { name: "Open dictation", exact: true }).click();
  await confirmation.getByText("Synthetic Browser Audio · Dog", { exact: true }).waitFor();
  browserCheck(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "tmp/clinical-audio-browser/mobile-appointment.png", fullPage: false });
  await confirmation.getByRole("checkbox", { name: /I confirm the patient/ }).check();
  await confirmation.getByRole("button", { name: "Confirm patient and open dictation", exact: true }).click();
  await clinical.getByText("Appointment encounter opened. Confirm recording permission below.", { exact: true }).waitFor();
  browserCheck(await clinical.getByLabel("Subjective", { exact: true }).inputValue(), "Reviewed browser cough history.");
  browserCheck(errors, []);
  await context.close();

  const snapshot = `set timezone='UTC';create temp table dictation_snapshot(name text,value jsonb);do $$declare r record;v jsonb;begin for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','auth','storage','extensions')and c.relkind in('r','p')order by 1,2 loop execute format('select jsonb_build_object(''count'',count(*),''hash'',md5(coalesce(string_agg(to_jsonb(t)::text,''|''order by to_jsonb(t)::text),'''')))from %I.%I t',r.nspname,r.relname)into v;insert into dictation_snapshot values(r.nspname||'.'||r.relname,v);end loop;end$$;select jsonb_object_agg(name,value)from dictation_snapshot;`;
  const before = JSON.parse(sql(snapshot));
  let dump = execFileSync(
    "docker",
    [
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
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  dump = dump
    .split("\n")
    .filter((line) => !line.startsWith("ALTER DEFAULT PRIVILEGES"))
    .join("\n")
    .replace(
      "CREATE SCHEMA extensions;",
      "CREATE SCHEMA IF NOT EXISTS extensions;",
    );
  const clone =
      "owned_audio_restore_" + randomUUID().replaceAll("-", "").slice(0, 10),
    marker = randomUUID();
  sql(`create database ${clone};comment on database ${clone} is '${marker}';`);
  try {
    sql(
      'drop schema public;create schema extensions;create extension pgcrypto with schema extensions;create extension "uuid-ossp"with schema extensions;',
      clone,
    );
    sql(dump, clone);
    sqlCheck(JSON.parse(sql(snapshot, clone)), before);
    sqlCheck(JSON.parse(sql(snapshot)), before);
    const sid = sql(
      `select id from auth.sessions where user_id='${first.id}'order by created_at desc limit 1;`,
    );
    assert.match(sid, /^[a-f0-9-]{36}$/);
    sqlCheck(
      sql(
        `begin;select set_config('request.jwt.claims','{"role":"authenticated","sub":"${first.id}","session_id":"${sid}"}',true);set local role authenticated;select read_clinical_audio('${first.id}','${uiPet}','${uiEncounter.id}')->>'encounter_id';rollback;`,
        clone,
      )
        .split("\n")
        .at(-1),
      uiEncounter.id,
    );
  } finally {
    assert.equal(
      sql(
        `select shobj_description(oid,'pg_database')from pg_database where datname='${clone}';`,
      ),
      marker,
    );
    sql(`drop database ${clone} with(force);`);
    sqlCheck(
      sql(`select count(*)from pg_database where datname='${clone}';`),
      "0",
    );
  }

  for (const family of [
    "clinical_audio_policies",
    "clinical_audio_jobs",
    "clinical_audio_attempts",
    "clinical_audio_events",
    "clinical_audio_generations",
  ])
    apiCheck(Number(before["public." + family].count) > 0, true);
  sql("delete from auth.sessions where user_id='" + second.id + "';");
  apiCheck(
    (
      await second.db.rpc("read_clinical_audio", {
        p_actor_id: second.id,
        p_pet_id: pet,
        p_encounter_id: initial.id,
      })
    ).error?.code,
    "42501",
  );
  const proof = {
    apiAssertions: apiChecks,
    browserAssertions: browserChecks,
    sqlRestoreAssertions: sqlChecks,
    observedHttpLockWaits: observedWaits,
    restoredRelations: Object.keys(before).length,
    populatedAudioFamilies: 5,
    droppedCommittedBrowserResponses:
      Number(lostPrepare) + Number(droppedReserve) + Number(droppedGeneration),
    appointmentPreparationRecovered: lostPrepare,
    concurrentAppointmentConfirmationsShareEncounter: prepared[0].id === prepared[1].id,
    fakeProviderRequests: providerRequests,
    realProviderRequests: 0,
    resultSaveRetryProved: true,
    cloneRemoved: true,
    limitations: [
      "Fake provider proves transport/orchestration, not clinical AI accuracy",
      "Restored-session read uses SQL role context, not HTTP",
      "Desktop Chromium emulation is not an iPhone hardware test",
    ],
  };
  writeFileSync(
    "tmp/clinical-audio-roundtrip.json",
    JSON.stringify(proof, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(proof));
} catch (failure) {
  if (page) {
    await page
      .screenshot({
        path: "tmp/clinical-audio-browser/failure.png",
        fullPage: true,
      })
      .catch(() => undefined);
    writeFileSync(
      "tmp/clinical-audio-browser/failure.html",
      await page.content().catch(() => ""),
      { mode: 0o600 },
    );
  }
  throw failure;
} finally {
  releaseProvider();
  if (browser) await browser.close();
  if (vite) {
    const exited = once(vite, "exit");
    vite.kill("SIGTERM");
    await exited;
  }
  bridge.closeAllConnections();
  fakeProvider.closeAllConnections();
  await Promise.all([
    new Promise<void>((r) => bridge.close(() => r())),
    new Promise<void>((r) => fakeProvider.close(() => r())),
  ]);
  for (const a of actors) {
    try {
      sql(
        "update profiles set is_active=false where id='" +
          a.id +
          "';delete from user_roles where user_id='" +
          a.id +
          "';delete from auth.refresh_tokens where user_id='" +
          a.id +
          "';delete from auth.sessions where user_id='" +
          a.id +
          "';",
      );
      const retired = await service.auth.admin.updateUserById(a.id, {
        ban_duration: "876000h",
      });
      if (retired.error) cleanupFailure = retired.error;
    } catch (error) {
      cleanupFailure = error;
    }
  }
}
if (cleanupFailure) throw cleanupFailure;
