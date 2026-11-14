begin;
create schema clinical_tools;
revoke all on schema clinical_tools from public,anon,authenticated,service_role;
create table clinical_tools.protocols(tool text primary key check(tool in('fluid','shock','chocolate','gestation','discharge','bloodwork','pill')),version text not null default 'lrv-clinical-tools-2026-11-v1',approved_by uuid not null references public.profiles(id),approved_at timestamptz not null default now(),review_note text not null check(length(review_note)between 1 and 2000));
create table clinical_tools.calculations(id uuid primary key,pet_id uuid not null references public.pets(id),tool text not null,inputs jsonb not null,result jsonb not null,reviewed_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create table clinical_tools.pill_references(id uuid primary key,name text not null check(length(name)between 1 and 200),imprint text not null check(length(imprint)between 1 and 100),shape text not null check(length(shape)between 1 and 100),color text not null check(length(color)between 1 and 100),strength text not null check(length(strength)between 1 and 100),source_url text not null check(source_url~'^https://[^[:space:]]+$'and length(source_url)<=2000),reviewed_by uuid not null,reviewed_at timestamptz not null default now());
create index pill_imprint on clinical_tools.pill_references(lower(imprint));
create table clinical_tools.helper_jobs(id uuid primary key,pet_id uuid not null references public.pets(id),kind text not null check(kind in('discharge','bloodwork','pill')),actor uuid not null references public.profiles(id),source_data jsonb not null,source_hash text not null,state text not null default 'GENERATING'check(state in('GENERATING','GENERATED','FAILED','APPROVED')),result jsonb,model text,failure text,reviewed_text text check(length(reviewed_text)<=30000),reviewed_by uuid references public.profiles(id),reviewed_at timestamptz,created_at timestamptz not null default now());
do $$declare n text;begin foreach n in array array['protocols','calculations','pill_references','helper_jobs']loop execute format('alter table clinical_tools.%I enable row level security',n);execute format('revoke all on clinical_tools.%I from public,anon,authenticated,service_role',n);end loop;end$$;
create function clinical_tools.actor(p_dvm boolean default false)returns uuid language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=auth.uid();begin if a is null or not public.is_active_staff(a)or(p_dvm and not exists(select 1 from public.user_roles where user_id=a and role='DVM'))then raise exception 'Active veterinary staff access required'using errcode='42501';end if;return a;end$$;
create function public.clinical_tools_read(p_pet_id uuid default null)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare a uuid:=clinical_tools.actor();begin
 return jsonb_build_object('can_review',exists(select 1 from public.user_roles where user_id=a and role='DVM'),
 'protocols',(select coalesce(jsonb_agg(to_jsonb(p)),'[]')from clinical_tools.protocols p),
 'patient',case when p_pet_id is null then null else(select jsonb_build_object('id',p.id,'name',p.name,'species',p.species)from public.pets p where p.id=p_pet_id)end,
 'encounters',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'visit_at',e.visit_at,'assessment',left(e.assessment,200))order by e.visit_at desc),'[]')from public.clinical_encounters e where e.pet_id=p_pet_id and e.status='signed'),
 'labs',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'test_name',o.test_name,'result_date',o.result_date,'version',o.version)),'[]')from public.patient_lab_orders o where o.pet_id=p_pet_id and o.result_date is not null),
 'calculations',(select coalesce(jsonb_agg(to_jsonb(c)order by c.created_at desc),'[]')from clinical_tools.calculations c where c.pet_id=p_pet_id),
 'helpers',(select coalesce(jsonb_agg(to_jsonb(j)-'source_data'order by j.created_at desc),'[]')from clinical_tools.helper_jobs j where j.pet_id=p_pet_id),
 'pill_references',(select coalesce(jsonb_agg(to_jsonb(r)order by r.name),'[]')from clinical_tools.pill_references r)
 );end$$;
