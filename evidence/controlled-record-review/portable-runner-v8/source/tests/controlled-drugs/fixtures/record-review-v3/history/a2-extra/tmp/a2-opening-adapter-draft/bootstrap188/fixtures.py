"""Fixed SQL compilation and independent old-column conservation admission."""
import json
import uuid
from pathlib import Path
import admission
HERE=Path(__file__).resolve().parent
FIXED={
 'actor':'a2180000-0000-4000-8000-000000000001','config':'a2180000-0000-4000-8000-000000000002',
 'draft':'a2180000-0000-4000-8000-000000000003','save':'a2180000-0000-4000-8000-000000000004',
 'sign':'a2180000-0000-4000-8000-000000000005','invoice':'a2180000-0000-4000-8000-000000000006',
 'dispense':'a2180000-0000-4000-8000-000000000007','correction':'a2180000-0000-4000-8000-000000000008',
 'receive1':'a2180000-0000-4000-8000-000000000009','receive2':'a2180000-0000-4000-8000-00000000000a',
 'lot1':'b2180000-0000-4000-8000-000000000001','lot2':'b2180000-0000-4000-8000-000000000002'}
ID_KEYS=set(FIXED)|{'client','pet','product'}
TABLES={'auth.users','profiles','user_roles','native_prescriber_configurations','native_prescription_draft_revisions','clients','pets','catalog_products','native_prescription_authorizations','native_prescription_drafts',
 'native_prescription_authorization_events','native_fill_slots','native_dispenses','native_dispense_allocations',
 'native_fulfillment_events','native_fulfillment_operations','native_dispense_correction_events','native_dispense_correction_operations',
 'inventory_lots','inventory_movements','native_prescription_operations','billing_invoices','billing_invoice_items',
 'stock_movement_sources','stock_custody_sources','stock_discrepancy_sources','native_pickups','native_slot_closures',
 'native_return_events','native_return_discrepancy_events','stock_writer_admissions'}

def seed():return (HERE/'fixture.sql').read_text()
def parse(text,kind):
    values=[]
    for line in text.splitlines():
        if not line.startswith('{'):continue
        value=json.loads(line,object_pairs_hook=admission.unique)
        if isinstance(value,dict) and value.get('kind')==kind:values.append(value)
    assert len(values)==1,'Exactly one primary structured receipt required'
    return values[0]
def admit_ids(ids):
    assert isinstance(ids,dict) and set(ids)==ID_KEYS
    assert len(set(ids.values()))==len(ids)
    assert all(type(value)is str and str(uuid.UUID(value))==value for value in ids.values())
    assert {key:ids[key] for key in FIXED}==FIXED
    return ids

def receipt(text):
    value=parse(text,'fixed188-genuine-fixture-v1')
    assert set(value)=={'kind','ids','session_user','current_user','role','replication_role','backend_pid','backend_start',
                        'historical_rows_fabricated','provenance_backfilled','business_calls','supporting_calls'}
    admit_ids(value['ids'])
    assert (value['session_user'],value['current_user'],value['role'],value['replication_role'])==('postgres','postgres','none','origin')
    assert value['historical_rows_fabricated'] is False and value['provenance_backfilled'] is False
    assert type(value['business_calls']) is int and value['business_calls']==4
    assert type(value['supporting_calls']) is int and value['supporting_calls']==7
    assert type(value['backend_pid']) is int and value['backend_pid']>0 and type(value['backend_start']) is str and value['backend_start']
    return value

def oracle(ids):
    admit_ids(ids)
    sql=(HERE/'oracle.sql').read_text();assert sql.count('__FIXED188_IDS__')==2 # explanatory comment + SQL token
    return sql.replace('__FIXED188_IDS__',"'"+admission.canonical(ids).replace("'","''")+"'")

def admit_observation(value,ids,backend_pid):
    admit_ids(ids)
    assert isinstance(value,dict) and set(value)=={'kind','membership','relations'} and value['kind']=='fixed188-source-oracle-v1'
    assert type(backend_pid)is int and backend_pid>0
    expected={'admission_backend_pid':backend_pid,'dispense_id':ids['dispense'],'correction_id':ids['correction'],'movement_count':4,'allocation_count':2,
              'charge_count':1,'pickup_sources':0,'correction_sources':0,'backfilled':False,'opening_or_controlled_event_count':0}
    assert value['membership']==expected
    for key in ('admission_backend_pid','movement_count','allocation_count','charge_count','pickup_sources','correction_sources','opening_or_controlled_event_count'):
        assert type(value['membership'][key]) is int
    assert value['membership']['backfilled'] is False
    relations=value['relations'];assert isinstance(relations,dict) and set(relations)==TABLES
    for name,table in relations.items():
        assert isinstance(table,dict) and set(table)=={'columns','rows'}
        cols=table['columns'];rows=table['rows']
        assert type(cols)is list and cols and all(type(c)is dict and set(c)=={'name','type'} and type(c['name'])is str and c['name'] and type(c['type'])is str and c['type'] for c in cols)
        names=[c['name'] for c in cols];assert len(names)==len(set(names))
        assert type(rows)is list and len(rows)<=1000
        assert all(type(row)is dict and set(row)==set(names) for row in rows)
        # Full ordered source rows do not depend on this process's JSON lexical
        # order; equality below compares independently canonicalized row sets.
        assert len({admission.canonical(row) for row in rows})==len(rows),'Duplicate full source row'
    return value

def preserved(before,after,ids,backend_pid):
    admit_observation(before,ids,backend_pid);admit_observation(after,ids,backend_pid)
    assert before['membership']==after['membership']
    for name in sorted(TABLES):
        old=before['relations'][name];new=after['relations'][name]
        cols={c['name']:c['type'] for c in old['columns']};newcols={c['name']:c['type'] for c in new['columns']}
        assert all(newcols.get(k)==v for k,v in cols.items()),'Original source column missing or changed type: '+name
        expected=sorted(admission.canonical(row) for row in old['rows'])
        actual=sorted(admission.canonical({k:row[k] for k in cols}) for row in new['rows'])
        assert expected==actual,'Original full rows/keyset changed across suffix: '+name
    return {'original_column_rows_preserved':True,'exact_membership_preserved':True,'relations':len(TABLES),
            'new_columns_retained':{name:[c for c in after['relations'][name]['columns'] if c not in before['relations'][name]['columns']] for name in sorted(TABLES)}}


def raw188_sql():
    import canonical_post206 as observations
    return "set timezone='UTC';\n"+observations.CATALOG_SQL+observations.ROWS_SQL+"select jsonb_build_object('catalog',pg_temp.review_cli_catalog(),'rows',pg_temp.review_cli_rows(),'ledger',(select jsonb_agg(to_jsonb(m)order by version)from supabase_migrations.schema_migrations m));\n"
