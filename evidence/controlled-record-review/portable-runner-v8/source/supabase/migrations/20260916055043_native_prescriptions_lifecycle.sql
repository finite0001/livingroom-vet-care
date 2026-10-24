-- Native authorization only: no stock, invoice, treatment or delivery effects.
create table public.native_prescriber_configurations (
 user_id uuid not null references public.profiles(id), version integer not null check(version>0), fields jsonb not null,
 configured_by uuid not null references public.profiles(id), configured_at timestamptz not null,
 primary key(user_id,version)
);
create table public.native_prescription_drafts (
 id uuid primary key,pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),
 version integer not null check(version>0),fields jsonb not null,status text not null check(status in ('draft','signed')),
 authorization_id uuid unique,created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null,updated_at timestamptz not null,check((status='draft')=(authorization_id is null))
);
create index native_prescription_draft_patient on public.native_prescription_drafts(pet_id,created_at desc,id desc);
create table public.native_prescription_authorizations (
 id uuid primary key,pet_id uuid not null references public.pets(id),client_id uuid not null references public.clients(id),
 draft_id uuid not null unique references public.native_prescription_drafts(id),document jsonb not null
);
alter table public.native_prescription_drafts add foreign key(authorization_id) references public.native_prescription_authorizations(id);
create table public.native_prescription_operations (
 id uuid primary key,actor_id uuid not null references public.profiles(id),operation text not null check(operation in ('configure_prescriber','save_draft','sign')),
 pet_id uuid references public.pets(id),request jsonb not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),result jsonb not null,created_at timestamptz not null
);
create table public.native_prescription_draft_revisions (
 operation_id uuid primary key references public.native_prescription_operations(id),draft_id uuid not null references public.native_prescription_drafts(id),version integer not null,snapshot jsonb not null,unique(draft_id,version)
);
create function public.native_rx_audit() returns trigger language plpgsql security definer set search_path=public as $$
declare n jsonb:=to_jsonb(NEW);o jsonb;rid uuid;
begin
 if TG_OP='UPDATE' then o:=to_jsonb(OLD);end if;
 rid:=coalesce(n->>'id',n->>'operation_id',n->>'user_id')::uuid;
 if rid is null then raise exception 'Native prescription audit identity required' using errcode='23514';end if;
 insert into public.audit_logs(user_id,action,table_name,record_id,old_data,new_data) values(auth.uid(),TG_OP,TG_TABLE_NAME,rid,o,n);
 return NEW;
end $$;
do $$declare t text;begin
 foreach t in array array['native_prescriber_configurations','native_prescription_drafts','native_prescription_authorizations','native_prescription_operations','native_prescription_draft_revisions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger native_prescription_audit after insert or update on public.%I for each row execute function public.native_rx_audit()',t);
 if t<>'native_prescription_drafts' then execute format('create trigger native_prescription_immutable before update or delete on public.%I for each row execute function public.guard_inquiry_history()',t);end if;
 end loop;
end $$;
create function public.native_rx_keys(v jsonb,keys text[]) returns void language plpgsql immutable set search_path=public as $$
begin if v is null or jsonb_typeof(v)<>'object' or not v ?& keys or (select count(*) from jsonb_object_keys(v))<>cardinality(keys) then raise exception 'Exact prescription fields required' using errcode='23514';end if;end $$;
create function public.native_rx_text(v jsonb,max_length integer) returns text language plpgsql immutable set search_path=public as $$
declare t text:=v#>>'{}';begin
 if jsonb_typeof(v) is distinct from 'string' or t<>btrim(t,chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) or length(t) not between 1 and max_length or t ~ '[\x01-\x08\x0B-\x1F\x7F]' then raise exception 'Invalid prescription text' using errcode='23514';end if;return t;
