#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';

const expectedReadinessObjects = {
  tables: [
    'public.outbound_deliveries',
  ],
  functions: [
    'public.cancel_appointment',
    'public.cancel_outbound_delivery',
    'public.claim_due_outbound_deliveries',
    'public.enqueue_staff_outbound_message',
    'public.guard_contact_submission',
    'public.normalize_sms_phone',
    'public.record_inbound_sms',
    'public.record_outbound_delivery_callback',
    'public.record_outbound_delivery_result',
    'public.retry_outbound_delivery',
    'public.save_appointment',
    'public.schedule_clinicians',
  ],
  triggers: [
    'trg_create_appointment_reminders',
    'guard_contact_submission',
  ],
};

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function stripComments(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function unquoteIdentifier(value) {
  return value.replaceAll('""', '"');
}

function collectMatches(sql, pattern, mapper) {
  return [...sql.matchAll(pattern)].map((match) => mapper(match));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function collectSchemaObjects(rawSql) {
  const sql = stripComments(rawSql);

  const tables = collectMatches(
    sql,
    /CREATE TABLE(?: IF NOT EXISTS)?\s+"([^"]+)"\."([^"]+)"/g,
    (match) => `${unquoteIdentifier(match[1])}.${unquoteIdentifier(match[2])}`,
  );

  const views = collectMatches(
    sql,
    /CREATE OR REPLACE VIEW\s+"([^"]+)"\."([^"]+)"/g,
    (match) => `${unquoteIdentifier(match[1])}.${unquoteIdentifier(match[2])}`,
  );

  const functions = collectMatches(
    sql,
    /CREATE OR REPLACE FUNCTION\s+"([^"]+)"\."([^"]+)"\s*\(/g,
    (match) => `${unquoteIdentifier(match[1])}.${unquoteIdentifier(match[2])}`,
  );

  const policies = collectMatches(
    sql,
    /CREATE POLICY\s+"([^"]+)"\s+ON\s+"([^"]+)"\."([^"]+)"/g,
    (match) =>
      `${unquoteIdentifier(match[2])}.${unquoteIdentifier(match[3])}:${unquoteIdentifier(match[1])}`,
  );

  const triggers = collectMatches(
    sql,
    /CREATE OR REPLACE TRIGGER\s+"([^"]+)"\s+[^;]*?\sON\s+"([^"]+)"\."([^"]+)"/gs,
    (match) =>
      `${unquoteIdentifier(match[2])}.${unquoteIdentifier(match[3])}:${unquoteIdentifier(match[1])}`,
  );

  const indexes = collectMatches(
    sql,
    /CREATE(?: UNIQUE)? INDEX(?: IF NOT EXISTS)?\s+"([^"]+)"\s+ON\s+"([^"]+)"\."([^"]+)"/g,
    (match) =>
      `${unquoteIdentifier(match[2])}.${unquoteIdentifier(match[3])}:${unquoteIdentifier(match[1])}`,
  );

  const extensions = collectMatches(
    sql,
    /CREATE EXTENSION IF NOT EXISTS\s+"([^"]+)"/g,
    (match) => unquoteIdentifier(match[1]),
  );

  return {
    counts: {
      tables: uniqueSorted(tables).length,
      views: uniqueSorted(views).length,
      functions: uniqueSorted(functions).length,
      policies: uniqueSorted(policies).length,
      triggers: uniqueSorted(triggers).length,
      indexes: uniqueSorted(indexes).length,
      extensions: uniqueSorted(extensions).length,
    },
    tables: uniqueSorted(tables),
    views: uniqueSorted(views),
    functions: uniqueSorted(functions),
    policies: uniqueSorted(policies),
    triggers: uniqueSorted(triggers),
    indexes: uniqueSorted(indexes),
    extensions: uniqueSorted(extensions),
  };
}

function readinessPresence(objects) {
  const tableSet = new Set(objects.tables);
  const functionSet = new Set(objects.functions);
  const triggerNames = new Set(objects.triggers.map((trigger) => trigger.split(':').at(-1)));

  return {
    tables: expectedReadinessObjects.tables.map((name) => ({
      name,
      present: tableSet.has(name),
    })),
    functions: expectedReadinessObjects.functions.map((name) => ({
      name,
      present: functionSet.has(name),
    })),
    triggers: expectedReadinessObjects.triggers.map((name) => ({
      name,
      present: triggerNames.has(name),
    })),
  };
}

const tempDirectory = mkdtempSync(join(tmpdir(), 'livingroom-supabase-schema-'));
const tempSchemaPath = join(tempDirectory, 'public-schema.sql');
const dump = run('npx', [
  'supabase',
  'db',
  'dump',
  '--linked',
  '--schema',
  'public',
  '--file',
  tempSchemaPath,
  '--yes',
]);

let rawSql = '';

try {
  rawSql = readFileSync(tempSchemaPath, 'utf8');
} catch {
  rawSql = dump.stdout;
}

rmSync(tempDirectory, { recursive: true, force: true });

const objects = collectSchemaObjects(rawSql);
const inventory = {
  generatedAt: new Date().toISOString(),
  note: 'Read-only remote public schema inventory from Supabase CLI schema-only dump. Raw SQL is intentionally not written to the artifact.',
  dump: {
    command: 'npx supabase db dump --linked --schema public --file [tempfile] --yes',
    status: dump.status,
    ok: dump.ok,
    stderr: dump.stderr
      .split('\n')
      .filter((line) => line.trim() && !line.includes('A new version of Supabase CLI is available'))
      .slice(0, 20),
  },
  objects,
  readinessPresence: readinessPresence(objects),
};

const json = `${JSON.stringify(inventory, null, 2)}\n`;
const outputFlagIndex = process.argv.indexOf('--output');

if (outputFlagIndex >= 0) {
  const outputPath = process.argv[outputFlagIndex + 1];

  if (!outputPath) {
    console.error('Missing path after --output.');
    process.exit(1);
  }

  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, json);
  console.log(`Wrote Supabase schema inventory to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (!dump.ok) {
  process.exit(dump.status ?? 1);
}
