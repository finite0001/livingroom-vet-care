-- Synthetic adversarial boundaries; every source is created through the native staff RPCs.
-- A separate rollback-only preflight exercises an actual RPC in REPEATABLE READ before
-- pgTAP establishes its own snapshot. A failed preflight raises an SQL error, failing the suite.
begin isolation level repeatable read;
do $$
declare actor uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); client uuid; pet uuid; detail text;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(actor,'synthetic-recap-isolation-'||actor||'@example.test','{}');
 update profiles set is_active=true,full_name='Synthetic recap isolation staff' where id=actor;
 insert into user_roles(user_id,role) values(actor,'STAFF') on conflict do nothing;
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,actor,now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',sid)::text,true);
 select id into client from save_client(actor,null,null,'Synthetic','Isolation','+13035555587','synthetic-isolation@example.test','EMAIL',null,null);
 select id into pet from save_patient(null,client,null,'Synthetic isolation','Dog','Mixed',null,'unknown','','unknown','unknown','',null,null);
 begin
  perform preview_clinical_recap(actor,pet,'{"encounter_ids":[],"include_native_problems":false,"visit_from":null,"visit_to":null}');
  raise exception 'REPEATABLE READ unexpectedly admitted recap capture';
 exception when sqlstate 'PT422' then
  get stacked diagnostics detail=PG_EXCEPTION_DETAIL;
  if (detail::jsonb)->>'code' is distinct from 'invalid_request' or (detail::jsonb)->'budget_violations' is distinct from '[]'::jsonb then
   raise exception 'REPEATABLE READ returned an unexpected refusal';
  end if;
 end;
end $$;
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select pass('Actual preview RPC rejects REPEATABLE READ before capture (rollback-only preflight)');
create temp table cb_fx(k text primary key,id uuid,v jsonb);
create temp table cb_enc(group_name text,id uuid,primary key(group_name,id));
grant all on cb_fx,cb_enc to authenticated;
create function pg_temp.cb_id(key text) returns uuid language sql as $$select id from cb_fx where k=$1$$;
create function pg_temp.cb_selection(group_name text,include_problems boolean default false) returns jsonb language sql as $$
 select jsonb_build_object('encounter_ids',coalesce((select jsonb_agg(id order by id)from cb_enc where group_name=$1),'[]'),'include_native_problems',$2,'visit_from',null,'visit_to',null)
$$;
create function pg_temp.cb_preview(pet_key text,group_name text,include_problems boolean default false) returns jsonb language plpgsql as $$
begin return public.preview_clinical_recap(pg_temp.cb_id('actor'),pg_temp.cb_id(pet_key),pg_temp.cb_selection(group_name,include_problems));end $$;
-- Return only the structured refusal and SQLSTATE. Unexpected SQL failures still fail assertions.
create function pg_temp.cb_try_preview(pet_key text,group_name text,include_problems boolean default false) returns jsonb language plpgsql as $$
declare d text;begin return jsonb_build_object('ok',true,'value',pg_temp.cb_preview(pet_key,group_name,include_problems));
exception when others then get stacked diagnostics d=PG_EXCEPTION_DETAIL;return jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM,'detail',case when left(d,1)='{'then d::jsonb else '{}'::jsonb end);end $$;

insert into cb_fx(k,id) select k,gen_random_uuid()from unnest(array['actor','sid'])k;
insert into auth.users(id,email,raw_user_meta_data) select id,'synthetic-recap-boundary-'||id||'@example.test','{}' from cb_fx where k='actor';
update profiles set is_active=true,full_name='Synthetic recap boundary staff'where id=pg_temp.cb_id('actor');
insert into user_roles(user_id,role)values(pg_temp.cb_id('actor'),'ADMIN')on conflict do nothing;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.cb_id('sid'),pg_temp.cb_id('actor'),now(),now());
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cb_id('actor'),'session_id',pg_temp.cb_id('sid'))::text,true);
set local role authenticated;
insert into cb_fx(k,id)select'client',id from save_client(auth.uid(),null,null,'Synthetic','Boundary','+13035555588','synthetic-boundary@example.test','EMAIL',null,null);
do $$declare k text;pet uuid;begin
 foreach k in array array['empty','encounters','problems','units','characters','bytes','epoch']loop
  select id into pet from save_patient(null,pg_temp.cb_id('client'),null,'Synthetic '||k,'Dog','Mixed',null,'unknown','','unknown','unknown','',null,null);
  insert into cb_fx(k,id)values(k,pet);
 end loop;