create function public.review_clinical_tool(p_tool text,p_note text)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=clinical_tools.actor(true);begin insert into clinical_tools.protocols(tool,approved_by,review_note)values(p_tool,a,p_note)on conflict(tool)do update set version=excluded.version,approved_by=a,approved_at=now(),review_note=excluded.review_note;end$$;
create function clinical_tools.calculate(p_tool text,p_inputs jsonb)returns jsonb language plpgsql immutable security invoker set search_path=pg_catalog as $$
declare kg numeric;w numeric;v jsonb;low numeric;high numeric;f date;s text:=p_inputs->>'species';d numeric;r numeric;o numeric;con numeric;
begin
 if p_tool<>'gestation'then
  w:=(p_inputs->>'weight')::numeric;if w is null or w<=0 or w>1000 or p_inputs->>'unit'is null or p_inputs->>'unit'not in('kg','lb')then raise exception 'Invalid weight/unit';end if;
  kg:=w*case when p_inputs->>'unit'='lb'then 0.45359237 else 1 end;
 end if;
 if p_tool in('fluid','shock','gestation')and(s is null or s not in('dog','cat'))then raise exception 'Supported species: dog and cat';end if;
 case p_tool
 when 'fluid'then
  d:=(p_inputs->>'dehydration_percent')::numeric;r:=(p_inputs->>'replacement_hours')::numeric;o:=(p_inputs->>'ongoing_ml_hour')::numeric;
  if d is null or r is null or o is null or d<0 or d>15 or r<12 or r>24 or o<0 or o>10000 then raise exception 'Invalid fluid inputs';end if;
  con:=kg*case when s='dog'then 60 else 40 end/24;
  v:=jsonb_build_object('weight_kg',kg,'maintenance_ml_hour',con,'deficit_ml',kg*d*10,'replacement_ml_hour',kg*d*10/r,'ongoing_ml_hour',o,'total_ml_hour',con+kg*d*10/r+o);
 when 'shock'then v:=jsonb_build_object('weight_kg',kg,'bolus_low_ml',kg*case when s='dog'then 15 else 5 end,'bolus_high_ml',kg*case when s='dog'then 20 else 10 end,'administration_minutes_low',15,'administration_minutes_high',30);
 when 'chocolate'then
  d:=(p_inputs->>'grams')::numeric;if d is null or d<=0 or d>100000 then raise exception 'Enter a known amount in grams';end if;
  case p_inputs->>'product'when'cocoa'then low:=28.5;high:=28.5;when'baking'then low:=15.5;high:=15.5;when'dark'then low:=5.3;high:=5.6;when'milk'then low:=2.3;high:=2.3;when'white'then low:=0.04;high:=0.04;when'percent'then
   con:=(p_inputs->>'cocoa_percent')::numeric;if con is null or con<0 or con>100 then raise exception 'Enter labeled cocoa percentage';end if;low:=15.5*con/100;high:=low;
  else raise exception 'Unknown product; do not assume a concentration';end case;
  v:=jsonb_build_object('weight_kg',kg,'estimated_methylxanthines_mg_kg_low',low*d/kg,'estimated_methylxanthines_mg_kg_high',high*d/kg);
 when 'gestation'then
  f:=(p_inputs->>'date')::date;
  if f is null or p_inputs->>'basis'is null or p_inputs->>'basis'not in('breeding','ovulation')or(s='cat'and p_inputs->>'basis'<>'breeding')then raise exception 'Choose a known reproductive date/basis';end if;
  low:=case when s='cat'then 65 when p_inputs->>'basis'='ovulation'then 62 else 58 end;high:=case when s='cat'then 65 when p_inputs->>'basis'='ovulation'then 64 else 72 end;
  v:=jsonb_build_object('earliest_estimated_date',f+low::integer,'latest_estimated_date',f+high::integer,'basis',p_inputs->>'basis');
 else raise exception 'Unsupported calculator';end case;
 return jsonb_build_object('version','lrv-clinical-tools-2026-11-v1','values',v);
