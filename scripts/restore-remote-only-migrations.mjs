#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const evidenceDate = new Date().toISOString().slice(0, 10);
const defaultSourceRoot = '/Users/davidedler/Developer/livingroom-readiness-reconciliation/supabase/migrations';
const defaultTargetRoot = 'supabase/migrations';
const sourceRoot = getFlagValue('--source-root') ?? defaultSourceRoot;
const targetRoot = getFlagValue('--target-root') ?? defaultTargetRoot;
const shouldApply = process.argv.includes('--apply');
const outputPath =
  getFlagValue('--output') ??
  `docs/launch-evidence/${evidenceDate}-remote-only-migration-restore.json`;

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

function filesByVersion(root) {
  if (!existsSync(root)) {
    throw new Error(`Migration source root does not exist: ${root}`);
  }

  return new Map(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{14}_.+\.sql$/.test(entry.name))
      .map((entry) => [entry.name.slice(0, 14), join(root, entry.name)]),
  );
}

const remoteOnlyVersions = parseMigrationList();
const sourceFiles = filesByVersion(sourceRoot);
const targetFiles = existsSync(targetRoot) ? filesByVersion(targetRoot) : new Map();
const missingFromSource = [];
const alreadyPresent = [];
const restored = [];
const planned = [];

mkdirSync(dirname(outputPath), { recursive: true });

if (shouldApply) {
  mkdirSync(targetRoot, { recursive: true });
}

for (const version of remoteOnlyVersions) {
  const sourcePath = sourceFiles.get(version);
  const targetAlreadyPresent = targetFiles.get(version);

  if (!sourcePath) {
    missingFromSource.push(version);
    continue;
  }

  if (targetAlreadyPresent) {
    alreadyPresent.push({
      version,
      targetPath: targetAlreadyPresent,
    });
    continue;
  }

  const targetPath = join(targetRoot, sourcePath.split('/').at(-1));
  const entry = {
    version,
    sourcePath,
    targetPath,
  };
  planned.push(entry);

  if (shouldApply) {
    copyFileSync(sourcePath, targetPath);
    restored.push(entry);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: shouldApply ? 'apply' : 'dry-run',
  status:
    remoteOnlyVersions.length === 0
      ? 'no-remote-only-receipts'
      : missingFromSource.length === 0
        ? 'ready'
        : 'source-missing-files',
  sourceRoot,
  targetRoot,
  summary: {
    remoteOnlyVersions: remoteOnlyVersions.length,
    planned: planned.length,
    restored: restored.length,
    alreadyPresent: alreadyPresent.length,
    missingFromSource: missingFromSource.length,
  },
  missingFromSource,
  alreadyPresent,
  planned,
  restored,
};

const resolvedOutputPath = resolve(outputPath);
mkdirSync(dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      status: report.status,
      mode: report.mode,
      outputPath: resolvedOutputPath,
      summary: report.summary,
    },
    null,
    2,
  ),
);

if (missingFromSource.length > 0) {
  process.exit(1);
}
