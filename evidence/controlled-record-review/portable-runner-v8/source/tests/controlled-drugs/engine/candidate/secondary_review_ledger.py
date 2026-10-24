"""Source-only ledger derivation using the unmodified pinned official CLI parser.

Generation is offline Node/TypeScript computation, never a database observation.
The frozen artifact is a candidate until independent source/reference review.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

SOURCE = Path(__file__).resolve().parent
VENDOR = 'vendor/supabase-cli-2.118.0'
PROVENANCE_SHA256 = '28bcd6a27b93fb7a31c3e20519b5ebb6540737b26e2f333e3f44cb3340327884'
TYPESCRIPT_SHA256 = 'dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0'
PARENT_PIN_SHA256 = '4755a1f1c53008003a11e94ada3963ae416f6c81f163ec43ed2ffea21d6d2f78'
PARENT_205 = '20261020151157_controlled_stock_private_engine.sql'
PARENT_205_SHA256 = '9977696d3d6271cbbfe1dee3767dd71b8512d55bcec0c0d65d108745726252b3'
MIGRATION_206 = '20261022010000_controlled_secondary_review_private.sql'
LEDGER_FILE = 'secondary_review_expected_205_ledger.json'
# Candidate source-derived pin; independent reference approval is separate evidence.
LEDGER_SHA256 = '73aa7156bebcf869a37a9f5047842c11a46079145d05674790f81d5d9da2f7f4'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def unique(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, 'Duplicate independent expectation field'
        result[key] = value
    return result


def source205(source=SOURCE):
    """Validate all old source bytes; this does not admit a 206 installation."""
    source = Path(source).resolve()
    root = source.parents[3]
    raw = (source / 'release-expected-204.json').read_bytes()
    assert sha(raw) == PARENT_PIN_SHA256, 'Frozen parent pin changed'
    expected = json.loads(raw, object_pairs_hook=unique)['canonical_migration_hashes']
    assert len(expected) == 204 and PARENT_205 not in expected
    expected = dict(expected, **{PARENT_205: PARENT_205_SHA256})
    actual = sorted((root / 'supabase/migrations').glob('*.sql'))
    names = [p.name for p in actual]
    assert names in (sorted(expected), sorted([*expected, MIGRATION_206])), 'Exact source inventory required'
    paths = [root / 'supabase/migrations' / name for name in sorted(expected)]
    assert {p.name: sha(p.read_bytes()) for p in paths} == expected, 'Frozen 205 migration bytes changed'
    assert all(re.fullmatch(r'[0-9]{14}_.+\.sql', p.name) for p in paths)
    assert len({p.name.split('_', 1)[0] for p in paths}) == 205, 'Unique fixed-width versions required'
    return paths


def provenance(source=SOURCE):
    source = Path(source)
    raw = (source / VENDOR / 'provenance.json').read_bytes()
    assert sha(raw) == PROVENANCE_SHA256, 'Pinned CLI provenance changed'
    data = json.loads(raw, object_pairs_hook=unique)
    assert data['kind'] == 'supabase-cli-statement-source-v2.118.0'
    assert data['typescript_version'] == '5.8.3'
    for name, record in data['files'].items():
        assert sha((source / VENDOR / name).read_bytes()) == record['sha256'], 'Official CLI source changed'
    return data


NODE_PARSER = r"""
const fs = require('fs');
const vm = require('vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const ts = require(input.typescript);
if (ts.version !== '5.8.3') throw Error('Exact TypeScript version required');
function load(name, dependency) {
  const raw = fs.readFileSync(input.vendor + '/' + name + '.ts', 'utf8');
  const compiled = ts.transpileModule(raw, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }, reportDiagnostics: true});
  if ((compiled.diagnostics || []).some(d => d.category === ts.DiagnosticCategory.Error))
    throw Error('Official parser transpilation failed');
  const module = {exports: {}};
  const requireExact = name => {
    if (name !== './sql-split.ts' || !dependency) throw Error('Unreviewed parser dependency');
    return dependency;
  };
  vm.runInNewContext(compiled.outputText, {exports: module.exports, module, require: requireExact});
  return module.exports;
}
const splitter = load('sql-split');
const parser = load('migration-file', splitter);
process.stdout.write(JSON.stringify(input.sources.map(source => {
  const parsed = parser.parseMigrationContent(source.body);
  return {name: source.name, statements: Array.from(parsed.statements), transaction_mode: parsed.transactionMode};
})));
"""


def split_sources(sources, typescript, source=SOURCE):
    """Run official exports; no subprocess receives SQL to execute."""
    provenance(source)
    typescript = Path(typescript).resolve()
    assert sha(typescript.read_bytes()) == TYPESCRIPT_SHA256, 'Pinned TypeScript implementation required'
    request = dict(typescript=str(typescript), vendor=str(Path(source).resolve() / VENDOR), sources=sources)
    process = subprocess.run(['node', '-e', NODE_PARSER], input=canonical(request), text=True,
                             capture_output=True, check=True, timeout=120)
    result = json.loads(process.stdout, object_pairs_hook=unique)
    assert len(result) == len(sources)
    for original, parsed in zip(sources, result):
        assert parsed['name'] == original['name']
        assert parsed['transaction_mode'] in ('transactional', 'none')
        assert isinstance(parsed['statements'], list) and all(type(s) is str and s for s in parsed['statements'])
    return result


def derive(typescript, source=SOURCE):
    paths = source205(source)
    parsed = split_sources([dict(name=p.name, body=p.read_bytes().decode('utf-8')) for p in paths], typescript, source)
    rows = []
    for path, result in zip(paths, parsed):
        assert result['transaction_mode'] == 'transactional', 'Unexpected historical transaction directive'
        version, name = path.name[:-4].split('_', 1)
        rows.append(dict(version=version, name=name, statements=result['statements']))
    assert len(rows[-1]['statements']) == 94
    assert sha(canonical(rows[-1]['statements']).encode()) == '626e9374546764d9a4070f3a0332bd0c7f606812ffe7355abdaea35088b89e7c'
    return dict(kind='controlled-review-source-derived-205-ledger-v1', cli_version='2.118.0',
                canonical_encoding='UTF-8 json.dumps(sort_keys=True,separators=(comma,colon),ensure_ascii=True)',
                parser_provenance_sha256=PROVENANCE_SHA256, typescript_sha256=TYPESCRIPT_SHA256,
                migration_sha256={p.name: sha(p.read_bytes()) for p in paths},
                ledger_sha256=sha(canonical(rows).encode()), ledger=rows)


def load_frozen(source=SOURCE):
    source = Path(source)
    paths = source205(source)
    provenance(source)
    raw = (source / LEDGER_FILE).read_bytes()
    assert sha(raw) == LEDGER_SHA256, 'Frozen source-derived ledger changed'
    data = json.loads(raw, object_pairs_hook=unique)
    assert set(data) == {'kind','cli_version','canonical_encoding','parser_provenance_sha256',
                         'typescript_sha256','migration_sha256','ledger_sha256','ledger'}
    assert data['kind'] == 'controlled-review-source-derived-205-ledger-v1' and data['cli_version'] == '2.118.0'
    assert data['parser_provenance_sha256'] == PROVENANCE_SHA256 and data['typescript_sha256'] == TYPESCRIPT_SHA256
    assert data['migration_sha256'] == {p.name: sha(p.read_bytes()) for p in paths}
    rows = data['ledger']
    assert len(rows) == 205 and sha(canonical(rows).encode()) == data['ledger_sha256']
    for row, path in zip(rows, paths):
        assert set(row) == {'version','name','statements'}
        assert row['version'] + '_' + row['name'] + '.sql' == path.name
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--derive', action='store_true')
    mode.add_argument('--check', action='store_true')
    parser.add_argument('--typescript', type=Path)
    args = parser.parse_args()
    if args.derive:
        assert args.typescript is not None, 'Explicit pinned transpiler path required'
        data = derive(args.typescript)
        target = SOURCE / LEDGER_FILE
        raw = (json.dumps(data, sort_keys=True, indent=2, ensure_ascii=True) + '\n').encode()
        assert not target.exists() or target.read_bytes() == raw, 'Never overwrite differing frozen ledger'
        target.write_bytes(raw)
    else:
        data = load_frozen()
        if args.typescript:
            assert derive(args.typescript) == data, 'Official parser regeneration differs'
    print(canonical(dict(kind=data['kind'], ledger_sha256=data['ledger_sha256'],
                         artifact_sha256=sha((SOURCE / LEDGER_FILE).read_bytes()),
                         migration_count=len(data['ledger']), database_operations=0)))


if __name__ == '__main__':
    main()
