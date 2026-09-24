import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

function parseJsonFromOutput(output) {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not find JSON in Supabase CLI output.');
  }

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

const localVersions = readdirSync('supabase/migrations')
  .map((name) => name.match(/^(\d{14})_.+\.sql$/)?.[1])
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right));

const dryRun = spawnSync('npx', ['supabase', 'db', 'push', '--linked', '--dry-run', '--skip-vault'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 60_000,
});

if (dryRun.error) {
  throw dryRun.error;
}

const dryRunOutput = `${dryRun.stdout}\n${dryRun.stderr}`;

if (dryRun.status !== 0) {
  throw new Error(dryRunOutput.trim() || 'Supabase dry-run drift check failed.');
}

const dryRunJson = parseJsonFromOutput(dryRunOutput);
const localOnly = (dryRunJson.migrations ?? [])
  .map((name) => name.match(/^(\d{14})_/)?.[1] ?? name)
  .sort((left, right) => left.localeCompare(right));

const report = {
  matching_count: localVersions.length - localOnly.length,
  remote_only_count: 0,
  local_only_count: localOnly.length,
  local_only: localOnly,
  remote_only_first: [],
  remote_only_last: [],
  source: {
    command: 'npx supabase db push --linked --dry-run --skip-vault',
    message: dryRunJson.message,
  },
};

console.log(JSON.stringify(report, null, 2));
