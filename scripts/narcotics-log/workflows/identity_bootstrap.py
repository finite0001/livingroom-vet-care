"""Only the fixed initial real-user staff bootstrap; no stock facts."""
import uuid

def literal(value):return "'"+str(value).replace("'","''")+"'"

def canonical(value):
 assert type(value)is str and str(uuid.UUID(value))==value and int(uuid.UUID(value))!=0
 return value

def identity_fixture(users):
 assert len(users)==2
 for item in users:canonical(item['id']);canonical(item['session_id'])
 a,b=users
 return f"""begin;
update public.profiles set is_active=true,full_name='LRV synthetic original'where id={literal(a['id'])}::uuid;
update public.profiles set is_active=true,full_name='LRV synthetic reviewer'where id={literal(b['id'])}::uuid;
delete from public.user_roles where user_id in({literal(a['id'])}::uuid,{literal(b['id'])}::uuid);
insert into public.user_roles(user_id,role)values({literal(a['id'])}::uuid,'DVM'),({literal(a['id'])}::uuid,'ADMIN'),({literal(b['id'])}::uuid,'DVM');
do $identity$begin
if(select count(*)from public.profiles where id in({literal(a['id'])}::uuid,{literal(b['id'])}::uuid)and is_active)<>2
or not exists(select 1 from auth.sessions where id={literal(a['session_id'])}::uuid and user_id={literal(a['id'])}::uuid)
or not exists(select 1 from auth.sessions where id={literal(b['session_id'])}::uuid and user_id={literal(b['id'])}::uuid)
then raise exception 'Genuine signed-in identities absent';end if;end$identity$;
commit;"""