end $$;
select is(pg_temp.cb_try_preview('empty','none')#>>'{detail,code}','empty_selection','An empty selected source set is refused explicitly');
select is(pg_temp.cb_try_preview('empty','none',true)#>>'{detail,code}','empty_selection','Selecting an empty native problem group is still empty');

-- Exactly 20 selected signed encounters are retained; a 21-ID request is invalid rather than clipped.
do $$declare enc uuid;n integer;begin
 for n in 1..21 loop
  select id into enc from save_clinical_encounter(null,pg_temp.cb_id('encounters'),null,'2020-03-08 07:30:00+00','clinic','Synthetic','Visit '||n,'','A','P');
  perform sign_clinical_encounter(enc,1);
  insert into cb_enc values('enc21',enc);if n<=20 then insert into cb_fx(k,id)values('enc20_'||n,enc);end if;
 end loop;
end $$;
insert into cb_enc select'enc20',id from cb_fx where k like'enc20_%';
insert into cb_fx(k,v)values('enc20_preview',pg_temp.cb_preview('encounters','enc20'));
select is((select(v#>>'{source_set,budgets,encounters}')::integer from cb_fx where k='enc20_preview'),20,'20 signed encounters fit the inclusive limit');
select is((select jsonb_array_length(v#>'{source_set,sources}')from cb_fx where k='enc20_preview'),20,'All 20 selected encounters appear without clipping');
select is(pg_temp.cb_try_preview('encounters','enc21')#>>'{detail,code}','invalid_request','21 selected encounter IDs are rejected at the request bound');

-- The optional problem group is all-or-nothing, including active and resolved records.
do $$declare n integer;begin
 for n in 1..40 loop
  perform save_patient_problem(null,pg_temp.cb_id('problems'),null,'Problem '||n,'',null,case when n%2=0 then'resolved'else'active'end,'routine');
 end loop;
end $$;
insert into cb_fx(k,v)values('problem40_preview',pg_temp.cb_preview('problems','none',true));
select is((select(v#>>'{source_set,budgets,problems}')::integer from cb_fx where k='problem40_preview'),40,'40 native problems fit the inclusive limit');
select is((select jsonb_array_length(v#>'{source_set,membership,native_problem_ids}')from cb_fx where k='problem40_preview'),40,'All 40 problem IDs are captured');
select is((select count(*)::integer from cb_fx cross join lateral jsonb_array_elements(v#>'{source_set,sources}')s where k='problem40_preview'and s#>>'{fields,status}'='resolved'),20,'Resolved problems are retained rather than silently filtered');
select save_patient_problem(null,pg_temp.cb_id('problems'),null,'Problem 41','',null,'active','routine');
insert into cb_fx(k,v)values('problem41_refusal',pg_temp.cb_try_preview('problems','none',true));
select is((select v#>>'{detail,code}'from cb_fx where k='problem41_refusal'),'budget_exceeded','41 native problems refuse the entire capture');
select is((select v#>'{detail,budget_violations}'from cb_fx where k='problem41_refusal'),'[{"dimension":"problems","observed":41,"limit":40}]'::jsonb,'Problem refusal discloses the exact authorized overage');
select ok(not(select v?'value'from cb_fx where k='problem41_refusal'),'Oversized problem capture returns no partial source payload');

-- Source unit cap includes complete addendum groups, not only the visit count.
do $$declare enc uuid;first_enc uuid;n integer;begin
 for n in 1..20 loop
  select id into enc from save_clinical_encounter(null,pg_temp.cb_id('units'),null,'2020-01-01 12:00:00+00','clinic','Synthetic','S','','A','P');
  perform sign_clinical_encounter(enc,1);insert into cb_enc values('units',enc);if n=1 then first_enc:=enc;end if;
 end loop;
 insert into cb_fx(k,id)values('unit_parent',first_enc);
 for n in 1..44 loop perform add_clinical_addendum(first_enc,'Synthetic addendum '||n);end loop;
end $$;
insert into cb_fx(k,v)values('units64_preview',pg_temp.cb_preview('units','units'));
select is((select(v#>>'{source_set,budgets,source_units}')::integer from cb_fx where k='units64_preview'),64,'20 visits and all 44 addenda fit exactly 64 source units');
select is((select count(*)::integer from cb_fx cross join lateral jsonb_array_elements(v#>'{source_set,sources}')s where k='units64_preview'and s->>'kind'='addendum'),44,'Every addendum is included at the source-unit boundary');
select add_clinical_addendum(pg_temp.cb_id('unit_parent'),'Synthetic addendum 45');
insert into cb_fx(k,v)values('units65_refusal',pg_temp.cb_try_preview('units','units'));
select is((select v#>'{detail,budget_violations}'from cb_fx where k='units65_refusal'),'[{"dimension":"source_units","observed":65,"limit":64}]'::jsonb,'65 sources are refused rather than dropping an addendum');
select ok(not(select v?'value'from cb_fx where k='units65_refusal'),'Oversized complete addendum group returns no partial source payload');

-- Native per-field limits are 50,000 PostgreSQL codepoints; recap counts UTF-16 units.
do $$declare enc uuid;kind text;s text;o text;begin
 foreach kind in array array['ascii_exact','ascii_over','astral_exact','astral_over']loop
  s:=case when kind like'ascii%'then repeat('x',50000)else repeat(U&'\+01F600',29999)end;
  o:=case kind when'ascii_exact'then repeat('y',9998)when'ascii_over'then repeat('y',9999)when'astral_over'then'z'else''end;
  select id into enc from save_clinical_encounter(null,pg_temp.cb_id('characters'),null,'2020-01-01 12:00:00+00','clinic','Synthetic',s,o,'A','P');
  perform sign_clinical_encounter(enc,1);insert into cb_enc values(kind,enc);
 end loop;
end $$;
insert into cb_fx(k,v)values('ascii_exact_preview',pg_temp.cb_preview('characters','ascii_exact')),('astral_exact_preview',pg_temp.cb_preview('characters','astral_exact'));
select is((select(v#>>'{source_set,budgets,source_characters}')::integer from cb_fx where k='ascii_exact_preview'),60000,'60,000 ASCII clinical UTF-16 units fit exactly');
select is((select length(v#>>'{source_set,sources,0,fields,subjective}')from cb_fx where k='ascii_exact_preview'),50000,'A full native 50,000-character SOAP field is retained without clipping');
select is((select(v#>>'{source_set,budgets,source_characters}')::integer from cb_fx where k='astral_exact_preview'),60000,'29,999 astral characters plus assessment and plan count as 60,000 UTF-16 units');
select is((select length(v#>>'{source_set,sources,0,fields,subjective}')from cb_fx where k='astral_exact_preview'),29999,'Astral source text retains all native codepoints');
select is((select(v#>>'{source_set,budgets,source_bytes}')::integer from cb_fx where k='astral_exact_preview'),(select octet_length(convert_to((v->'source_set')::text,'UTF8'))from cb_fx where k='astral_exact_preview'),'Astral canonical byte count uses final UTF-8 JSON rather than character count');
insert into cb_fx(k,v)values('ascii_over_refusal',pg_temp.cb_try_preview('characters','ascii_over')),('astral_over_refusal',pg_temp.cb_try_preview('characters','astral_over'));
select is((select v#>'{detail,budget_violations}'from cb_fx where k='ascii_over_refusal'),'[{"dimension":"source_characters","observed":60001,"limit":60000}]'::jsonb,'60,001 ASCII units fail with the exact character overage');
select is((select v#>'{detail,budget_violations}'from cb_fx where k='astral_over_refusal'),'[{"dimension":"source_characters","observed":60001,"limit":60000}]'::jsonb,'A single extra BMP character beyond the astral limit fails equally');

-- Canonical JSON escapes control characters to six bytes. Measure a real small preview,
-- then extend a fresh signed encounter by the exact remaining ASCII bytes. Native clinical
-- text remains below 50,000 codepoints and below 60,000 UTF-16 units throughout.
do $$declare enc uuid;kind text;baseline integer;pad integer;preview jsonb;begin
 select id into enc from save_clinical_encounter(null,pg_temp.cb_id('bytes'),null,'2020-01-01 12:00:00+00','clinic','Synthetic',repeat(chr(1),39000),'','A','P');
 perform sign_clinical_encounter(enc,1);insert into cb_enc values('bytes_seed',enc);
 preview:=pg_temp.cb_preview('bytes','bytes_seed');baseline:=(preview#>>'{source_set,budgets,source_bytes}')::integer;pad:=240000-baseline;
 if pad not between 1 and 9999 then raise exception 'Synthetic byte-boundary fixture does not fit native text bounds';end if;
 insert into cb_fx(k,v)values('bytes_seed_preview',preview);
 foreach kind in array array['bytes_exact','bytes_over']loop
  select id into enc from save_clinical_encounter(null,pg_temp.cb_id('bytes'),null,'2020-01-01 12:00:00+00','clinic','Synthetic',repeat(chr(1),39000)||repeat('b',pad+case when kind='bytes_over'then 1 else 0 end),'','A','P');
  perform sign_clinical_encounter(enc,1);insert into cb_enc values(kind,enc);
 end loop;
end $$;
insert into cb_fx(k,v)values('bytes_exact_preview',pg_temp.cb_preview('bytes','bytes_exact')),('bytes_over_refusal',pg_temp.cb_try_preview('bytes','bytes_over'));
select is((select(v#>>'{source_set,budgets,source_bytes}')::integer from cb_fx where k='bytes_exact_preview'),240000,'Final canonical source JSON fits exactly 240,000 UTF-8 bytes');
select is((select octet_length(convert_to((v->'source_set')::text,'UTF8'))from cb_fx where k='bytes_exact_preview'),240000,'The exact byte limit includes its own fixed-point budget counter');
select ok((select(v#>>'{source_set,budgets,source_characters}')::integer<50000 from cb_fx where k='bytes_exact_preview'),'Byte-boundary input remains below the clinical character cap');
select is((select length(v#>>'{source_set,sources,0,fields,subjective}')from cb_fx where k='bytes_exact_preview'),(select(v#>>'{source_set,budgets,source_characters}')::integer-2 from cb_fx where k='bytes_exact_preview'),'Escaped input is preserved exactly without clipping or normalization');
select is((select v#>'{detail,budget_violations}'from cb_fx where k='bytes_over_refusal'),'[{"dimension":"source_bytes","observed":240001,"limit":240000}]'::jsonb,'240,001 canonical bytes fail independently of the character cap');
select ok(not(select v?'value'from cb_fx where k='bytes_over_refusal'),'Oversized canonical JSON returns no source text');

-- Explicit UTC rendering must make identical captures independent of the connection zone.
set local timezone='Pacific/Auckland';
insert into cb_fx(k,v)values('timezone_a',pg_temp.cb_preview('encounters','enc20'));
set local timezone='America/Los_Angeles';
insert into cb_fx(k,v)values('timezone_b',pg_temp.cb_preview('encounters','enc20'));
select is((select v->>'source_fingerprint'from cb_fx where k='timezone_a'),(select v->>'source_fingerprint'from cb_fx where k='timezone_b'),'Identical source fingerprints are stable across connection timezones');
select is((select v->'source_set'from cb_fx where k='timezone_a'),(select v->'source_set'from cb_fx where k='timezone_b'),'All rendered source and lifecycle timestamps are timezone-independent');
select ok((select bool_and(s#>>'{metadata,visit_at}'='2020-03-08T07:30:00.000000Z')from cb_fx cross join lateral jsonb_array_elements(v#>'{source_set,sources}')s where k='timezone_a'),'Visit timestamps use explicit UTC including a DST transition date');

-- BOM/NBSP are JavaScript trim whitespace. Use actual configuration RPC validation.
select throws_ok($$select save_clinical_recap_policy(auth.uid(),gen_random_uuid(),jsonb_build_object('expected_version',1,'status','draft','consent_text',U&'\FEFF','retention_text','Synthetic','attest_reviewed',false))$$,'PT422',null,'A BOM-only policy cannot poison strict frontend reads');
select throws_ok($$select save_clinical_recap_policy(auth.uid(),gen_random_uuid(),jsonb_build_object('expected_version',1,'status','draft','consent_text','Synthetic','retention_text',U&'\00A0','attest_reviewed',false))$$,'PT422',null,'NBSP-only retention text is blank');
select throws_ok($$select save_clinical_recap_policy(auth.uid(),gen_random_uuid(),jsonb_build_object('expected_version',1,'status','draft','consent_text',repeat(U&'\+01F600',2001),'retention_text','Synthetic','attest_reviewed',false))$$,'PT422',null,'2,001 astral consent characters exceed the 4,000 UTF-16 policy limit');
insert into cb_fx(k,v)select'policy_unicode',save_clinical_recap_policy(auth.uid(),gen_random_uuid(),jsonb_build_object('expected_version',1,'status','draft','consent_text',U&'\FEFF'||'Synthetic'||U&'\00A0','retention_text',repeat(U&'\+01F600',1000),'attest_reviewed',false));
select is((select v#>>'{policy,consent_text}'from cb_fx where k='policy_unicode'),U&'\FEFF'||'Synthetic'||U&'\00A0','Nonblank Unicode policy text is retained exactly');
select is((select length(v#>>'{policy,retention_text}')from cb_fx where k='policy_unicode'),1000,'1,000 astral retention characters fit exactly 2,000 UTF-16 units');
select is((select v#>>'{policy,status}'from cb_fx where k='policy_unicode'),'draft','Boundary tests never activate processing policy');

-- Authority is checked before source census and budget details, even for known oversized pets.
reset role;
update profiles set is_active=false where id=pg_temp.cb_id('actor');
set local role authenticated;
insert into cb_fx(k,v)values('inactive_refusal',pg_temp.cb_try_preview('problems','none',true));
select is((select v->>'sqlstate'from cb_fx where k='inactive_refusal'),'PT403','Inactive staff cannot preview an oversized patient');
select is((select v#>>'{detail,code}'from cb_fx where k='inactive_refusal'),'forbidden','Authority refusal takes precedence over budget counts');
select is((select v#>'{detail,budget_violations}'from cb_fx where k='inactive_refusal'),'[]'::jsonb,'Unauthorized refusal discloses no patient census or budget overage');
select ok(not(select v?'value'from cb_fx where k='inactive_refusal'),'Unauthorized refusal contains no captured source payload');
select set_config('request.jwt.claims','{}',true);
insert into cb_fx(k,v)values('anonymous_refusal',pg_temp.cb_try_preview('problems','none',true));
select is((select v#>>'{detail,code}'from cb_fx where k='anonymous_refusal'),'authentication_required','Missing actual user is refused before oversized source capture');
select is((select v#>'{detail,budget_violations}'from cb_fx where k='anonymous_refusal'),'[]'::jsonb,'Unauthenticated caller receives no budget census');
reset role;
update profiles set is_active=true where id=pg_temp.cb_id('actor');
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cb_id('actor'),'session_id',pg_temp.cb_id('sid'))::text,true);

-- Deliberately corrupt only the private epoch fixture as owner. No public RPC can remove it.
-- The guard is restored before exercising either read or writer, and all changes roll back.
insert into cb_fx(k,v)select'epoch_original',to_jsonb(version)from clinical_recap_epochs where pet_id=pg_temp.cb_id('epoch');
alter table clinical_recap_epochs disable trigger recap_row_guard;
delete from clinical_recap_epochs where pet_id=pg_temp.cb_id('epoch');
alter table clinical_recap_epochs enable trigger recap_row_guard;
set local role authenticated;
insert into cb_fx(k,v)values('missing_epoch_refusal',pg_temp.cb_try_preview('epoch','none'));
select is((select v#>>'{detail,code}'from cb_fx where k='missing_epoch_refusal'),'source_unavailable','Missing epoch fails closed before empty-selection logic');
select is((select v#>'{detail,source_reasons}'from cb_fx where k='missing_epoch_refusal'),'["source_unavailable"]'::jsonb,'Missing epoch has the canonical safe source-unavailable reason');
select throws_ok($$select save_patient_problem(null,pg_temp.cb_id('epoch'),null,'Must not commit','',null,'active','routine')$$,'PT409',null,'A native source writer also fails closed when its epoch is missing');
reset role;
select is((select count(*)::integer from patient_problems where pet_id=pg_temp.cb_id('epoch')),0,'Failed epoch writer leaves no canonical source row behind');
insert into clinical_recap_epochs(pet_id,version)select pg_temp.cb_id('epoch'),(v#>>'{}')::bigint from cb_fx where k='epoch_original';
select ok((select tgenabled='O'from pg_trigger where tgrelid='clinical_recap_epochs'::regclass and tgname='recap_row_guard'),'Private epoch history guard is restored');
select *from finish();
rollback;
