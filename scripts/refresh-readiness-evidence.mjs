#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const evidenceDate = new Date().toISOString().slice(0, 10);
const evidenceDirectory = 'docs/launch-evidence';

const steps = [
  {
    id: 'hosted-readiness',
    command: ['node', 'scripts/hosted-readiness-inventory.mjs', '--output', `${evidenceDirectory}/${evidenceDate}-hosted-readiness-inventory.json`],
  },
  {
    id: 'remote-only-migration-file-search',
    command: ['node', 'scripts/find-remote-only-migrations.mjs', '--output', `${evidenceDirectory}/${evidenceDate}-remote-only-migration-file-search.json`],
  },
  {
    id: 'remote-only-migration-source-comparison',
    command: [
      'node',
      'scripts/compare-remote-only-migration-sources.mjs',
      '--output',
      `${evidenceDirectory}/${evidenceDate}-remote-only-migration-source-comparison.json`,
    ],
  },
  {
    id: 'remote-public-schema',
    command: ['node', 'scripts/supabase-schema-inventory.mjs', '--output', `${evidenceDirectory}/${evidenceDate}-remote-public-schema-inventory.json`],
  },
  {
    id: 'edge-functions',
    command: ['node', 'scripts/supabase-functions-inventory.mjs', '--output', `${evidenceDirectory}/${evidenceDate}-edge-functions-inventory.json`],
  },
  {
    id: 'remote-edge-function-review',
    command: [
      'node',
      'scripts/review-remote-edge-functions.mjs',
      '--inventory',
      `${evidenceDirectory}/${evidenceDate}-edge-functions-inventory.json`,
      '--output',
      `${evidenceDirectory}/${evidenceDate}-remote-edge-function-review.json`,
    ],
  },
  {
    id: 'public-site',
    command: ['node', 'scripts/public-site-readiness.mjs', '--output', `${evidenceDirectory}/${evidenceDate}-public-site-readiness.json`],
  },
  {
    id: 'hub-workflows',
    command: [
      'node',
      'scripts/hub-workflow-readiness.mjs',
      '--schema-inventory',
      `${evidenceDirectory}/${evidenceDate}-remote-public-schema-inventory.json`,
      '--functions-inventory',
      `${evidenceDirectory}/${evidenceDate}-edge-functions-inventory.json`,
      '--output',
      `${evidenceDirectory}/${evidenceDate}-hub-workflow-readiness.json`,
    ],
  },
  {
    id: 'commercial-summary',
    command: ['node', 'scripts/commercial-readiness-summary.mjs', '--output', `${evidenceDirectory}/${evidenceDate}-commercial-readiness-summary.json`],
  },
];

function runStep(step) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(step.command[0], step.command.slice(1), {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    id: step.id,
    command: step.command.join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim().split('\n').filter(Boolean).slice(-5),
    stderr: result.stderr
      .trim()
      .split('\n')
      .filter((line) => line && !line.includes('A new version of Supabase CLI is available'))
      .slice(-10),
  };
}

const results = [];

for (const step of steps) {
  const result = runStep(step);
  results.push(result);

  if (!result.ok) {
    break;
  }
}

let summary = null;
const summaryPath = `${evidenceDirectory}/${evidenceDate}-commercial-readiness-summary.json`;

try {
  summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
} catch {
  summary = null;
}

const report = {
  generatedAt: new Date().toISOString(),
  evidenceDate,
  status: results.every((result) => result.ok) ? 'completed' : 'failed',
  steps: results,
  summary: summary
    ? {
        status: summary.status,
        gates: summary.summary,
      }
    : null,
};

const outputFlagIndex = process.argv.indexOf('--output');
const defaultOutputPath = `${evidenceDirectory}/${evidenceDate}-readiness-refresh.json`;
const outputPath = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : defaultOutputPath;

if (!outputPath) {
  console.error('Missing path after --output.');
  process.exit(1);
}

const resolvedPath = resolve(outputPath);
mkdirSync(dirname(resolvedPath), { recursive: true });
writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote readiness refresh report to ${resolvedPath}`);

if (report.status !== 'completed') {
  process.exit(1);
}
