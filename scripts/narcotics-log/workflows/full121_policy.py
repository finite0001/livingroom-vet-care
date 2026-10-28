"""Actual ADMIN policy publication, prior conflict and owned terminal closure."""
from copy import deepcopy
import full121_values as v
import full121_queries as sql
RPCS=('read_controlled_count_policy_v1','publish_controlled_count_policy_v1','read_controlled_count_operation_closure_v2','close_controlled_count_operation_v2','list_controlled_count_scopes_v1')
def verify_receipt(q,r,version):
 v.keys(r,('schema_version','action','actor_id','operation_id','product_id','site_id','request_digest','result_ref','receipt_digest'))
 if any(r[k]!=q[k]for k in('schema_version','actor_id','operation_id','product_id','site_id'))or r['action']!='policy_publish'or r['result_ref']!=dict(kind='policy',id=q['operation_id'],version=str(version)):raise ValueError('Actual policy receipt reference differs')
 if r['request_digest']!=v.digest('lrv-controlled-count-policy-request-v1',q)or r['receipt_digest']!=v.digest('lrv-controlled-count-policy-receipt-v1',{k:x for k,x in r.items()if k!='receipt_digest'}):raise ValueError('Actual policy receipt independent frame differs')
 return deepcopy(r)
def pointer(q):return dict(schema_version=2,actor_id=q['actor_id'],operation_id=q['operation_id'],original_action='policy_publish',scope_id=q['operation_id'],product_id=q['product_id'],site_id=q['site_id'])
def closure(p,r,state,receipt=None):
 expected={**p,'action':'operation_closure','state':state,'receipt':receipt}
 if r!={**expected,'receipt_digest':v.digest('lrv-controlled-count-operation-closure-receipt-v2',expected)}:raise ValueError('Actual V2 policy closure differs')
 return deepcopy(r)
def state_sql(product,site):
 product=v.uid(product);site=v.uid(site)
 return sql.read(f"""select jsonb_build_object('policies',(select coalesce(jsonb_agg(jsonb_build_object('policy_id',policy_id,'version',version::text,'prior_policy_id',prior_policy_id,'actor_id',actor_id,'session_id',session_id)order by version),'[]'::jsonb)from controlled_count_v1.policies where product_id='{product}'::uuid and site_id='{site}'::uuid),
 'operations',(select count(*)from controlled_count_v1.operations where product_id='{product}'::uuid and site_id='{site}'::uuid),
 'closures',(select coalesce(jsonb_agg(jsonb_build_object('operation_id',operation_id,'state',state,'original_action',original_action,'scope_id',scope_id)order by operation_id),'[]'::jsonb)from controlled_count_v1.operation_closures where product_id='{product}'::uuid and site_id='{site}'::uuid));""")
def run(ctx,m,runtime,folder,query,save):
 if 'count_policy'in ctx:raise ValueError('Policy stage cannot run twice')
 http=ctx['http'];a=ctx['users'][0];ids=ctx['ids'];scope=dict(schema_version=1,actor_id=a['id'],product_id=ids['product'],site_id=ids['site']);steps=[];published=[]
 def rpc(label,name,q):
  if name not in RPCS:raise ValueError('Fixed policy API required')
  runtime.remaining(1);r=http.rpc(name,{'p_request':q},a);save(folder,'policy-'+label,r);steps.append(dict(label=label,rpc=name,actor_id=a['id'],session_id=a['session_id']));return r
 initial=rpc('initial','read_controlled_count_policy_v1',scope)
 if initial!=dict(schema_version=1,state='unconfigured',data=dict(product_id=ids['product'],site_id=ids['site'],policy=None)):raise ValueError('Initial scope unexpectedly commissioned')
 settings=v.count_settings()
 prior=None
 for version in(1,2):
  chosen=deepcopy(settings)
  if version==2:chosen['max_observation_age_seconds']=86400;chosen['meaning_version']='synthetic-engineering-v2'
  q={**scope,'operation_id':v.uid(),'expected_prior_policy_id':prior,'settings':chosen}
  save(folder,'policy-publish-'+str(version)+'-request',q)
  p=pointer(q);closure(p,rpc('pending-'+str(version),'read_controlled_count_operation_closure_v2',p),'pending')
  r=verify_receipt(q,rpc('publish-'+str(version),'publish_controlled_count_policy_v1',q),version)
  closure(p,rpc('recover-'+str(version),'read_controlled_count_operation_closure_v2',p),'saved',r)
  closure(p,rpc('saved-close-'+str(version),'close_controlled_count_operation_v2',p),'saved',r)
  read=rpc('current-'+str(version),'read_controlled_count_policy_v1',scope)
  policy=read['data']['policy']
  if read['state']!='configured'or policy['policy_id']!=q['operation_id']or policy['version']!=str(version)or policy['prior_policy_id']!=prior or policy['settings']!=chosen or policy['actor']['id']!=a['id']:raise ValueError('Protected policy READ not exact saved current version')
  published.append(dict(request=q,receipt=r,pointer=p));prior=q['operation_id']
 # Old saved policy closure remains exact after a later current policy exists.
 first=published[0];closure(first['pointer'],rpc('historical-recovery','read_controlled_count_operation_closure_v2',first['pointer']),'saved',first['receipt'])
 unsent={**scope,'operation_id':v.uid(),'expected_prior_policy_id':prior,'settings':deepcopy(settings)};p=pointer(unsent)
 closure(p,rpc('unsent-pending','read_controlled_count_operation_closure_v2',p),'pending')
 abandoned=closure(p,rpc('unsent-abandon','close_controlled_count_operation_v2',p),'abandoned')
 before=query('policy-before-late',state_sql(ids['product'],ids['site']))
 status,error=http.post('/rest/v1/rpc/publish_controlled_count_policy_v1',{'p_request':unsent},a['token']);save(folder,'policy-late-refusal',dict(status=status,error=error))
 if status!=400 or error!=dict(code='P0001',details='',hint='',message='count_request_failed'):raise ValueError('Late policy publication did not refuse exact terminal fence')
 after=query('policy-after-late',state_sql(ids['product'],ids['site']))
 if after!=before:raise ValueError('Refused late policy changed committed scope')
 expected_policies=[dict(policy_id=x['request']['operation_id'],version=str(i+1),prior_policy_id=x['request']['expected_prior_policy_id'],actor_id=a['id'],session_id=a['session_id'])for i,x in enumerate(published)]
 expected_closures=sorted([dict(operation_id=x['request']['operation_id'],state='saved',original_action='policy_publish',scope_id=x['request']['operation_id'])for x in published]+[dict(operation_id=unsent['operation_id'],state='abandoned',original_action='policy_publish',scope_id=unsent['operation_id'])],key=lambda x:x['operation_id'])
 if after!=dict(policies=expected_policies,operations=0,closures=expected_closures):raise ValueError('Policy-only exact rows differ; fake count operations are forbidden')
 scopes=rpc('scopes','list_controlled_count_scopes_v1',dict(schema_version=1,actor_id=a['id'],cursor=None,page_size=100))
 if not any(x['product_id']==ids['product']and x['site_id']==ids['site']for x in scopes['items']):raise ValueError('Actual newly commissioned scope not discoverable')
 proof=dict(published=published,abandoned_pointer=p,abandoned_receipt=abandoned,late_request=unsent,actual_rows=after,steps=steps)
 ctx['count_policy']=deepcopy(proof);save(folder,'full121-count-policy-proof',proof);return proof
