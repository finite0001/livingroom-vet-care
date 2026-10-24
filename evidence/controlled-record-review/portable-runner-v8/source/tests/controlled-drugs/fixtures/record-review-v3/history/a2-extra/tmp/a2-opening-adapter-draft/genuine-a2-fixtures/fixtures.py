"""Fixed, pure compilation of five-product genuine188 A2 positive fixtures.
No runtime, Docker, subprocess, network, CLI execution or candidate write API.
"""
from pathlib import Path
from hashlib import sha256
import json
import uuid
HERE=Path(__file__).resolve().parent
PRODUCTS=('plain','clinical_prefix','operational_prefix','split','pickup')
NS=uuid.UUID('a2f20000-0000-4000-8000-000000000001')
ROOT_KEYS=('actor','config','session','site','location')
PRODUCT_KEYS=('draft','save','sign','invoice','dispense','receive1','receive2','lot1','lot2','old_correction',
 'controlled_draft','controlled_review','policy','opening','frozen','active','stock1','stock2','prepared1','prepared2',
 'stockcell1','stockcell2','preparedcell1','preparedcell2')
TARGETS=(
 ('O_plain_clinical','plain','clinical_annotation','opening_custody_site',None,None,1),
 ('O_plain_operational','plain','operational_annotation','opening_custody_site',None,None,2),
 ('O_retained_clinical_prefix','clinical_prefix','clinical_annotation','opening_custody_site',None,None,1),
 ('O_retained_operational_prefix','operational_prefix','operational_annotation','opening_custody_site',None,None,1),
 ('O_split_same_site','split','clinical_annotation','opening_custody_site',None,None,1),
 ('K_managed_pickup_of_188_package','pickup','pickup','event_transitions','pickup.dispense',None,1),
 ('K_first_amendment','pickup','pickup_amendment','managed_pickup',None,None,2),
 ('K_second_amendment','pickup','pickup_amendment','managed_pickup',None,'K_first_amendment',3),
)
WITNESS='O_plain_later_clinical_witness'
FIXED={k:str(uuid.uuid5(NS,k)) for k in (*ROOT_KEYS,*(p+'.'+k for p in PRODUCTS for k in PRODUCT_KEYS),
 'split.prepared_half','split.prepared_zero','split.preparedcell_half','split.preparedcell_zero',*(x[0] for x in TARGETS),WITNESS)}
DYNAMIC={'client','pet'}|{p+'.'+k for p in PRODUCTS for k in ('product','allocation1','allocation2','movement1','movement2','charge')}
ID_KEYS=set(FIXED)|DYNAMIC

def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def literal(v):return "'"+str(v).replace("'","''")+"'"
def read(name):return (HERE/name).read_text()
def sql_ids(ids):return ',\n'.join('('+literal(k)+','+literal(v)+'::uuid)' for k,v in sorted(ids.items()))
def admit_ids(ids):
 assert type(ids)is dict and set(ids)==ID_KEYS,'Exact complete fixed A2 seed ID set required'
 assert all(type(v)is str and str(uuid.UUID(v))==v and uuid.UUID(v).int for v in ids.values())
 assert {k:ids[k] for k in FIXED}==FIXED
 for keys in ([p+'.product' for p in PRODUCTS],[p+'.lot'+str(n) for p in PRODUCTS for n in (1,2)],
              [p+'.allocation'+str(n) for p in PRODUCTS for n in (1,2)],[p+'.movement'+str(n) for p in PRODUCTS for n in (1,2)]):
  assert len({ids[k] for k in keys})==len(keys),'Fixture products/lots/allocations/movements must remain distinct'
 return ids

def temp_setup(ids):
 return """begin; set local timezone='UTC'; set local search_path=public,pg_temp;
create temp table a2_ids(k text primary key,id uuid not null);
insert into a2_ids values """+sql_ids(ids)+""";
create function pg_temp.a2_id(p_key text) returns uuid language sql stable as $$select id from pg_temp.a2_ids where k=p_key$$;
"""+read('identity.sql')+"select pg_temp.a2_identity('ordinary');\ncommit;\n"

