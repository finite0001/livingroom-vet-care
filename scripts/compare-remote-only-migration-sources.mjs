#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const evidenceDate = new Date().toISOString().slice(0, 10);
const defaultPrimaryRoot = '/Users/davidedler/Developer/livingroom-readiness-reconciliation/supabase/migrations';
const defaultComparisonRoot = '/Users/davidedler/Developer/livingroom-readiness-weight/supabase/migrations';
const primaryRoot = getFlagValue('--primary-root') ?? defaultPrimaryRoot;
const comparisonRoot = getFlagValue('--comparison-root') ?? defaultComparisonRoot;
const outputPath =
  getFlagValue('--output') ??
  `docs/launch-evidence/${evidenceDate}-remote-only-migration-source-comparison.json`;

function getFlagValue(flag) {
  const flagIndex = process.argv.indexOf(flag);
  return flagIndex >= 0 ? process.argv[flagIndex + 1] : null;
}

function parseMigrationList() {
  const output = execFileSync('npx', ['supabase', 'migration', 'list'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const jsonStart = output.indexOf('{');
  const jsonEnd = output.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('Could not find JSON in Supabase migration list output.');
  }

  const { migrations } = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  return migrations
    .filter((migration) => !migration.local && migration.remote)
    .map((migration) => migration.remote)
    .sort();
}

function migrationFilesByVersion(root) {
  if (!existsSync(root)) {
    return new Map();
  }

  return new Map(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{14}_.+\.sql$/.test(entry.name))
      .map((entry) => [entry.name.slice(0, 14), join(root, entry.name)]),
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const remoteOnlyVersions = parseMigrationList();
const primaryFiles = migrationFilesByVersion(primaryRoot);
const comparisonFiles = migrationFilesByVersion(comparisonRoot);

const comparisons = remoteOnlyVersions.map((version) => {
  const primaryPath = primaryFiles.get(version) ?? null;
  const comparisonPath = comparisonFiles.get(version) ?? null;
  const primaryHash = primaryPath ? sha256(primaryPath) : null;
  const comparisonHash = comparisonPath ? sha256(comparisonPath) : null;

  return {
    version,
    primaryPath,
    comparisonPath,
    primaryPresent: Boolean(primaryPath),
    comparisonPresent: Boolean(comparisonPath),
    hashesMatch: Boolean(primaryHash && comparisonHash && primaryHash === comparisonHash),
    primarySha256: primaryHash,
    comparisonSha256: comparisonHash,
  };
});

const missingFromPrimary = comparisons.filter((comparison) => !comparison.primaryPresent);
const missingFromComparison = comparisons.filter((comparison) => !comparison.comparisonPresent);
const hashMismatches = comparisons.filter(
  (comparison) => comparison.primaryPresent && comparison.comparisonPresent && !comparison.hashesMatch,
);

const report = {
  generatedAt: new Date().toISOString(),
  status:
    remoteOnlyVersions.length === 0
      ? 'no-remote-only-receipts'
      : missingFromPrimary.length === 0 && missingFromComparison.length === 0 && hashMismatches.length === 0
      ? 'sources-match'
      : 'sources-differ',
  primaryRoot,
  comparisonRoot,
  summary: {
    remoteOnlyVersions: remoteOnlyVersions.length,
    missingFromPrimary: missingFromPrimary.length,
    missingFromComparison: missingFromComparison.length,
    hashMismatches: hashMismatches.length,
  },
  missingFromPrimary: missingFromPrimary.map(({ version, comparisonPath }) => ({ version, comparisonPath })),
  missingFromComparison: missingFromComparison.map(({ version, primaryPath }) => ({ version, primaryPath })),
  hashMismatches: hashMismatches.map(({ version, primaryPath, comparisonPath, primarySha256, comparisonSha256 }) => ({
    version,
    primaryPath,
    comparisonPath,
    primarySha256,
    comparisonSha256,
  })),
  comparisons,
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
    },
    null,
    2,
  ),
);
