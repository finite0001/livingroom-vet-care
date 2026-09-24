import { execFileSync } from "node:child_process";

const output = execFileSync("npx", ["supabase", "migration", "list"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

const jsonStart = output.indexOf("{");
const jsonEnd = output.lastIndexOf("}");

if (jsonStart === -1 || jsonEnd === -1) {
  throw new Error("Could not find JSON in Supabase migration list output.");
}

const { migrations } = JSON.parse(output.slice(jsonStart, jsonEnd + 1));

const both = migrations.filter((migration) => migration.local && migration.remote);
const localOnly = migrations.filter((migration) => migration.local && !migration.remote);
const remoteOnly = migrations.filter((migration) => !migration.local && migration.remote);

const report = {
  matching_count: both.length,
  remote_only_count: remoteOnly.length,
  local_only_count: localOnly.length,
  local_only: localOnly.map((migration) => migration.local),
  remote_only_first: remoteOnly.slice(0, 10).map((migration) => migration.remote),
  remote_only_last: remoteOnly.slice(-10).map((migration) => migration.remote),
};

console.log(JSON.stringify(report, null, 2));
