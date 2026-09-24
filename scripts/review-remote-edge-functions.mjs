#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const evidenceDate = new Date().toISOString().slice(0, 10);
const projectRef = 'mgadheotkdnrsatfivjy';
const evidenceDirectory = 'docs/launch-evidence';
const defaultInventoryPath = `${evidenceDirectory}/${evidenceDate}-edge-functions-inventory.json`;
const outputPath =
  getFlagValue('--output') ?? `${evidenceDirectory}/${evidenceDate}-remote-edge-function-review.json`;
const inventoryPath = getFlagValue('--inventory') ?? defaultInventoryPath;

const launchConflictSlugs = new Set([
  'dispatch-outbox',
  'enqueue-message',
  'process-inbound',
  'public-contact',
  'queue-reminders',
  'resend-webhook',
  'twilio-webhook',
]);

const adjacentWorkflowPatterns = [
  /stripe/i,
  /payment/i,
  /invoice/i,
  /document/i,
  /release/i,
  /ezyvet/i,
  /lab/i,
  /attachment/i,
];

const riskPatterns = [
  { id: 'scheduler-or-worker', pattern: /\b(cron|schedule|dispatch|queue|worker|process)\b/i },
  { id: 'provider-webhook', pattern: /\b(webhook|signature|twilio|resend|stripe)\b/i },
  { id: 'sends-message', pattern: /\b(messages?\.json|resend\.emails|send|sms|email)\b/i },
  { id: 'writes-database', pattern: /\.(insert|update|upsert|delete)\s*\(/i },
  { id: 'service-role', pattern: /\bSUPABASE_SERVICE_ROLE_KEY\b/ },
  { id: 'public-contact', pattern: /\bcontact_submissions\b/i },
];

function getFlagValue(flag) {
  const flagIndex = process.argv.indexOf(flag);
  return flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr
      .trim()
      .split('\n')
      .filter((line) => line.trim() && !line.includes('A new version of Supabase CLI is available'))
      .slice(0, 20),
  };
}

function readAllFiles(directory) {
  const files = [];
  const queue = [directory];

  while (queue.length > 0) {
    const current = queue.shift();

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  return files.sort();
}

function hashSource(fileContents) {
  return createHash('sha256').update(fileContents).digest('hex');
}

function classifySlug(slug, matchedRiskPatterns) {
  if (launchConflictSlugs.has(slug)) {
    return {
      classification: 'launch-conflict-risk',
      launchBlocker: true,
      reason: 'Legacy/adjacent function slug overlaps launch-critical messaging, contact, webhook, or worker routes and must be disabled or proven unrouted before cutover.',
    };
  }

  if (adjacentWorkflowPatterns.some((pattern) => pattern.test(slug))) {
    return {
      classification: 'adjacent-workflow-review',
      launchBlocker: false,
      reason: 'Remote-only function appears tied to payment, document, ezyVet, lab, attachment, or release workflows outside the current launch-critical operating loop.',
    };
  }

  if (matchedRiskPatterns.length > 0) {
    return {
      classification: 'manual-review-risk',
      launchBlocker: true,
      reason: 'Downloaded source contains worker, webhook, provider, service-role, or database-write patterns and needs explicit cutover review.',
    };
  }

  return {
    classification: 'reviewed-no-launch-signal',
    launchBlocker: false,
    reason: 'Downloaded source did not match the launch-conflict slug list or high-risk source patterns.',
  };
}

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const remoteOnlySlugs = inventory.remoteOnly ?? [];
const tempDirectory = mkdtempSync(join(tmpdir(), 'livingroom-remote-functions-'));
const reviews = [];

try {
  for (const slug of remoteOnlySlugs) {
    const download = run(
      'npx',
      ['supabase', 'functions', 'download', slug, '--project-ref', projectRef, '--use-api'],
      tempDirectory,
    );
    const functionDirectory = join(tempDirectory, 'supabase', 'functions', slug);
    const files = download.ok ? readAllFiles(functionDirectory) : [];
    const contents = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const matchedRiskPatterns = riskPatterns
      .filter(({ pattern }) => pattern.test(contents) || pattern.test(slug))
      .map(({ id }) => id);
    const classification = classifySlug(slug, matchedRiskPatterns);

    reviews.push({
      slug,
      download: {
        ok: download.ok,
        status: download.status,
        stderr: download.stderr,
      },
      fileCount: files.length,
      sourceSha256: contents ? hashSource(contents) : null,
      matchedRiskPatterns,
      ...classification,
    });
  }
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

const launchBlockers = reviews.filter((review) => review.launchBlocker);
const report = {
  generatedAt: new Date().toISOString(),
  projectRef,
  inventoryPath,
  note: 'Downloads remote-only Edge Function source into a temporary directory, records hashes/classification only, then deletes the downloaded source. Source bodies are intentionally not written to evidence.',
  status: launchBlockers.length === 0 ? 'reviewed-no-launch-blockers' : 'launch-conflicts-found',
  summary: {
    remoteOnlyReviewed: reviews.length,
    launchBlockers: launchBlockers.length,
    adjacentWorkflowReview: reviews.filter((review) => review.classification === 'adjacent-workflow-review').length,
    reviewedNoLaunchSignal: reviews.filter((review) => review.classification === 'reviewed-no-launch-signal').length,
    downloadFailures: reviews.filter((review) => !review.download.ok).length,
  },
  launchBlockers: launchBlockers.map(({ slug, classification, reason, matchedRiskPatterns }) => ({
    slug,
    classification,
    reason,
    matchedRiskPatterns,
  })),
  reviews,
};

const resolvedOutputPath = resolve(outputPath);
mkdirSync(dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      status: report.status,
      outputPath: resolvedOutputPath,
      summary: report.summary,
      launchBlockerSlugs: report.launchBlockers.map((blocker) => blocker.slug),
    },
    null,
    2,
  ),
);

if (reviews.some((review) => !review.download.ok)) {
  process.exit(1);
}
