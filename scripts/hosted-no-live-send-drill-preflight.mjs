#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const evidenceDirectory = 'docs/launch-evidence';
const evidenceDate = getFlagValue('--date') ?? new Date().toISOString().slice(0, 10);
const targetProjectRef = 'mgadheotkdnrsatfivjy';
const expectedPendingMigrations = ['20260924120000', '20260924130000'];

const requiredEdgeFunctions = [
  { slug: 'public-contact', verifyJwt: false, purpose: 'anonymous contact intake' },
  { slug: 'send-email', verifyJwt: true, purpose: 'staff email queueing endpoint' },
  { slug: 'send-sms', verifyJwt: true, purpose: 'staff SMS queueing endpoint' },
  { slug: 'dispatch-outbound-deliveries', verifyJwt: false, purpose: 'token-protected outbound dispatcher' },
  { slug: 'resend-delivery-webhook', verifyJwt: false, purpose: 'signed Resend delivery callback' },
  { slug: 'twilio-message-status-callback', verifyJwt: false, purpose: 'signed Twilio status callback' },
  { slug: 'twilio-inbound-sms', verifyJwt: false, purpose: 'signed Twilio inbound SMS and STOP/START callback' },
  { slug: 'process-inbound', verifyJwt: false, purpose: 'token-protected inbound review worker' },
  { slug: 'queue-reminders', verifyJwt: false, purpose: 'token-protected reminder enqueue worker' },
];

const requiredSchemaObjects = {
  tables: ['public.outbound_deliveries'],
  functions: [
    'public.cancel_outbound_delivery',
    'public.claim_due_outbound_deliveries',
    'public.enqueue_staff_outbound_message',
    'public.guard_contact_submission',
    'public.record_inbound_sms',
    'public.record_outbound_delivery_callback',
    'public.record_outbound_delivery_result',
    'public.retry_outbound_delivery',
    'public.save_appointment',
  ],
  triggers: ['guard_contact_submission', 'trg_create_appointment_reminders'],
};

const expectedCronJobs = [
  'cleanup-abandoned-attachment',
  'dispatch-outbox',
  'process-inbound',
  'process-stripe-events',
  'queue-reminders',
  'scheduler-reconcile',
];

const artifacts = {
  hostedInventory: evidencePathOrLatest(`${evidenceDate}-hosted-readiness-inventory.json`, /^\d{4}-\d{2}-\d{2}-hosted-readiness-inventory\.json$/),
  schemaInventory: evidencePathOrLatest(
    `${evidenceDate}-remote-public-schema-inventory.json`,
    /^\d{4}-\d{2}-\d{2}-remote-public-schema-inventory\.json$/,
  ),
  edgeFunctionInventory: evidencePathOrLatest(
    `${evidenceDate}-edge-functions-inventory.json`,
    /^\d{4}-\d{2}-\d{2}-edge-functions-inventory\.json$/,
  ),
  hubReadiness: evidencePathOrLatest(`${evidenceDate}-hub-workflow-readiness.json`, /^\d{4}-\d{2}-\d{2}-hub-workflow-readiness\.json$/),
  localNoLiveSendEvidence: `${evidenceDirectory}/${evidenceDate}-no-live-send-local-drill.md`,
};

function getFlagValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function evidencePathOrLatest(preferredName, pattern) {
  const preferredPath = `${evidenceDirectory}/${preferredName}`;

  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  const matches = readdirSync(evidenceDirectory)
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  return matches.length > 0 ? `${evidenceDirectory}/${matches.at(-1)}` : null;
}

function readJson(path) {
  if (!path || !existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 90_000,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error ? { code: result.error.code, message: result.error.message } : null,
  };
}

