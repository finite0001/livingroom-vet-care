"""Offline fixed-fixture, source-oracle and preservation regressions; no DB."""
import ast
import copy
import json
from pathlib import Path
import re
import socket
import subprocess
import unittest
from unittest.mock import patch
import uuid
import fixtures as f
from pglast import parse_sql,parse_plpgsql,parser
from pglast.stream import RawStream


def walk(node):
 if isinstance(node,dict):
  yield node
  for v in node.values():yield from walk(v)
 elif isinstance(node,list):
  for v in node:yield from walk(v)

def test_seed():
 return {'kind':'a2-five-product188-seed-v1','ids':{**f.FIXED,**{k:str(uuid.uuid5(f.NS,'offline-'+k))for k in f.DYNAMIC}},'backend_pid':123,
 'backend_start':'offline fixture only','business_calls':17,'supporting_calls':23,'source_rows_fabricated':False,'provenance_backfilled':False}

def stages():
 seed=test_seed()
 return (*f.seed_stages(),('history',f.history_sql(seed)),('post_setup',f.post_setup(seed['ids'])),*f.opening_stages(),*f.action_stages(),
 ('oracle',f.oracle_setup()),('before',f.verify_sql()),('later',f.later_stage()),('after',f.verify_sql(True)))

def calls(sql):
 out=[]
 for x in walk(json.loads(parser.parse_sql_json(sql))):
  if 'FuncCall'in x:out.append('.'.join(n['String']['sval']for n in x['FuncCall']['funcname']))
 return out

def alias_collisions(sql):
 found=[]
 for unit in parse_plpgsql(sql):
  body=unit['PLpgSQL_function'];names={v['refname']for datum in body['datums']for k,v in datum.items()if k in('PLpgSQL_var','PLpgSQL_rec')};aliases=set()
  for node in walk(body):
   if 'PLpgSQL_expr'not in node:continue
   expr=node['PLpgSQL_expr'];q=expr['query'];mode=expr['parseMode']
   if mode==2:q='SELECT '+q
   elif mode in(3,4,5):
    match=re.fullmatch(r'\s*(?:[a-zA-Z_]\w*|"(?:[^"]|"")+")\s*(?::=|=)\s*(.*)',q,re.S)
    assert match,'Unknown assignment in audit';q='SELECT '+match[1]
   else:assert mode==0,'Unknown parser mode'
   for x in walk(json.loads(parser.parse_sql_json(q))):
    if 'aliasname'in x:aliases.add(x['aliasname'])
    if 'RangeVar'in x and 'alias'not in x['RangeVar']:aliases.add(x['RangeVar']['relname'])
  found.extend(names&aliases)
 return set(found)

