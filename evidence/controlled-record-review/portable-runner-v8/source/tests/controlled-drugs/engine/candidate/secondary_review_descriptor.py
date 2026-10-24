"""Finite Gate A DDL + independent metadata derivation; no database access.

Expected semantics are constructed here, never captured from an installation.
Reference realization is a separate renderer cross-check, not a reseal route.
This is a feasibility shell, not the subsequent review protocol descriptor.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FACADES = (
    'prepare_controlled_secondary_review', 'read_controlled_secondary_review',
    'execute_controlled_secondary_review', 'cancel_controlled_secondary_review',
    'read_controlled_secondary_review_event', 'list_controlled_secondary_reviews',
)
FUNCTION_NAMES = {'immutable_guard', 'preparation_context', 'required', 'require_prior_commit', 'snapshot'}
CONFIG = ['search_path=pg_catalog, public, pg_temp', 'TimeZone=UTC']
# Columns and named constraints are reviewed finite declarations, not SQL scraped
# from a live database. Constraint rendering is cross-checked on PostgreSQL 17.
TABLES = {
    'descriptor': {
        'columns': [('id', 'boolean', True), ('definition', 'jsonb', True)],
        'constraints': [
            ('descriptor_pkey', 'PRIMARY KEY (id)'),
            ('descriptor_singleton', 'CHECK (id)'),
        ],
    },
    'preparations': {
        'columns': [('operation_id', 'uuid', True), ('event_id', 'uuid', True),
                    ('prepared_boot', 'timestamp with time zone', True), ('prepared_xid', 'xid8', True)],
        'constraints': [
            ('preparations_pkey', 'PRIMARY KEY (operation_id)'),
            ('preparations_target_fk', 'FOREIGN KEY (event_id) REFERENCES controlled_stock_events(id) ON DELETE RESTRICT'),
        ],
    },
}


def _acl(privileges):
    return [{'grantee': 'postgres', 'grantor': 'postgres', 'privilege': p, 'grantable': False}
            for p in sorted(privileges)]


def _function_metadata(body, result, language, argument):
    return dict(source=body, owner='postgres', language=language, return_type=result,
                kind='f', security_definer=False, strict=False, leakproof=False,
                volatility='v', parallel='u', returns_set=False, cost=100, rows=0,
                configuration=CONFIG, argument_names=[argument.split()[0]] if argument else None,
                all_argument_types=None, argument_modes=None, default_count=0,
                defaults=None, variadic='-', support='-', sql_body=None, acl=_acl(['EXECUTE']))


def build():
    source = (ROOT / 'secondary-review.sql').read_bytes()
    text = source.decode()
    matches = list(re.finditer(r'^-- BEGIN FUNCTION ([a-z_]+)\|([a-z0-9]+)\|([a-z]+)(?:\|([^\n]+))?\n(.*?)^-- END FUNCTION$', text, re.M | re.S))
    assert {m[1] for m in matches} == FUNCTION_NAMES and len(matches) == len(FUNCTION_NAMES)
    residual = re.sub(r'^-- BEGIN FUNCTION .*?^-- END FUNCTION$', '', text, flags=re.M | re.S)
    assert all(not line.strip() or line.startswith('--') for line in residual.splitlines()), 'Unreviewed SQL outside finite function bodies'
    expected = {'kind': 'controlled-review-gate-a-v1',
                'schema': {'owner': 'postgres', 'acl': _acl(['CREATE', 'USAGE'])},
                'functions': {}, 'relations': {}, 'relation_inventory': [], 'types': [], 'other_objects': [], 'foreign_key_triggers': [], 'facade_objects': []}
    # Presence refusal is separate from CREATE failures: no adoption or repair.
    names = ','.join("'" + n + "'" for n in FACADES)
    ddl = [f"""do $admission$ begin
 if exists(select 1 from pg_namespace where nspname='controlled_review') or
    exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in({names})) or
    exists(select 1 from pg_class where relnamespace='public'::regnamespace and relname in({names})) or
    exists(select 1 from pg_type where typnamespace='public'::regnamespace and typname in({names})) then
  raise exception 'Secondary-review package must be wholly absent' using errcode='23514';
 end if;