end$$;
create function public.save_clinical_calculation(p_id uuid,p_pet_id uuid,p_tool text,p_inputs jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=clinical_tools.actor(true);v jsonb;c clinical_tools.calculations;begin
 if not exists(select 1 from clinical_tools.protocols where tool=p_tool and version='lrv-clinical-tools-2026-11-v1')then raise exception 'Clinical protocol needs veterinary review';end if;
 if p_id is null or p_pet_id is null or length(p_inputs::text)>5000 then raise exception 'Invalid calculation';end if;
 v:=clinical_tools.calculate(p_tool,p_inputs);
 insert into clinical_tools.calculations(id,pet_id,tool,inputs,result,reviewed_by)values(p_id,p_pet_id,p_tool,p_inputs,v,a)on conflict(id)do nothing;
 select * into c from clinical_tools.calculations where id=p_id;
 if c.pet_id<>p_pet_id or c.tool<>p_tool or c.inputs<>p_inputs or c.reviewed_by<>a then raise exception 'Calculation request conflict'using errcode='PT409';end if;
 return to_jsonb(c);
end$$;
create function public.add_pill_reference(p_id uuid,p_values jsonb)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=clinical_tools.actor(true);begin
 insert into clinical_tools.pill_references(id,name,imprint,shape,color,strength,source_url,reviewed_by)values(p_id,p_values->>'name',lower(trim(p_values->>'imprint')),lower(trim(p_values->>'shape')),lower(trim(p_values->>'color')),p_values->>'strength',p_values->>'source_url',a);
end$$;
create function clinical_tools.source(p_pet uuid,p_kind text,p_data jsonb)returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v jsonb;e public.clinical_encounters;l public.patient_lab_orders;pet jsonb;
begin
 select jsonb_build_object('id',p.id,'name',p.name,'species',p.species)into pet from public.pets p where p.id=p_pet;
 if pet is null then raise exception 'Choose a valid patient';end if;
 if p_kind='pill'then
  if length(trim(coalesce(p_data->>'imprint','')))=0 then raise exception 'A known pill imprint is required';end if;
  select coalesce(jsonb_agg(jsonb_build_object('source_ref',r.id::text,'content',to_jsonb(r)-'reviewed_by')),'[]')into v from clinical_tools.pill_references r where lower(r.imprint)=lower(trim(p_data->>'imprint'))and(nullif(p_data->>'shape','')is null or lower(r.shape)=lower(trim(p_data->>'shape')))and(nullif(p_data->>'color','')is null or lower(r.color)=lower(trim(p_data->>'color')));
  if jsonb_array_length(v)=0 then raise exception 'No verified reference matches. Unable to identify; verify manually with the labeled container or pharmacist.';end if;
 else
  select * into e from public.clinical_encounters where id=(p_data->>'encounter_id')::uuid and pet_id=p_pet and status='signed';
  if e.id is null then raise exception 'Choose a signed encounter for this patient';end if;
  v:=jsonb_build_array(jsonb_build_object('source_ref',e.id::text,'content',jsonb_build_object('visit_at',e.visit_at,'subjective',e.subjective,'objective',e.objective,'assessment',e.assessment,'plan',e.plan,'addenda',(select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at),'[]')from public.clinical_addenda x where x.encounter_id=e.id))));
  if p_kind='bloodwork'then
   select * into l from public.patient_lab_orders where id=(p_data->>'lab_id')::uuid and pet_id=p_pet and result_date is not null;
   if l.id is null or(p_data->>'attest_reviewed')::boolean is distinct from true or jsonb_typeof(p_data->'lab_values')is distinct from'array'or jsonb_array_length(p_data->'lab_values')not between 1 and 100 then raise exception 'Select this patient''s lab record and confirm reviewed values with units/ranges';end if;
   v:=v||jsonb_build_array(jsonb_build_object('source_ref',l.id::text,'content',jsonb_build_object('order',to_jsonb(l),'reviewed_lab_values',p_data->'lab_values')));
  elsif p_kind<>'discharge'then raise exception 'Unknown helper';end if;
 end if;
 return jsonb_build_object('patient',pet,'sources',v,'selection',p_data);
