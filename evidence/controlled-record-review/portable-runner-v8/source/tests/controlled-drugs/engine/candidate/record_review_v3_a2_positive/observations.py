"""Same-backend observations around intentional writes and read-only adapters."""
import json
import a2_positive_dependencies as dep

JWT=('request.jwt.claims','request.jwt.claim.sub','request.jwt.claim.role','request.jwt.claim.email')
GUC=JWT+('TimeZone','search_path','session_replication_role','transaction_isolation','role')

def literal(value):return "'"+json.dumps(value,separators=(',',':')).replace("'","''")+"'::jsonb"

def session_setup():
    return """do $identity$ begin
 if session_user<>'postgres' or current_user<>'postgres' or current_setting('role')<>'none'
 or current_setting('session_replication_role')<>'origin' then raise exception 'A2 runtime ordinary identity';end if;end $identity$;
create function pg_temp.a2_runtime_session()returns jsonb language sql as $s$
 select jsonb_build_object('settings',(select jsonb_object_agg(k,current_setting(k,true))from unnest(array["""+','.join("'"+k+"'" for k in GUC)+"""])g(k)),
 'session_user',session_user,'current_user',current_user,'auth_uid',auth.uid(),'auth_role',auth.role(),'auth_email',auth.email(),
 'auth_jwt',auth.jwt(),'advisory',(select coalesce(jsonb_agg(to_jsonb(l)-'pid' order by classid,objid,objsubid,mode),'[]')from pg_locks l where l.pid=pg_backend_pid()and locktype='advisory'));
$s$;
create temp table a2_runtime_context(id boolean primary key check(id),initial_value jsonb not null,stable_value jsonb);
insert into a2_runtime_context values(true,pg_temp.a2_runtime_session(),null);
do $empty$ begin if exists(select 1 from a2_runtime_context c where c.initial_value->'advisory'<>'[]'::jsonb
 or c.initial_value->>'auth_uid' is not null or c.initial_value->>'auth_role' is not null or c.initial_value->>'auth_email' is not null
 or exists(select 1 from jsonb_each(c.initial_value->'settings')s where s.key like 'request.jwt.%'and s.value not in('null'::jsonb,'""'::jsonb)))then raise exception 'A2 initial context';end if;end $empty$;
select jsonb_build_object('a2_session_initial',pg_temp.a2_runtime_session());
"""

def session_guard(name,initial=False):
    assert name.replace('_','').isalnum()
    if initial:
        check="""do $setup_context$ declare before_value jsonb;after_value jsonb;normalized jsonb;key text;begin
 select initial_value into strict before_value from a2_runtime_context where id;
 after_value:=pg_temp.a2_runtime_session();normalized:=after_value;
 foreach key in array ARRAY["""+','.join("'"+k+"'" for k in JWT)+"""] loop
 if before_value#>array['settings',key]='null'::jsonb and after_value#>array['settings',key]='""'::jsonb then
 normalized:=jsonb_set(normalized,array['settings',key],'null'::jsonb);end if;end loop;
 if normalized is distinct from before_value then raise exception 'A2 initial setup context changed beyond declared missing-empty slots';end if;
 update a2_runtime_context set stable_value=after_value where id;
 end $setup_context$;
"""
    else:
        check="do $context$ begin if(select count(*)from a2_runtime_context)<>1 or(select stable_value from a2_runtime_context where id)is distinct from pg_temp.a2_runtime_session()then raise exception 'A2 phase session leak';end if;end $context$;\n"
    return check+"select jsonb_build_object('a2_session_phase','"+name+"','value',pg_temp.a2_runtime_session());\n"


def wrap(phases):
    result=[]
    for i,(name,sql) in enumerate(phases):
        prefix=session_setup() if i==0 else session_guard(name)
        # Prefix guard output is intentionally distinguishable in the raw stream;
        # exact receipts are admitted using the final phase suffix only below.
        if i:prefix=prefix.split("select jsonb_build_object('a2_session_phase'",1)[0]
        result.append((name,prefix+sql+session_guard(name,initial=i==0)))
    return tuple(result)


