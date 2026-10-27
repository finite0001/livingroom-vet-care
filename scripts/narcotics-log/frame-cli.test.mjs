import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { arrayHashes } from "./frame-cli.mjs";

const sha = value => crypto.createHash("sha256").update(value).digest("hex");

test("framing retains exact UTF-8 and the PostgreSQL space between array elements", () => {
  const statements = ["select 'a\\b'", "line\n\"quoted\"\t", "µ → 🐾", "\b\f\r"];
  const postgres = '["select \'a\\\\b\'", "line\\n\\\"quoted\\\"\\t", "µ → 🐾", "\\b\\f\\r"]';
  const result = arrayHashes(statements);
  assert.equal(result.compact_array_sha256, sha(JSON.stringify(statements)));
  assert.equal(result.postgres_array_sha256, sha(postgres));
  assert.equal(result.postgres_array_bytes, Buffer.byteLength(postgres));
});

test("statement boundaries remain distinct even when concatenated SQL is identical", () => {
  assert.notEqual(arrayHashes(["ab", "c"]).postgres_array_sha256, arrayHashes(["a", "bc"]).postgres_array_sha256);
  assert.equal(arrayHashes([]).postgres_array_bytes, 2);
  assert.equal(arrayHashes([]).postgres_array_sha256, sha("[]"));
});
