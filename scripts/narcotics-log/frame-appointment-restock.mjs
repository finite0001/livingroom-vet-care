/** Offline official CLI framing for the exact appointment and restocking successor. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSource, readRegular } from "./frame-cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = "20261110203352_appointment_links_restock_alerts.sql";
const mode = process.argv.slice(2);
assert(mode.length === 1 && ["--check", "--write-candidate"].includes(mode[0]));
const result = {
  kind: "appointment-restock-cli213-source-v1", cli_version: "2.118.0",
  prefix_migration_count: 212, migration_count: 213, migration,
  framing: frameSource(readRegular(path.join(root, "supabase/migrations", migration))),
  database_operations: 0,
};
const destination = path.join(root, "scripts/narcotics-log/appointment-restock-migration213.json");
const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
if (mode[0] === "--write-candidate" && !fs.existsSync(destination)) {
  fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
} else {
  assert(readRegular(destination).equals(bytes), "Differing appointment and restocking framing candidate already exists");
}
console.log(JSON.stringify({ database_operations: 0, migration, sha256: result.framing.sha256,
  statement_count: result.framing.statement_count, runtime_acceptance: false }));
