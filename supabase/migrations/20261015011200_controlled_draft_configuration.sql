-- C0: reviewed draft metadata only. No physical writer, opening or activation.
create table public.controlled_draft_entries (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 product_id uuid not null unique references public.catalog_products(id) on delete restrict,
 state text not null default 'draft' check(state='draft'),head_id uuid not null,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default clock_timestamp()
);
create table public.controlled_draft_reviews (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 actor_id uuid not null references auth.users(id) on delete restrict,session_id uuid not null,
 operation text not null check(operation='draft_configuration'),
 request jsonb not null check(jsonb_typeof(request)='object'and octet_length(request::text)<=32768),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default(clock_timestamp()+interval '15 minutes'),
 unique(id,actor_id,operation),check(expires_at>created_at)
);
create index controlled_draft_reviews_actor_idx on public.controlled_draft_reviews(actor_id,expires_at);
create table public.controlled_draft_versions (
 id uuid primary key,entry_id uuid not null references public.controlled_draft_entries(id) on delete restrict,
 version integer not null check(version>0),definition jsonb not null check(jsonb_typeof(definition)='object'),
 product_snapshot jsonb not null check(jsonb_typeof(product_snapshot)='object'),
 action_id uuid not null unique,actor_id uuid not null references auth.users(id) on delete restrict,
 session_id uuid not null,actor_name text not null check(length(actor_name)between 1 and 200),
 created_at timestamptz not null default clock_timestamp(),unique(entry_id,version),unique(id,entry_id)
);
alter table public.controlled_draft_entries add constraint controlled_draft_head_fk
 foreign key(head_id,id)references public.controlled_draft_versions(id,entry_id)deferrable initially deferred;
create table public.controlled_draft_actions (
 id uuid primary key,actor_id uuid not null,session_id uuid not null,operation text not null,
 request jsonb not null,version_id uuid not null unique references public.controlled_draft_versions(id) on delete restrict,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(id,actor_id,operation)references public.controlled_draft_reviews(id,actor_id,operation)on delete restrict
);
alter table public.controlled_draft_versions add constraint controlled_draft_version_action_fk
 foreign key(action_id)references public.controlled_draft_actions(id)deferrable initially deferred;
create table public.controlled_draft_cancellations (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 actor_id uuid not null references auth.users(id) on delete restrict,session_id uuid not null,
 created_at timestamptz not null default clock_timestamp()
);
create function public.controlled_draft_actor(p_actor uuid default null,p_reviewer boolean default false)
 returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid;begin
 if auth.jwt()->>'role'is distinct from 'authenticated'then raise exception 'Authenticated staff required'using errcode='42501';end if;
 actor:=public.clinical_require_staff();perform public.next_visit_review_session();
 if p_actor is not null and actor is distinct from p_actor then raise exception 'Matched draft reviewer required'using errcode='42501';end if;
 if p_reviewer and not exists(select 1 from public.user_roles where user_id=actor and role in('ADMIN','DVM'))then raise exception 'Active veterinarian or administrator required'using errcode='42501';end if;
 return actor;
end $$;
-- Match the browser's Unicode edge-trimming and single-line text contract.
create function public.controlled_draft_text(value jsonb,maximum integer)returns text
 language plpgsql immutable set search_path=public,pg_temp as $$
declare result text:=public.native_rx_text(value,maximum);begin
 return public.inventory_identity_text(to_jsonb(result),maximum);
