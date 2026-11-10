"""Isolated SQL acceptance for source catalog setup; never connects to hosted DBs."""
from pathlib import Path
import json
import re
import subprocess
import uuid
import time
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
NAME = 'lrv-catalog-setup-' + uuid.uuid4().hex[:10]

def run(args, **kw):
    result = subprocess.run(args, text=True, capture_output=True, **kw)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args, result.stdout, result.stderr)
    return result.stdout

def sql(query):
    return run(['docker', 'exec', '-i', NAME, 'psql', '-U', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=query).strip()

# Compare every source field to the unchanged Excel export, independently of SQL.
items = json.loads((ROOT / 'docs/inventory/catalog-source.json').read_text())
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(ROOT / 'docs/inventory/living-room-vet-inventory-2026-11-10.xlsx') as z:
    strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
    tabs = ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', ns)
    expected = []
    for i, tab in enumerate(tabs, 1):
        headers = {}
        for row in ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')).findall('s:sheetData/s:row', ns):
            values = {}
            for cell in row:
                col = re.sub('[0-9]', '', cell.get('r'))
                value = cell.find('s:v', ns)
                values[col] = strings[int(value.text)] if value is not None and cell.get('t') == 's' else value.text if value is not None else ''
            if row.get('r') == '1':
                headers = values
            elif any(values.values()):
                expected.append((tab.get('name'), int(row.get('r')), values['A'], {headers[k]: v for k, v in values.items() if k in headers}))
assert [(i['source_tab'], i['source_row'], i['name'], i['source_fields']) for i in items] == expected

try:
    run(['docker', 'run', '--rm', '-d', '--name', NAME, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    for _ in range(100):
        try:
            if 'PostgreSQL init process complete' not in run(['docker', 'logs', NAME]):
                time.sleep(0.3)
                continue
            sql('select 1')
            break
        except subprocess.CalledProcessError:
            time.sleep(0.3)
    else:
        raise RuntimeError('Disposable PostgreSQL did not finish startup')
    core = (ROOT / 'supabase/migrations/20260913000000_inventory_billing.sql').read_text()
    reads = (ROOT / 'supabase/migrations/20260913030000_inventory_read_models.sql').read_text()
    table = re.search(r'create table public.catalog_products \(.*?\n\);', core, re.S).group()
    creator = re.search(r'create function public.create_inventory_product\(.*?end \$\$;', reads, re.S).group()
    # Minimal staff/auth/audit fixtures; exercise the real catalog table and creator.
    sql('''create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function public.is_active_staff(actor uuid) returns boolean language sql as $$ select actor='8259ab86-0992-4344-bea3-71c9cbba0f2b'::uuid $$;
      create function public.clinical_require_staff() returns uuid language plpgsql as $$begin if not coalesce(public.is_active_staff(auth.uid()),false) then raise exception 'Staff required' using errcode='42501';end if; return auth.uid();end$$;
      create table audit_fixture(id uuid,actor uuid);
      create function public.audit_trigger_fn() returns trigger language plpgsql as $$begin insert into public.audit_fixture values(NEW.id,auth.uid());return NEW;end$$;
      grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
      insert into auth.users values('8259ab86-0992-4344-bea3-71c9cbba0f2b');
    ''' + table + creator)
    migration = next((ROOT / 'supabase/migrations').glob('*_susan_inventory_catalog_setup.sql'))
    sql(migration.read_text())
    assert sql('select count(*) from public.catalog_source_items') == '217'
    assert sql('select count(*) from public.catalog_products') == '0'
    actor = '8259ab86-0992-4344-bea3-71c9cbba0f2b'
    prefix = f"set role authenticated;select set_config('request.jwt.claim.sub','{actor}',false);"
    source = items[0]['id']
    first, second = str(uuid.uuid4()), str(uuid.uuid4())
    def create(pid, name='Carprofen 25 mg tablet', source_id=source, actor_id=actor):
        return f"select (public.configure_catalog_source_item('{actor_id}','{source_id}','{pid}','{name}','medication','','tablet',125)).id;"
    sql(prefix + create(first) + create(first))
    assert sql('select count(*) from public.catalog_products') == '1'
    sql(prefix + create(second, 'Carprofen 75 mg tablet'))
    assert sql('select count(*) from public.catalog_source_products') == '2'
    result = sql(prefix + "select jsonb_array_length(search_catalog_source_items('Carprofen')->0->'products');")
    assert result.splitlines()[-1] == '2'
    errors = [
        prefix + create(first, 'Different metadata'),
        prefix + create(str(uuid.uuid4()), source_id=str(uuid.uuid4())),
        prefix + create(str(uuid.uuid4()), actor_id=str(uuid.uuid4())),
        prefix + "insert into public.catalog_source_products(source_id,product_id,created_by) select id,'" + first + "','" + actor + "' from public.catalog_source_items limit 1;",
        prefix + "update public.catalog_source_items set name='tampered';",
        "set role anon;select public.search_catalog_source_items('');",
        "set role authenticated;select set_config('request.jwt.claim.sub','34000000-0000-4000-8000-000000000099',false);select public.search_catalog_source_items('');",
    ]
    for query in errors:
        try:
            sql(query)
            raise AssertionError('Expected rejection')
        except subprocess.CalledProcessError:
            pass
    sql(prefix + f"select public.link_catalog_source_product('{actor}','{items[1]['id']}','{first}');" * 2)
    assert sql('select count(*) from public.catalog_source_products') == '3'
    assert sql('select count(*) from public.audit_fixture') == '3'
    assert sql('select count(*) from public.catalog_products') == '2'
    assert sql("select has_function_privilege('anon','public.configure_catalog_source_item(uuid,uuid,uuid,text,text,text,text,bigint)','execute')") == 'f'
    assert sql("select has_function_privilege('service_role','public.link_catalog_source_product(uuid,uuid,uuid)','execute')") == 'f'
    print('PASS: all 217 workbook rows match; no auto-created products; variants, retry, source linking, actor checks, direct-write denial, anonymous denial and audit verified.')
finally:
    subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True)
