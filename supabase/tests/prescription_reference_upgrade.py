"""Exercise additive6500 against populated canonical6300 in an owned scratch DB."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
migrations = root / 'supabase/migrations'
files = sorted(migrations.glob('*.sql'))
assert len(files) == 85
assert len([p for p in files if not p.name.startswith('20260913650000')]) == 84
old = (migrations / '20260913630000_record_release_prescription_history.sql').read_text()
old = old[old.index('create function public.ezyvet_validate_reviewed_prescriptions'):old.index('create function public.release_preview_v8_internal')]
old = old.replace('create function', 'create or replace function', 1)
new = (migrations / '20260913650000_prescription_release_reference_hardening.sql').read_text()
test = (root / 'supabase/tests/ezyvet_prescription_release_reference.test.sql').read_text()
# Populate an approved review using canonical schema8 before applying additive6500.
test = test.replace('-- FIXTURE_BEGIN:', old + '\n-- FIXTURE_BEGIN:', 1)
boundary = "insert into data select 'refs'"
capture = """
create temp table upgrade_rows(name text primary key,rows jsonb);
do $capture$ declare t record;begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') loop
  execute format('insert into upgrade_rows select %L,coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',t.relname,t.relname);
 end loop;
end $capture$;
create temp table upgrade_routines as select oid,pg_get_functiondef(oid) definition,proacl from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname<>'ezyvet_validate_reviewed_prescriptions';
"""
verify = """
do $verify$ declare t record;actual jsonb;begin
 for t in select * from upgrade_rows loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',t.name) into actual;
  if actual is distinct from t.rows then raise exception 'Upgrade changed table %',t.name;end if;
 end loop;
end $verify$;
select ok(not exists(select 1 from upgrade_routines u full join (select oid,pg_get_functiondef(oid) definition,proacl from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname<>'ezyvet_validate_reviewed_prescriptions') p using(oid) where row(u.definition,u.proacl) is distinct from row(p.definition,p.proacl)),'Additive upgrade preserves every unrelated function and its grants');
select ok((select count(*) from ezyvet_imported_prescriptions)>0,'Upgrade preserved populated approved prescription evidence');
"""
test = test.replace(boundary, capture + new + verify + boundary, 1)
with tempfile.TemporaryDirectory(prefix='lrv-reference-upgrade-') as directory:
    fixture = Path(directory) / 'upgrade.sql'
    fixture.write_text(test)
    subprocess.run(['python3',str(root/'supabase/tests/ezyvet_prescription_review_concurrency.py'),'--sql-only','--extra-sql-test',str(fixture)],cwd=root,check=True)
print('PASS: populated canonical84-to85 additive upgrade, exact table rows and unrelated functions/grants preserved; owned scratch DB cleaned.')