end $$;
create function public.native_rx_valid_text(v jsonb,max_length integer) returns boolean language plpgsql immutable set search_path=public as $$
begin perform public.native_rx_text(v,max_length);return true;exception when check_violation then return false;end $$;
create function public.native_rx_day(v jsonb) returns date language plpgsql immutable set search_path=public as $$
declare t text:=v#>>'{}';d date;begin
 if jsonb_typeof(v) is distinct from 'string' or t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid prescription date' using errcode='23514';end if;
 d:=t::date;if not isfinite(d) or to_char(d,'YYYY-MM-DD')<>t then raise exception 'Invalid prescription date' using errcode='23514';end if;return d;
exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Invalid prescription date' using errcode='23514';end $$;
create function public.native_rx_uuid(v jsonb,nullable boolean default false) returns uuid language plpgsql immutable set search_path=public as $$
begin
 if nullable and v='null'::jsonb then return null;end if;
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid prescription identity' using errcode='23514';end if;
 return (v#>>'{}')::uuid;
end $$;
create function public.native_rx_revision(v jsonb) returns integer language plpgsql immutable set search_path=public as $$
begin if v='null'::jsonb then return null;end if;
 if jsonb_typeof(v) is distinct from 'number' or (v#>>'{}') !~ '^[1-9][0-9]{0,9}$' or (v#>>'{}')::numeric>2147483647 then raise exception 'Invalid prescription revision' using errcode='23514';end if;return (v#>>'{}')::integer;end $$;
create function public.native_rx_require_admin() returns uuid language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();begin if not exists(select 1 from public.user_roles where user_id=a and role='ADMIN') then raise exception 'Active administrator required' using errcode='42501';end if;return a;end $$;
create function public.native_rx_require_dvm() returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();c public.native_prescriber_configurations;n text;
begin
 if not exists(select 1 from public.user_roles where user_id=a and role='DVM') then raise exception 'Configured veterinarian required' using errcode='42501';end if;
 select * into c from public.native_prescriber_configurations where user_id=a order by version desc limit 1;
 select full_name into n from public.profiles where id=a;
 if c.user_id is null or (c.fields->>'active')::boolean is not true or (c.fields->>'license_expires_on')::date<(now() at time zone 'America/Denver')::date or not public.native_rx_valid_text(to_jsonb(n),200) then raise exception 'Current native prescriber commissioning required' using errcode='42501';end if;
 return jsonb_build_object('user_id',a,'name',n,'configuration',to_jsonb(c));
end $$;
create function public.native_rx_receipt(r public.native_prescription_operations) returns jsonb language sql immutable set search_path=public as $$
 select jsonb_build_object('version',1,'id',r.id,'actor_id',r.actor_id,'operation',r.operation,'pet_id',r.pet_id,'request',r.request,'request_hash',r.request_hash,'result',r.result,'created_at',r.created_at);
$$;
create function public.native_rx_begin(p_id uuid,p_operation text,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r public.native_prescription_operations;
begin
 if p_id is null or p_request is null or jsonb_typeof(p_request)<>'object' or octet_length(p_request::text)>32768 then raise exception 'Bounded prescription operation required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-operation:'||p_id::text,0));perform public.clinical_require_staff();
 select * into r from public.native_prescription_operations where id=p_id;
 if found then
 if r.actor_id<>a or r.operation<>p_operation or r.request is distinct from p_request then raise exception 'Prescription operation identity cannot change' using errcode='23514';end if;
 if p_operation='configure_prescriber' then perform public.native_rx_require_admin();end if;return public.native_rx_receipt(r);end if;
 return null;
end $$;
create function public.native_rx_finish(p_id uuid,p_operation text,p_pet_id uuid,p_request jsonb,p_result jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r public.native_prescription_operations;
begin
 insert into public.native_prescription_operations values(p_id,a,p_operation,p_pet_id,p_request,encode(sha256(convert_to(jsonb_build_object('version',1,'actor_id',a,'operation',p_operation,'request',p_request)::text,'UTF8')),'hex'),p_result,clock_timestamp()) returning * into r;
 return public.native_rx_receipt(r);
end $$;
create function public.recover_native_prescription_operation(p_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();r public.native_prescription_operations;
begin select * into r from public.native_prescription_operations where id=p_id and actor_id=a;if not found then return null;end if;
 if r.operation='configure_prescriber' then perform public.native_rx_require_admin();end if;return public.native_rx_receipt(r);end $$;
create function public.configure_native_prescriber(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.native_rx_require_admin();u uuid;ev integer;c public.native_prescriber_configurations;f jsonb;r jsonb;k text;
begin
 r:=public.native_rx_begin(p_id,'configure_prescriber',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['user_id','expected_version','fields','attest_review']);
 u:=public.native_rx_uuid(p_request->'user_id');ev:=public.native_rx_revision(p_request->'expected_version');f:=p_request->'fields';
 perform public.native_rx_keys(f,array['active','license_number','license_state','license_expires_on','practice_name','practice_address','practice_phone','clinical_review_note']);
 if p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(f->'active') is distinct from 'boolean' then raise exception 'Explicit commissioning review required' using errcode='23514';end if;
 foreach k in array array['license_number','license_state'] loop perform public.native_rx_text(f->k,100);end loop;
 perform public.native_rx_text(f->'practice_name',200);perform public.native_rx_text(f->'practice_address',1000);perform public.native_rx_text(f->'clinical_review_note',2000);
 if f->'practice_phone'<>'null'::jsonb then perform public.native_rx_text(f->'practice_phone',100);end if;perform public.native_rx_day(f->'license_expires_on');
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||u::text,0));perform public.native_rx_require_admin();
 if not exists(select 1 from public.profiles where id=u) or ((f->>'active')::boolean and not exists(select 1 from public.user_roles where user_id=u and role='DVM')) then raise exception 'Existing veterinarian required for commissioning' using errcode='23514';end if;
 select * into c from public.native_prescriber_configurations where user_id=u order by version desc limit 1;
 if c.version is distinct from ev then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 insert into public.native_prescriber_configurations values(u,coalesce(ev,0)+1,f,a,clock_timestamp()) returning * into c;
 perform public.native_rx_require_admin();return public.native_rx_finish(p_id,'configure_prescriber',null,p_request,to_jsonb(c));
end $$;
create function public.list_native_prescribers(p_after_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid prescriber page' using errcode='23514';end if;
 with bounded as materialized (
 select p.id,p.full_name,public.is_active_staff(p.id) active_staff,exists(select 1 from public.user_roles ur where ur.user_id=p.id and ur.role='DVM') dvm,c.*
 from public.profiles p left join lateral(select to_jsonb(c) configuration,c.fields from public.native_prescriber_configurations c where c.user_id=p.id order by c.version desc limit 1)c on true
 where (p_after_id is null or p.id>p_after_id) and (c.configuration is not null or exists(select 1 from public.user_roles ur where ur.user_id=p.id and ur.role='DVM')) order by p.id limit p_limit+1
 ), selected as (select * from bounded order by id limit p_limit)
 select jsonb_build_object('version',1,'entries',(select coalesce(jsonb_agg(jsonb_build_object('user_id',id,'name',full_name,'active_staff',active_staff,'has_dvm_role',dvm,'configuration',configuration,'eligible',active_staff and dvm and coalesce((fields->>'active')::boolean,false) and coalesce((fields->>'license_expires_on')::date>=(now() at time zone 'America/Denver')::date,false) and public.native_rx_valid_text(to_jsonb(full_name),200)) order by id),'[]') from selected),
 'has_more',(select count(*)>p_limit from bounded),'next_after_id',case when (select count(*)>p_limit from bounded) then(select id from selected order by id desc limit 1) else null end) into r;
 return r;end $$;
create function public.native_rx_validate_fields(f jsonb,p_pet uuid,p_client uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare product public.catalog_products;enc uuid;pid uuid;q numeric;k text;stock_unit text;mode text;
begin
 perform public.native_rx_keys(f,array['encounter_id','medication','quantity_per_fill','unit','refills_authorized','fulfillment_mode','product_id','starts_on','expires_on']);
 perform public.native_rx_keys(f->'medication',array['name','strength','form','directions','route']);
 foreach k in array array['name','strength'] loop perform public.native_rx_text(f->'medication'->k,200);end loop;
 foreach k in array array['form','route'] loop perform public.native_rx_text(f->'medication'->k,100);end loop;perform public.native_rx_text(f->'medication'->'directions',4000);
 stock_unit:=public.native_rx_text(f->'unit',50);mode:=f->>'fulfillment_mode';
 if jsonb_typeof(f->'quantity_per_fill') is distinct from 'string' or (f->>'quantity_per_fill') !~ '^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$' then raise exception 'Invalid prescription quantity' using errcode='23514';end if;
 q:=(f->>'quantity_per_fill')::numeric;if q<=0 or q>99999999999.999 then raise exception 'Invalid prescription quantity' using errcode='23514';end if;
 if jsonb_typeof(f->'refills_authorized') is distinct from 'number' or (f->>'refills_authorized') !~ '^(0|[1-9][0-9]{0,3})$' or (f->>'refills_authorized')::integer>1000 then raise exception 'Invalid refill allowance' using errcode='23514';end if;
 if mode is null or mode not in ('practice_stock','external_pharmacy') then raise exception 'Explicit fulfillment mode required' using errcode='23514';end if;
 if public.native_rx_day(f->'expires_on')<public.native_rx_day(f->'starts_on') then raise exception 'Invalid prescription date order' using errcode='23514';end if;
 perform 1 from public.pets where id=p_pet and client_id=p_client and archived_at is null and deceased_at is null for share;if not found then raise exception 'Active patient household required' using errcode='23514';end if;
 enc:=public.native_rx_uuid(f->'encounter_id',true);if enc is not null then perform 1 from public.clinical_encounters where id=enc and pet_id=p_pet for share;if not found then raise exception 'Encounter patient mismatch' using errcode='23514';end if;end if;
 pid:=public.native_rx_uuid(f->'product_id',true);
 if mode='external_pharmacy' and pid is not null then raise exception 'External orders cannot select stock' using errcode='23514';end if;
 if mode='practice_stock' then
 select * into product from public.catalog_products where id=pid and kind='medication' and active and unit=stock_unit for share;
 if product.id is null or product.unit<>stock_unit then raise exception 'Exact active medication product and unit required' using errcode='23514';end if;
 end if;
 return jsonb_set(f,'{quantity_per_fill}',to_jsonb(q::numeric(14,3)::text));
end $$;
create function public.save_native_prescription_draft(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();d public.native_prescription_drafts;di uuid;pet uuid;client uuid;ev integer;f jsonb;r jsonb;stamp timestamptz:=clock_timestamp();
begin
 r:=public.native_rx_begin(p_id,'save_draft',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['draft_id','pet_id','client_id','expected_version','fields']);
 di:=public.native_rx_uuid(p_request->'draft_id');pet:=public.native_rx_uuid(p_request->'pet_id');client:=public.native_rx_uuid(p_request->'client_id');ev:=public.native_rx_revision(p_request->'expected_version');
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform public.clinical_require_staff();
 select * into d from public.native_prescription_drafts where id=di for update;
 if d.version is distinct from ev then raise exception 'Prescription draft changed' using errcode='40001';end if;
 if d.id is not null and (d.pet_id<>pet or d.client_id<>client or d.status<>'draft') then raise exception 'Signed draft or patient identity cannot change' using errcode='23514';end if;
 f:=public.native_rx_validate_fields(p_request->'fields',pet,client);
 if d.id is null then insert into public.native_prescription_drafts values(di,pet,client,1,f,'draft',null,a,a,stamp,stamp) returning * into d;
 else update public.native_prescription_drafts set fields=f,version=version+1,updated_by=a,updated_at=stamp where id=di returning * into d;end if;
 r:=public.native_rx_finish(p_id,'save_draft',pet,p_request,to_jsonb(d));
 insert into public.native_prescription_draft_revisions values(p_id,d.id,d.version,to_jsonb(d));return r;
end $$;
create function public.read_native_prescription_draft(p_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();select to_jsonb(d) into r from public.native_prescription_drafts d where id=p_id and pet_id=p_pet_id;return r;end $$;
create function public.list_native_prescription_drafts(p_pet_id uuid,p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();
 if p_pet_id is null or not exists(select 1 from public.pets where id=p_pet_id) or (p_before_at is null)<>(p_before_id is null) or (p_before_at is not null and not isfinite(p_before_at)) or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid prescription page' using errcode='23514';end if;
 with bounded as materialized(select * from public.native_prescription_drafts d where pet_id=p_pet_id and (p_before_at is null or (created_at,id)<(p_before_at,p_before_id)) order by created_at desc,id desc limit p_limit+1), selected as(select * from bounded order by created_at desc,id desc limit p_limit)
 select jsonb_build_object('version',1,'pet_id',p_pet_id,'drafts',(select coalesce(jsonb_agg(to_jsonb(d) order by created_at desc,id desc),'[]') from selected d),'has_more',(select count(*)>p_limit from bounded),'next_cursor',case when (select count(*)>p_limit from bounded) then (select jsonb_build_object('before_at',created_at,'before_id',id) from selected order by created_at,id limit 1) else null end) into r;return r;
end $$;
create function public.read_native_prescription_authorization(p_id uuid,p_pet_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb;begin perform public.clinical_require_staff();select document into r from public.native_prescription_authorizations where id=p_id and pet_id=p_pet_id;return r;end $$;
create function public.preview_native_prescription_sign(p_draft_id uuid,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();d public.native_prescription_drafts;pet public.pets;client public.clients;product public.catalog_products;prescriber jsonb;alerts jsonb;ctx jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));prescriber:=public.native_rx_require_dvm();
 select * into d from public.native_prescription_drafts where id=p_draft_id for share;
 if d.id is null or d.version is distinct from p_expected_version or d.status<>'draft' then raise exception 'Prescription draft changed' using errcode='40001';end if;
 alerts:=public.read_patient_treatment_alerts(d.pet_id);
 perform public.native_rx_validate_fields(d.fields,d.pet_id,d.client_id);
 select * into pet from public.pets where id=d.pet_id for share;select * into client from public.clients where id=d.client_id for share;
 if (d.fields->>'expires_on')::date<(now() at time zone 'America/Denver')::date then raise exception 'Prescription order has expired' using errcode='23514';end if;
 if nullif(btrim(concat_ws(' ',client.first_name,client.last_name)),'') is null or coalesce(nullif(btrim(client.mailing_address),''),nullif(btrim(client.housecall_address),'')) is null then raise exception 'Household name and address required for signing' using errcode='23514';end if;
 select * into product from public.catalog_products where id=(d.fields->>'product_id')::uuid for share;
 ctx:=jsonb_build_object('version',1,'draft',to_jsonb(d),'patient',jsonb_build_object('id',pet.id,'version',pet.version,'name',pet.name,'species',pet.species),
 'household',jsonb_build_object('id',client.id,'version',client.version,'name',concat_ws(' ',client.first_name,client.last_name),'address',coalesce(nullif(btrim(client.mailing_address),''),nullif(btrim(client.housecall_address),''))),
 'prescriber',prescriber,'product',case when product.id is null then null else jsonb_build_object('id',product.id,'version',product.version,'name',product.name,'unit',product.unit) end,'alerts',alerts);
 if prescriber is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 return jsonb_build_object('version',1,'actor_id',a,'draft_id',d.id,'pet_id',d.pet_id,'context',ctx,'context_hash',encode(sha256(convert_to(ctx::text,'UTF8')),'hex'),'observed_at',statement_timestamp());
end $$;
create function public.sign_native_prescription(p_id uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.clinical_require_staff();di uuid;pet uuid;ev integer;preview jsonb;ctx jsonb;r jsonb;stamp timestamptz;h text;artifact jsonb;document jsonb;
begin
 r:=public.native_rx_begin(p_id,'sign',p_request);if r is not null then return r;end if;
 perform public.native_rx_keys(p_request,array['draft_id','pet_id','expected_version','expected_context_hash','signature_name','attest_review']);
 di:=public.native_rx_uuid(p_request->'draft_id');pet:=public.native_rx_uuid(p_request->'pet_id');ev:=public.native_rx_revision(p_request->'expected_version');
 perform public.native_rx_text(p_request->'signature_name',200);
 if ev is null or p_request->'attest_review' is distinct from 'true'::jsonb or jsonb_typeof(p_request->'expected_context_hash') is distinct from 'string' or (p_request->>'expected_context_hash') !~ '^[a-f0-9]{64}$' then raise exception 'Exact signing review required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-prescriber:'||a::text,0));perform public.native_rx_require_dvm();
 perform pg_advisory_xact_lock(hashtextextended('native-prescription-draft:'||di::text,0));perform 1 from public.native_prescription_drafts where id=di for update;
 preview:=public.preview_native_prescription_sign(di,ev);ctx:=preview->'context';
 if (preview->>'pet_id')::uuid<>pet then raise exception 'Prescription patient mismatch' using errcode='23514';end if;
 if preview->>'context_hash'<>p_request->>'expected_context_hash' then raise exception 'Prescription signing context changed' using errcode='40001';end if;
 if p_request->>'signature_name'<>ctx#>>'{prescriber,name}' then raise exception 'Signature must match reviewed veterinarian identity' using errcode='23514';end if;
 stamp:=clock_timestamp();h:=encode(sha256(convert_to(jsonb_build_object('version',1,'id',p_id,'draft_id',di,'draft_version',ev,'actor_id',a,'context_hash',preview->>'context_hash','signature_name',p_request->>'signature_name','signed_at',stamp)::text,'UTF8')),'hex');
 artifact:=jsonb_build_object('schema_version',1,'authorization_id',p_id,'authorization_hash',h,'signed_at',stamp,'signature_name',p_request->>'signature_name',
 'patient',(ctx->'patient')-'version','household',(ctx->'household')-'version',
 'prescriber',jsonb_build_object('user_id',a,'name',ctx#>>'{prescriber,name}','license_number',ctx#>>'{prescriber,configuration,fields,license_number}','license_state',ctx#>>'{prescriber,configuration,fields,license_state}','practice_name',ctx#>>'{prescriber,configuration,fields,practice_name}','practice_address',ctx#>>'{prescriber,configuration,fields,practice_address}','practice_phone',ctx#>'{prescriber,configuration,fields,practice_phone}'),
 'medication',ctx#>'{draft,fields,medication}','quantity_per_fill',ctx#>'{draft,fields,quantity_per_fill}','unit',ctx#>'{draft,fields,unit}','refills_authorized',ctx#>'{draft,fields,refills_authorized}','fulfillment_mode',ctx#>'{draft,fields,fulfillment_mode}','starts_on',ctx#>'{draft,fields,starts_on}','expires_on',ctx#>'{draft,fields,expires_on}');
 document:=jsonb_build_object('id',p_id,'pet_id',pet,'client_id',ctx#>'{household,id}','draft_id',di,'draft_version',ev,'signed_by',a,'signed_at',stamp,'context_hash',preview->>'context_hash','context',ctx,'authorization_hash',h,'artifact',artifact);
 insert into public.native_prescription_authorizations values(p_id,pet,(ctx#>>'{household,id}')::uuid,di,document);
 update public.native_prescription_drafts set status='signed',authorization_id=p_id,updated_by=a,updated_at=stamp where id=di;
 if ctx->'prescriber' is distinct from public.native_rx_require_dvm() then raise exception 'Prescriber configuration changed' using errcode='40001';end if;
 return public.native_rx_finish(p_id,'sign',pet,p_request,document);
end $$;
-- Explicit grant boundary: no worker can commission, draft or sign.
do $$declare f record;begin
 for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and (proname like 'native_rx_%' or proname in ('recover_native_prescription_operation','configure_native_prescriber','list_native_prescribers','save_native_prescription_draft','read_native_prescription_draft','list_native_prescription_drafts','read_native_prescription_authorization','preview_native_prescription_sign','sign_native_prescription')) loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.proname not like 'native_rx_%' then execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;
end $$;