def begin(mode):
 s="begin; set local timezone='UTC'; set local search_path=public,pg_temp;\nselect pg_temp.a2_identity('ordinary');\n"
 if mode=='historical_writer':s+="set local role authenticated;\n"
 if mode!='ordinary':
  s+="select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.a2_id('actor'),'role','authenticated')"+("||jsonb_build_object('session_id',pg_temp.a2_id('session'))" if mode=='controlled_owner' else '')+"::text,true);\n"
  # Parenthesize JSON concatenation before ::text for exact expression semantics.
  if mode=='controlled_owner':s=s.replace("jsonb_build_object('sub'","(jsonb_build_object('sub'").replace("('session'))::text","('session')))::text")
  s+="select pg_temp.a2_identity('"+mode+"');\n"
 return s

def end(mode):
 return "select pg_temp.a2_identity('"+mode+"');\n"+("reset role;\n" if mode=='historical_writer' else '')+"set constraints all immediate;\ncommit;\nselect pg_temp.a2_identity('ordinary');\n"

def seed_stages():
 setup=temp_setup(FIXED)+begin('ordinary')+"""do $$begin
 if to_regclass('public.stock_pickup_sources') is not null or to_regclass('public.stock_correction_sources') is not null
 or to_regclass('public.stock_movement_sources') is null or to_regclass('public.stock_custody_sources') is null
 or to_regclass('public.stock_discrepancy_sources') is null or to_regclass('public.controlled_stock_openings') is not null then
 raise exception 'A2 seed requires exact canonical188 source era' using errcode='23514';end if;end$$;
create temp table a2_data(k text primary key,v jsonb not null);
grant select,insert,update on a2_ids,a2_data to authenticated;
"""
 body=read('seed-setup.sql').replace('__ACTOR__',FIXED['actor'])
 marker='-- AUTHENTICATED_SETUP --';assert body.count(marker)==1
 a,b=body.split(marker)
 setup+=a+"set local role authenticated;\nselect set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.a2_id('actor'),'role','authenticated')::text,true);\nselect pg_temp.a2_identity('historical_writer');\n"+b+end('historical_writer')
 stages=[('seed_setup',setup)]
 for label in PRODUCTS:
  body=read('seed-product.sql').replace('__LABEL__',label)
  at=body.index("insert into a2_ids select '"+label+".allocation")
  writers,ids=body[:at],body[at:]
  if label in ('clinical_prefix','operational_prefix'):
   kind='clinical_annotation' if label=='clinical_prefix' else 'operational_annotation'
   writers+=correction(label,label+'.old_correction',kind,None,False)
  sql=begin('historical_writer')+writers+"select pg_temp.a2_identity('historical_writer');\nreset role;\n"+ids+"set constraints all immediate;commit;\nselect pg_temp.a2_identity('ordinary');\n"
  stages.append(('seed_'+label,sql))
 stages[-1]=(stages[-1][0],stages[-1][1]+"select jsonb_build_object('kind','a2-five-product188-seed-v1','ids',(select jsonb_object_agg(k,id order by k collate \"C\")from a2_ids),'backend_pid',pg_backend_pid(),'backend_start',(select backend_start from pg_stat_activity where pid=pg_backend_pid()),'business_calls',17,'supporting_calls',23,'source_rows_fabricated',false,'provenance_backfilled',false);\n")
 return tuple(stages)

def correction(product,target,kind,predecessor,controlled):
 p=literal(product);t=literal(target);k=literal(kind);pred="null" if predecessor is None else "pg_temp.a2_id("+literal(predecessor)+")"
 request="""jsonb_build_object('authorization_id',pg_temp.a2_id({p}||'.sign'),'pet_id',pg_temp.a2_id('pet'),
 'dispense_id',pg_temp.a2_id({p}||'.dispense'),'kind',{k},'expected_context_hash',preview->>'context_hash',
 'expected_head',preview#>'{{context,head}}','reason','Synthetic A2 positive source fixture','note','Synthetic engineering assertion only',
 'amends_event_id',{pred},'pickup_amendment',""".format(p=p,k=k,pred=pred)
 request+=("jsonb_build_object('original_pickup_id',pg_temp.a2_id('K_managed_pickup_of_188_package'),'disposition','recorded_in_error','handoff',null)" if kind=='pickup_amendment' else 'null')+",'attest_review',true)"
 if controlled:call="pg_temp.a2_controlled_annotation("+p+","+t+","+request+")"
 else:call="public.append_native_dispense_correction(pg_temp.a2_id("+t+"),"+request+")"
 return "select "+call+" from(select public.preview_native_dispense_correction(pg_temp.a2_id("+p+"||'.sign'),pg_temp.a2_id('pet'),pg_temp.a2_id("+p+"||'.dispense'))preview)source;\n"

