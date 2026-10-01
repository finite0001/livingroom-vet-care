import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
// Retired provider slugs are inert stubs: they answer through the shared
// disabled-legacy handler and never reach the database, Vault or a provider.
for (const name of ["resend-webhook", "twilio-webhook"]) {
  test(`${name}: retired endpoint is an inert disabled-legacy stub`, () => {
    const raw = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(raw, /createClient|receiveTwilio|receiveResend|Deno\.env/);
    const source = raw.replace(/^import .*;\n/gm, "");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const served: { slug: string; replacement?: string }[] = [];
    let externalCalls = 0;
    runInNewContext(compiled, {
      serveDisabledLegacyFunction: (options: { slug: string; replacement?: string }) => { served.push(options); },
      Deno: { env: { get: () => { externalCalls++; return "live"; } } },
      fetch: () => { externalCalls++; throw new Error("Unexpected provider access"); },
    });
    assert.equal(served.length, 1);
    assert.equal(served[0].slug, name);
    assert.ok(served[0].replacement);
    assert.equal(externalCalls, 0);
  });
}