end $admission$;""",
           'create schema controlled_review authorization postgres;',
           'revoke all on schema controlled_review from public,anon,authenticated,service_role;']
    for name, spec in TABLES.items():
        cols = [f'{n} {t}' + (' not null' if required else '') for n, t, required in spec['columns']]
        ddl_constraints = []
        for constraint, definition in spec['constraints']:
            ddl_constraints.append('constraint ' + constraint + ' ' + definition.replace('REFERENCES controlled_stock_events', 'REFERENCES public.controlled_stock_events'))
        ddl += ['create table controlled_review.' + name + '(' + ','.join(cols + ddl_constraints) + ');',
                f'alter table controlled_review.{name} enable row level security;',
                f'revoke all on controlled_review.{name} from public,anon,authenticated,service_role;']
        key = 'id' if name == 'descriptor' else 'operation_id'
        index = f'CREATE UNIQUE INDEX {name}_pkey ON controlled_review.{name} USING btree ({key})'
        expected['relations'][name] = dict(
            kind='r', owner='postgres', persistence='p', rls=True, force_rls=False, replica_identity='d', options=None,
            acl=_acl(['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']),
            columns=[dict(name=n, type=t, not_null=required, identity='', generated='', default=None, collation='-', column_acl=[])
                     for n, t, required in spec['columns']],
            constraints=[dict(name=c, definition=d, validated=True) for c, d in sorted(spec['constraints'])],
            indexes=[dict(definition=index, valid=True, ready=True, live=True, primary=True, unique=True, exclusion=False, immediate=True)],
            triggers=[], policies=[], rules=[])
        expected['relation_inventory'] += [dict(name=name, kind='r'), dict(name=name + '_pkey', kind='i')]
        expected['types'] += [dict(name=name, kind='c', owner='postgres', relation=name, element=None, acl=None),
                              dict(name='_' + name, kind='b', owner='postgres', relation=None, element=name, acl=None)]
    function_specs = [(m[1], m[2], m[3], m[4] or '', '\n' + m[5]) for m in matches]
    for name in FACADES:
        function_specs.append(('public.' + name, 'jsonb', 'plpgsql', 'p_request jsonb',
                               "\nbegin\n perform controlled_review.required();\n raise exception 'Gate A feasibility shell; review protocol is not installed' using errcode='0A000';\nend\n"))
    for name, result, language, argument, body in function_specs:
        qualified = name if name.startswith('public.') else 'controlled_review.' + name
        signature = qualified + '(' + argument + ')'
        ddl += [f'create function {signature} returns {result}\nlanguage {language} volatile set search_path=pg_catalog,public,pg_temp set timezone=\'UTC\' as $body$' + body + '$body$;',
                f'revoke all on function {qualified}(' + (argument.split()[-1] if argument else '') + ') from public,anon,authenticated,service_role;']
        expected['functions'][signature] = _function_metadata(body, result, language, argument)
    for name in TABLES:
        triggers = [('immutable', 'BEFORE DELETE OR UPDATE', 'FOR EACH ROW', 'immutable_guard'),
                    ('no_truncate', 'BEFORE TRUNCATE', 'FOR EACH STATEMENT', 'immutable_guard')]
        if name == 'preparations':
            triggers.append(('server_context', 'BEFORE INSERT', 'FOR EACH ROW', 'preparation_context'))
        for trigger, timing, each, function in triggers:
            statement = f'CREATE TRIGGER {trigger} {timing} ON controlled_review.{name} {each} EXECUTE FUNCTION controlled_review.{function}()'
            ddl.append(statement + ';')
            expected['relations'][name]['triggers'].append(dict(name=trigger, enabled='O', definition=statement))
        expected['relations'][name]['triggers'].sort(key=lambda t: t['name'])
    expected['relation_inventory'].sort(key=lambda r: r['name'])
    expected['types'].sort(key=lambda t: t['name'])
    for relation, other, function, trigger_type in (
        ('controlled_review.preparations', 'public.controlled_stock_events', 'RI_FKey_check_ins', 5),
        ('controlled_review.preparations', 'public.controlled_stock_events', 'RI_FKey_check_upd', 17),
        ('public.controlled_stock_events', 'controlled_review.preparations', 'RI_FKey_noaction_upd', 17),
        ('public.controlled_stock_events', 'controlled_review.preparations', 'RI_FKey_restrict_del', 9),
    ):
        expected['foreign_key_triggers'].append(dict(
            constraint='preparations_target_fk', relation=relation, function='pg_catalog.' + function,
            constraint_relation=other, type=trigger_type, enabled='O', internal=True,
            deferrable=False, initially_deferred=False, argument_count=0, arguments='',
            columns='', condition=None, old_table=None, new_table=None))
    literal = json.dumps(expected, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    insert = "insert into controlled_review.descriptor(id,definition) values(true,$expected$" + literal + "$expected$::jsonb);"
    return {'ddl': '\n'.join(ddl), 'expected': expected, 'descriptor_insert': insert,
            'snapshot_sql': 'select controlled_review.snapshot();',
            'source_hashes': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in (ROOT / 'secondary-review.sql', Path(__file__))},
            'expected_sha256': hashlib.sha256(literal.encode()).hexdigest()}


if __name__ == '__main__':
    # Inspect only. No CLI can capture or replace the expected descriptor.
    print(json.dumps(build(), sort_keys=True, indent=2))