def post_setup(ids):
 admit_ids(ids)
 sql=temp_setup(ids)+begin('ordinary')+"insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.a2_id('session'),pg_temp.a2_id('actor'),clock_timestamp(),clock_timestamp());\n"+end('ordinary')
 cells=[]
 for p in PRODUCTS:
  for n in (1,2):
   cells.append((p+'.stockcell'+str(n),p,p+'.stock'+str(n),n,None,'available','2.000'))
   cells.append((p+'.preparedcell'+str(n),p,p+'.prepared'+str(n),n,n,'prepared','0.500' if p=='split' and n==1 else '1.000'))
 cells.extend([('split.preparedcell_half','split','split.prepared_half',1,1,'prepared','0.500'),('split.preparedcell_zero','split','split.prepared_zero',1,1,'prepared','0.000')])
 def values(rows):return ',\n'.join('('+','.join('null' if x is None else str(x) if type(x)is int else literal(x) for x in row)+')'for row in rows)
 targets=[(*row,index) for index,row in enumerate(TARGETS,1)]
 body=read('post-setup.sql').replace('__CELL_VALUES__',values(cells)).replace('__TARGET_VALUES__',values(targets))
 sql+=begin('ordinary')+body+end('ordinary')
 sql+=begin('controlled_owner')+"""select public.controlled_stock_exclusive();
insert into controlled_stock_sites(id,label,registration_evidence,actor_id,session_id)
 values(pg_temp.a2_id('site'),'SYNTHETIC A2 SITE','{"synthetic":true}',auth.uid(),pg_temp.a2_id('session'));
insert into controlled_stock_locations(id,site_id,kind,label,initial_custodian_id,actor_id,session_id)
 values(pg_temp.a2_id('location'),pg_temp.a2_id('site'),'clinic','SYNTHETIC A2 LOCATION',auth.uid(),auth.uid(),pg_temp.a2_id('session'));
"""+end('controlled_owner')
 return sql

def opening_stages():
 return tuple(('opening_'+p,begin('controlled_owner')+read('opening.sql').replace('__LABEL__',p).replace('__PREFIX__','1' if p in ('clinical_prefix','operational_prefix') else '0')+end('controlled_owner')) for p in PRODUCTS)

def action_stages():
 out=[]
 for label,p,kind,basis,family,pred,seq in TARGETS[:7]:
  body=read('pickup.sql') if kind=='pickup' else correction(p,label,kind,pred,True)
  out.append(('target_'+label,begin('controlled_owner')+body+end('controlled_owner')))
 return tuple(out)

def later_stage():
 return begin('controlled_owner')+correction('pickup','K_second_amendment','pickup_amendment','K_first_amendment',True)+correction('plain',WITNESS,'clinical_annotation','O_plain_clinical',True)+end('controlled_owner')

def oracle_setup():return begin('ordinary')+read('oracle.sql')+end('ordinary')
def verify_sql(after=False):
 assert type(after)is bool
 # Fixed two inventories; no arbitrary optional target/case profile.
 return begin('ordinary')+"select pg_temp.a2_verify("+('true' if after else 'false')+");\n"+end('ordinary')

def parse_seed(text):
 rows=[json.loads(s) for s in text.splitlines() if s.startswith('{')]
 rows=[r for r in rows if type(r)is dict and r.get('kind')=='a2-five-product188-seed-v1'];assert len(rows)==1
 r=rows[0];assert set(r)=={'kind','ids','backend_pid','backend_start','business_calls','supporting_calls','source_rows_fabricated','provenance_backfilled'}
 admit_ids(r['ids']);assert type(r['backend_pid'])is int and r['backend_pid']>0 and type(r['backend_start'])is str and r['backend_start']
 assert type(r['business_calls'])is int and r['business_calls']==17 and type(r['supporting_calls'])is int and r['supporting_calls']==23
 assert r['source_rows_fabricated'] is False and r['provenance_backfilled'] is False
 return r

