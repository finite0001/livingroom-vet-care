import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const dryRunCommand = ['supabase', 'db', 'push', '--linked', '--dry-run', '--skip-vault'];

function parseJsonFromOutput(output) {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not find JSON in Supabase CLI output.');
  }

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

function runDryRun() {
  return spawnSync('npx', dryRunCommand, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
}

function outputFor(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function isRetryableLoginRoleFailure(output) {
  return output.includes('LegacyDbConnectError') || output.includes('cli_login_postgres');
}

function isRetryableDryRunFailure(result, output) {
  return result.error?.code === 'ETIMEDOUT' || isRetryableLoginRoleFailure(output);
}

const localVersions = readdirSync('supabase/migrations')
  .map((name) => name.match(/^(\d{14})_.+\.sql$/)?.[1])
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right));

const maxAttempts = 2;
let attempts = 0;
let dryRun;
let dryRunOutput = '';

while (attempts < maxAttempts) {
  attempts += 1;
  dryRun = runDryRun();
  dryRunOutput = outputFor(dryRun);

  if (!dryRun.error && dryRun.status === 0) {
    break;
  }

  if (attempts >= maxAttempts || !isRetryableDryRunFailure(dryRun, dryRunOutput)) {
    break;
  }

  await setTimeout(1_500);
}

if (dryRun.error) {
  throw dryRun.error;
}

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
    attempts,
    message: dryRunJson.message,
  },
};

console.log(JSON.stringify(report, null, 2));