end $$;
create function public.controlled_draft_validate(p_operation text,p_request jsonb,p_current boolean default true)
 returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb;entry uuid;product uuid;e public.controlled_draft_entries;v public.controlled_draft_versions;p public.catalog_products;k text;begin
 if p_operation is distinct from 'draft_configuration'then raise exception 'Only draft configuration is supported'using errcode='23514';end if;
 perform public.native_rx_keys(p_request,array['id','expected_version','definition','review_note','attest_review']);
 if octet_length(p_request::text)>32768 then raise exception 'Bounded draft review required'using errcode='23514';end if;
 entry:=public.inventory_identity_uuid(p_request->'id');
 if p_request->'expected_version'is distinct from 'null'::jsonb then perform public.appointment_catalog_integer(p_request->'expected_version',1,2147483647);end if;
 perform public.native_rx_text(p_request->'review_note',2000);
 if p_request->'attest_review'is distinct from 'true'::jsonb then raise exception 'Explicit draft-only review required'using errcode='23514';end if;
 d:=p_request->'definition';
 perform public.native_rx_keys(d,array['product_id','product_version','stock_unit','generic_name','brand_name','schedule','concentration','concentration_source','classification_source','configuration_note']);
 product:=public.inventory_identity_uuid(d->'product_id');perform public.appointment_catalog_integer(d->'product_version',1,2147483647);
 perform public.controlled_draft_text(d->'stock_unit',50);perform public.controlled_draft_text(d->'generic_name',200);
 if d->'brand_name'is distinct from 'null'::jsonb then perform public.controlled_draft_text(d->'brand_name',200);end if;
 if jsonb_typeof(d->'schedule')is distinct from 'string'or d->>'schedule'not in('II','III','IV','V')then raise exception 'Explicit proposed schedule II through V required'using errcode='23514';end if;
 perform public.controlled_draft_text(d->'concentration',200);
 foreach k in array array['concentration_source','classification_source','configuration_note']loop perform public.native_rx_text(d->k,2000);end loop;
 select * into e from public.controlled_draft_entries where id=entry;
 if found then
  if e.product_id<>product then raise exception 'Draft product identity is immutable'using errcode='23514';end if;
  select * into v from public.controlled_draft_versions where id=e.head_id;
  if p_current and p_request->'expected_version'is distinct from to_jsonb(v.version)then raise exception 'Draft changed;review current version'using errcode='PT409';end if;
 elsif p_current and p_request->'expected_version'is distinct from 'null'::jsonb then raise exception 'New draft requires null expected version'using errcode='PT409';end if;
 if p_current then
  select * into p from public.catalog_products where id=product;
  if not found or p.kind<>'medication'or not p.active or d->>'stock_unit'is distinct from p.unit or d->'product_version'is distinct from to_jsonb(p.version)then raise exception 'Current active medication/version/unit required'using errcode='PT409';end if;
  if exists(select 1 from public.controlled_draft_entries where product_id=product and id<>entry)then raise exception 'This medication already has a draft configuration'using errcode='23505';end if;
 end if;
end $$;
create function public.controlled_draft_view(p_id uuid,p_version_id uuid default null)returns jsonb
 language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',e.id,'state',e.state,'product_id',e.product_id,'version_id',v.id,'version',v.version,
 'definition',v.definition,'product_snapshot',v.product_snapshot,'actor_id',v.actor_id,'actor_name',v.actor_name,'created_at',public.inventory_identity_instant(v.created_at))
 from public.controlled_draft_entries e join public.controlled_draft_versions v on v.entry_id=e.id and v.id=coalesce(p_version_id,e.head_id)where e.id=p_id
$$;
create function public.controlled_draft_immutable()returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Controlled draft evidence is immutable'using errcode='23514';end $$;
create function public.controlled_draft_entry_guard()returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op<>'UPDATE'then raise exception 'Controlled draft cannot be deleted/truncated'using errcode='23514';end if;
 if row(new.id,new.product_id,new.state,new.created_by,new.created_at)is distinct from row(old.id,old.product_id,old.state,old.created_by,old.created_at)then raise exception 'Only reviewed draft head may advance'using errcode='23514';end if;return new;
end $$;
create trigger controlled_draft_entry_guard before update or delete on public.controlled_draft_entries for each row execute function public.controlled_draft_entry_guard();
create trigger controlled_draft_entry_no_truncate before truncate on public.controlled_draft_entries for each statement execute function public.controlled_draft_entry_guard();
do $$declare name text;begin
 foreach name in array array['controlled_draft_reviews','controlled_draft_versions','controlled_draft_actions','controlled_draft_cancellations']loop
  execute format('create trigger %I_immutable before update or delete on public.%I for each row execute function public.controlled_draft_immutable()',name,name);
  execute format('create trigger %I_no_truncate before truncate on public.%I for each statement execute function public.controlled_draft_immutable()',name,name);
 end loop;
 foreach name in array array['controlled_draft_entries','controlled_draft_reviews','controlled_draft_versions','controlled_draft_actions','controlled_draft_cancellations']loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;
