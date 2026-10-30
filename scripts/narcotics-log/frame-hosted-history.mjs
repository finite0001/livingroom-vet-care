/** Source-only official CLI framing for the fixed historical transport variant. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSource, readRegular } from "./frame-cli.mjs";

if (process.argv.slice(2).join(" ") !== "--write-candidate") throw Error("Explicit source-only framing required");
const here = path.dirname(fileURLToPath(import.meta.url));
const base = path.join(here, "hosted-source");
const proof = JSON.parse(readRegular(path.join(base, "source-proof.json")));
if (proof.kind !== "secondary-review-source-receipt-variant-v1"
  || proof.original_source_sha256 !== "de8e0f4c0d2100b47a490dbd9b8e65c957fa49d003d447cb1af6f37aa8a75bfc"
  || proof.changed_gate_count !== 205 || proof.original_non_gate_bytes_recovered_exactly !== true
  || proof.historical_rows_rewritten !== false || proof.observed_database_values_used_as_expected !== false) throw Error("Fixed source-only transport inverse required");
const filename = "20261022010000_controlled_secondary_review_private.sql";
const raw = readRegular(path.join(base, "migrations", filename));
const framing = frameSource(raw);
if (framing.bytes !== proof.variant_source_bytes || framing.sha256 !== proof.variant_source_sha256) throw Error("Source variant bytes differ");
const encoded = Buffer.from(JSON.stringify({ kind: "narcotics-hosted206-official-framing-source-v1", cli_version: "2.118.0", filename, framing, database_operations: 0 }, null, 2) + "\n");
const target = path.join(base, "cli-framing.json");
if (fs.existsSync(target)) {
  if (!readRegular(target).equals(encoded)) throw Error("Differing source framing already exists");
} else fs.writeFileSync(target, encoded, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ database_operations: 0, bytes: framing.bytes, statements: framing.statement_count, postgres_array_sha256: framing.postgres_array_sha256 }));
