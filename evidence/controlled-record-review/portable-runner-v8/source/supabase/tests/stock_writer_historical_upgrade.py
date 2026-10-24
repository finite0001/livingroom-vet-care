"""Genuine owned 187/188 provenance upgrades; never dismantle a current engine.

Boots the independently pinned canonical prefixes through the existing local
replay owner. Raw seed, row, ledger, catalog and receipt evidence stays private.
There is no CLI entry point and no hosted connection option.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

HEX = re.compile(r'[0-9a-f]{64}')
HANDOFF = {'record_native_pickup', 'append_native_dispense_correction'}
WRITERS = HANDOFF | {'adjust_inventory', 'receive_inventory', 'record_native_dispense',
    'record_patient_treatment', 'record_native_dispense_return', 'record_native_dispense_return_v2',
    'record_native_return_discrepancy', 'record_anesthesia_drug_administration'}
MESSAGES = {187: 'Unexpected pre-migration stock writer definition',
            188: 'Unexpected pre-migration handoff writer definition'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def validate_prior(entries):
    assert type(entries) is list and len(entries) == 10, 'Ten original writer pins required'
    result = {}
    for entry in entries:
        assert type(entry) is dict and set(entry) == {'writer', 'signature', 'prior_hash'}
        writer = entry['writer']
        assert type(writer) is str and re.fullmatch(r'[a-z_][a-z_0-9]*', writer)
        assert writer not in result, 'Duplicate prior writer'
        assert type(entry['signature']) is str and entry['signature'].startswith('public.' + writer + '(')
        assert type(entry['prior_hash']) is str and HEX.fullmatch(entry['prior_hash'])
        result[writer] = entry
    assert set(result) == WRITERS, 'Exact canonical writer inventory required'
    return result


def require_failure(result, message):
    """Only an actual verbose PostgreSQL primary ERROR accepts the refusal."""
    assert result.returncode != 0, 'Historical drift unexpectedly installed'
    lines = result.stderr.splitlines()
    assert sum(bool(re.fullmatch(r'(?:psql:[^\n]*?:\d+:\s*)?ERROR:\s+23514:\s+' + re.escape(message), line)) for line in lines) == 1, 'Exact historical SQLSTATE/message missing'


def assert_replay_preservation(before, after):
    assert set(before) == set(after)
    audit = 'public.stock_writer_admissions'
    assert audit in before
    assert all(before[key] == after[key] for key in before if key != audit), 'Legacy replay changed original data'
    assert after[audit]['count'] == before[audit]['count'] + 1, 'Exactly one fresh admission expected'
    assert after[audit]['sha256'] != before[audit]['sha256']


def expected_handoff_rows(entries, definitions):
    """Apply only the reviewed189 literal hook to independently pinned old text."""
    rows = []
    for entry in entries:
        assert entry['writer'] in HANDOFF
        original = definitions[entry['signature']]
        assert hashlib.sha256(original.encode()).hexdigest() == entry['prior_hash']
        modified, count = re.subn(r'\bbegin\b', lambda match: match.group() + "\n perform public.stock_writer_enter(" + literal(entry['writer']) + ",p_id);", original, count=1, flags=re.I)
        assert count == 1 and modified != original
        rows.append({'writer': entry['writer'], 'version': 1, 'signature': entry['signature'],
                     'definition_sha256': hashlib.sha256(modified.encode()).hexdigest(),
                     'prior_definition_sha256': entry['prior_hash']})
    assert len(rows) == 2 and {row['writer'] for row in rows} == HANDOFF
    return rows


def assert_upgrade_preservation(before, after, old_manifest=None, new_manifest=None, additions=None):
    assert set(before) == set(after)
    if old_manifest is None:
        assert before == after, 'Historical upgrade changed populated original rows'
        return
    assert type(old_manifest) is list and len(old_manifest) == 8
    assert type(new_manifest) is list and len(new_manifest) == 10
    assert type(additions) is list and len(additions) == 2
    assert {row['writer'] for row in old_manifest}.isdisjoint(HANDOFF)
    expected = sorted(old_manifest + additions, key=lambda row: (row['writer'], row['version']))
    assert new_manifest == expected, 'Historical manifest must retain exact original8 plus expected2 rows'
    relation = 'public.stock_writer_manifests'
    assert relation in before and before[relation]['count'] == 8 and after[relation]['count'] == 10
    assert before[relation]['sha256'] != after[relation]['sha256']
    assert all(before[key] == after[key] for key in before if key != relation), 'Historical upgrade changed other original data'


def _manifest_rows(replay):
    return replay.json('select jsonb_agg(to_jsonb(m)order by writer,version)from public.stock_writer_manifests m;')


def _save(folder, name, value):
    path = folder / name
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def _ledger(replay):
    return replay.json('select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m;')


def _catalog(replay, atomic):
    return replay.json(atomic.CATALOG_SQL + 'select pg_temp.cli_atomicity_catalog();')


def _definitions(replay, entries):
    signatures = ','.join(literal(e['signature']) for e in entries)
    return replay.json("select jsonb_object_agg(signature,pg_get_functiondef(signature::regprocedure))from unnest(array[" + signatures + '])signature;')


def _staff(actor, body):
    claims = json.dumps({'sub': actor, 'role': 'authenticated'}, separators=(',', ':'))
    return "begin;set local timezone='UTC';do $$begin perform set_config('request.jwt.claims'," + literal(claims) + ",true);end$$;" + body + ';commit;'


def _legacy_replay(replay, actor, writer, source_id, expression, expected, label):
    columns = replay.columns()
    before = replay.snapshot(columns)
    # A single DO statement binds every canonical audit field to its real RPC.
    query = _staff(actor, r"""