create function public.controlled_draft_consistency()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;version_id uuid;e public.controlled_draft_entries;v public.controlled_draft_versions;a public.controlled_draft_actions;r public.controlled_draft_reviews;begin
 if tg_table_name='controlled_draft_reviews'then
  perform public.controlled_draft_validate(new.operation,new.request,false);return null;
 elsif tg_table_name='controlled_draft_cancellations'then
  if exists(select 1 from public.controlled_draft_actions where id=new.id)or exists(select 1 from public.controlled_draft_reviews where id=new.id and actor_id<>new.actor_id)then raise exception 'Cancellation cannot overwrite saved/other work'using errcode='23514';end if;return null;
 elsif tg_table_name='controlled_draft_entries'then target:=new.id;
 elsif tg_table_name='controlled_draft_versions'then target:=new.entry_id;version_id:=new.id;
 else select entry_id,id into target,version_id from public.controlled_draft_versions where id=new.version_id;end if;
 select * into e from public.controlled_draft_entries where id=target;
 if e.id is null or not exists(select 1 from public.controlled_draft_versions where id=e.head_id and entry_id=e.id and version=(select count(*)from public.controlled_draft_versions where entry_id=e.id)and version=(select max(version)from public.controlled_draft_versions where entry_id=e.id))then raise exception 'Exact contiguous draft head/history required'using errcode='23514';end if;
 select * into v from public.controlled_draft_versions where id=coalesce(version_id,e.head_id)and entry_id=e.id;
 select * into a from public.controlled_draft_actions where id=v.action_id;select * into r from public.controlled_draft_reviews where id=v.action_id;
 if v.id is null or a.id is null or r.id is null then raise exception 'Draft version requires reviewed action'using errcode='23514';end if;
 perform public.controlled_draft_validate(r.operation,r.request,false);
 if r.request->>'id'<>e.id::text or(r.request->'expected_version'='null'::jsonb and v.version<>1)or(r.request->'expected_version'<>'null'::jsonb and(r.request->>'expected_version')::integer<>v.version-1)then raise exception 'Draft version requires exact predecessor/identity'using errcode='23514';end if;
 if a.version_id<>v.id or a.actor_id<>v.actor_id or r.actor_id<>v.actor_id or a.session_id<>v.session_id
 or a.request is distinct from r.request or r.request->'definition'is distinct from v.definition
 or v.definition->>'product_id'<>e.product_id::text
 or v.product_snapshot->>'id'<>e.product_id::text or v.product_snapshot->'version'is distinct from v.definition->'product_version'
 or v.product_snapshot->>'unit'is distinct from v.definition->>'stock_unit'or v.product_snapshot->>'kind'is distinct from 'medication'
 or not(v.product_snapshot ?& array['id','version','name','kind','manufacturer','unit','active'])
 or a.receipt is distinct from jsonb_build_object('id',a.id,'actor_id',a.actor_id,'operation',a.operation,'entry',public.controlled_draft_view(e.id,v.id))
 or exists(select 1 from public.controlled_draft_cancellations where id=a.id)then raise exception 'Exact immutable draft request/version/receipt required'using errcode='23514';end if;
 return null;
end $$;
do $$declare name text;begin
 foreach name in array array['controlled_draft_entries','controlled_draft_reviews','controlled_draft_versions','controlled_draft_actions','controlled_draft_cancellations']loop
  execute format('create constraint trigger %I_consistency after insert or update on public.%I deferrable initially deferred for each row execute function public.controlled_draft_consistency()',name,name);
 end loop;
end $$;
create function public.read_controlled_draft_review(p_actor_id uuid,p_action_id uuid)returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.controlled_draft_actor(p_actor_id);r controlled_draft_reviews;a controlled_draft_actions;c controlled_draft_cancellations;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 select * into r from controlled_draft_reviews where id=p_action_id;select * into a from controlled_draft_actions where id=p_action_id;select * into c from controlled_draft_cancellations where id=p_action_id;
 if(r.id is not null and r.actor_id<>actor)or(a.id is not null and a.actor_id<>actor)or(c.id is not null and c.actor_id<>actor)then raise exception 'Controlled draft review belongs to another account' using errcode='42501';end if;
 if r.id is null then return case when c.id is null then null else jsonb_build_object('id',c.id,'actor_id',c.actor_id,'state','cancelled','operation',null,'request',null,'expires_at',null,'receipt',null)end;end if;
 if a.id is not null and(a.request is distinct from r.request or a.operation<>r.operation)then raise exception 'Controlled draft action receipt collision' using errcode='23505';end if;
 return jsonb_build_object('id',r.id,'actor_id',r.actor_id,'operation',r.operation,'request',r.request,'expires_at',public.inventory_identity_instant(r.expires_at),'receipt',a.receipt,
 'state',case when a.id is not null then 'saved'when c.id is not null then 'cancelled'when r.expires_at<=clock_timestamp()then 'expired'else 'prepared'end);
end $$;
create function public.prepare_controlled_draft_review(p_actor_id uuid,p_action_id uuid,p_operation text,p_request jsonb)returns jsonb
 language plpgsql security definer set search_path=public,pg_temp set lock_timeout='2s' set statement_timeout='5s' as $$
