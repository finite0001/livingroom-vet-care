"""Actual public-API commissioning. SOURCE/UNRUN; framework owns all services.

Only initial real-user profile/role bootstrap may use inherited identity_fixture.
No stock_setup, owner policy/opening INSERTs, fake claims or business retries.
"""
from copy import deepcopy
from datetime import date,timedelta
import json
from pathlib import Path
import full121_values as v
import full121_queries as sql

RPCS=('save_catalog_product','receive_inventory','prepare_controlled_draft_review','execute_controlled_draft_review',
 'list_controlled_stock_administration_options_v1','preview_controlled_stock_opening_v1',
 'prepare_controlled_stock_administration_v1','read_controlled_stock_administration_operation_v1',
 'execute_controlled_stock_administration_v1','close_controlled_stock_administration_operation_v1',
 'read_current_stock_policy_v1','project_controlled_review_calendar_v1',
 'read_controlled_stock_administration_configuration_v1','list_controlled_stock_administration_operations_v1')
HERE=Path(__file__).resolve().parent

def run(ctx,m,runtime,folder,query,save):
 a,b=ctx['users'];http=ctx['http'];ids=ctx['ids'];steps=[];operations=[]
 original_users=deepcopy(ctx['users'])
 if 'admin'in ctx:raise ValueError('Commissioning stage cannot run twice')
 choices=json.loads((HERE/'synthetic-rule-choices.json').read_bytes());kinds=choices['stock_event_kinds']
 def named(label,name,args):
  if name not in RPCS:raise ValueError('Fixed commissioning RPC only')
  runtime.remaining(1);reply=http.rpc(name,args,a);save(folder,'admin-'+label,reply)
  steps.append(dict(label=label,rpc=name,actor_id=a['id'],session_id=a['session_id']));return reply
 def rpc(label,name,q):return named(label,name,{'p_request':q})
 def publish(label,action,definition,product,site,operation=None):
  operation=v.uid(operation);p=v.pointer(action,a['id'],operation,product,site);q={**p,'definition':deepcopy(definition)}
  save(folder,'admin-'+label+'-request',q)
  prepared=v.verify_admin(rpc(label+'-prepare','prepare_controlled_stock_administration_v1',q),p,q,'prepared')
  if prepared['data']['preparation']['source_state']!='current':raise ValueError('New prepared administration source not current')
  read=v.verify_admin(rpc(label+'-review','read_controlled_stock_administration_operation_v1',p),p,q,'prepared')
  if read!=prepared:raise ValueError('Actual immutable preparation changed before explicit execute')
  saved=v.verify_admin(rpc(label+'-execute','execute_controlled_stock_administration_v1',p),p,q,'saved')
  recovered=v.verify_admin(rpc(label+'-recover','read_controlled_stock_administration_operation_v1',p),p,q,'saved')
  closed=v.verify_admin(rpc(label+'-close-saved','close_controlled_stock_administration_operation_v1',p),p,q,'saved')
  # Current source_state may change due to the publication itself; only the saved
  # original request, summary and receipt bind the terminal recovery.
  for other in(recovered,closed):
   if other['data']['receipt']!=saved['data']['receipt']or other['data']['preparation']['request']!=q:raise ValueError('Saved administration recovery changed original receipt/request')
  proof=dict(label=label,pointer=p,request=q,preparation=prepared['data']['preparation'],receipt=saved['data']['receipt'])
  operations.append(proof);return proof

 # Existing fixed identity bootstrap is performed by the framework BEFORE this
 # stage, from actual initial GoTrue users. This stage never writes roles itself.
 product=named('catalog','save_catalog_product',dict(p_id=None,p_expected_version=None,p_name='Synthetic full121 medication',p_kind='medication',p_manufacturer='',p_unit='tablet',p_unit_price_cents=100,p_active=True))
 ids['product']=v.uid(product['id']);clock=query('admin-clock-initial',sql.clock())
 ids['lot']=v.uid();ids['legacy_receive']=v.uid()
 named('legacy-stock','receive_inventory',dict(p_id=ids['legacy_receive'],p_lot_id=ids['lot'],p_product_id=ids['product'],p_lot_number='FULL121-SYNTHETIC',p_expires_on=clock['expiry'],p_location='Synthetic full121 clinic',p_quantity=20,p_reason=v.NOTE))
 draft_id=v.uid();draft_action=v.uid()
 draft=dict(id=draft_id,expected_version=None,definition=dict(product_id=ids['product'],product_version=product['version'],stock_unit='tablet',generic_name='Synthetic full121 medication',brand_name=None,schedule='II',concentration='Synthetic engineering value; no clinical dose',concentration_source=v.NOTE,classification_source=v.NOTE,configuration_note=v.NOTE),review_note=v.NOTE,attest_review=True)
 named('draft-prepare','prepare_controlled_draft_review',dict(p_actor_id=a['id'],p_action_id=draft_action,p_operation='draft_configuration',p_request=draft))
 drafted=named('draft-execute','execute_controlled_draft_review',dict(p_actor_id=a['id'],p_action_id=draft_action))
 entry=drafted['entry'];ids['draft_version']=v.uid(entry['version_id'])
 if entry['id']!=draft_id or entry['product_id']!=ids['product']or entry['definition']!=draft['definition']:raise ValueError('Actual reviewed draft differs from explicit synthetic classification')
 ids['site']=v.uid()
 site=publish('site','site_register',dict(site=dict(label='Synthetic full121 clinic',registration_reference=v.NOTE),locations=[dict(key='clinic',label='Synthetic full121 shelf',kind='clinic',initial_custodian_id=None)]),None,ids['site'],ids['site'])
 locations=site['preparation']['summary']['locations']
 if len(locations)!=1 or locations[0]['kind']!='clinic':raise ValueError('Expected single actual generated clinic location')
 ids['location']=v.uid(locations[0]['id'])
 options=rpc('options','list_controlled_stock_administration_options_v1',dict(schema_version=1,actor_id=a['id'],cursor=None,page_size=100))
 if options['has_more']or options['next_cursor']is not None or not any(x['id']==ids['product']and x['draft_version_id']==ids['draft_version']for x in options['products'])or not any(x['id']==ids['location']for x in options['locations']):raise ValueError('Actual options missing new draft/site/location')
 preview=rpc('opening-preview','preview_controlled_stock_opening_v1',dict(schema_version=1,actor_id=a['id'],product_id=ids['product'],draft_version_id=ids['draft_version']))
 if preview['state']!='available':raise ValueError('Actual opening is blocked')
 slots=preview['data']['slots']
 if len(slots)!=1 or slots[0]['slot']!=dict(channel='available',lot_id=ids['lot'],dispense_id=None,allocation_id=None,intake_id=None)or slots[0]['recorded_quantity']!='20.000'or slots[0]['observation_required']is not True or slots[0]['custody_state']!='onsite':raise ValueError('Complete actual opening basis is not the synthetic one-lot prefix')
 at=query('admin-clock-opening',sql.clock())['at'];v.instant(at);ids['opening']=v.uid()
 policy=v.stock_policy(ids['site'],kinds)
 opened=publish('opening','stock_opening',dict(draft_version_id=ids['draft_version'],expected_basis_digest=preview['data']['source_basis_digest'],policy=policy,completed_at=at,note=v.NOTE,placements=[dict(slot=deepcopy(slots[0]['slot']),label='Synthetic full121 stock',location_id=ids['location'],custodian_id=None,status='onsite',quantity='20.000',observed_at=at)]),ids['product'],ids['site'],ids['opening'])
 scope=dict(schema_version=1,actor_id=a['id'],product_id=ids['product'],site_id=ids['site'])
 current=rpc('opening-active','read_current_stock_policy_v1',scope)
 if current['state']!='available'or current['data']['state']['state']!='active'or current['data']['opening_id']!=ids['opening']or current['data']['policy']!=policy:raise ValueError('First opening did not activate the exact reviewed stock policy')
 prior=current['data'];revised=deepcopy(policy);revised['review_reference']=v.NOTE+' Explicit synthetic policy revision.'
 revision=publish('stock-policy','stock_policy',dict(draft_version_id=ids['draft_version'],expected_policy_version_id=prior['policy_version_id'],policy=revised,reason=v.NOTE),ids['product'],ids['site'])
 current=rpc('stock-policy-current','read_current_stock_policy_v1',scope)
 if current['data']['policy_version_id']!=revision['pointer']['operation_id']or current['data']['policy']!=revised or current['data']['state']['state']!='active':raise ValueError('Actual optimistic stock policy revision differs')
 physical=query('admin-opening-identities',sql.opening(ids['product'],ids['site']))
 if len(physical['containers'])!=1 or len(physical['cells'])!=1 or physical['positions']!=[dict(cell_id=physical['cells'][0]['id'],quantity='20.000')]:raise ValueError('Actual opening graph not single explicit synthetic available cell')
 ids['container']=v.uid(physical['containers'][0]['id']);ids['cell']=v.uid(physical['cells'][0]['id'])
 if physical['containers'][0]['opening_id']!=ids['opening']or physical['cells'][0]['container_id']!=ids['container']or physical['cells'][0]['lot_id']!=ids['lot']or physical['cells'][0]['channel']!='available':raise ValueError('Actual opening identities/lineage differ')

 members=sorted([dict(actor_id=a['id'],roles=['ADMIN','DVM']),dict(actor_id=b['id'],roles=['DVM'])],key=lambda x:x['actor_id'])
 caps=['audit','manage_eligibility','manage_escalation','publish_calendar','publish_policy','publish_routing']
 administration=publish('review-administration','review_administration',dict(expected_predecessor_id=None,enabled=True,members=[{**deepcopy(x),'capabilities':caps.copy()}for x in members],approval_reference=v.NOTE),ids['product'],None)
 def configure(label,kind,body,site=ids['site'],event=None,capability=None):
  return publish('review-'+label,'review_configuration',dict(kind=kind,scope=dict(product_id=ids['product'],site_id=site,event_kind=event,capability=capability),expected_predecessor_id=None,enabled=True,approval_reference=v.NOTE,body=body),ids['product'],site)
 eligibility=[]
 for capability in('read','review'):eligibility.append(configure(capability,'eligibility',dict(members=deepcopy(members)),event='adjust_inventory',capability=capability))
 eligibility.append(configure('exception-read','eligibility',dict(members=deepcopy(members)),site=None,capability='exception_read'))
 routing=configure('routing','routing',dict(members=deepcopy(members)))
 # UTC candidates are obtained from the actual protected backend projection,
 # even though UTC would be easy to synthesize locally.
 day=date.fromisoformat(query('admin-clock-calendar',sql.clock())['date']);after=day+timedelta(days=1)
 local_values=sorted([day.isoformat()+'T00:00:00',day.isoformat()+'T17:00:00',after.isoformat()+'T00:00:00'])
 projection=rpc('calendar-projection','project_controlled_review_calendar_v1',dict(**scope,zone='UTC',local_values=local_values))
 if projection['zone']!='UTC'or [x['local_timestamp']for x in projection['local_values']]!=local_values:raise ValueError('Actual calendar projection differs from requested local values')
 candidates={x['local_timestamp']:x['candidates']for x in projection['local_values']}
 if any(len(xs)!=1 or xs[0]['offset_seconds']!=0 for xs in candidates.values()):raise ValueError('Actual UTC calendar candidates not unique')
 utc=lambda local:v.instant(candidates[local][0]['utc'])
 calendar=configure('calendar','calendar',dict(zone='UTC',first_date=day.isoformat(),last_date=day.isoformat(),days=[dict(date=day.isoformat(),staffed=True,start_utc=utc(local_values[0]),end_utc=utc(local_values[2]),close_local='17:00:00',close_fold=0,close_utc=utc(local_values[1]))]))
 review_policy=configure('policy','policy',dict(effective_from=dict(mode='now',at=None),calendar_id=calendar['pointer']['operation_id'],routing_id=routing['pointer']['operation_id'],native_deadline_kind=None,rules=deepcopy(choices['review_rules'])))
 # Prove all five actions occurred without treating route success alone as DB effects.
 if {x['pointer']['action']for x in operations}!=set(('site_register','stock_opening','stock_policy','review_administration','review_configuration')):raise ValueError('Five-action source path incomplete')
 # Terminal close for an unsent request prevents late preparation. No new fake
 # preparation, physical fact, or publication is inserted by the client.
 abandoned=v.pointer('site_register',a['id'],v.uid(),None,None);abandoned['site_id']=abandoned['operation_id']
 v.verify_admin(rpc('unsent-read','read_controlled_stock_administration_operation_v1',abandoned),abandoned,state='not_found')
 closed=v.verify_admin(rpc('unsent-close','close_controlled_stock_administration_operation_v1',abandoned),abandoned,state='abandoned')
 late={**abandoned,'definition':dict(site=dict(label='Unsent synthetic clinic',registration_reference=v.NOTE),locations=[dict(key='clinic',label='Unsent shelf',kind='clinic',initial_custodian_id=None)])}
 if v.verify_admin(rpc('late-prepare-fenced','prepare_controlled_stock_administration_v1',late),abandoned,state='abandoned')!=closed:raise ValueError('Late prepared administration escaped terminal closure')
 rows=query('admin-journal-effects',sql.journal([x['pointer']['operation_id']for x in operations]+[abandoned['operation_id']]))
 expected=sorted([(x['pointer']['operation_id'],stage,x['pointer']['action'],a['id'],a['session_id'])for x in operations for stage in('prepared','saved')]+[(abandoned['operation_id'],'abandoned','site_register',a['id'],a['session_id'])])
 actual=sorted((r['operation_id'],r['stage'],r['action'],r['actor_id'],r['session_id'])for r in rows)
 if actual!=expected or any(r['protocol']!='administration_v1'for r in rows):raise ValueError('Exact committed administration journal row multiset differs')
 if ctx['users']!=original_users:raise ValueError('Original actual actors were mutated')
 proof=dict(operations=operations,abandoned_pointer=abandoned,late_request=late,steps=steps,actual_journal_rows=rows,scope=dict(product_id=ids['product'],site_id=ids['site']),opening_id=ids['opening'],synthetic_fact_notice=v.NOTE)
 ctx['admin']=deepcopy(proof);save(folder,'full121-commissioning-proof',proof);return proof
