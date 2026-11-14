/** Source-only official CLI framing for this explicitly named staff-feature release. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { frameSource, readRegular } from "../narcotics-log/frame-cli.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const names = [
  "20261114215340_workforce_time_and_leave.sql",
  "20261114220407_workforce_team.sql",
  "20261114220830_workforce_people.sql",
  "20261114221516_staff_clinical_tools.sql",
  "20261114222530_staff_backup_health.sql",
];
const mode = process.argv[2];
assert(["--check", "--write-candidate"].includes(mode));
for (const [index, migration] of names.entries()) {
  const count = 215 + index;
  const value = {
    kind: `staff-features-cli${count}-source-v1`,
    cli_version: "2.118.0",
    prefix_migration_count: count - 1,
    migration_count: count,
    migration,
    framing: frameSource(
      readRegular(path.join(root, "supabase/migrations", migration)),
    ),
    database_operations: 0,
  };
  const destination = path.join(
    root,
    `scripts/workforce/migration${count}.json`,
  );
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  if (mode === "--write-candidate" && !fs.existsSync(destination))
    fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
  else
    assert(
      readRegular(destination).equals(bytes),
      "Staff migration framing differs from its declared source",
    );
}
console.log(
  JSON.stringify({
    database_operations: 0,
    source_migrations: names.length,
    runtime_acceptance: false,
  }),
);