def measurement_setup():
    source=dep.capture.retained.SETUP
    assert source.startswith("set timezone='UTC';\n")
    source=source.removeprefix("set timezone='UTC';\n")
    return source+"""
create temp table a2_measure_baseline(id boolean primary key check(id),value jsonb not null);
create function pg_temp.a2_temp_rows()returns jsonb language plpgsql as $$
declare rel record;rows_value jsonb;answer jsonb:='{}';begin
 for rel in select c.relname from pg_class c where c.relnamespace=pg_my_temp_schema()and c.relkind='r'
 and c.relname not in('a2_before_append','a2_measure_baseline')order by c.relname collate "C" loop
 execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text collate "C"),''[]''::jsonb)from pg_temp.%I r',rel.relname)into rows_value;
 answer:=answer||jsonb_build_object(rel.relname,rows_value);end loop;return answer;end$$;
create function pg_temp.a2_temp_catalog()returns jsonb language sql as $$
 select jsonb_build_object('relations',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner,'acl',c.relacl,
 'columns',(select jsonb_agg(to_jsonb(a)order by a.attnum)from pg_attribute a where a.attrelid=c.oid and a.attnum>0),
 'constraints',(select coalesce(jsonb_agg(to_jsonb(t)order by t.conname),'[]')from pg_constraint t where t.conrelid=c.oid),
 'triggers',(select coalesce(jsonb_agg(to_jsonb(t)order by t.tgname),'[]')from pg_trigger t where t.tgrelid=c.oid),
 'index',case when c.relkind='i'then pg_get_indexdef(c.oid)else null end)order by c.relname),'[]')from pg_class c where c.relnamespace=pg_my_temp_schema()),
 'functions',(select coalesce(jsonb_agg(to_jsonb(p)order by p.proname,p.oid),'[]')from pg_proc p where p.pronamespace=pg_my_temp_schema()),
 'types',(select coalesce(jsonb_agg(to_jsonb(t)order by t.typname),'[]')from pg_type t where t.typnamespace=pg_my_temp_schema()));
$$;
create function pg_temp.a2_measure_value()returns jsonb language sql as $$select jsonb_build_object(
 'permanent',"""+dep.capture.retained.VALUE+""",'metadata',controlled_review_v3.snapshot(),'session',pg_temp.a2_runtime_session(),
 'temp_catalog',pg_temp.a2_temp_catalog(),'temp_rows',pg_temp.a2_temp_rows(),'saved_outputs',(select coalesce(jsonb_agg(to_jsonb(r)order by label collate "C"),'[]')from a2_before_append r));$$;
"""


def measured(sql,after):
    assert type(after)is bool
    count=7 if after else 0
    # Setup/observer definitions completed in preceding oracle_setup phase.
    before="select controlled_review_v3.required();\ntruncate pg_temp.a2_measure_baseline;\ninsert into pg_temp.a2_measure_baseline select true,pg_temp.a2_measure_value();\n"
    before+="do $count$ begin if(select count(*)from a2_before_append)<>"+str(count)+" then raise exception 'A2 saved output before count';end if;end $count$;\n"
    check="""do $conserved$ begin
 if(select count(*)from a2_measure_baseline)<>1 or(select value from a2_measure_baseline where id)is distinct from pg_temp.a2_measure_value()then raise exception 'A2 measurement state changed';end if;
 if(select count(*)from a2_before_append)<>7 then raise exception 'A2 saved output after count';end if;
 end $conserved$;
select controlled_review_v3.required();
"""
    if not after:
        check=check.replace('(select value from a2_measure_baseline where id)is distinct from pg_temp.a2_measure_value()',
          "((select value from a2_measure_baseline where id)-'saved_outputs')is distinct from (pg_temp.a2_measure_value()-'saved_outputs')")
    # The oracle proves all seven saved complete values against independently
    # constructed expected values, both at creation and after append.
    return before+sql+check+"select jsonb_build_object('a2_measurement_preserved',true,'after_append',"+str(after).lower()+");\n"