create temp table historical_replay_result(value jsonb);
do $replay$declare prior jsonb;expected_audit public.stock_writer_admissions;actual jsonb;receipt jsonb;begin
 select coalesce(jsonb_agg(to_jsonb(a)order by to_jsonb(a)::text),'[]')into prior from public.stock_writer_admissions a;
 expected_audit:=row(pg_backend_pid(),pg_postmaster_start_time(),txid_current(),transaction_timestamp(),statement_timestamp(),__WRITER__,__ID__::uuid,__ACTOR__::uuid)::public.stock_writer_admissions;
 if exists(select 1 from public.stock_writer_admissions where backend_pid=pg_backend_pid())then raise exception 'Fresh historical replay backend required';end if;
 receipt:=__EXPRESSION__;
 if receipt is distinct from __EXPECTED__::jsonb then raise exception 'Exact legacy receipt changed';end if;
 select coalesce(jsonb_agg(to_jsonb(a)order by to_jsonb(a)::text),'[]')into actual from public.stock_writer_admissions a;
 if actual is distinct from(select jsonb_agg(v order by v::text)from jsonb_array_elements(prior||jsonb_build_array(to_jsonb(expected_audit)))v)then raise exception 'Legacy replay audit differs from exact expected row';end if;
 insert into historical_replay_result values(jsonb_build_object('receipt',receipt,'exact_audit_row',true,'prior_audit_rows_retained',true));
