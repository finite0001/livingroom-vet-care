#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectName = 'livingroom-vet-care';
const domains = ['thelivingroom.vet', 'www.thelivingroom.vet'];
const apexDomain = 'thelivingroom.vet';

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
    const jsonStart = commandResult.stdout.indexOf('{');
    const jsonEnd = commandResult.stdout.lastIndexOf('}');

    if (jsonStart === -1 || jsonEnd === -1) {
      return null;
    }

    try {
      return JSON.parse(commandResult.stdout.slice(jsonStart, jsonEnd + 1));
    } catch {
      return null;
    }
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

function collectDomainInspection(domain, inspection) {
  const parsed = parseJson(inspection);

  if (!parsed) {
    return {
      domain,
      result: redactCommandOutput(inspection),
    };
  }

  const attachedProject = (parsed.projects ?? []).find(
    (project) => project.name === projectName && (project.domains ?? []).includes(domain),
  );
  const configured = parsed.configuration?.misconfigured === false;
  const attached = attachedProject !== undefined;
  const ok = configured && attached;

  return {
    domain,
    result: {
      status: ok ? 'ok' : 'blocked',
      reason: ok ? 'configured_attached_inspected' : configured ? 'not_attached_to_project' : 'misconfigured',
      message: ok
        ? `${domain} is configured and attached to project ${projectName}.`
        : `${domain} is not launch-ready from passive Vercel domain inspection.`,
      domain,
      domainStatus: configured ? 'configured-inspected' : 'misconfigured',
      configurationStatus: configured ? 'configured-inspected' : 'misconfigured',
      ok,
      issues: ok ? [] : [attached ? 'Domain configuration is misconfigured.' : `Domain is not attached to ${projectName}.`],
      misconfigured: !configured,
      project: {
        idOrName: projectName,
        attached,
        verified: null,
        verification: [],
        verificationError: null,
      },
      inspection: {
        command: inspection.command,
        status: inspection.status,
        ok: inspection.ok,
        domainName: parsed.domain?.name ?? null,
        edgeNetwork: parsed.domain?.edgeNetwork ?? null,
        currentNameservers: parsed.nameservers?.current ?? [],
        projectDomains: (parsed.projects ?? [])
          .filter((project) => project.name === projectName)
          .flatMap((project) => project.domains ?? [])
          .sort((left, right) => left.localeCompare(right)),
      },
    },
  };
}

function inspectDomain(domain) {
  return run('npx', [
    '--yes',
    'vercel',
    'domains',
    'inspect',
    domain,
    '--json',
    '--non-interactive',
  ]);
}

const apexDomainInspection = inspectDomain(apexDomain);

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
    domainVerification: domains.map((domain) => collectDomainInspection(domain, apexDomainInspection)),
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
