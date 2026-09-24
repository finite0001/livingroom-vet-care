import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
for (const name of ["send-email", "send-sms", "send-provider-email"]) {
  test(`${name}: retired endpoint cannot bypass queue even with live credentials`, async () => {
    let handler: ((request: Request) => Response) | undefined;
    let externalCalls = 0;
    const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), "utf8").replace(/^import .*;\n/gm, "");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    runInNewContext(compiled, {
      serve: (fn: typeof handler) => { handler = fn; }, Response, Request,
      Deno: { env: { get: () => "live" } },
      createClient: () => { externalCalls++; throw new Error("Unexpected database access"); },
      fetch: () => { externalCalls++; throw new Error("Unexpected provider access"); },
    });
    assert.ok(handler);
    for (const method of ["POST", "GET", "PUT"]) {
      const response = handler(new Request("https://edge.example", { method, headers: { Authorization: "Bearer synthetic-staff" } }));
      assert.equal(response.status, 410);
      const body = await response.json();
      assert.equal(body.accepted, false); assert.equal(body.delivered, false);
    }
    assert.equal(handler(new Request("https://edge.example", {method:"OPTIONS"})).status, 200);
    assert.equal(externalCalls, 0);
  });
}