end$replay$
""".replace('__WRITER__', literal(writer)).replace('__ID__', literal(source_id)).replace('__ACTOR__', literal(actor)).replace('__EXPRESSION__', expression).replace('__EXPECTED__', literal(json.dumps(expected))))
    result = replay.json(query + 'select value from historical_replay_result;')
    assert result['exact_audit_row'] is True and result['prior_audit_rows_retained'] is True
    after = replay.snapshot(columns)
    assert_replay_preservation(before, after)
    _save(replay.folder, label + '-replay.json', {'before': before, 'after': after, 'result': result})


def _private_access(replay, era):
    tables = ['stock_writer_manifests', 'stock_writer_admissions', 'stock_movement_sources', 'stock_custody_sources', 'stock_discrepancy_sources']
    helpers = ['stock_source_immutable()', 'stock_writer_current()', 'stock_writer_enter(text,uuid)', 'stock_source_guard()', 'stock_source_validate_movement(uuid)', 'stock_source_consistency()']
    if era == 188:
        tables += ['stock_pickup_sources', 'stock_correction_sources']
        helpers += ['stock_handoff_guard()', 'stock_handoff_consistency()']
    for table in tables:
        assert replay.sql("select has_table_privilege('authenticated'," + literal(table) + ",'SELECT')or has_table_privilege('service_role'," + literal(table) + ",'INSERT');").strip() == 'f'
    for helper in helpers:
        assert replay.sql("select has_function_privilege('authenticated'," + literal(helper) + ",'EXECUTE')or has_function_privilege('service_role'," + literal(helper) + ",'EXECUTE');").strip() == 'f'
    assert replay.sql("select bool_and(definition_sha256=encode(sha256(convert_to(pg_get_functiondef(signature::regprocedure),'UTF8')),'hex'))from stock_writer_manifests;").strip() == 't'


def _era(era, files, entries, owner, atomic, environment, scheduler, folder):
    replay = owner.OwnedReplay(era, folder)
    outcome = None
    try:
        replay.start(files[:era])
        inspected = json.loads(replay.command(['docker', 'inspect', replay.container]))[0]
        image = json.loads(replay.command(['docker', 'image', 'inspect', inspected['Image']]))[0]
        image_pin = environment.assert_bootstrap_image(inspected['Config']['Image'], image)
        replay.ledger(files[:era])
        with scheduler.paused_owned_scheduler(replay.project, replay.identity):
            fixture = (owner.root / 'supabase/tests/native_fulfillment.test.sql').read_text()
            marker = "insert into data select 'target',"
            assert fixture.count(marker) == 1
            prefix = fixture[:fixture.index(marker)].replace('select no_plan();', '').replace('begin;', "begin;set local timezone='UTC';", 1)
            seed = replay.json(prefix + (owner.source / 'native-history-seed.sql').read_text(), {'era': era})
            assert seed['kind'] == 'controlled-native-history-seed-v1' and seed['era'] == era
            assert seed['historical_rows_fabricated'] is False and seed['provenance_backfilled'] is False
            assert len(seed['cases']) == (1 if era == 187 else 6)
            assert seed['actual_canonical_dispense_count'] == (1 if era == 187 else 6)
            assert seed['actual_canonical_correction_count'] == (0 if era == 187 else 3)
            assert seed['actual_canonical_pickup_count'] == (0 if era == 187 else 2)
            _save(replay.folder, 'seed.json', seed)
            assert replay.json("select jsonb_build_object('engine',to_regclass('public.controlled_stock_engine_manifests')is null,'policies',to_regclass('public.controlled_stock_policy_versions')is null,'guard',to_regprocedure('public.controlled_stock_source_required()')is null);") == dict(engine=True, policies=True, guard=True)
            selected = [e for e in entries.values() if (e['writer'] in HANDOFF) == (era == 188)]
            assert len(selected) == (8 if era == 187 else 2)
            definitions = _definitions(replay, selected)
            for e in selected:
                assert hashlib.sha256(definitions[e['signature']].encode()).hexdigest() == e['prior_hash'], 'Genuine prior definition differs from pinned provenance'
            _save(replay.folder, 'genuine-prior-definitions.json', definitions)
            columns = replay.columns()
            before = replay.snapshot(columns)
            ledger_before = _ledger(replay)
            manifest_before = _manifest_rows(replay) if era == 188 else None
            additions = expected_handoff_rows(selected, definitions) if era == 188 else None
            if additions is not None:
                reviewed_writers = json.loads((owner.source / 'release-expected-204.json').read_text())['canonical_writer_definition_hashes']
                assert all(row['definition_sha256'] == reviewed_writers[row['signature']] for row in additions), 'Derived handoff bodies differ from independent release pin'
            _save(replay.folder, 'original-before-upgrade.json', {'rows': before, 'ledger': ledger_before, 'manifest_rows': manifest_before, 'expected_additions': additions})
            migration = files[era]
            assert migration.name == ('20261015020722_stock_writer_provenance.sql' if era == 187 else '20261015055007_native_custody_provenance.sql')
            last_name = 'record_native_return_discrepancy' if era == 187 else 'append_native_dispense_correction'
            last = entries[last_name]
            original = definitions[last['signature']]
            drifted, n = re.subn(r'\bbegin\b', 'begin /* synthetic historical last-root drift */', original, count=1, flags=re.I)
            assert n == 1 and drifted != original
            replay.sql(drifted)
            drift_catalog = _catalog(replay, atomic)
            replay.verify()
            result = subprocess.run(['docker', 'exec', '-i', replay.container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], input=migration.read_text(), text=True, capture_output=True, timeout=90)
            replay.log.write(result.stdout + result.stderr + '\n'); replay.log.flush()
            require_failure(result, MESSAGES[era])
            assert replay.snapshot(columns) == before and _ledger(replay) == ledger_before
            assert _catalog(replay, atomic) == drift_catalog, 'Failed historical DDL/catalog rollback differs'
            _save(replay.folder, 'failed-upgrade-rollback.json', {'rows': before, 'ledger': ledger_before, 'catalog': drift_catalog})
            replay.sql(original)
            assert _definitions(replay, selected) == definitions
            # Actual CLI applies the original next canonical file and records it.
            import shutil
            shutil.copy2(migration, replay.project / 'supabase/migrations' / migration.name)
            replay.verify()
            replay.command(['supabase', 'migration', 'up', '--local', '--workdir', str(replay.project), '--yes', '--output-format', 'json'], timeout=240)
            replay.ledger(files[:era + 1])
            after_rows = replay.snapshot(columns)
            after_ledger = _ledger(replay)
            manifest_after = _manifest_rows(replay) if era == 188 else None
            _save(replay.folder, 'installed-upgrade.json', {'rows': after_rows, 'ledger': after_ledger,
                'catalog': _catalog(replay, atomic), 'manifest_before': manifest_before,
                'manifest_after': manifest_after, 'expected_additions': additions})
            assert_upgrade_preservation(before, after_rows, manifest_before, manifest_after, additions)
            assert after_ledger[:era] == ledger_before and len(after_ledger) == era + 1
            _private_access(replay, era)
            assert replay.sql('select count(*)from stock_writer_manifests;').strip() == str(8 if era == 187 else 10)
            if era == 187:
                assert replay.sql('select(select count(*)from stock_movement_sources)+(select count(*)from stock_custody_sources)+(select count(*)from stock_discrepancy_sources);').strip() == '0'
            actor = 'a5510000-0000-4000-8000-000000000001'
            ids = seed['ids']
            if era == 187:
                movement = replay.json('select to_jsonb(m)from inventory_movements m where id=' + literal(ids['history_generic_receive']) + '::uuid;')
                expression = 'to_jsonb(receive_inventory(' + ','.join([literal(ids['history_generic_receive']), literal(ids['history_generic_lot']), literal(ids['history_generic_product']), literal('SYNTHETIC-GENERIC-HISTORY'), 'current_date+365', literal('Synthetic clinic'), '3.000', literal('Synthetic genuine-era generic receipt')]) + '))'
                _legacy_replay(replay, actor, 'receive_inventory', ids['history_generic_receive'], expression, movement, 'legacy-movement')
                assert replay.sql('select count(*)from stock_movement_sources;').strip() == '0'
                new_id, new_lot = str(uuid.uuid4()), str(uuid.uuid4())
                new_expression = 'select to_jsonb(receive_inventory(' + ','.join([literal(new_id), literal(new_lot), literal(ids['history_generic_product']), literal('SYNTHETIC-NEW-RECEIPT'), "'2099-12-31'", literal('Synthetic clinic'), '0.125', literal('Synthetic post-upgrade receipt')]) + '));'
                replay.sql(_staff(actor, new_expression))
                assert replay.sql('select count(*)from stock_movement_sources where movement_id=' + literal(new_id) + '::uuid and source_id=' + literal(new_id) + "::uuid and writer='receive_inventory'and actor_id=" + literal(actor) + '::uuid;').strip() == '1'
                assert replay.sql('select count(*)from stock_movement_sources;').strip() == '1'
                replay.sql('select stock_source_validate_movement(' + literal(new_id) + '::uuid);')
                assert replay.sql('select sum(quantity)::text from inventory_movements where lot_id=' + literal(new_lot) + '::uuid;').strip() == '0.125'
                outcome = dict(exact_prior_definition_hashes=8, legacy_history_preserved=True, unexpected_drift_denied_atomically=True, legacy_receipt_unchanged_without_backfill=True, new_post_upgrade_source_enforced=True)
            else:
                operations = replay.json("select jsonb_agg(jsonb_build_object('writer','append_native_dispense_correction','id',o.id,'actor',o.actor_id,'request',o.request,'receipt',native_correction_receipt(o))order by o.id)from native_dispense_correction_operations o;")
                pickups = replay.json("select jsonb_agg(jsonb_build_object('writer','record_native_pickup','id',o.id,'actor',o.actor_id,'request',o.request,'receipt',native_fulfillment_receipt(o))order by o.id)from native_fulfillment_operations o where operation='pickup';")
                assert len(operations) == 3 and len(pickups) == 2
                for item in operations + pickups:
                    expression = item['writer'] + '(' + literal(item['id']) + '::uuid,' + literal(json.dumps(item['request'])) + '::jsonb)'
                    _legacy_replay(replay, item['actor'], item['writer'], item['id'], expression, item['receipt'], 'legacy-' + item['id'])
                assert replay.sql('select(select count(*)from stock_pickup_sources)+(select count(*)from stock_correction_sources);').strip() == '0'
                item = next(o for o in operations if o['request']['kind'] == 'operational_annotation')
                new_id = str(uuid.uuid4())
                stable_columns = {k:v for k,v in replay.columns().items() if k in ('public.inventory_movements','public.billing_invoices','public.billing_invoice_items')}
                stable = replay.snapshot(stable_columns)
                query = r"""do $new$declare request jsonb:=__REQUEST__::jsonb;p jsonb;begin
