-- Hosted deployment probes. All synthetic data writes roll back in the inner block.
-- Existing staff identity is used only for database-role simulation, not HTTP authentication.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $probe$
declare
 actor uuid;
 household public.clients;
 patient public.pets;
 legacy public.clients;
 legacy_pet public.pets;
 receipt record;
 replay record;
 checks integer:=0;
 before_clients bigint;
 before_pets bigint;
 phone text:='+12025550192';
 unknown_phone text:='+12025550193';
 provider_id text:='ROLLOUT-'||gen_random_uuid()::text;
begin
 select count(*) into before_clients from public.clients;
 select count(*) into before_pets from public.pets;
 select p.id into actor from public.profiles p join public.user_roles r on r.user_id=p.id
   where p.is_active and r.role='ADMIN' order by p.id limit 1;
 if actor is null then raise exception 'No existing active administrator for role probes';end if;
 if exists(select 1 from clients where primary_phone in (phone,unknown_phone)) then
  raise exception 'Reserved probe phone already in use';end if;
 select c.* into legacy from clients c where not client_contacts_complete(c.primary_phone,c.primary_email)
  order by exists(select 1 from pets p where p.client_id=c.id) desc,c.id limit 1;
 begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  begin
   perform save_client(actor,null,null,'ROLLOUT','PROBE',null,'probe@example.test','EMAIL',null,null);
   raise exception 'Missing phone accepted';
  exception when check_violation then checks:=checks+1;end;
  begin
   perform save_client(actor,null,null,'ROLLOUT','PROBE',phone,null,'EMAIL',null,null);
   raise exception 'Missing email accepted';
  exception when check_violation then checks:=checks+1;end;
  begin
   perform save_client(actor,null,null,'ROLLOUT','PROBE',phone,'.probe@example.test','EMAIL',null,null);
   raise exception 'Malformed email accepted';
  exception when check_violation then checks:=checks+1;end;
  begin
   perform save_client(actor,null,null,'ROLLOUT','PROBE','2025550192','probe@example.test','EMAIL',null,null);
   raise exception 'Phone without country code accepted';
  exception when check_violation then checks:=checks+1;end;
  begin
   perform save_client(gen_random_uuid(),null,null,'ROLLOUT','PROBE',phone,'probe@example.test','EMAIL',null,null);
   raise exception 'Spoofed actor accepted';
  exception when insufficient_privilege then checks:=checks+1;end;
  begin
   insert into clients(first_name,last_name,full_name,primary_phone) values('ROLLOUT','PROBE','ROLLOUT PROBE',phone);
   raise exception 'Direct incomplete insert accepted';
  exception when check_violation then checks:=checks+1;end;
  begin
   perform save_patient(null,null,null,'ROLLOUT PROBE','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
   raise exception 'Patient without client accepted';
  exception when check_violation then checks:=checks+1;end;
  household:=save_client(actor,null,null,'ROLLOUT','PROBE',' +1 (202) 555-0192 ',' PROBE@example.test ','EMAIL',null,null);
  if household.primary_phone<>phone or household.primary_email<>'probe@example.test' then raise exception 'Normalization failed';end if;
  checks:=checks+1;
  patient:=save_patient(null,household.id,null,'ROLLOUT PROBE 1','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
  perform save_patient(null,household.id,null,'ROLLOUT PROBE 2','Cat',null,null,'unknown',null,'unknown','unknown',null,null,null);
  if (select count(*) from pets where client_id=household.id)<>2 then raise exception 'Two-pet linkage failed';end if;
  checks:=checks+1;
  patient:=save_patient(patient.id,household.id,patient.version,patient.name,patient.species,patient.breed,patient.dob,
   patient.birth_date_precision,patient.color,patient.sex,patient.neuter_status,patient.microchip_id,patient.archived_at,patient.deceased_at);
  if patient.version<>2 then raise exception 'Patient edit version failed';end if;
  checks:=checks+1;
  begin
   perform save_client(actor,household.id,0,'ROLLOUT','PROBE',phone,'probe@example.test','EMAIL',null,null);
   raise exception 'Stale version accepted';
  exception when sqlstate 'PT409' then checks:=checks+1;end;
  begin
   update clients set primary_email=null where id=household.id;
   raise exception 'Direct update removed email';
  exception when check_violation then checks:=checks+1;end;
  begin
   update clients set primary_phone=' ' where id=household.id;
   raise exception 'Direct update removed phone';
  exception when check_violation then checks:=checks+1;end;
  if exists(select 1 from sms_consent where client_id=household.id) then raise exception 'Contacts granted SMS consent';end if;
  checks:=checks+1;
  if legacy.id is not null then
   begin
    perform save_patient(null,legacy.id,null,'ROLLOUT LEGACY PROBE','Dog',null,null,'unknown',null,'unknown','unknown',null,null,null);
    raise exception 'Incomplete legacy household accepted a new patient';
   exception when check_violation then checks:=checks+1;end;
   select * into legacy_pet from pets where client_id=legacy.id order by id limit 1;
   if legacy_pet.id is not null then
    perform save_patient(legacy_pet.id,legacy.id,legacy_pet.version,legacy_pet.name,legacy_pet.species,legacy_pet.breed,legacy_pet.dob,
     legacy_pet.birth_date_precision,legacy_pet.color,legacy_pet.sex,legacy_pet.neuter_status,legacy_pet.microchip_id,legacy_pet.archived_at,legacy_pet.deceased_at);
    checks:=checks+1;
   end if;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  select * into receipt from record_inbound_sms(unknown_phone,'+12025550194','Synthetic rollout probe',provider_id,null,now());
  if receipt.consent_action<>'REVIEW_REQUIRED' or receipt.client_id is not null or (select count(*) from clients)<>before_clients+1 then
   raise exception 'Unknown inbound created a household or did not enter review';end if;
  checks:=checks+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  set local role authenticated;
  perform save_client(actor,null,null,'ROLLOUT','LATER',unknown_phone,'later-probe@example.test','EMAIL',null,null);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  set local role service_role;
  select * into replay from record_inbound_sms(unknown_phone,'+12025550194','Synthetic rollout probe',provider_id,null,now());
  if replay.consent_action<>'DUPLICATE' or replay.client_id is not null
   or (select count(*) from communication_inbound where provider='twilio' and resource_id=provider_id)<>1
   or exists(select 1 from messages where provider='twilio' and provider_message_id=provider_id) then
   raise exception 'Inbound replay lost original review identity';end if;
  checks:=checks+1;
  begin
   perform record_inbound_sms(unknown_phone,'+12025550194','Changed probe',provider_id,null,now());
   raise exception 'Provider identifier reused with changed content';
  exception when unique_violation then checks:=checks+1;end;
  set local role anon;
  begin
   perform client_contacts_complete(phone,'probe@example.test');
   raise exception 'Anonymous helper access allowed';
  exception when insufficient_privilege then checks:=checks+1;end;
  raise exception 'ROLLBACK_SYNTHETIC_PROBES' using errcode='Z0001';
 exception when sqlstate 'Z0001' then null;
 end;
 if checks<18 then raise exception 'Incomplete probe run: %',checks;end if;
 if (select count(*) from clients)<>before_clients or (select count(*) from pets)<>before_pets
  or exists(select 1 from communication_provider_events where resource_id=provider_id)
  or exists(select 1 from communication_inbound where resource_id=provider_id) then
  raise exception 'Synthetic probe records were not fully rolled back';end if;
 perform set_config('lrv.contact_rollout_proof',jsonb_build_object('checks',checks,'synthetic_writes_rolled_back',true,
  'clients_unchanged',before_clients,'patients_unchanged',before_pets)::text,true);
end $probe$;
select current_setting('lrv.contact_rollout_proof')::jsonb as contact_rollout_proof;
commit;