declare actor uuid:=public.controlled_draft_actor(p_actor_id,true);r controlled_draft_reviews;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 perform public.inventory_identity_uuid(to_jsonb(p_action_id));perform pg_advisory_xact_lock(90271030,hashtext(actor::text));perform pg_advisory_xact_lock(90271031,hashtext(p_action_id::text));perform public.controlled_draft_actor(p_actor_id,true);
 select * into r from controlled_draft_reviews where id=p_action_id;
 if found then if r.actor_id<>actor or r.operation is distinct from p_operation or r.request is distinct from p_request then raise exception 'Controlled draft review UUID is immutable' using errcode='23505';end if;return public.read_controlled_draft_review(actor,p_action_id);end if;
 if exists(select 1 from controlled_draft_cancellations where id=p_action_id)then raise exception 'Controlled draft action cancelled;check saved work' using errcode='PT409';end if;
 perform public.controlled_draft_validate(p_operation,p_request);
 if(select count(*)from controlled_draft_reviews rv where actor_id=actor and expires_at>clock_timestamp()and not exists(select 1 from controlled_draft_actions a where a.id=rv.id)and not exists(select 1 from controlled_draft_cancellations c where c.id=rv.id))>=32 then raise exception 'Check pending controlled draft reviews first' using errcode='23514';end if;
 insert into controlled_draft_reviews(id,actor_id,session_id,operation,request)values(p_action_id,actor,public.next_visit_review_session(),p_operation,p_request);
 return public.read_controlled_draft_review(actor,p_action_id);
end $$;
create function public.execute_controlled_draft_review(p_actor_id uuid,p_action_id uuid)returns jsonb
 language plpgsql security definer set search_path=public,pg_temp set lock_timeout='2s' set statement_timeout='5s' as $$
declare actor uuid:=public.controlled_draft_actor(p_actor_id,true);r public.controlled_draft_reviews;a public.controlled_draft_actions;e public.controlled_draft_entries;v public.controlled_draft_versions;
 entry uuid;product uuid;new_version uuid:=gen_random_uuid();sequence integer;d jsonb;p public.catalog_products;snapshot jsonb;receipt jsonb;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required'using errcode='42501';end if;
 perform public.inventory_identity_uuid(to_jsonb(p_action_id));
 perform pg_advisory_xact_lock(90271030,hashtext(actor::text));perform pg_advisory_xact_lock(90271031,hashtext(p_action_id::text));perform public.controlled_draft_actor(p_actor_id,true);
 select * into r from public.controlled_draft_reviews where id=p_action_id;if not found or r.actor_id<>actor then raise exception 'Own prepared draft review required'using errcode='42501';end if;
 select * into a from public.controlled_draft_actions where id=p_action_id;
 if found then if a.request is distinct from r.request or a.operation<>r.operation then raise exception 'Draft receipt collision'using errcode='23505';end if;return a.receipt;end if;
 if r.expires_at<=clock_timestamp()or exists(select 1 from public.controlled_draft_cancellations where id=p_action_id)then raise exception 'Draft review expired/cancelled;recover saved work'using errcode='PT409';end if;
 entry:=public.inventory_identity_uuid(r.request->'id');d:=r.request->'definition';product:=public.inventory_identity_uuid(d->'product_id');
 -- Product-wide serialization prevents two different draft IDs for one medication.
 perform pg_advisory_xact_lock(90271032,hashtext(product::text));
 select * into p from public.catalog_products where id=product for share;
 perform public.controlled_draft_actor(p_actor_id,true);
 if r.expires_at<=clock_timestamp()then raise exception 'Draft review expired while waiting;recover saved work'using errcode='PT409';end if;
 perform public.controlled_draft_validate(r.operation,r.request);
 snapshot:=jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'kind',p.kind,'manufacturer',p.manufacturer,'unit',p.unit,'active',p.active);
 select * into e from public.controlled_draft_entries where id=entry for update;
 if found then select * into v from public.controlled_draft_versions where id=e.head_id;sequence:=v.version+1;update public.controlled_draft_entries set head_id=new_version where id=entry;
 else sequence:=1;insert into public.controlled_draft_entries(id,product_id,head_id,created_by)values(entry,p.id,new_version,actor);end if;
 insert into public.controlled_draft_versions(id,entry_id,version,definition,product_snapshot,action_id,actor_id,session_id,actor_name)
 values(new_version,entry,sequence,d,snapshot,p_action_id,actor,public.next_visit_review_session(),(select left(coalesce(nullif(btrim(full_name),''),'Staff member'),200)from public.profiles where id=actor));
 perform public.controlled_draft_actor(p_actor_id,true);
 receipt:=jsonb_build_object('id',p_action_id,'actor_id',actor,'operation',r.operation,'entry',public.controlled_draft_view(entry,new_version));
 insert into public.controlled_draft_actions(id,actor_id,session_id,operation,request,version_id,receipt)values(p_action_id,actor,public.next_visit_review_session(),r.operation,r.request,new_version,receipt);
 return receipt;
