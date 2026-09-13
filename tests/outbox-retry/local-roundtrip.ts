/** Actual Auth/PostgREST reviewed outbox recovery; no provider sends. */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { dispatchOne } from "../../supabase/functions/_shared/outbox-dispatch.ts";
let project = process.env.PAYMENT_TEST_PROJECT ||
  "/tmp/livingroom-vet-foundation";
let temporaryProject = "";
// The existing containers may outlive their /tmp configuration. This config is
// used for status only; this runner never starts, resets, or stops Supabase.
if (
  !process.env.PAYMENT_TEST_PROJECT &&
  !existsSync(`${project}/supabase/config.toml`)
) {
  temporaryProject = mkdtempSync(join(tmpdir(), "lrv-payment-local-"));
  project = temporaryProject;
  mkdirSync(join(project, "supabase"));
  writeFileSync(
    join(project, "supabase/config.toml"),
    'project_id = "livingroom-vet-foundation"\n[api]\nport = 56321\n[db]\nport = 56322\nshadow_port = 56320\n',
  );
  process.once(
    "exit",
    () => rmSync(temporaryProject, { recursive: true, force: true }),
  );
}
const projectId = readFileSync(`${project}/supabase/config.toml`, "utf8").match(
  /^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m,
)?.[1];
assert.ok(projectId, "Explicit local project required");
const local = JSON.parse(
  execFileSync(
    "supabase",
    ["status", "--workdir", project, "--output", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
const sql = (query: string) =>
  execFileSync("docker", [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
    .trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

const ids: string[] = [];
let actor = "", client = "";
let assertions = 0;
const failures: unknown[] = [];
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  assertions++;
};
const serviceHeaders = {
  apikey: local.ANON_KEY,
  Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
let staffHeaders: Record<string, string> = {};
async function api(path: string, args: unknown, headers = serviceHeaders) {
  const response = await fetch(local.API_URL + path, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    const code =
      typeof failure?.code === "string" && /^[A-Z0-9]{5}$/.test(failure.code)
        ? failure.code
        : "unknown";
    throw new Error(
      `Local fixture ${path} failed: HTTP ${response.status}, SQL ${code}`,
    );
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
const rpc = (name: string, args: Record<string, unknown>, staff = false) =>
  api("/rest/v1/rpc/" + name, args, staff ? staffHeaders : serviceHeaders);

const service = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let providerCalls = 0;
const noProvider: typeof fetch = async () => {
  providerCalls++;
  throw new Error("Provider transport forbidden in this fixture");
};
const failBeforeProvider = () =>
  dispatchOne(
    service,
    { APP_ENV: "staging", OUTBOUND_DELIVERY_MODE: "test" },
    noProvider,
  );
try {
  check(
    sql(
      "select count(*) from public.communication_outbox where state in ('pending','claimed');",
    ) === "0",
    "No unrelated claimable outbox work exists before fixture",
  );
  const email = `retry-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}-Aa1!`;
  actor = (await api("/auth/v1/admin/users", {
    email,
    password,
    email_confirm: true,
  })).id;
  ids.push(actor);
  const auth = await api("/auth/v1/token?grant_type=password", {
    email,
    password,
  }, { apikey: local.ANON_KEY, "Content-Type": "application/json" });
  staffHeaders = {
    apikey: local.ANON_KEY,
    Authorization: `Bearer ${auth.access_token}`,
    "Content-Type": "application/json",
  };
  client = (await rpc("save_client", {
    p_actor_id: actor,
    p_client_id: null,
    p_expected_version: null,
    p_first_name: "Synthetic",
    p_last_name: "Retry",
    p_primary_phone: null,
    p_primary_email: email,
    p_preferred_channel: "EMAIL",
    p_mailing_address: null,
    p_housecall_address: null,
  }, true)).id;
  ids.push(client);
  const conversation = randomUUID();
  ids.push(conversation);
  sql(
    `insert into public.conversations(id,client_id) values(${
      quote(conversation)
    },${quote(client)});`,
  );
  async function enqueue() {
    const requestId = randomUUID();
    ids.push(requestId);
    const args = {
      p_actor_id: actor,
      p_request_id: requestId,
      p_conversation_id: conversation,
      p_channel: "EMAIL",
      p_recipient: email,
      p_subject: "Synthetic reviewed subject",
      p_body: "Synthetic reviewed body",
      p_attachment_ids: [],
    };
    await rpc("prepare_message_request", {
      ...args,
      p_scope: "synthetic-retry:" + requestId,
    }, true);
    const queued = await rpc("enqueue_communication", args, true);
    ids.push(queued.id, queued.message_id);
    return queued;
  }
  const queued = await enqueue();
  check(
    (await failBeforeProvider()).state === "failed" && providerCalls === 0,
    "Actual dispatcher records configuration failure before provider execution",
  );
  await assert.rejects(
    rpc("preview_outbox_retry", { p_outbox_id: queued.id }, true),
    /HTTP 403/,
  );
  check(true, "Ordinary staff cannot authorize retry review");
  sql(
    `insert into public.user_roles(user_id,role) values(${
      quote(actor)
    },'ADMIN') on conflict do nothing;`,
  );
  const preview = await rpc(
    "preview_outbox_retry",
    { p_outbox_id: queued.id },
    true,
  );
  check(
    preview.eligible === true && preview.outbox.attempt_count === 0 &&
      /^[a-f0-9]{64}$/.test(preview.expected_work_hash),
    "Actual ADMIN preview establishes eligible untouched failed work",
  );
  check(
    Object.keys(preview).sort().join(",") ===
      "eligible,expected_work_hash,history,history_has_more,outbox,reason,source",
    "Preview returns exact browser envelope",
  );
  check(
    !("body" in preview.outbox) && !("provider_config" in preview.outbox) &&
      !("lease_token" in preview.outbox),
    "Preview omits message payload and worker metadata",
  );
  const intent = sql(
    `select jsonb_build_object('id',id,'request_id',request_id,'conversation_id',conversation_id,'client_id',client_id,'message_id',message_id,'channel',channel,'recipient',recipient,'subject',subject,'body',body,'attachment_ids',attachment_ids,'provider_config',provider_config)::text from public.communication_outbox where id=${
      quote(queued.id)
    };`,
  );
  const actionId = randomUUID();
  ids.push(actionId);
  const args = {
    p_id: actionId,
    p_outbox_id: queued.id,
    p_expected_work_hash: preview.expected_work_hash,
    p_reason: "configuration_repaired",
    p_attest: true,
  };
  await assert.rejects(
    rpc("requeue_outbox_retry", { ...args, p_attest: false }, true),
  );
  check(true, "Explicit repair attestation is mandatory before mutation");
  // Actual mutation commits; intentionally discard its response just as a browser
  // losing the ACK would. No local result is used to decide the recovered state.
  await rpc("requeue_outbox_retry", args, true);
  check(
    (await failBeforeProvider()).state === "failed",
    "A later worker configuration failure is independently durable",
  );
  const later = await rpc(
    "preview_outbox_retry",
    { p_outbox_id: queued.id },
    true,
  );
  check(
    later.outbox.revision > preview.outbox.revision &&
      later.expected_work_hash !== preview.expected_work_hash,
    "Later identical failure has a new revision and review hash",
  );
  const recovered = await rpc("recover_outbox_retry", { p_id: actionId }, true);
  check(
    recovered.id === actionId && recovered.actor_id === actor &&
      recovered.outbox_id === queued.id &&
      recovered.expected_work_hash === preview.expected_work_hash,
    "Lost ACK recovers original actor and exact reviewed request after next failure",
  );
  check(
    Object.keys(recovered).sort().join(",") ===
      "actor_id,created_at,expected_work_hash,id,outbox_id,previous_revision,queued_revision,reason",
    "Recovery returns exact safe browser receipt object",
  );
  const replay = await rpc("requeue_outbox_retry", args, true);
  check(
    JSON.stringify(replay) === JSON.stringify(recovered),
    "Exact replay returns immutable first action receipt",
  );
  check(
    (await rpc("preview_outbox_retry", { p_outbox_id: queued.id }, true)).outbox
      .state === "failed",
    "Old request replay cannot requeue a later failure",
  );
  await assert.rejects(
    rpc(
      "requeue_outbox_retry",
      { ...args, p_reason: "recipient_reverified" },
      true,
    ),
    /HTTP 409|SQL 23505/,
  );
  check(true, "Changed reason cannot reuse action UUID");
  await assert.rejects(
    rpc("requeue_outbox_retry", { ...args, p_id: randomUUID() }, true),
  );
  check(
    true,
    "Old reviewed hash cannot create another action against new failure",
  );
  const history = await rpc(
    "list_outbox_retry_actions",
    { p_limit: 100 },
    true,
  );
  check(
    Array.isArray(history.items) && history.items.some((r: { id: string }) =>
      r.id === actionId
    ) && typeof history.has_more === "boolean",
    "Actor history rediscovers original receipt after browser pointer loss",
  );
  await assert.rejects(
    rpc("retry_communication", { p_actor_id: actor, p_id: queued.id }, true),
    /HTTP 403/,
  );
  check(true, "Legacy unversioned retry is no longer authorized");
  sql(
    `update public.clients set primary_email='changed-${randomUUID()}@example.test' where id=${
      quote(client)
    };`,
  );
  check(
    (await rpc("preview_outbox_retry", { p_outbox_id: queued.id }, true))
      .eligible === false,
    "Current recipient mismatch blocks new retry",
  );
  sql(
    `update public.clients set primary_email=${quote(email)} where id=${
      quote(client)
    };`,
  );
  const fresh = await rpc(
    "preview_outbox_retry",
    { p_outbox_id: queued.id },
    true,
  );
  const secondId = randomUUID();
  ids.push(secondId);
  await rpc("requeue_outbox_retry", {
    ...args,
    p_id: secondId,
    p_expected_work_hash: fresh.expected_work_hash,
  }, true);
  const after = sql(
    `select jsonb_build_object('id',id,'request_id',request_id,'conversation_id',conversation_id,'client_id',client_id,'message_id',message_id,'channel',channel,'recipient',recipient,'subject',subject,'body',body,'attachment_ids',attachment_ids,'provider_config',provider_config)::text from public.communication_outbox where id=${
      quote(queued.id)
    };`,
  );
  check(
    after === intent,
    "Reviewed retry preserves exact original identity, payload, attachment IDs and sender metadata",
  );
  let startedLease = "";
  await assert.rejects(
    dispatchOne({
      rpc: async (name, args) => {
        const response = await service.rpc(name, args);
        if (name === "start_communication_attempt" && !response.error) {
          startedLease = response.data.lease_token;
          throw new Error("Synthetic lost start ACK");
        }
        return response;
      },
    }, {
      APP_ENV: "staging",
      OUTBOUND_DELIVERY_MODE: "test",
      OUTBOUND_TEST_EMAILS: email,
      RESEND_API_KEY: "synthetic-not-used",
      RESEND_FROM: "synthetic@example.test",
      RESEND_REPLY_TO: "synthetic@example.test",
    }, noProvider),
    /Synthetic lost start ACK/,
  );
  check(
    Boolean(startedLease) && providerCalls === 0,
    "Actual lost start ACK cannot call provider or release audited attempt as pre-provider failure",
  );
  const claim = { id: queued.id, lease_token: startedLease };
  await rpc("finish_communication_attempt", {
    p_id: claim.id,
    p_lease_token: claim.lease_token,
    p_outcome: "failed",
    p_provider_message_id: null,
    p_error_code: "synthetic_provider_failure",
  });
  check(
    (await rpc("preview_outbox_retry", { p_outbox_id: queued.id }, true))
      .eligible === false,
    "Failed work with an audited prior attempt requires provider reconciliation",
  );
  const uncertain = await enqueue();
  const u = await rpc("claim_communication", {});
  check(u.id === uncertain.id, "Only the owned new outbox can be claimed");
  await rpc("start_communication_attempt", {
    p_id: u.id,
    p_lease_token: u.lease_token,
    p_provider_config: {
      from: "synthetic@example.test",
      reply_to: "synthetic@example.test",
    },
  });
  await rpc("finish_communication_attempt", {
    p_id: u.id,
    p_lease_token: u.lease_token,
    p_outcome: "uncertain",
    p_provider_message_id: null,
    p_error_code: "synthetic_transport_unknown",
  });
  check(
    (await rpc("preview_outbox_retry", { p_outbox_id: u.id }, true))
      .eligible === false,
    "Uncertain provider execution cannot use pre-provider retry",
  );
  const accepted = await enqueue();
  const a = await rpc("claim_communication", {});
  check(
    a.id === accepted.id,
    "Accepted-state fixture claims only its own message",
  );
  await rpc("start_communication_attempt", {
    p_id: a.id,
    p_lease_token: a.lease_token,
    p_provider_config: {
      from: "synthetic@example.test",
      reply_to: "synthetic@example.test",
    },
  });
  await rpc("finish_communication_attempt", {
    p_id: a.id,
    p_lease_token: a.lease_token,
    p_outcome: "accepted",
    p_provider_message_id: "synthetic-" + randomUUID(),
    p_error_code: null,
  });
  check(
    (await rpc("preview_outbox_retry", { p_outbox_id: a.id }, true))
      .eligible === false,
    "Synthetic accepted evidence blocks resend instead of claiming non-acceptance",
  );
  await assert.rejects(
    rpc("recover_outbox_retry", { p_id: actionId }),
    /HTTP 403/,
  );
  check(
    true,
    "Service credentials cannot impersonate the receipt's administrator",
  );
  check(
    providerCalls === 0,
    "All provider evidence is synthetic SQL fixture evidence; no provider transport invoked",
  );
  check(
    await rpc("recover_outbox_retry", { p_id: randomUUID() }, true) === null,
    "Unknown action recovery is null and does not fabricate completion",
  );
} catch (error) {
  failures.push(error);
} finally {
  try {
    if (client) {
      ids.push(
        ...JSON.parse(
          sql(
            `select coalesce(json_agg(id),'[]'::json) from (select id from public.conversations where client_id=${
              quote(client)
            } union select m.id from public.messages m join public.conversations c on c.id=m.conversation_id where c.client_id=${
              quote(client)
            } union select id from public.communication_outbox where client_id=${
              quote(client)
            }) owned;`,
          ),
        ),
      );
    }
    if (ids.length) {
      const patterns = ids.filter(Boolean).map((value) => quote(`%${value}%`))
        .join(",");
      sql(
        `begin;set local session_replication_role=replica;do $cleanup$ declare t record;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('delete from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) using array[${patterns}];end loop;end $cleanup$;commit;`,
      );
      sql(
        `do $verify$ declare t record;n bigint;begin for t in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('select count(*) from %I.%I r where to_jsonb(r)::text like any ($1)',t.schemaname,t.tablename) into n using array[${patterns}];if n<>0 then raise exception 'Synthetic fixture cleanup incomplete';end if;end loop;end $verify$;`,
      );
      check(true, "Owned synthetic application records cleaned and verified");
    }
    if (actor) {
      check(
        (await fetch(local.API_URL + "/auth/v1/admin/users/" + actor, {
          method: "DELETE",
          headers: serviceHeaders,
        })).ok,
        "Synthetic Auth identity cleaned",
      );
    }
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length) {
  throw new AggregateError(
    failures,
    "Local outbox retry workflow or cleanup failed",
  );
}
console.log(
  `Local outbox retry Auth/PostgREST: ${assertions} checks passed. No provider transport or sends.`,
);
