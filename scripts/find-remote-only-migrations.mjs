#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const evidenceDate = new Date().toISOString().slice(0, 10);
const defaultOutputPath = `docs/launch-evidence/${evidenceDate}-remote-only-migration-file-search.json`;
const outputFlagIndex = process.argv.indexOf('--output');
const outputPath = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : defaultOutputPath;

if (!outputPath) {
  console.error('Missing path after --output.');
  process.exit(1);
}

const workspaceRoot = process.cwd();
const candidateParents = [
  '/Users/davidedler',
  '/Users/davidedler/Developer',
  '/Users/davidedler/.codex/private',
];

const ignoredDirectoryNames = new Set([
  '.git',
  '.next',
  '.supabase',
  'Library',
  'node_modules',
  'dist',
  'build',
  'coverage',
]);

function listDirectories(parentDirectory) {
  try {
    return readdirSync(parentDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parentDirectory, entry.name));
  } catch {
    return [];
  }
}

function isLikelyLivingRoomRoot(directoryPath) {
  const directoryName = directoryPath.split('/').pop()?.toLowerCase() ?? '';
  return (
    directoryPath === workspaceRoot ||
    directoryName.includes('livingroom') ||
    directoryName.includes('living-room') ||
    directoryName.startsWith('lrv-') ||
    directoryName.includes('lrv-')
  );
}

function collectCandidateRoots() {
  const roots = new Set([workspaceRoot]);

  for (const parentDirectory of candidateParents) {
    for (const directoryPath of listDirectories(parentDirectory)) {
      if (isLikelyLivingRoomRoot(directoryPath)) {
        roots.add(directoryPath);
      }
    }
  }

  return [...roots].sort();
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
  return {
    matching: migrations.filter((migration) => migration.local && migration.remote),
    localOnly: migrations.filter((migration) => migration.local && !migration.remote),
    remoteOnly: migrations.filter((migration) => !migration.local && migration.remote),
  };
}

function collectMigrationFiles(rootDirectory) {
  const migrationFiles = [];
  const queue = [rootDirectory];

  while (queue.length > 0) {
    const currentDirectory = queue.shift();

    let entries = [];
    try {
      entries = readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const entryPath = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'migrations' && currentDirectory.endsWith('/supabase')) {
          migrationFiles.push(
            ...listMigrationSqlFiles(entryPath).map((filePath) => ({
              root: rootDirectory,
              path: filePath,
            })),
          );
          continue;
        }

        queue.push(entryPath);
      }
    }
  }

  return migrationFiles;
}

function listMigrationSqlFiles(migrationDirectory) {
  try {
    return readdirSync(migrationDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{14}_.+\.sql$/.test(entry.name))
      .map((entry) => join(migrationDirectory, entry.name));
  } catch {
    return [];
  }
}

function getVersionFromPath(filePath) {
  return filePath.split('/').pop()?.match(/^(\d{14})_/)?.[1] ?? null;
}

function safeDirectoryExists(directoryPath) {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

const startedAt = new Date().toISOString();
const migrationState = parseMigrationList();
const remoteOnlyVersions = new Set(migrationState.remoteOnly.map((migration) => migration.remote));
const candidateRoots = collectCandidateRoots().filter(safeDirectoryExists);
const matches = [];
const scannedRoots = [];

for (const root of candidateRoots) {
  const migrationFiles = collectMigrationFiles(root);
  scannedRoots.push({
    root,
    migrationFileCount: migrationFiles.length,
  });

  for (const migrationFile of migrationFiles) {
    const version = getVersionFromPath(migrationFile.path);

    if (version && remoteOnlyVersions.has(version)) {
      matches.push({
        version,
        root: migrationFile.root,
        path: migrationFile.path,
      });
    }
  }
}

matches.sort((left, right) => left.version.localeCompare(right.version) || left.path.localeCompare(right.path));

const uniqueMatchedVersions = [...new Set(matches.map((match) => match.version))].sort();
const missingRemoteOnlyVersions = [...remoteOnlyVersions]
  .filter((version) => !uniqueMatchedVersions.includes(version))
  .sort();
const groupedMatches = uniqueMatchedVersions.map((version) => {
  const versionMatches = matches.filter((match) => match.version === version);
  const roots = [...new Set(versionMatches.map((match) => match.root))].sort();

  return {
    version,
    matchCount: versionMatches.length,
    rootCount: roots.length,
    roots: roots.slice(0, 10),
    samplePaths: versionMatches.slice(0, 5).map((match) => match.path),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  startedAt,
  finishedAt: new Date().toISOString(),
  workspaceRoot,
  status:
    remoteOnlyVersions.size === 0
      ? 'no-remote-only-receipts'
      : matches.length > 0
        ? 'matches-found'
        : 'no-local-files-found',
  migrationCounts: {
    matching: migrationState.matching.length,
    localOnly: migrationState.localOnly.length,
    remoteOnly: migrationState.remoteOnly.length,
    remoteOnlyMatched: uniqueMatchedVersions.length,
    remoteOnlyStillMissing: missingRemoteOnlyVersions.length,
  },
  searchScope: {
    candidateParents,
    ignoredDirectoryNames: [...ignoredDirectoryNames].sort(),
    candidateRootsChecked: candidateRoots.length,
    scannedRoots,
  },
  matchedRemoteOnlyVersions: groupedMatches,
  missingRemoteOnlyVersions,
};

const resolvedOutputPath = resolve(outputPath);
mkdirSync(dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      status: report.status,
      outputPath: resolvedOutputPath,
      migrationCounts: report.migrationCounts,
      candidateRootsChecked: candidateRoots.length,
      matchCount: matches.length,
    },
    null,
    2,
  ),
);
