import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { compareMigrationInventory } from './migration-inventory.mjs';

const configuredProject = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([a-z]{20})"/m)?.[1];
const projectRef = process.env.SUPABASE_PROJECT_REF || configuredProject;
if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) throw new Error('Set a valid Supabase project reference for migration drift.');

const dryRunCommand = ['supabase', 'db', 'push', '--project-ref', projectRef, '--include-all', '--dry-run', '--skip-vault'];
const ledgerCommand = ['supabase', 'db', 'query', '--linked', '--project-ref', projectRef, '--output-format', 'json',
  'select version,name from supabase_migrations.schema_migrations order by version'];

function parseJsonFromOutput(output) {
  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not find JSON in Supabase CLI output.');
  }

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1));
}

function runCommand(command) {
  return spawnSync('npx', command, {
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

const localFiles = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql'));

const maxAttempts = 2;
async function runWithRetry(command) {
  let attempts = 0;
  let result;
  let output = '';
  while (attempts < maxAttempts) {
    attempts += 1;
    result = runCommand(command);
    output = outputFor(result);
    if (!result.error && result.status === 0) break;
    if (attempts >= maxAttempts || !isRetryableDryRunFailure(result, output)) break;
    await setTimeout(1_500);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(output.trim() || 'Supabase migration inventory failed.');
  return { output, attempts };
}

const dryRun = await runWithRetry(dryRunCommand);
const ledger = await runWithRetry(ledgerCommand);
const dryRunJson = parseJsonFromOutput(dryRun.output);
const ledgerJson = parseJsonFromOutput(ledger.output);
if (!Array.isArray(ledgerJson.rows)) throw new Error('Supabase migration ledger query returned no rows.');
const comparison = compareMigrationInventory(localFiles, ledgerJson.rows);
const dryRunOnly = (dryRunJson.migrations ?? [])
  .map((name) => name.match(/^(\d{14})_/)?.[1] ?? name)
  .sort((left, right) => left.localeCompare(right));
if (JSON.stringify(dryRunOnly) !== JSON.stringify(comparison.local_only)) {
  throw new Error('Supabase push plan disagrees with the hosted migration ledger.');
}

const report = {
  ...comparison,
  source: {
    command: 'npx supabase db push --project-ref <selected project> --include-all --dry-run --skip-vault',
    project_ref: projectRef,
    attempts: dryRun.attempts,
    ledger_command: 'npx supabase db query --linked --project-ref <selected project> --output-format json <read-only migration ledger query>',
    ledger_attempts: ledger.attempts,
    message: dryRunJson.message,
  },
};

console.log(JSON.stringify(report, null, 2));
