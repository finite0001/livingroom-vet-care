"""Rehearse genuine pre-provenance native history upgrades in owned local stacks.

Creates records with actual canonical prefix APIs, applies the unchanged suffix,
then observes the unpublished candidate. Never connects to a hosted project.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import uuid

from local_install import build_install, assert_prior
from history_environment import assert_bootstrap_image

source = Path(__file__).resolve().parent
root = source.parents[3]
sys.path.insert(0, str(root / 'tests/controlled-drugs'))
from owned_scheduler import paused_owned_scheduler


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


class OwnedReplay:
    def __init__(self, era, folder):
        self.era = era
        self.identity = 'lrv-controlled-engine-history-' + uuid.uuid4().hex[:10]
        self.work = Path(tempfile.mkdtemp(prefix=self.identity + '-'))
        self.project = self.work / 'project'
        self.container = 'supabase_db_' + self.identity
        self.folder = folder / str(era)
        self.folder.mkdir()
        self.log = (self.folder / 'runner.log').open('x')
        self.started = False

    def command(self, argv, text=None, timeout=180):
        result = subprocess.run(argv, input=text, capture_output=True, text=True,
                                cwd=root, timeout=timeout)
        self.log.write('COMMAND ' + argv[0] + '\n' + (
            '[Owned Docker inspection withheld]\n' if argv[:2] == ['docker', 'inspect']
            else result.stdout + result.stderr) + '\n')
        self.log.flush()
        if result.returncode:
            raise RuntimeError('Owned history command failed; private log: ' + str(self.folder / 'runner.log'))
        return result.stdout

    def verify(self, name=None):
        labels = json.loads(self.command(['docker', 'inspect', name or self.container]))[0]['Config']['Labels']
        assert labels['com.supabase.cli.project'] == self.identity
        assert Path(labels['com.supabase.cli.workdir']).resolve() == self.project.resolve()

    def sql(self, query, variables=None):
        self.verify()
        argv = ['docker', 'exec', '-i', self.container, 'psql', '-X', '-qAt',
                '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
        for key, value in (variables or {}).items():
            argv.extend(['-v', key + '=' + str(value)])
        return self.command(argv, query)

    def json(self, query, variables=None):
        return json.loads(self.sql(query, variables).splitlines()[-1])

    def ledger(self, files):
        actual = self.json('select jsonb_agg(version order by version)from supabase_migrations.schema_migrations;')
        assert actual == [p.name.split('_')[0] for p in files]
        return actual

    def columns(self, original=False):
        predicate = ("(n.nspname='auth'and c.relname='users')or(n.nspname='public'and("
                     "c.relname~'^(native_|inventory_|billing_)'or c.relname in"
                     "('clients','pets','profiles','user_roles','catalog_products',"
                     "'stock_movement_sources','stock_custody_sources','stock_discrepancy_sources')))" if original else
                     "n.nspname in('public','auth','storage','extensions')")
        return self.json("select jsonb_object_agg(name,columns)from(select n.nspname||'.'||c.relname name,"
                         "jsonb_agg(a.attname order by a.attnum)columns from pg_class c join pg_namespace n on n.oid=c.relnamespace "
                         "join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped "
                         "where c.relkind in('r','p')and(" + predicate + ')group by n.nspname,c.relname)x;')

    def snapshot(self, columns):
        parts = []
        for name, names in sorted(columns.items()):
            schema, relation = name.split('.')
            selected = ','.join(identifier(x) for x in names)
            parts.append('select ' + literal(name) + " name,jsonb_build_object('count',count(*),'sha256',"
                         "encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text),''),'UTF8')),'hex'))value "
                         'from(select ' + selected + ' from ' + identifier(schema) + '.' + identifier(relation) + ')t')
        return self.json("begin;set local timezone='UTC';select jsonb_object_agg(name,value)from(" +
                         ' union all '.join(parts) + ')x;rollback;')

    def provenance(self):
        return self.json("select jsonb_build_object('movement',(select count(*)from stock_movement_sources),"
                         "'custody',(select count(*)from stock_custody_sources),'discrepancy',(select count(*)from stock_discrepancy_sources),"
                         "'pickup',(select count(*)from stock_pickup_sources),'correction',(select count(*)from stock_correction_sources));")

    def verify_writers(self, expected):
        actual = self.json("select jsonb_object_agg(signature,encode(sha256(convert_to("
                           "pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex'))from stock_writer_manifests;")
        assert len(actual) == 10 and actual == expected, 'Canonical writer definitions changed'

    def no_controlled_data(self):
        value = self.json("select coalesce(jsonb_object_agg(name,n),'{}')from(select c.relname name,"
                          "(xpath('/row/n/text()',query_to_xml(format('select count(*)n from public.%I',c.relname),false,true,'')))[1]::text::bigint n "
                          "from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'and "
                          "(c.relname like 'controlled_stock_%'or c.relname like 'controlled_draft_%')"
                          "and c.relname<>'controlled_stock_engine_manifests')x;")
        assert value and all(count == 0 for count in value.values()), 'Unexpected controlled configuration or history'
        return value

    def start(self, files):
        # Keep both eras separate from the ordinary Auth/API runner and from
        # each other: recently closed TCP connections may outlive owned Docker
        # cleanup. Retain the occupied-port guard instead of enabling reuse.
        port_base = {187: 64630, 188: 64640}[self.era]
        for port in [port_base, port_base + 1, port_base + 2, port_base + 4]:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', port))
        migrations = self.project / 'supabase/migrations'
        migrations.mkdir(parents=True)
        for path in files:
            shutil.copy2(path, migrations / path.name)
        (self.project / 'supabase/config.toml').write_text(f'''project_id = "{self.identity}"
[api]
port = {port_base + 1}
[db]
port = {port_base + 2}
shadow_port = {port_base}
major_version = 17
[studio]
enabled = false
[analytics]
enabled = false
[inbucket]
port = {port_base + 4}
[auth]
site_url = "http://127.0.0.1:{port_base + 1}"
enable_signup = false
[storage]
enabled = true
[edge_runtime]
enabled = false
''')
        self.started = True
        self.command(['supabase', 'start', '--workdir', str(self.project), '--exclude',
                      'realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor'], timeout=600)
        self.verify()

    def cleanup(self):
        try:
            if self.started:
                for name in self.command(['docker', 'ps', '-a', '--filter',
                                          'label=com.supabase.cli.project=' + self.identity, '--format', '{{.Names}}']).splitlines():
                    self.verify(name)
                self.command(['supabase', 'stop', '--workdir', str(self.project), '--no-backup'])
                for argv in [ ['docker', 'ps', '-aq'], ['docker', 'volume', 'ls', '-q'] ]:
                    assert not self.command(argv + ['--filter', 'label=com.supabase.cli.project=' + self.identity]).strip()
            shutil.rmtree(self.work)
            assert not self.work.exists()
            (self.folder / 'cleanup.json').write_text(json.dumps({'identity': self.identity,
                'containers_volumes_workdir_removed': True}, indent=2))
        finally:
            self.log.close()


def rehearse(era, files, assembly, folder):
    replay = OwnedReplay(era, folder)
    outcome = None
    try:
        print('Replaying genuine native checkpoint ' + str(era) + '.', flush=True)
        replay.start(files[:era])
        container = json.loads(replay.command(['docker', 'inspect', replay.container]))[0]
        image = container['Config']['Image']
        inspected = json.loads(replay.command(['docker', 'image', 'inspect', container['Image']]))[0]
        image_pin = assert_bootstrap_image(image, inspected)
        replay.ledger(files[:era])
        with paused_owned_scheduler(replay.project, replay.identity) as scheduler:
            fixture = (root / 'supabase/tests/native_fulfillment.test.sql').read_text()
            marker = "insert into data select 'target',"
            assert fixture.count(marker) == 1
            prefix = fixture[:fixture.index(marker)].replace('select no_plan();', '').replace(
                'begin;', "begin;set local timezone='UTC';", 1)
            seed = replay.json(prefix + (source / 'native-history-seed.sql').read_text(), {'era': era})
            assert seed['kind'] == 'controlled-native-history-seed-v1' and seed['era'] == era
            assert len(seed['cases']) == (1 if era == 187 else 6)
            (replay.folder / 'seed.json').write_text(json.dumps(seed, indent=2))
            original_columns = replay.columns(original=True)
            before = replay.snapshot(original_columns)
            assert sum(x['count'] for x in before.values()) > 0
            for path in files[era:]:
                shutil.copy2(path, replay.project / 'supabase/migrations' / path.name)
            replay.verify()
            replay.command(['supabase', 'db', 'push', '--local', '--skip-vault', '--yes',
                            '--workdir', str(replay.project)], timeout=240)
            replay.ledger(files)
            assert replay.snapshot(original_columns) == before, 'Canonical upgrade changed original history'
            provenance = replay.provenance()
            assert provenance['pickup'] == provenance['correction'] == 0, 'Retroactive provenance was manufactured'
            if era == 187:
                assert provenance == dict(movement=0, custody=0, discrepancy=0, pickup=0, correction=0)
            else:
                assert provenance['movement'] > 0 and provenance['custody'] > 0 and provenance['discrepancy'] > 0
            actual = replay.json(assembly['prior_sql'] + 'select pg_temp.controlled_stock_prior_snapshot();')
            assert_prior(actual, assembly['trusted'])
            roots = replay.json('select jsonb_object_agg(signature,definition_sha256)from stock_writer_manifests;')
            assert len(roots) == 10
            assert replay.sql("select count(*)from stock_writer_manifests where definition_sha256=encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(signature)),'UTF8')),'hex');").strip() == '10'
            replay.no_controlled_data()
            replay.sql(assembly['install'])
            assert replay.snapshot(original_columns) == before, 'Candidate installation changed original history'
            assert replay.json('select jsonb_object_agg(signature,definition_sha256)from stock_writer_manifests;') == roots
            replay.verify_writers(roots)
            controlled = replay.no_controlled_data()
            final_columns = replay.columns()
            installed = replay.snapshot(final_columns)
            observations = []
            for case in seed['cases']:
                observation = replay.json((source / 'native-history-observe.sql').read_text(),
                                          {'ids_json': json.dumps(seed), 'case_name': case['name']})
                assert observation['case_name'] == case['name']
                assert replay.snapshot(final_columns) == installed, 'Observation changed stored state: ' + case['name']
                replay.verify_writers(roots)
                observations.append(observation)
                print(str(era) + ': ' + case['name'] + ' observed; state unchanged.', flush=True)
            assert replay.provenance() == provenance
            assert replay.no_controlled_data() == controlled
            (replay.folder / 'preservation.json').write_text(json.dumps({'original_columns': original_columns,
                'original_before_and_after': before, 'post_install_after_each_observation': installed}, indent=2))
            outcome = {'era': era, 'postgres_image': image, 'postgres_content_pin': image_pin,
                'original_checkpoint': files[era - 1].name, 'final_migrations': len(files),
                'original_relation_count': len(before), 'final_relation_count': len(installed),
                'original_rows': sum(x['count'] for x in before.values()),
                'original_columns_rows_unchanged': True, 'post_install_state_unchanged_after_each_case': True,
                'provenance_counts': provenance, 'no_retrospective_provenance': True,
                'trusted_prior_metadata_matches_original_189': True, 'ten_canonical_writers_unchanged': True,
                'controlled_data_relation_count': len(controlled), 'controlled_configuration_or_events': 0,
                'observations': observations}
        assert scheduler['paused_and_drained'] and scheduler['restored']
        outcome['owned_scheduler_paused_drained_and_restored'] = True
    finally:
        replay.cleanup()
    outcome['containers_volumes_workdir_removed'] = True
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-synthetic-local', action='store_true', required=True)
    parser.parse_args()
    os.umask(0o077)
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    assert len(files) == 204, 'Review the exact native upgrade baseline before rebasing'
    assert files[186].name == '20261015011200_controlled_draft_configuration.sql'
    assert files[187].name == '20261015020722_stock_writer_provenance.sql'
    assert files[188].name == '20261015055007_native_custody_provenance.sql'
    for name in ['native-history-seed.sql', 'native-history-observe.sql']:
        assert (source / name).is_file(), 'Required source-bound fixture missing: ' + name
    inputs = files + sorted(source.glob('*.sql')) + sorted(source.glob('*.py')) + [
        source / 'trusted-prior-189.json', root / 'supabase/tests/native_fulfillment.test.sql',
        root / 'tests/controlled-drugs/owned_scheduler.py', source.parent / 'source-reader.sql',
        source.parent / 'source-effects.sql']
    hashes = {str(p.relative_to(root)): digest(p) for p in inputs}
    folder = Path(tempfile.mkdtemp(prefix='lrv-native-history-evidence-'))
    print('Protected evidence: ' + str(folder), flush=True)
    cli = subprocess.run(['supabase', '--version'], capture_output=True, text=True, timeout=30, check=True)
    assert cli.stdout.strip() == '2.118.0', 'Use the reviewed CLI bootstrap; never normalize trusted ACL drift'
    assembly = build_install(source, files)
    outcomes = [rehearse(era, files, assembly, folder) for era in (187, 188)]
    assert all(digest(root / path) == expected for path, expected in hashes.items()), 'Source changed during proof'
    proof = {'synthetic_only': True, 'hosted_writes': 0, 'provider_requests': 0, 'canonical_migration': False,
             'clinical_or_register_activation': False, 'trusted_reference_regenerated': False,
             'trusted_reference_sha256': assembly['reference_sha256'], 'supabase_cli': cli.stdout.strip(), 'source_hashes': hashes,
             'replays': outcomes, 'observed_cases': sum(len(x['observations']) for x in outcomes),
             'all_owned_resources_removed': True}
    (folder / 'result.json').write_text(json.dumps(proof, indent=2))
    print('PASS: genuine 187/188 history upgraded unchanged; seven outcomes observed; cleanup verified.', flush=True)
    print('Sanitized result: ' + str(folder / 'result.json'), flush=True)


if __name__ == '__main__':
    main()
