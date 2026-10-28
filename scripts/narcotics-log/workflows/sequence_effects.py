"""Closed fresh-three-grant serial effect only; never a general rowcount law."""
from copy import deepcopy

NAME='auth.refresh_tokens_id_seq'
CONFIG={'type':'bigint','start':1,'increment':1,'min':1,'max':9223372036854775807,'cache':1,'cycle':False}
PREREQUISITE={'owner':'supabase_auth_admin','kind':'S','id_type':'bigint','id_not_null':True,
 'id_default':"nextval('auth.refresh_tokens_id_seq'::regclass)",'owned_by_id':True,'config':CONFIG}

SQL="""create function pg_temp.scalar_sequence_states()returns jsonb language plpgsql as $seq$
declare r record;v jsonb;answer jsonb:='{}';begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','auth','storage','extensions','supabase_migrations','controlled_review','controlled_review_v3')and c.relkind='S'order by 1,2 loop
 execute format('select jsonb_build_object(''last_value'',last_value,''is_called'',is_called)from %I.%I',r.nspname,r.relname)into v;
 answer:=answer||jsonb_build_object(r.nspname||'.'||r.relname,v);
 end loop;return answer;end$seq$;
select pg_temp.scalar_sequence_states();"""


def initial(states,auth):
    if any(auth[k]!=[]for k in auth)or states.get(NAME)!={'last_value':1,'is_called':False}:raise ValueError('Fresh empty genuine-Auth fixture required')
    return states

def final(before,after,grants,clinical=False):
    if type(grants)is not int or grants not in(2,3,4)or type(clinical)is not bool:raise ValueError('Fixed genuine source profile required')
    wanted=deepcopy(before);wanted[NAME]={'last_value':grants,'is_called':True}
    if clinical:
        name='public.anesthesia_record_revisions_id_seq'
        if before.get(name)!={'last_value':1,'is_called':False}:raise ValueError('Fresh native anesthesia revision sequence required')
        wanted[name]={'last_value':1,'is_called':True}
    if after!=wanted:raise ValueError('Only source-declared genuine password grants and optional anesthesia birth may allocate sequences')
    return dict(password_grants=grants,anesthesia_birth=int(clinical),all_other_sequences_exact=True)
