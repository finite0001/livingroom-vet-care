#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const evidenceDirectory = 'docs/launch-evidence';
const evidenceFiles = {
  hosted: latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-hosted-readiness-inventory\.json$/),
  schema: latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-remote-public-schema-inventory\.json$/),
  functions: latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-edge-functions-inventory\.json$/),
  functionReview: latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-remote-edge-function-review\.json$/),
  publicSite: latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-public-site-readiness\.json$/),
  hub: latestEvidenceFile(/^\d{4}-\d{2}-\d{2}-hub-workflow-readiness\.json$/),
  noLiveSendPreflight: latestOptionalEvidenceFile(/^\d{4}-\d{2}-\d{2}-hosted-no-live-send-drill-preflight\.json$/),
};

function latestEvidenceFile(pattern) {
  const matches = readdirSync(evidenceDirectory)
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    throw new Error(`No launch evidence artifact matches ${pattern}`);
  }

  return `${evidenceDirectory}/${matches.at(-1)}`;
}

function latestOptionalEvidenceFile(pattern) {
  const matches = readdirSync(evidenceDirectory)
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  return matches.length > 0 ? `${evidenceDirectory}/${matches.at(-1)}` : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function makeGate(id, label, status, blockers, evidence, warnings = []) {
  return {
    id,
    label,
    status,
    blockers,
    warnings,
    evidence,
  };
}

function statusFromBlockers(blockers) {
  return blockers.length === 0 ? 'pass' : 'blocked';
}

const hosted = readJson(evidenceFiles.hosted);
const schema = readJson(evidenceFiles.schema);
const functions = readJson(evidenceFiles.functions);
const functionReview = readJson(evidenceFiles.functionReview);
const publicSite = readJson(evidenceFiles.publicSite);
const hub = readJson(evidenceFiles.hub);
const noLiveSendPreflight = evidenceFiles.noLiveSendPreflight ? readJson(evidenceFiles.noLiveSendPreflight) : null;

const migrationDrift = hosted.supabase?.migrationDrift;
const supabaseBlockers = [];

if (!migrationDrift) {
  supabaseBlockers.push('Supabase migration drift summary is missing.');
} else {
  if (migrationDrift.remote_only_count > 0) {
    supabaseBlockers.push(`${migrationDrift.remote_only_count} remote-only migration receipts need recovery/reconciliation.`);
  }

  if (migrationDrift.local_only_count > 0) {
    supabaseBlockers.push(`${migrationDrift.local_only_count} local readiness migrations are not applied remotely.`);
  }
}

const missingSchemaReadiness = [
  ...(schema.readinessPresence?.tables ?? []),
  ...(schema.readinessPresence?.functions ?? []),
  ...(schema.readinessPresence?.triggers ?? []),
].filter((item) => !item.present);

for (const item of missingSchemaReadiness) {
  supabaseBlockers.push(`Hosted schema missing ${item.name}.`);
}

const missingFunctions = (functions.readinessPresence ?? []).filter((item) => !item.remotePresent);
const functionBlockers = missingFunctions.map((item) => `Hosted Edge Function missing ${item.slug}.`);

const functionReviewLaunchBlockers = functionReview.launchBlockers ?? [];

if (functionReviewLaunchBlockers.length > 0) {
  functionBlockers.push(
    `${functionReviewLaunchBlockers.length} remote-only Edge Function slugs conflict with launch-critical worker/webhook/contact routes: ${functionReviewLaunchBlockers
      .map((blocker) => blocker.slug)
      .join(', ')}.`,
  );
}

const vercelBlockers = [];
const externalWarnings = [];
const envOutput = hosted.vercel?.environmentNames?.stdout ?? '';

if (!/\bProduction\b/.test(envOutput)) {
  vercelBlockers.push('Production Vercel browser environment variables are not evidenced.');
}

for (const domain of hosted.vercel?.domainVerification ?? []) {
  if (!domain.result?.ok) {
    vercelBlockers.push(`${domain.domain} is not verified/attached in Vercel: ${domain.result?.reason ?? 'unknown'}.`);
  }
}

const noLiveSendPreflightBlockers = noLiveSendPreflight?.blockers ?? [];
const noLiveSendPreflightNonMigrationBlockers = noLiveSendPreflightBlockers.filter((blocker) => blocker.check !== 'migration-drift');
const noLiveSendPreflightEvidence = evidenceFiles.noLiveSendPreflight ? [evidenceFiles.noLiveSendPreflight] : [];

if (!noLiveSendPreflight) {
  externalWarnings.push('Hosted no-live-send drill preflight evidence is not present yet.');
} else if (noLiveSendPreflightNonMigrationBlockers.length > 0) {
  functionBlockers.push(
    `Hosted no-live-send drill preflight has non-migration blockers: ${noLiveSendPreflightNonMigrationBlockers
      .map((blocker) => blocker.message)
      .join('; ')}`,
  );
} else if (noLiveSendPreflightBlockers.length > 0) {
  externalWarnings.push(
    'Hosted no-live-send drill preflight is waiting on the Supabase migration parity blocker already counted in the Supabase/database gate.',
  );
} else if (noLiveSendPreflight.status !== 'ready-for-hosted-drill-approval') {
  externalWarnings.push(`Hosted no-live-send drill preflight returned status ${noLiveSendPreflight.status}.`);
}

const publicBlockers = (publicSite.findings ?? [])
  .filter((finding) => finding.severity === 'blocker')
  .map((finding) => `${finding.area}: ${finding.message}`);

const publicWarnings = (publicSite.findings ?? [])
  .filter((finding) => finding.severity === 'warning')
  .map((finding) => `${finding.area}: ${finding.message} (${finding.evidence})`);

const hubBlockers = [
  ...(hub.findings ?? [])
    .filter((finding) => finding.severity === 'blocker')
    .map((finding) => `${finding.workflow}: ${finding.message}`),
  ...(hub.findings ?? [])
    .filter((finding) => finding.severity === 'hosted-blocker')
    .map((finding) => `${finding.workflow}: ${finding.message}`),
];

const verificationBlockers = [];

if ((hub.summary?.blockers ?? 1) > 0) {
  verificationBlockers.push('Local Hub readiness has blockers.');
}

if (publicSite.status !== 'not-launch-ready' && publicSite.status !== 'ready-for-owner-review') {
  verificationBlockers.push(`Unexpected public-site readiness status: ${publicSite.status}.`);
}

const gates = [
  makeGate(
    'supabase-database',
    'Supabase/database operating loop',
    statusFromBlockers(supabaseBlockers),
    supabaseBlockers,
    [evidenceFiles.hosted, evidenceFiles.schema],
  ),
  makeGate(
    'hub-frontend',
    'Hub/frontend workflow readiness',
    statusFromBlockers(hubBlockers),
    hubBlockers,
    [evidenceFiles.hub],
  ),
  makeGate(
    'external-services',
    'External services and deployment readiness',
    statusFromBlockers([...functionBlockers, ...vercelBlockers]),
    [...functionBlockers, ...vercelBlockers],
    [evidenceFiles.functions, evidenceFiles.functionReview, evidenceFiles.hosted, ...noLiveSendPreflightEvidence],
    externalWarnings,
  ),
  makeGate(
    'public-website',
    'Public website launch readiness',
    statusFromBlockers(publicBlockers),
    publicBlockers,
    [evidenceFiles.publicSite],
    publicWarnings,
  ),
  makeGate(
    'verification-release-control',
    'Verification/release control',
    statusFromBlockers(verificationBlockers),
    verificationBlockers,
    Object.values(evidenceFiles).filter(Boolean),
  ),
];

const blockedGates = gates.filter((gate) => gate.status !== 'pass');
const report = {
  generatedAt: new Date().toISOString(),
  status: blockedGates.length === 0 ? 'commercial-ready' : 'blocked',
  summary: {
    gates: gates.length,
    passing: gates.length - blockedGates.length,
    blocked: blockedGates.length,
  },
  gates,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
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
  console.log(`Wrote commercial readiness summary to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (process.argv.includes('--fail-on-blockers') && blockedGates.length > 0) {
  process.exit(1);
}