end $$;
create function public.cancel_controlled_draft_review(p_actor_id uuid,p_action_id uuid)returns jsonb
 language plpgsql security definer set search_path=public,pg_temp set lock_timeout='2s' set statement_timeout='5s' as $$
declare actor uuid:=public.controlled_draft_actor(p_actor_id);r controlled_draft_reviews;a controlled_draft_actions;c controlled_draft_cancellations;begin
 if p_actor_id is null or p_action_id is null then raise exception 'Matched reviewer/action required' using errcode='42501';end if;
 perform public.inventory_identity_uuid(to_jsonb(p_action_id));perform pg_advisory_xact_lock(90271030,hashtext(actor::text));perform pg_advisory_xact_lock(90271031,hashtext(p_action_id::text));perform public.controlled_draft_actor(p_actor_id);
 select * into r from controlled_draft_reviews where id=p_action_id;select * into a from controlled_draft_actions where id=p_action_id;select * into c from controlled_draft_cancellations where id=p_action_id;
 if(r.id is not null and r.actor_id<>actor)or(a.id is not null and a.actor_id<>actor)or(c.id is not null and c.actor_id<>actor)then raise exception 'Controlled draft review belongs to another account' using errcode='42501';end if;
 if a.id is not null then return jsonb_build_object('cancelled',false,'receipt',a.receipt);end if;
 insert into controlled_draft_cancellations(id,actor_id,session_id)values(p_action_id,actor,public.next_visit_review_session())on conflict(id)do nothing;
 return jsonb_build_object('cancelled',true,'receipt',null);
end $$;
create function public.list_controlled_drafts(p_search text default '',p_after uuid default null,p_limit integer default 50)returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 perform public.controlled_draft_actor();
 if p_search is null or length(p_search)>200 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Bounded draft search required'using errcode='23514';end if;
 with candidates as materialized(select e.id from public.controlled_draft_entries e join public.controlled_draft_versions v on v.id=e.head_id where(p_after is null or e.id>p_after)and(p_search=''or position(lower(p_search)in lower(v.definition->>'generic_name'))>0 or position(lower(p_search)in lower(v.product_snapshot->>'name'))>0)order by e.id limit p_limit+1),page as materialized(select id from candidates order by id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(public.controlled_draft_view(id)order by id)from page),'[]'),'next',case when(select count(*)from candidates)>p_limit then(select id from page order by id desc limit 1)end)into result;return result;
end $$;
create function public.read_controlled_draft(p_id uuid,p_before_version integer default null,p_limit integer default 20)returns jsonb
 language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;begin
 perform public.controlled_draft_actor();if p_id is null or p_limit is null or p_limit not between 1 and 100 or(p_before_version is not null and p_before_version<1)then raise exception 'Bounded draft/history required'using errcode='23514';end if;
 if not exists(select 1 from public.controlled_draft_entries where id=p_id)then return null;end if;
 with candidates as materialized(select id,version from public.controlled_draft_versions where entry_id=p_id and(p_before_version is null or version<p_before_version)order by version desc limit p_limit+1),page as materialized(select id,version from candidates order by version desc limit p_limit)
 select jsonb_build_object('entry',public.controlled_draft_view(p_id),'current_product',(select jsonb_build_object('id',p.id,'version',p.version,'name',p.name,'kind',p.kind,'manufacturer',p.manufacturer,'unit',p.unit,'active',p.active)from public.catalog_products p join public.controlled_draft_entries e on e.product_id=p.id where e.id=p_id),'history',coalesce((select jsonb_agg(public.controlled_draft_view(p_id,id)order by version desc)from page),'[]'),'next',case when(select count(*)from candidates)>p_limit then(select min(version)from page)end)into result;return result;
end $$;
do $$declare f regprocedure;name text;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and(proname like 'controlled_draft_%'or proname in('read_controlled_draft_review','prepare_controlled_draft_review','execute_controlled_draft_review','cancel_controlled_draft_review','list_controlled_drafts','read_controlled_draft'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
 foreach name in array array['read_controlled_draft_review','prepare_controlled_draft_review','execute_controlled_draft_review','cancel_controlled_draft_review','list_controlled_drafts','read_controlled_draft']loop
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname=name loop execute format('grant execute on function %s to authenticated',f);end loop;
 end loop;
end $$;
