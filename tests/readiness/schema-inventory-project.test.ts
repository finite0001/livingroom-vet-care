import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/supabase-schema-inventory.mjs');

function inventory(projectOverride?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'lrv-schema-project-test-'));
  try {
    mkdirSync(join(directory, 'supabase'));
    writeFileSync(join(directory, 'supabase/config.toml'), 'project_id = "mgadheotkdnrsatfivjy"\n');
    // A competing local link must never select the inspected backend.
    mkdirSync(join(directory, 'supabase/.temp'));
    writeFileSync(join(directory, 'supabase/.temp/project-ref'), 'ugpyjacqganaqtsiekay');
    const capture = join(directory, 'args.json');
    writeFileSync(join(directory, 'npx'), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(args));fs.writeFileSync(args[args.indexOf('--file')+1],'CREATE TABLE "public"."outbound_deliveries" ();');\n`, { mode: 0o700 });
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` };
    delete env.SUPABASE_PROJECT_REF;
    if (projectOverride !== undefined) env.SUPABASE_PROJECT_REF = projectOverride;
    const result = spawnSync(process.execPath, [script], { cwd: directory, env, encoding: 'utf8' });
    return {
      status: result.status,
      stderr: result.stderr,
      artifact: result.status === 0 ? JSON.parse(result.stdout) : null,
      args: result.status === 0 ? JSON.parse(readFileSync(capture, 'utf8')) as string[] : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('schema inventory binds both CLI and artifact to the configured application project', () => {
  const result = inventory();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.artifact.projectRef, 'mgadheotkdnrsatfivjy');
  assert.equal(result.args?.includes('--linked'), false);
  assert.equal(result.args?.[(result.args?.indexOf('--project-ref') ?? -1) + 1], 'mgadheotkdnrsatfivjy');
});

test('schema inventory supports an explicit staging selection', () => {
  const result = inventory('kothoqicubowyhwfsrte');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.artifact.projectRef, 'kothoqicubowyhwfsrte');
  assert.equal(result.args?.[(result.args?.indexOf('--project-ref') ?? -1) + 1], 'kothoqicubowyhwfsrte');
});

test('schema inventory refuses an invalid project before invoking the CLI', () => {
  const result = inventory('not-a-project');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /valid Supabase project reference/);
});