class FixtureTests(unittest.TestCase):
 def test_pure_compilation_and_fixed_inventories(self):
  with patch.object(subprocess,'Popen',side_effect=AssertionError('No processes')),patch.object(socket,'socket',side_effect=AssertionError('No sockets')):
   sqls=stages()
  self.assertEqual(len(f.PRODUCTS),5);self.assertEqual(len(f.TARGETS),8)
  self.assertEqual(len(f.action_stages()),7);self.assertEqual(len(f.seed_stages()),6);self.assertEqual(len(f.opening_stages()),5)
  self.assertEqual(len({n for n,_ in sqls}),len(sqls))
  self.assertTrue(all('__LABEL__'not in s and '__PREFIX__'not in s and '__CELL_VALUES__'not in s for _,s in sqls))
  self.assertNotIn(f.WITNESS,[t[0]for t in f.TARGETS])
 def test_all_generated_sql_and_plpgsql_parse_required(self):
  counts=[(len(parse_sql(sql)),len(parse_plpgsql(sql)))for _,sql in stages()]
  self.assertGreater(sum(x for x,_ in counts),300);self.assertGreater(sum(y for _,y in counts),15)
  print('PARSER_COUNTS',sum(x for x,_ in counts),sum(y for _,y in counts))
 def test_alias_guard_covers_all_functions_and_actual_prior_negative(self):
  for name,sql in stages():
   with self.subTest(name=name):self.assertEqual(alias_collisions(sql),set())
  bad="create function bad()returns void language plpgsql as $$declare a record;begin if exists(select 1 from public.native_dispense_allocations a where a.id is not null)then null;end if;end$$;"
  self.assertEqual(alias_collisions(bad),{'a'})
  self.assertEqual(alias_collisions(bad.replace('declare a record','declare distinct_local record')),set())
 def test_append_baseline_compares_columns_to_distinct_local_values(self):
  sql=f.read('oracle.sql')
  query=re.search(r'not exists\((select 1 from a2_before_append b where .*?)\) then',sql).group(1)
  def equalities(text):
   pairs=[]
   for node in walk(json.loads(parser.parse_sql_json(text))):
    if 'A_Expr' not in node:continue
    expr=node['A_Expr']
    if expr['name']!=[{'String':{'sval':'='}}]:continue
    left=expr.get('lexpr',{}).get('ColumnRef',{}).get('fields',[])
    right=expr.get('rexpr',{}).get('ColumnRef',{}).get('fields',[])
    pairs.append((tuple(x['String']['sval'] for x in left),tuple(x['String']['sval'] for x in right)))
   return set(pairs)
  required={(('b',name),('v_'+name+'_packet',))for name in ('collected','adapted','expected')}
  self.assertTrue(required.issubset(equalities(query)))
  bad=query
  for name in ('collected','adapted','expected'):bad=bad.replace('v_'+name+'_packet',name)
  self.assertFalse(required.issubset(equalities(bad)))
  self.assertTrue({(('b',name),(name,))for name in ('collected','adapted','expected')}.issubset(equalities(bad)))
  verify=sql.split('create function pg_temp.a2_verify(p_after boolean)',1)[1]
  declarations=verify.split(';begin',1)[0]
  for name in ('collected','adapted','expected'):
   self.assertNotRegex(declarations,r'(?<![\w.])'+name+r'\s+jsonb')
   self.assertIn('v_'+name+'_packet jsonb',declarations)
 def test_exact_genuine188_writer_and_supporting_call_counts(self):
  ns=[n.split('.')[-1]for _,sql in f.seed_stages()for n in calls(sql)]
  expected={'receive_inventory':10,'record_native_dispense':5,'append_native_dispense_correction':2,
   'save_client':1,'save_patient':1,'configure_native_prescriber':1,'save_catalog_product':5,'save_native_prescription_draft':5,'sign_native_prescription':5,'create_billing_invoice':5}
  self.assertEqual({k:ns.count(k)for k in expected},expected)
  self.assertEqual(sum(expected[k]for k in ('receive_inventory','record_native_dispense','append_native_dispense_correction')),17)
  self.assertEqual(sum(expected.values())-17,23)
  self.assertIn("order by pg_temp.a2_id('__LABEL__.lot'||n)",f.read('seed-product.sql'))
  self.assertNotIn('record_native_pickup',ns);self.assertNotIn('record_native_dispense_return',ns)
 def test_fixed_ids_and_typed_receipt_refuse_forgery(self):
  seed=test_seed();self.assertEqual(f.parse_seed(f.canonical(seed)),seed)
  for mutation in ('extra','missing','fixed','duplicate_product','bad_uuid','site','boolean_pid','false_flag','counts'):
   bad=copy.deepcopy(seed)
   if mutation=='extra':bad['ids']['unreviewed']=str(uuid.uuid4())
   elif mutation=='missing':del bad['ids']['plain.product']
   elif mutation=='fixed':bad['ids']['plain.dispense']=str(uuid.uuid4())
   elif mutation=='duplicate_product':bad['ids']['plain.product']=bad['ids']['split.product']
   elif mutation=='bad_uuid':bad['ids']['plain.product']='bad'
   elif mutation=='site':bad['ids']['site']=str(uuid.uuid4())
   elif mutation=='boolean_pid':bad['backend_pid']=True
   elif mutation=='false_flag':bad['source_rows_fabricated']=0
   else:bad['business_calls']=True
   with self.subTest(mutation=mutation),self.assertRaises((AssertionError,ValueError)):f.parse_seed(f.canonical(bad))
  with self.assertRaises(AssertionError):f.parse_seed(f.canonical(seed)+'\n'+f.canonical(seed))
 def test_no_bypass_or_fabricated_native_inserts(self):
  allowed={'a2_ids','a2_data','a2_products','a2_expected_cells','a2_cases','a2_expected_boundaries','a2_before_append','a2_native_receipts',
   'users','sessions','profiles','user_roles','controlled_stock_sites','controlled_stock_locations','controlled_stock_policy_versions','controlled_stock_policy_sites',
   'controlled_stock_state_events','controlled_stock_states','controlled_stock_openings','controlled_stock_opening_movements','controlled_stock_containers',
   'controlled_stock_container_heads','controlled_stock_cells','controlled_stock_positions'}
  for _,sql in stages():
   self.assertNotRegex(sql.lower(),r'disable\s+trigger|session_replication_role\s*=|set\s+session\s+authorization|delete\s+from|truncate\s|update\s+public\.native_')
   for node in walk(json.loads(parser.parse_sql_json(sql))):
    for kind in ('InsertStmt','UpdateStmt','DeleteStmt'):
     if kind in node:self.assertIn(node[kind]['relation']['relname'],allowed)
 def test_constructor_uses_declared_retained_versions_not_current_counts(self):
  for label,sql in f.opening_stages():
   self.assertIn("select public.controlled_stock_exclusive()",sql)
   self.assertLess(sql.index('select public.controlled_stock_exclusive()'),sql.index('insert into controlled_stock_policy_versions'))
   self.assertIn('actual is distinct from expected',sql)
   self.assertIn("0,"+('1'if label.endswith(('clinical_prefix','operational_prefix'))else'0')+",0,null)",sql)
   self.assertNotIn('count(*)',sql)
   self.assertIn('controlled_stock_validate_opening',sql)
   self.assertLess(sql.index('controlled_stock_validate_opening'),sql.index("'active',"))
   self.assertLess(sql.index('set constraints all immediate;'),sql.index('set constraints all deferred;'))
 def test_split_and_zero_cell_declaration_counts(self):
  sql=f.post_setup(test_seed()['ids']);tree=json.loads(parser.parse_sql_json(sql))
  rows=None
  for n in walk(tree):
   if 'InsertStmt'in n and n['InsertStmt']['relation']['relname']=='a2_expected_cells':rows=n['InsertStmt']['selectStmt']['SelectStmt']['valuesLists']
  self.assertEqual(len(rows),22)
  rendered=sql[sql.index('insert into a2_expected_cells values'):sql.index('create temp table a2_cases')]
  self.assertIn("'split.preparedcell1','split','split.prepared1',1,1,'prepared','0.500'",rendered)
  self.assertIn("'split.preparedcell_half','split','split.prepared_half',1,1,'prepared','0.500'",rendered)
  self.assertIn("'split.preparedcell_zero','split','split.prepared_zero',1,1,'prepared','0.000'",rendered)
 def test_pickup_plan_exact_two_cell_effects(self):
  sql=f.read('pickup.sql');self.assertIn("'quantity_delta','-1.000'",sql);self.assertNotIn("'allocation_id'",sql)
  self.assertIn('generate_series(1,2)',sql);self.assertNotIn('controlled_stock_expected(',sql)
  self.assertIn("pg_temp.a2_id('pickup.prepared'||n)",sql)
 def test_oracle_expected_rows_are_independent_and_fixed(self):
  sql=f.read('oracle.sql');prefix=sql[:sql.index('create function pg_temp.a2_physical_assertions')]
  self.assertNotIn('controlled_review_v3.',prefix)
  self.assertNotIn('container_heads',prefix);self.assertNotIn('controlled_stock_positions',prefix)
  for name in ('opening_movement','opening_cells','original_dispense','amendment_predecessor','original_pickup'):self.assertIn(name,prefix)
  self.assertIn('v_expected_packet:=pg_temp.a2_expected_packet',sql)
  self.assertLess(sql.index('v_expected_packet:=pg_temp.a2_expected_packet'),sql.index('v_collected_packet:=controlled_review_v3.collect_event_sources'))
  self.assertIn('b.collected=v_collected_packet and b.adapted=v_adapted_packet and b.expected=v_expected_packet',sql)
  self.assertIn("'available','0.000'",sql);self.assertIn("then '-2.000' else '0.000'",sql)
  self.assertIn("'remaining_negative_limit_restore_proven',false",sql)
 def test_session_role_and_jwt_contract(self):
  self.assertIn("set local role authenticated",f.begin('historical_writer'))
  self.assertNotIn('set local role',f.begin('controlled_owner'))
  for mode in ('ordinary','historical_writer','controlled_owner'):
   self.assertIn("a2_identity('ordinary')",f.begin(mode));self.assertIn('commit;',f.end(mode))
  s=f.read('identity.sql')
  for key in ('session_user','current_user',"current_setting('role')",'session_replication_role','request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.email','auth.uid()','auth.role()','auth.email()'):self.assertIn(key,s)
 def test_preservation_full_columns_rows_and_backend_identity(self):
  seed=test_seed();membership={'products':5,'lots':10,'movements':20,'movement_sources':20,'allocations':10,'dispenses':5,'charges':5,'old_corrections':2,
   'closed_seed_backend':123,'retroactive_membership':False,'new_pickup_correction_provenance':False}
  old={'kind':'a2-history-source-oracle-v1','ids':seed['ids'],'membership':membership,'relations':{k:{'columns':[{'name':'id','type':'uuid'}],'rows':[{'id':'fixed'}]}for k in f.HISTORY_TABLES}}
  new=copy.deepcopy(old)
  for table in new['relations'].values():table['columns'].append({'name':'new_col','type':'text'});table['rows'][0]['new_col']='retained'
  self.assertTrue(f.preserved(old,new,seed)['original31_relations_preserved'])
  for change in ('row','type','missing_table','extra_table','backend','boolean_count','duplicate'):
   bad=copy.deepcopy(new)
   if change=='row':bad['relations']['native_dispenses']['rows'][0]['id']='changed'
   elif change=='type':bad['relations']['native_dispenses']['columns'][0]['type']='text'
   elif change=='missing_table':del bad['relations']['native_dispenses']
   elif change=='extra_table':bad['relations']['foreign']={}
   elif change=='backend':bad['membership']['closed_seed_backend']=124
   elif change=='boolean_count':bad['membership']['products']=True
   else:bad['relations']['native_dispenses']['rows']*=2
   with self.subTest(change=change),self.assertRaises(AssertionError):f.preserved(old,bad,seed)
  self.assertIn('a.backend_pid=123',f.history_sql(seed));self.assertIn('pg_stat_activity',f.history_sql(seed))
 def test_exact_finite_source_closure_and_changed_authority_refusal(self):
  inputs=f.source_inputs();self.assertEqual(len(inputs),29)
  self.assertTrue(all(str(f.HERE/name)in inputs for name in f.SOURCES))
  declaration=json.loads(f.read('declaration.json'));key=next(iter(declaration['source_authorities']));declaration['source_authorities'][key]='0'*64
  original=f.read
  with patch.object(f,'read',side_effect=lambda name:json.dumps(declaration)if name=='declaration.json'else original(name)):
   with self.assertRaisesRegex(AssertionError,'authority changed'):f.source_inputs()
 def test_source_has_no_runtime_or_candidate_write_api(self):
  tree=ast.parse((f.HERE/'fixtures.py').read_text())
  for n in ast.walk(tree):
   if isinstance(n,ast.Import):self.assertTrue(all(a.name in('json','uuid')for a in n.names))
   if isinstance(n,ast.ImportFrom):self.assertIn(n.module,('pathlib','hashlib'))
  self.assertNotIn('write_text(',f.read('fixtures.py'));self.assertNotIn('write_bytes(',f.read('fixtures.py'))

if __name__=='__main__':unittest.main(verbosity=2)
