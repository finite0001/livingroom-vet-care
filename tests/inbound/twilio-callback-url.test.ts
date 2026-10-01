import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
// Twilio signs the public URL configured in its console. Without the matching
// setting the handler must refuse with 503 (retryable, visible) rather than
// verify against req.url, which behind the gateway never matches (403 forever).
for (const [name, setting] of [["twilio-inbound-sms", "TWILIO_INBOUND_WEBHOOK_URL"], ["twilio-message-status-callback", "TWILIO_STATUS_CALLBACK_URL"]] as const) {
  test(`${name}: missing ${setting} answers 503 before reading the body or the database`, async () => {
    const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
    assert.doesNotMatch(source, /\|\|\s*req\.url/);
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    let handler: ((request: Request) => Promise<Response>) | undefined;
    let databaseCalls = 0;
    const env: Record<string, string> = { TWILIO_AUTH_TOKEN: "synthetic-token", SUPABASE_URL: "https://synthetic.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic" };
    runInNewContext(compiled, {
      serve: (fn: typeof handler) => { handler = fn; },
      createClient: () => { databaseCalls++; throw new Error("Unexpected database access"); },
      Deno: { env: { get: (key: string) => env[key] } },
      Request, Response, URLSearchParams, TextEncoder, crypto, btoa, atob, console,
    });
    assert.ok(handler);
    const request = () => new Request("http://internal.gateway/functions/v1/" + name, {
      method: "POST", headers: { "X-Twilio-Signature": "forged", "Content-Type": "application/x-www-form-urlencoded" }, body: "MessageSid=SM1",
    });
    const response = await handler(request());
    assert.equal(response.status, 503);
    assert.equal(databaseCalls, 0);
    env[setting] = "https://example.supabase.co/functions/v1/" + name;
    assert.equal((await handler(request())).status, 403, "with the setting present, a bad signature is still a 403");
    assert.equal(databaseCalls, 0);
  });
}