SOURCE=HERE.parents[2]
SOURCES=('fixtures.py','identity.sql','seed-setup.sql','seed-product.sql','post-setup.sql','opening.sql','pickup.sql','oracle.sql','history-oracle.sql','test_fixtures.py','declaration.json')
def source_inputs():
 declaration=json.loads(read('declaration.json'));out={str(HERE/name):sha256((HERE/name).read_bytes()).hexdigest()for name in SOURCES}
 for rel,expected in declaration['source_authorities'].items():
  path=SOURCE/rel;actual=sha256(path.read_bytes()).hexdigest();assert actual==expected,'A2 fixture authority changed: '+rel;out[str(path)]=actual
 return out

HISTORY_TABLES=('auth.users','profiles','user_roles','native_prescriber_configurations','native_prescription_draft_revisions','clients','pets','catalog_products',
 'native_prescription_authorizations','native_prescription_drafts','native_prescription_authorization_events','native_fill_slots','native_dispenses','native_dispense_allocations',
 'native_fulfillment_events','native_fulfillment_operations','native_dispense_correction_events','native_dispense_correction_operations','inventory_lots','inventory_movements',
 'native_prescription_operations','billing_invoices','billing_invoice_items','stock_movement_sources','stock_custody_sources','stock_discrepancy_sources','native_pickups',
 'native_slot_closures','native_return_events','native_return_discrepancy_events','stock_writer_admissions')

def history_sql(seed_receipt):
 r=parse_seed(canonical(seed_receipt));sql=temp_setup(r['ids'])+begin('ordinary')+read('history-oracle.sql').replace('__SEED_PID__',str(r['backend_pid']))+end('ordinary')
 return sql+"begin read only;set local timezone='UTC';select jsonb_build_object('kind','a2-history-source-oracle-v1','ids',(select jsonb_object_agg(k,id order by k collate \"C\")from a2_ids),'membership',pg_temp.a2_history_assertions(),'relations',(select jsonb_object_agg(name,pg_temp.a2_history_rows(name)order by name collate \"C\")from unnest(array["+','.join(map(literal,HISTORY_TABLES))+"])name));commit;\n"

def preserved(before,after,seed):
 seed=parse_seed(canonical(seed));expected={'products':5,'lots':10,'movements':20,'movement_sources':20,'allocations':10,'dispenses':5,'charges':5,'old_corrections':2,
 'closed_seed_backend':seed['backend_pid'],'retroactive_membership':False,'new_pickup_correction_provenance':False}
 for result in (before,after):
  assert type(result)is dict and set(result)=={'kind','ids','membership','relations'} and result['kind']=='a2-history-source-oracle-v1'
  assert result['ids']==seed['ids'] and result['membership']==expected
  assert all(type(result['membership'][k])is type(v) for k,v in expected.items())
  assert type(result['relations'])is dict and set(result['relations'])==set(HISTORY_TABLES)
  for rel in result['relations'].values():
   assert type(rel)is dict and set(rel)=={'columns','rows'} and type(rel['columns'])is list and rel['columns']
   assert all(type(c)is dict and set(c)=={'name','type'} and type(c['name'])is str and c['name'] and type(c['type'])is str and c['type'] for c in rel['columns'])
   cols={c['name']:c['type'] for c in rel['columns']};assert len(cols)==len(rel['columns'])
   assert type(rel['rows'])is list and len(rel['rows'])<=1000
   assert all(type(row)is dict and set(row)==set(cols) for row in rel['rows'])
   assert len({canonical(row)for row in rel['rows']})==len(rel['rows'])
 for name in HISTORY_TABLES:
  old=before['relations'][name];new=after['relations'][name];columns={c['name']:c['type']for c in old['columns']};new_columns={c['name']:c['type']for c in new['columns']}
  assert all(new_columns.get(k)==v for k,v in columns.items()),'Original historical column/type changed'
  assert sorted(canonical(row)for row in old['rows'])==sorted(canonical({k:row[k]for k in columns})for row in new['rows']),'Original historical rows changed'
 return {'original31_relations_preserved':True,'exact_historical_membership_preserved':True,'new_columns_retained':{name:[c for c in after['relations'][name]['columns']if c not in before['relations'][name]['columns']]for name in HISTORY_TABLES}}
