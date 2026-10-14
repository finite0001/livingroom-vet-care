/** Real worker HTTP and real PostgREST, with intentionally lost response bytes. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconciliationRunSchema } from "../../supabase/functions/_shared/operational-reconciliation-contract.ts";

interface HttpInput {
  status: { API_URL: string; SERVICE_ROLE_KEY: string };
  service: SupabaseClient;
  sql: (query: string) => string;
}
export async function reconciliationHttpProof(
  { status, service, sql }: HttpInput,
) {
  assert.match(status.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
  let checks = 0, dropExecute = false, dropRecovery = false;
  const calls: string[] = [];
  const executionPayloads: unknown[] = [];
  function check(actual: unknown, expected: unknown) {
    assert.deepEqual(actual, expected);
    checks++;
  }
  const proxy = createServer(async (request, response) => {
    try {
      const body: Buffer[] = [];
      for await (const part of request) body.push(Buffer.from(part));
      const path = request.url ?? "/";
      const name = path.split("/").at(-1)!;
      calls.push(name);
      if (name === "execute_operational_reconciliation_run") executionPayloads.push(JSON.parse(Buffer.concat(body).toString("utf8")));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value && !["host", "connection", "content-length"].includes(key)) {
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
      }
      const result = await fetch(status.API_URL + path, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method ?? "GET")
          ? undefined
          : Buffer.concat(body),
        redirect: "error",
      });
      const bytes = Buffer.from(await result.arrayBuffer());
      if (
        (name === "execute_operational_reconciliation_run" && dropExecute) ||
        (name === "recover_operational_reconciliation_run" && dropRecovery)
      ) {
        response.destroy();
        return;
      }
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(bytes);
    } catch {
      response.writeHead(502);
      response.end();
    }
  });
  proxy.listen(47292, "127.0.0.1");
  await once(proxy, "listening");
  let child: ReturnType<typeof spawn> | null = null;
  const origin = "http://127.0.0.1:47293";
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGTERM");
      await ended;
    }
    child = null;
  }
  async function launch(enabled: boolean, environment: string) {
    await stop();
    child = spawn("deno", [
      "run",
      "--frozen",
      "--config",
      "supabase/functions/reconcile-operational-tasks/deno.json",
      "--allow-net=127.0.0.1",
      "--allow-env=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_SECRET_KEYS,OPERATIONAL_RECONCILIATION_ENABLED,APP_ENV",
      "tests/scheduling/reconciliation-http-server.ts",
    ], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: {
        ...process.env,
        SUPABASE_URL: "http://127.0.0.1:47292",
        SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
        SUPABASE_SECRET_KEYS: "{}",
        OPERATIONAL_RECONCILIATION_ENABLED: String(enabled),
        APP_ENV: environment,
      },
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error("Owned worker exited");
      }
      try {
        if ((await fetch(origin, { method: "GET" })).status === 405) return;
      } catch { /* wait for own listen socket */ }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Owned worker did not start");
  }
  async function post(body: unknown, extra: Record<string, string> = {}) {
    return fetch(origin, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
    });
  }
  async function recovered(id: string, limit: number) {
    const { data, error } = await service.rpc(
      "recover_operational_reconciliation_run",
      { p_run_id: id, p_limit: limit },
    );
    if (error) throw error;
    return reconciliationRunSchema.parse(data);
  }
  async function committedResponse(answer: Response) {
    const { reconciled, ...receipt } = await answer.json();
    check(reconciled, true);
    return reconciliationRunSchema.parse(receipt);
  }
  try {
    const before = sql("select count(*) from operational_reconciliation_runs;");
    await launch(false, "staging");
    const disabled = await post({});
    check(disabled.status, 200);
    check(await disabled.json(), { disabled: true, reconciled: false });
    check(calls.length, 0);
    check(sql("select count(*) from operational_reconciliation_runs;"), before);
    check((await post({}, { apikey: "explicit_bad_key" })).status, 401);
    await launch(true, "development");
    check((await post({})).status, 503);
    check(calls.length, 0);
    await launch(true, "staging");
    check((await post({ limit: 26 })).status, 400);
    check((await post({ patient_id: randomUUID() })).status, 400);
    const id = randomUUID();
    calls.length = 0;
    dropExecute = true;
    const answer = await post({ run_id: id, limit: 5 });
    check(answer.status, 200);
    const committed = await committedResponse(answer);
    check(committed.outcome, "completed");
    check(committed, await recovered(id, 5));
    // The HTTP transport may retry a lost connection. Every execution attempt
    // must still target the same frozen UUID; the DB result below proves once.
    check(calls[0], "start_operational_reconciliation_run");
    check(calls.at(-1), "recover_operational_reconciliation_run");
    check(calls.slice(1, -1).every((name) => name === "execute_operational_reconciliation_run") && calls.length >= 3, true);
    check(executionPayloads.length >= 1 && executionPayloads.every((value) => JSON.stringify(value) === JSON.stringify({ p_run_id: id, p_limit: 5 })), true);
    check(
      sql(
        `select count(*) from operational_reconciliation_results where run_id='${id}';`,
      ),
      "1",
    );
    const second = randomUUID();
    calls.length = 0;
    dropRecovery = true;
    const uncertain = await post({ run_id: second, limit: 4 });
    check(uncertain.status, 202);
    check(await uncertain.json(), {
      run_id: second,
      requested_limit: 4,
      outcome: "unknown",
      reconciled: false,
    });
    const saved = await recovered(second, 4);
    check(saved.outcome, "completed");
    dropExecute = false;
    dropRecovery = false;
    calls.length = 0;
    const replay = await post({ run_id: second, limit: 4 });
    check(replay.status, 200);
    check(await committedResponse(replay), saved);
    check(calls, ["start_operational_reconciliation_run"]);
    check(
      sql(
        `select count(*) from operational_reconciliation_results where run_id='${second}';`,
      ),
      "1",
    );
    check(sql("select count(*) from communication_outbox;"), "0");
    check(sql("select count(*) from inventory_movements;"), "0");
    return {
      http_checks: checks,
      actual_edge_entrypoint: true,
      genuine_postgrest: true,
      lost_response_recovery: true,
      unknown_response_replay: true,
      provider_requests: 0,
    };
  } finally {
    await stop();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}
