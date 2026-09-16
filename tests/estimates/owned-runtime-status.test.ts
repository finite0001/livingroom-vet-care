import test from "node:test";
import assert from "node:assert/strict";
import { parseOwnedRuntimeStatus } from "./owned-runtime-status.ts";

const fixture = { API_URL: "http://127.0.0.1:63521", ANON_KEY: "synthetic-public", SERVICE_ROLE_KEY: "synthetic-private" };
test("owned runtime status accepts only complete localhost credentials and ignores unrelated CLI metadata", () => {
  assert.deepEqual(parseOwnedRuntimeStatus(JSON.stringify({ ...fixture, unrelated: "metadata" })), fixture);
  for (const value of [null, [], {}, { ...fixture, API_URL: "https://hosted.example.test" },
    { ...fixture, API_URL: "http://127.0.0.1:63521/path" }, { ...fixture, ANON_KEY: "" },
    { ...fixture, SERVICE_ROLE_KEY: null }, { result: fixture }])
    assert.throws(() => parseOwnedRuntimeStatus(JSON.stringify(value)));
});
test("malformed CLI output never exposes credentials in parse errors", () => {
  for (const raw of [JSON.stringify(fixture) + "\nextra agent text", '{"SERVICE_ROLE_KEY":"synthetic-private",', "not JSON"])
    assert.throws(() => parseOwnedRuntimeStatus(raw), error => error instanceof Error && !error.message.includes("synthetic-private") && error.message.includes("private output withheld"));
});