p:=preview_native_dispense_correction((request->>'authorization_id')::uuid,(request->>'pet_id')::uuid,(request->>'dispense_id')::uuid);
request:=request||jsonb_build_object('expected_context_hash',p->>'context_hash','expected_head',p#>'{context,head}');
perform append_native_dispense_correction(__ID__::uuid,request);end$new$""".replace('__REQUEST__', literal(json.dumps(item['request']))).replace('__ID__', literal(new_id))
                replay.sql(_staff(item['actor'], query))
                assert replay.sql('select count(*)from stock_correction_sources where event_id=' + literal(new_id) + '::uuid and actor_id=' + literal(item['actor']) + '::uuid;').strip() == '1'
                assert replay.sql('select count(*)from stock_correction_sources;').strip() == '1'
                assert replay.snapshot(stable_columns) == stable
                outcome = dict(exact_prior_definition_hashes=2, history_preserved=True, source_drift_rolls_back_all_ddl=True, legacy_replay_has_no_backfill=True, new_correction_has_one_source_and_no_stock_or_billing_effect=True)
            _save(replay.folder, 'new-write-proof.json', {'rows': replay.snapshot(replay.columns()),
                'catalog': _catalog(replay, atomic), 'ledger': _ledger(replay)})
            outcome.update(image_pin=image_pin, ledger_before=era, ledger_after=era + 1, genuine_prefix=True)
    finally:
        replay.cleanup()
    assert outcome is not None
    outcome['owned_runtime_removed'] = True
    return outcome


def run_historical_upgrades(root, evidence_dir, expected_prior):
    root, folder = Path(root).resolve(), Path(evidence_dir).resolve()
    source = root / 'tests/controlled-drugs/engine/candidate'
    sys.path.insert(0, str(source))
    import canonical_prefix
    import cli_atomicity
    import history_environment
    sys.path.insert(0, str(root / 'tests/controlled-drugs'))
    import owned_scheduler
    files = canonical_prefix.canonical_prefix(source, sorted((root / 'supabase/migrations').glob('*.sql')))
    entries = validate_prior(expected_prior)
    paths = sorted(set(files + [root / canonical_prefix.CANONICAL_PATH, Path(__file__).resolve(), root / 'supabase/tests/native_fulfillment.test.sql', root / 'tests/controlled-drugs/owned_scheduler.py'] + [p for p in source.iterdir() if p.suffix in ('.py', '.sql', '.json')]))
    bound = {str(p.relative_to(root)): digest(p) for p in paths}
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    _save(folder, 'source-hashes.json', bound)
    spec = importlib.util.spec_from_file_location('stock_genuine_history_owner', source / 'run-native-history.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    assert owner.root.resolve() == root
    first = _era(187, files, entries, owner, cli_atomicity, history_environment, owned_scheduler, folder)
    second = _era(188, files, entries, owner, cli_atomicity, history_environment, owned_scheduler, folder)
    assert {str(p.relative_to(root)): digest(p) for p in paths} == bound, 'Historical helper inputs changed'
    proof = {'kind': 'controlled-stock-genuine-historical-upgrades-v1', 'passed': True, 'owned_runtimes_removed': True, 'source_hashes': bound, 'source_upgrade187': first, 'handoff_upgrade188': second}
    _save(folder, 'result.json', proof)
    return proof