end$$;
create function public.claim_clinical_helper(p_id uuid,p_pet_id uuid,p_kind text,p_data jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=clinical_tools.actor();s jsonb;begin
 if p_id is null or length(p_data::text)>50000 then raise exception 'Invalid helper request';end if;
 if not exists(select 1 from clinical_tools.protocols where tool=p_kind and version='lrv-clinical-tools-2026-11-v1')then raise exception 'Clinical helper needs veterinary protocol review';end if;
 perform pg_advisory_xact_lock(hashtextextended('clinical-helper-actor:'||a,0));
 perform pg_advisory_xact_lock(hashtextextended('clinical-helper:'||p_id,0));
 if exists(select 1 from clinical_tools.helper_jobs where id=p_id)then raise exception 'Request already exists. Open its saved status; do not regenerate.'using errcode='PT409';end if;
 if(select count(*)from clinical_tools.helper_jobs where actor=a and created_at>now()-interval'1 hour')>=20 then raise exception 'Hourly draft limit reached';end if;
 s:=clinical_tools.source(p_pet_id,p_kind,p_data);
 if length(s::text)>120000 then raise exception 'Selected clinical sources exceed the draft limit';end if;
 insert into clinical_tools.helper_jobs(id,pet_id,kind,actor,source_data,source_hash)values(p_id,p_pet_id,p_kind,a,s,md5(s::text));
 return s;
end$$;
create function public.finish_clinical_helper(p_id uuid,p_result jsonb,p_model text,p_failure text default null)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare j clinical_tools.helper_jobs;claim jsonb;cite jsonb;src jsonb;
begin
 select * into j from clinical_tools.helper_jobs where id=p_id for update;
 if j.id is null or j.state<>'GENERATING'then raise exception 'No generating helper job';end if;
 if p_failure is not null then update clinical_tools.helper_jobs set state='FAILED',failure=left(p_failure,200)where id=p_id;return;end if;
 if jsonb_typeof(p_result->'claims')is distinct from'array'or jsonb_array_length(p_result->'claims')not between 1 and 40 or length(p_result::text)>40000 then raise exception 'Invalid clinical draft';end if;
 for claim in select value from jsonb_array_elements(p_result->'claims')loop
  if coalesce(length(claim->>'text'),0)not between 1 and 1500 or jsonb_typeof(claim->'citations')is distinct from'array'or jsonb_array_length(claim->'citations')not between 1 and 4 then raise exception 'Missing clinical citations';end if;
  for cite in select value from jsonb_array_elements(claim->'citations')loop
   select value into src from jsonb_array_elements(j.source_data->'sources')where value->>'source_ref'=cite->>'source_ref';
   if src is null or length(coalesce(cite->>'quote',''))not between 3 and 1000 or position(cite->>'quote'in(src->'content')::text)=0 then raise exception 'Citation does not match selected source';end if;
  end loop;
 end loop;
 update clinical_tools.helper_jobs set state='GENERATED',result=p_result,model=left(p_model,200)where id=p_id;
end$$;
create function public.review_clinical_helper(p_id uuid,p_text text)returns void language plpgsql security definer set search_path=pg_catalog as $$
declare a uuid:=clinical_tools.actor(true);j clinical_tools.helper_jobs;s jsonb;begin
 select * into j from clinical_tools.helper_jobs where id=p_id for update;
 if j.id is null or j.state<>'GENERATED'or length(trim(p_text))not between 1 and 30000 then raise exception 'Generated draft and reviewed text required';end if;
 s:=clinical_tools.source(j.pet_id,j.kind,j.source_data->'selection');
 if md5(s::text)<>j.source_hash then raise exception 'Clinical sources changed; generate and review a fresh draft'using errcode='PT409';end if;
 update clinical_tools.helper_jobs set state='APPROVED',reviewed_text=p_text,reviewed_by=a,reviewed_at=now()where id=p_id;
end$$;
revoke all on all functions in schema clinical_tools from public,anon,authenticated,service_role;
revoke all on function public.clinical_tools_read(uuid),public.review_clinical_tool(text,text),public.save_clinical_calculation(uuid,uuid,text,jsonb),public.add_pill_reference(uuid,jsonb),public.claim_clinical_helper(uuid,uuid,text,jsonb),public.review_clinical_helper(uuid,text)from public,anon,service_role;
grant execute on function public.clinical_tools_read(uuid),public.review_clinical_tool(text,text),public.save_clinical_calculation(uuid,uuid,text,jsonb),public.add_pill_reference(uuid,jsonb),public.claim_clinical_helper(uuid,uuid,text,jsonb),public.review_clinical_helper(uuid,text)to authenticated;
revoke all on function public.finish_clinical_helper(uuid,jsonb,text,text)from public,anon,authenticated;
grant execute on function public.finish_clinical_helper(uuid,jsonb,text,text)to service_role;
commit;
