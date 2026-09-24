#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectName = 'livingroom-vet-care';
const domains = ['thelivingroom.vet', 'www.thelivingroom.vet'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    ...options,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function parseJson(commandResult) {
  if (!commandResult.stdout) {
    return null;
  }

  try {
    return JSON.parse(commandResult.stdout);
  } catch {
    return null;
  }
}

function redactCommandOutput(commandResult) {
  return {
    command: commandResult.command,
    status: commandResult.status,
    ok: commandResult.ok,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr,
  };
}

function redactVercelEnvList(commandResult) {
  const redactRows = (text) =>
    text
      .split('\n')
      .map((line) => {
        if (!line.trim()) {
          return line;
        }

        if (/^\s*name\s+value\s+type\s+environments\s+created\s*$/i.test(line)) {
          return line.replace(/\bvalue\b/i, 'value');
        }

        return line.replace(/^(\s*\S+)\s+\S+(\s+\S+\s+.*)$/, '$1 [redacted]$2');
      })
      .join('\n');

  return {
    command: commandResult.command,
    status: commandResult.status,
    ok: commandResult.ok,
    stdout: redactRows(commandResult.stdout).trim(),
    stderr: redactRows(commandResult.stderr).trim(),
  };
}

function collectDomainVerification(domain) {
  const verification = run('npx', [
    '--yes',
    'vercel',
    'domains',
    'verify',
    domain,
    '--project',
    projectName,
    '--format',
    'json',
    '--non-interactive',
  ]);

  return {
    domain,
    result: parseJson(verification) ?? redactCommandOutput(verification),
  };
}

const inventory = {
  generatedAt: new Date().toISOString(),
  note: 'Read-only hosted readiness inventory. Outputs intentionally avoid environment values and provider secrets.',
  git: {
    head: redactCommandOutput(run('git', ['rev-parse', 'HEAD'])),
    branch: redactCommandOutput(run('git', ['branch', '--show-current'])),
    statusShort: redactCommandOutput(run('git', ['status', '--short'])),
  },
  supabase: {
    migrationDrift: parseJson(run('npm', ['run', 'supabase:migration-drift', '--silent'])),
  },
  vercel: {
    projectInspect: redactCommandOutput(run('npx', ['--yes', 'vercel', 'project', 'inspect', projectName])),
    environmentNames: redactVercelEnvList(run('npx', ['--yes', 'vercel', 'env', 'ls'])),
    domainVerification: domains.map(collectDomainVerification),
  },
  dns: {
    nameservers: redactCommandOutput(run('dig', ['+short', 'NS', 'thelivingroom.vet'])),
    apexA: redactCommandOutput(run('dig', ['+short', 'A', 'thelivingroom.vet'])),
    wwwCname: redactCommandOutput(run('dig', ['+short', 'CNAME', 'www.thelivingroom.vet'])),
  },
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
  console.log(`Wrote hosted readiness inventory to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}