function parseJsonFromOutput(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');

  if (start === -1 || end === -1) {
    return null;
  }

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function redactCommandResult(result) {
  return {
    command: result.command,
    status: result.status,
    ok: result.ok,
    error: result.error,
    stderr: result.stderr
      .split('\n')
      .filter((line) => line.trim() && !line.includes('A new version of Supabase CLI is available'))
      .slice(0, 10),
  };
}

function exactArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function check(id, label, status, blockers = [], warnings = [], evidence = {}) {
  return { id, label, status, blockers, warnings, evidence };
}

function statusFromBlockers(blockers, warnings = []) {
  if (blockers.length > 0) {
    return 'blocked';
  }

  return warnings.length > 0 ? 'warning' : 'pass';
}

function collectSchemaPresence(schemaInventory) {
  const tableSet = new Set(schemaInventory?.objects?.tables ?? []);
  const functionSet = new Set(schemaInventory?.objects?.functions ?? []);
  const triggerNameSet = new Set((schemaInventory?.objects?.triggers ?? []).map((trigger) => trigger.split(':').at(-1)));

  return {
    tables: requiredSchemaObjects.tables.map((name) => ({ name, present: tableSet.has(name) })),
    functions: requiredSchemaObjects.functions.map((name) => ({ name, present: functionSet.has(name) })),
    triggers: requiredSchemaObjects.triggers.map((name) => ({ name, present: triggerNameSet.has(name) })),
  };
}

function collectEdgePresence(functionInventory) {
  const remoteFunctions = functionInventory?.remoteFunctions ?? [];

  return requiredEdgeFunctions.map((expected) => {
    const remote = remoteFunctions.find((fn) => fn.slug === expected.slug) ?? null;

    return {
      ...expected,
      remotePresent: remote !== null,
      remoteStatus: remote?.status ?? null,
      remoteVerifyJwt: remote?.verifyJwt ?? null,
      verifyJwtMatches: remote !== null && remote.verifyJwt === expected.verifyJwt,
    };
  });
}

const hostedInventory = readJson(artifacts.hostedInventory);
const schemaInventory = readJson(artifacts.schemaInventory);
const edgeFunctionInventory = readJson(artifacts.edgeFunctionInventory);
const hubReadiness = readJson(artifacts.hubReadiness);

const migrationDriftCommand = run('npm', ['run', 'supabase:migration-drift', '--silent']);
const migrationDrift = parseJsonFromOutput(`${migrationDriftCommand.stdout}\n${migrationDriftCommand.stderr}`);
const localOnly = migrationDrift?.local_only ?? [];
const expectedLocalOnly = exactArray(localOnly, expectedPendingMigrations);
const migrationBlockers = [];
const migrationWarnings = [];

if (!migrationDriftCommand.ok || !migrationDrift) {
  migrationBlockers.push('Could not refresh migration drift with the linked dry-run helper.');
} else if ((migrationDrift.remote_only_count ?? 0) > 0) {
  migrationBlockers.push('Remote-only migrations are present; do not run the hosted drill until drift is reconciled.');
} else if (localOnly.length > 0) {
  if (expectedLocalOnly) {
    migrationBlockers.push('Hosted database is still missing the two expected readiness migrations required before the hosted no-live-send drill.');
  } else {
    migrationBlockers.push(`Unexpected local-only migration set: ${localOnly.join(', ')}`);
  }
}

if (migrationDrift?.source?.attempts > 1) {
  migrationWarnings.push(`Migration drift helper required ${migrationDrift.source.attempts} attempts.`);
}

const schemaPresence = collectSchemaPresence(schemaInventory);
const missingSchemaObjects = [
  ...schemaPresence.tables.filter((item) => !item.present).map((item) => `table ${item.name}`),
  ...schemaPresence.functions.filter((item) => !item.present).map((item) => `function ${item.name}`),
  ...schemaPresence.triggers.filter((item) => !item.present).map((item) => `trigger ${item.name}`),
];

const edgePresence = collectEdgePresence(edgeFunctionInventory);
const missingEdgeFunctions = edgePresence
  .filter((item) => !item.remotePresent || item.remoteStatus !== 'ACTIVE' || !item.verifyJwtMatches)
  .map((item) => `${item.slug} (present=${item.remotePresent}, status=${item.remoteStatus}, verifyJwt=${item.remoteVerifyJwt})`);

const schedulerSecretsQuery = run('npx', [
  'supabase',
  'db',
  'query',
  '--linked',
  "select name from vault.secrets where name in ('project_url','scheduler_worker_key') order by name;",
]);
const schedulerSecrets = parseJsonFromOutput(`${schedulerSecretsQuery.stdout}\n${schedulerSecretsQuery.stderr}`);
const schedulerSecretsRows = schedulerSecrets?.rows ?? null;

const cronJobsQuery = run('npx', [
  'supabase',
  'db',
  'query',
  '--linked',
  `select jobname, schedule from cron.job where jobname in (${expectedCronJobs.map((name) => `'${name}'`).join(',')}) order by jobname;`,
]);
const cronJobs = parseJsonFromOutput(`${cronJobsQuery.stdout}\n${cronJobsQuery.stderr}`);
const cronJobRows = cronJobs?.rows ?? null;
const presentCronJobNames = new Set((cronJobRows ?? []).map((job) => job.jobname));
const missingCronJobs = expectedCronJobs.filter((jobName) => !presentCronJobNames.has(jobName));

const checks = [
  check(
    'migration-drift',
    'Hosted migration drift before no-live-send drill',
    statusFromBlockers(migrationBlockers, migrationWarnings),
    migrationBlockers,
    migrationWarnings,
    {
      command: redactCommandResult(migrationDriftCommand),
      expectedPendingMigrations,
      migrationDrift,
    },
  ),
  check(
    'hub-workflows',
    'Hub workflow readiness evidence',
    hubReadiness?.status === 'local-hub-ready' && hubReadiness?.hostedStatus === 'hosted-dependencies-ready' ? 'pass' : 'blocked',
    hubReadiness?.status === 'local-hub-ready' && hubReadiness?.hostedStatus === 'hosted-dependencies-ready'
      ? []
      : ['Hub workflow readiness evidence is not green for local and hosted dependencies.'],
    [],
    {
      artifact: artifacts.hubReadiness,
      status: hubReadiness?.status ?? null,
      hostedStatus: hubReadiness?.hostedStatus ?? null,
      summary: hubReadiness?.summary ?? null,
    },
  ),
  check(
    'schema-objects',
    'Hosted schema objects required for the no-live-send drill',
    missingSchemaObjects.length > 0 ? 'blocked' : 'pass',
    missingSchemaObjects.map((item) => `Missing required ${item}.`),
    [],
    {
      artifact: artifacts.schemaInventory,
      presence: schemaPresence,
    },
  ),
  check(
    'edge-functions',
    'Hosted Edge Functions required for the no-live-send drill',
    missingEdgeFunctions.length > 0 ? 'blocked' : 'pass',
    missingEdgeFunctions.map((item) => `Required Edge Function is not active with expected JWT setting: ${item}.`),
    [],
    {
      artifact: artifacts.edgeFunctionInventory,
      presence: edgePresence,
    },
  ),
  check(
    'scheduler-containment',
    'Scheduler containment before provider commissioning',
    !schedulerSecretsQuery.ok || schedulerSecretsRows === null || schedulerSecretsRows.length > 0 || !cronJobsQuery.ok || cronJobRows === null || missingCronJobs.length > 0
      ? 'blocked'
      : 'pass',
    [
      ...(!schedulerSecretsQuery.ok || schedulerSecretsRows === null ? ['Could not verify scheduler Vault secrets.'] : []),
      ...(schedulerSecretsRows?.length > 0 ? ['Scheduler Vault secrets are present; do not run this no-live-send drill until scheduler/provider commissioning scope is explicit.'] : []),
      ...(!cronJobsQuery.ok || cronJobRows === null ? ['Could not verify scheduler cron jobs.'] : []),
      ...missingCronJobs.map((jobName) => `Expected cron job is missing: ${jobName}.`),
    ],
    [],
    {
      schedulerSecrets: {
        command: redactCommandResult(schedulerSecretsQuery),
        rows: schedulerSecretsRows,
      },
      cronJobs: {
        command: redactCommandResult(cronJobsQuery),
        rows: cronJobRows,
      },
    },
  ),
  check(
    'local-contract-evidence',
    'Local no-live-send contract evidence',
    existsSync(artifacts.localNoLiveSendEvidence) ? 'pass' : 'blocked',
    existsSync(artifacts.localNoLiveSendEvidence) ? [] : ['Local no-live-send evidence artifact is missing.'],
    [],
    {
      artifact: artifacts.localNoLiveSendEvidence,
    },
  ),
];

const blockers = checks.flatMap((item) => item.blockers.map((message) => ({ check: item.id, message })));
const warnings = checks.flatMap((item) => item.warnings.map((message) => ({ check: item.id, message })));
const status = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready-for-hosted-drill-approval';

const report = {
  generatedAt: new Date().toISOString(),
  status,
  scope: 'Read-only preflight for the hosted no-live-send workflow drill. This command does not write hosted data, activate provider dashboards, configure CloudTalk, publish a phone number, or send live messages.',
  targetProjectRef,
  drillCoverage: [
    'anonymous contact submit to Hub triage/audit',
    'staff email queueing through the outbox path',
    'staff SMS queueing in disabled/test evidence mode',
    'appointment reminder enqueue and dispatcher containment',
    'Resend synthetic signed delivery callback',
    'Twilio synthetic signed status callback and inbound SMS STOP/START',
    'delivery operations visibility for queued, failed, retryable, canceled, and unknown states',
  ],
  manualGates: [
    'Explicit approval before applying hosted migrations',
    'Explicit approval before creating hosted synthetic workflow records',
    'No public phone, CloudTalk, live SMS, live voice, voicemail, or provider dashboard activation in this drill',
  ],
  artifacts,
  checks,
  blockers,
  warnings,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
const outputFlagIndex = process.argv.indexOf('--output');
const outputPath = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : null;

if (outputPath) {
  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, json);
  console.log(`Wrote hosted no-live-send drill preflight to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (status === 'blocked') {
  process.exit(1);
}
