import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Owner decision 2026-09-27: the legacy direct-send endpoints are retired. Every
// client email/SMS goes through enqueue-message -> communication_outbox ->
// dispatch-outbox (email via Resend, SMS via CloudTalk).
const root = new URL("../../", import.meta.url).pathname;
const retired = ["send-email", "send-sms"];
function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path);
    return /\.(ts|tsx|mjs|js|toml)$/.test(name) ? [path] : [];
  });
}

test("legacy send-email and send-sms functions are deleted and not configured", () => {
  for (const slug of retired) {
    assert.equal(existsSync(join(root, "supabase/functions", slug)), false, `${slug} source must be deleted`);
  }
  const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
  for (const slug of retired) assert.ok(!config.includes(`[functions.${slug}]`), `${slug} must not be configured`);
});

test("no app, function or script code invokes the retired endpoints", () => {
  const invocation = new RegExp(
    String.raw`(functions\.invoke\(\s*["'\`](${retired.join("|")})["'\`]|/functions/v1/(${retired.join("|")})\b)`,
  );
  const offenders = ["src", "supabase/functions", "scripts"]
    .flatMap((directory) => files(join(root, directory)))
    .filter((path) => invocation.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

test("bulk campaigns stay unavailable instead of queueing through a legacy path", () => {
  const app = readFileSync(join(root, "src/App.tsx"), "utf8");
  assert.match(app, /path="\/hub\/tools\/campaigns" element={<UnavailableToolPage \/>}/);
  assert.equal(existsSync(join(root, "src/hub/hooks/use-campaigns.ts")), false);
});
