#!/usr/bin/env node
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const projectRef = 'mgadheotkdnrsatfivjy';
const functionsDirectory = resolve('supabase/functions');

const expectedHostedFunctions = [
  { slug: 'invite-staff', verifyJwt: true, purpose: 'staff bootstrap/invitations' },
  { slug: 'send-email', verifyJwt: true, purpose: 'staff client email enqueue endpoint' },
  { slug: 'send-sms', verifyJwt: true, purpose: 'staff client SMS enqueue endpoint' },
  { slug: 'dispatch-outbound-deliveries', verifyJwt: false, purpose: 'token-protected outbound delivery worker' },
  { slug: 'resend-delivery-webhook', verifyJwt: false, purpose: 'signed Resend delivery callback' },
  { slug: 'twilio-message-status-callback', verifyJwt: false, purpose: 'signed Twilio delivery status callback' },
  { slug: 'twilio-inbound-sms', verifyJwt: false, purpose: 'signed Twilio inbound SMS webhook' },
];

const intentionallyNotCommissioned = [
  { slug: 'send-provider-email', reason: 'references provider delivery tables outside the launch baseline' },
  { slug: 'suggest-replies', reason: 'requires AI provider configuration and is not needed for foundation launch' },
];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function listLocalFunctionSlugs() {
  return readdirSync(functionsDirectory)
    .filter((entry) => {
      if (entry.startsWith('_')) {
        return false;
      }

      const path = join(functionsDirectory, entry);
      return statSync(path).isDirectory();
    })
    .sort((left, right) => left.localeCompare(right));
}

function parseFunctionList(commandResult) {
  if (!commandResult.stdout) {
    return [];
  }

  const jsonStart = commandResult.stdout.indexOf('{');
  const jsonEnd = commandResult.stdout.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) {
    return [];
  }

  const parsed = JSON.parse(commandResult.stdout.slice(jsonStart, jsonEnd + 1));
  return parsed.functions ?? [];
}

function publicFunctionShape(fn) {
  return {
    slug: fn.slug,
    status: fn.status,
    version: fn.version,
    verifyJwt: fn.verify_jwt,
    importMap: fn.import_map,
    updatedAt: fn.updated_at ? new Date(fn.updated_at).toISOString() : null,
  };
}

const localSlugs = listLocalFunctionSlugs();
const functionsList = run('npx', ['supabase', 'functions', 'list', '--project-ref', projectRef]);
const remoteFunctions = parseFunctionList(functionsList).map(publicFunctionShape);
const remoteSlugSet = new Set(remoteFunctions.map((fn) => fn.slug));
const localSlugSet = new Set(localSlugs);

const readinessPresence = expectedHostedFunctions.map((expected) => {
  const remote = remoteFunctions.find((fn) => fn.slug === expected.slug) ?? null;

  return {
    ...expected,
    localPresent: localSlugSet.has(expected.slug),
    remotePresent: remote !== null,
    remoteStatus: remote?.status ?? null,
    remoteVerifyJwt: remote?.verifyJwt ?? null,
    verifyJwtMatches: remote ? remote.verifyJwt === expected.verifyJwt : false,
  };
});

const inventory = {
  generatedAt: new Date().toISOString(),
  note: 'Read-only Supabase Edge Function inventory. Function hashes and source paths are intentionally omitted; this captures deployment shape, not code equivalence.',
  projectRef,
  command: {
    command: functionsList.command,
    status: functionsList.status,
    ok: functionsList.ok,
    stderr: functionsList.stderr
      .split('\n')
      .filter((line) => line.trim() && !line.includes('A new version of Supabase CLI is available'))
      .slice(0, 20),
  },
  counts: {
    localFunctions: localSlugs.length,
    remoteFunctions: remoteFunctions.length,
  },
  localSlugs,
  remoteFunctions,
  readinessPresence,
  localOnly: localSlugs.filter((slug) => !remoteSlugSet.has(slug)),
  remoteOnly: remoteFunctions
    .map((fn) => fn.slug)
    .filter((slug) => !localSlugSet.has(slug))
    .sort((left, right) => left.localeCompare(right)),
  intentionallyNotCommissioned,
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
  console.log(`Wrote Supabase function inventory to ${resolvedPath}`);
} else {
  process.stdout.write(json);
}

if (!functionsList.ok) {
  process.exit(functionsList.status ?? 1);
}
