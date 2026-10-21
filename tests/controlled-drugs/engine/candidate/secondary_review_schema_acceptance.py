"""Actual owned-database schema drift/corruption/atomicity negatives.

All deliberate corruption is transaction-local and rolled back. Independent
expected descriptors are never edited or replaced. Uses only the caller's owned
runtime and genuine synthetic Auth identities; no network or hosted access here.
"""
import hashlib
import json
import uuid


def run(ctx):
    runtime=ctx.runtime
    quote=ctx.base.literal
    actor=ctx.actors['reviewer']
    before_original=ctx.parent_rows()
    results=[]

    def request_sql(request):
        return quote(json.dumps(request,sort_keys=True,separators=(',',':')))+'::jsonb'

    def snapshot():
        return {'review_rows':ctx.review_rows(),'original_rows':ctx.parent_rows(),
                'metadata':runtime.json('select controlled_review.snapshot();')}

    def case(label,mutation,validation,code='23514',message_fragment=None,authenticated=False,late=False,privileged=False,as_role=None):
        before=snapshot()
        assert as_role in (None,'anon','authenticated','service_role')
        selected_role=as_role or ('authenticated' if authenticated else None)
        role="perform set_config('role',"+quote(selected_role)+",true);" if selected_role else ''
        expected_message=message_fragment or ('ARMED:'+label if late else None)
        # Each inner exception block is an actual subtransaction: corruption and
        # any successfully persisted API work roll back before observation.
        sql='begin;\n'+ctx.sql_claims(actor)+"\ncreate temp table secondary_review_observation(payload jsonb)on commit drop;\n"
        sql+="do $negative$ declare observed_code text; observed_message text; begin begin\n"+mutation+'\n'+role+'\n'+validation+'\n'
        if late:
            sql+="raise exception using errcode='P0001',message="+quote('ARMED:'+label)+";\n"
        else:
            sql+="raise exception 'NEGATIVE CASE DID NOT REFUSE' using errcode='P9999';\n"
        sql+="""exception when others then
 get stacked diagnostics observed_code=returned_sqlstate,observed_message=message_text;
 if observed_code<>"""+quote(code)+" then raise;end if;\n"
        if expected_message:
            sql+='if position('+quote(expected_message)+" in observed_message)=0 then raise exception 'Unexpected refusal stage: %',observed_message;end if;\n"
        sql+="insert into secondary_review_observation values(jsonb_build_object('label',"+quote(label)+",'sqlstate',observed_code,'message',observed_message,'armed_late_failure',"+str(late).lower()+"));\nend;end $negative$;\n"
        sql+="select jsonb_build_object('observations',(select jsonb_agg(payload)from secondary_review_observation));\nrollback;"
        observed=ctx.base.json_output(runtime.sql(sql,user='supabase_admin' if privileged else 'postgres').stdout)
        assert len(observed['observations'])==1
        after=snapshot()
        assert after==before,label+' failed exact data/catalog rollback'
        ctx.save('schema-'+label,{'sql':sql,'sql_sha256':hashlib.sha256(sql.encode()).hexdigest(),
                                'before':before,'observed':observed,'after':after})
        results.append({'label':label,'sqlstate':code,'exact_rollback':True,'armed_late_failure':late})

    # All prerequisites are real API work, including a durably committed prep.
    saved_request=ctx.request(actor,ctx.events[-100],operation=str(uuid.uuid4()))
    ctx.rpc('prepare',actor,saved_request)
    ctx.rpc('execute',actor,saved_request)
    pending_request=ctx.request(actor,ctx.events[-99],operation=str(uuid.uuid4()))
    ctx.rpc('prepare',actor,pending_request)
    pending_id=quote(pending_request['operation_id'])+'::uuid'
    saved_id=quote(saved_request['operation_id'])+'::uuid'
    private_call='perform public.read_controlled_secondary_review('+request_sql(saved_request)+');'

    # Catalog expectation excludes PUBLIC, and real role impersonation proves
    # the service role cannot borrow direct table/helper access through RLS bypass.
    sealed=runtime.json('select controlled_review.snapshot();')
    assert all(a['grantee']!='PUBLIC' for f in sealed['functions'].values() for a in f['acl'])
    assert all(a['grantee']!='PUBLIC' for t in sealed['relations'].values() for a in t['acl'])
    for role_name in ('anon','authenticated','service_role'):
        case('raw-select-'+role_name,'','perform operation_id from controlled_review.preparations;',code='42501',message_fragment='permission denied',as_role=role_name)
        case('raw-insert-'+role_name,'',"insert into controlled_review.preparations(operation_id)values(gen_random_uuid());",code='42501',message_fragment='permission denied',as_role=role_name)
        case('raw-helper-'+role_name,'','perform controlled_review.target('+quote(saved_request['event_id'])+'::uuid);',code='42501',message_fragment='permission denied',as_role=role_name)
        if role_name!='authenticated':
            case('ungranted-facade-'+role_name,'',private_call,code='42501',message_fragment='permission denied',as_role=role_name)

    metadata_cases=[
        ('function-body',"create or replace function controlled_review.target(p_event_id uuid)returns jsonb language sql volatile set search_path=pg_catalog,public,pg_temp set timezone='UTC' as 'select null::jsonb';"),
        ('function-configuration',"alter function controlled_review.packet(jsonb)set search_path=public,pg_temp;"),
        ('function-attributes','alter function controlled_review.packet(jsonb)cost 101;'),
        ('function-acl','grant execute on function controlled_review.packet(jsonb)to authenticated;'),
        ('public-facade-acl','grant execute on function public.read_controlled_secondary_review(jsonb)to anon;'),
        ('column-acl','grant select(reason)on controlled_review.preparations to authenticated;'),
        ('schema-acl','grant usage on schema controlled_review to authenticated;'),
        ('schema-owner','alter schema controlled_review owner to supabase_admin;grant usage on schema controlled_review to postgres;'),
        ('constraint','alter table controlled_review.preparations drop constraint preparations_event_fk;'),
        ('guard-trigger','alter table controlled_review.decisions disable trigger review_guard;'),
        ('rls','alter table controlled_review.preparations disable row level security;'),
        ('extra-schema-object','create table controlled_review.unreviewed(extra text);'),
        ('extra-public-facade-overload','create function public.read_controlled_secondary_review(p_extra integer)returns jsonb language sql as \'select null::jsonb\';'),
    ]
    for label,mutation in metadata_cases:
        case(label,mutation,private_call,authenticated=True,message_fragment='Secondary-review metadata differs',privileged=label=='schema-owner')
    for side,relation in (('child','controlled_review.preparations'),('parent','public.controlled_stock_events')):
        mutation="""do $ri$ declare trigger_name text;begin
 select t.tgname into strict trigger_name from pg_trigger t join pg_constraint c on c.oid=t.tgconstraint
 where c.connamespace='controlled_review'::regnamespace and c.conname='preparations_event_fk'
 and t.tgrelid="""+quote(relation)+"::regclass order by t.tgname limit 1;\nexecute format('alter table %s disable trigger %I',"+quote(relation)+",trigger_name);end $ri$;"
        case('ri-trigger-'+side,mutation,private_call,authenticated=True,message_fragment='Secondary-review metadata differs',privileged=True)
    # Fixed fabricated corruption tests the independently required parent
    # literal. Never capture live metadata into any stored expectation.
    mutation="""alter table public.controlled_stock_engine_manifests disable trigger immutable;
 update public.controlled_stock_engine_manifests set definition='{}'::jsonb,
 definition_hash=public.controlled_stock_hash('{}'::jsonb);
 alter table public.controlled_stock_engine_manifests enable trigger immutable;"""
    case('parent-fixed-corruption-refused',mutation,private_call,message_fragment='Unchanged frozen-205 parent',authenticated=True,privileged=True)

    def corrupt(table,statement):
        return 'alter table controlled_review.'+table+' disable trigger immutable;\n'+statement+'\nalter table controlled_review.'+table+' enable trigger immutable;'

    validate='perform controlled_review.validate_history();'
    for field,replacement in (
        ('event_id',str(uuid.uuid4())),('product_id',str(uuid.uuid4())),('sequence',9999999),
        ('record_hash','0'*64),('original_actor_id',str(uuid.uuid4())),('policy_version_id',str(uuid.uuid4())),
        ('opening_id',str(uuid.uuid4())),('engine_revision',9999999)):
        change="update controlled_review.preparations set target=jsonb_set(target,array["+quote(field)+"],"+quote(json.dumps(replacement))+"::jsonb)where operation_id="+pending_id+';'
        case('target-'+field,corrupt('preparations',change),validate,message_fragment='Historical preparation binding')
    for field,value in (('request_hash',quote('0'*64)),('packet_hash',quote('0'*64)),
                        ('packet',"packet||'{\"unexpected\":true}'::jsonb"),('reason',quote(' changed reason ')),
                        ('expires_at',"created_at+interval '16 minutes'")):
        change='update controlled_review.preparations set '+field+'='+value+' where operation_id='+pending_id+';'
        case('preparation-'+field,corrupt('preparations',change),validate,message_fragment='Use clean bounded controlled text' if field=='reason' else 'Historical preparation binding')
    for field,value in (('receipt',"receipt||'{\"unexpected\":true}'::jsonb"),('packet_hash',quote('0'*64)),
                        ('recorded_at',"'infinity'::timestamptz"),('meaning_version','2')):
        change='update controlled_review.decisions set '+field+'='+value+' where operation_id='+saved_id+';'
        case('decision-'+field,corrupt('decisions',change),validate,message_fragment='Historical final decision')
    duplicate_terminal="""perform set_config('session_replication_role','replica',true);
 insert into controlled_review.cancellations(operation_id,actor_id,session_id,recorded_at)
 select operation_id,actor_id,session_id,recorded_at from controlled_review.decisions where operation_id="""+saved_id+";\nperform set_config('session_replication_role','origin',true);"
    case('terminal-exclusivity',duplicate_terminal,validate,message_fragment='both decision and cancellation',privileged=True)
    orphan="perform set_config('session_replication_role','replica',true);delete from controlled_review.preparations where operation_id="+saved_id+";perform set_config('session_replication_role','origin',true);"
    case('orphan-decision',orphan,validate,message_fragment='Orphan or duplicate',privileged=True)
    disabled="update controlled_review.definitions set enabled=false where id="+quote(saved_request['definition_id'])+'::uuid;'
    case('historical-disabled-definition',corrupt('definitions',disabled),validate,message_fragment='Historical preparation binding')
    # A broken contiguous stream is independently caught even without a prep
    # referring to the deleted row. This clone-local version rewrite rolls back.
    stream="update controlled_review.definitions set version=version+100000 where id="+quote(saved_request['definition_id'])+'::uuid;'
    case('historical-definition-gap',corrupt('definitions',stream),validate,message_fragment='stream versions')

    # Oversized immutable source fixture is deliberate privileged corruption,
    # not a valid stock-event claim. The authoritative packet helper must reject
    # the complete data rather than truncate it; all source bytes then roll back.
    oversized="perform set_config('session_replication_role','replica',true);update public.controlled_stock_events set source_bundle=jsonb_build_object('oversized_fixture',repeat('x',1048576))where id="+quote(pending_request['event_id'])+"::uuid;perform set_config('session_replication_role','origin',true);"
    packet_context=request_sql({'event_id':pending_request['event_id'],'definition_id':pending_request['definition_id']})
    case('packet-overflow',oversized,'perform controlled_review.packet('+packet_context+');',message_fragment='evidence packet exceeds one MiB',privileged=True)

    # Armed late exceptions follow actual successful persistence, not an early
    # seal refusal. These prove outer transaction rollback at each named stage.
    new_request=ctx.request(actor,ctx.events[-98],operation=str(uuid.uuid4()))
    api_prepare='perform public.prepare_controlled_secondary_review('+request_sql(new_request)+');'
    case('late-preparation','',api_prepare,code='P0001',authenticated=True,late=True)
    api_execute='perform public.execute_controlled_secondary_review('+request_sql(pending_request)+');'
    case('late-decision','',api_execute,code='P0001',authenticated=True,late=True)
    api_cancel='perform public.cancel_controlled_secondary_review('+request_sql(pending_request)+');'
    case('late-cancellation','',api_cancel,code='P0001',authenticated=True,late=True)
    definition_id=quote(saved_request['definition_id'])+'::uuid'
    insert_definition="""insert into controlled_review.definitions(id,product_id,site_id,event_kind,capability,version,enabled,roles)
 select gen_random_uuid(),d.product_id,d.site_id,d.event_kind,d.capability,
 (select max(x.version)+1 from controlled_review.definitions x where x.product_id=d.product_id and x.site_id=d.site_id and x.event_kind=d.event_kind and x.capability=d.capability),
 false,d.roles from controlled_review.definitions d where d.id="""+definition_id+';'
    case('late-definition','',insert_definition,code='P0001',late=True)

    # Force a bad stored receipt after the real API has queued its constraint
    # trigger, restore metadata, and actually COMMIT: terminal validation must
    # refuse at commit rather than only an explicit restore-validator call.
    before=snapshot()
    sql='begin;\n'+ctx.sql_claims(actor)+'\nset local role authenticated;\nselect public.execute_controlled_secondary_review('+request_sql(pending_request)+');\nreset role;\n'
    sql+="select set_config('session_replication_role','replica',true);\nupdate controlled_review.decisions set receipt=receipt||'{\"corrupted_after_insert\":true}'::jsonb where operation_id="+pending_id+";\nselect set_config('session_replication_role','origin',true);\ncommit;"
    result=runtime.sql(sql,fail=False,user='supabase_admin')
    assert result.returncode!=0 and '23514' in result.stderr and 'Historical final decision' in result.stderr, 'Actual deferred commit did not reject corrupt receipt'
    after=snapshot()
    assert after==before,'Deferred commit refusal failed exact rollback'
    ctx.save('schema-actual-deferred-commit',{'sql':sql,'before':before,'stdout':result.stdout,'stderr':result.stderr,'returncode':result.returncode,'after':after})
    results.append({'label':'actual-deferred-commit','sqlstate':'23514','exact_rollback':True,'actual_commit':True})
    assert ctx.parent_rows()==before_original,'Schema negatives changed original source rows'
    ctx.checkpoint('schema-negatives-original-source-preserved')
    return {'passed':True,'cases':results,'original_rows_unchanged':True,'acceptance_expectation_resealed':False,
            'late_failure_scope':'Exact armed outer transaction exceptions after successful persistence; actual deferred COMMIT refusal separately proven.'}
