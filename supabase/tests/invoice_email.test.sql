begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Test-only rollback probe exercises the real ADMIN preview on a pre-provider failure.
create function pg_temp.retry_source_probe(p_id uuid,p_change text default null) returns jsonb language plpgsql security definer as $$
declare result jsonb;actor uuid;begin
 begin
  select created_by into actor from communication_outbox where id=p_id;
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
  update communication_outbox set state='failed',lease_token=null,lease_expires_at=null where id=p_id;
  if p_change is not null then execute p_change;end if;
  result:=preview_outbox_retry(p_id);
  raise exception 'rollback probe';
 exception when raise_exception then return result;end;
end $$;

insert into auth.users(id,email,raw_user_meta_data) values('97000000-0000-4000-8000-000000000001','invoice-email@example.test','{}'),('97000000-0000-4000-8000-000000000002','other-invoice@example.test','{}');
insert into user_roles(user_id,role) values('97000000-0000-4000-8000-000000000001','ADMIN');
create temp table fx(k text primary key,id uuid);grant all on fx to authenticated,service_role;
create temp table data(k text primary key,v jsonb);grant all on data to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into fx select 'client',id from save_client(auth.uid(),null,null,'Invoice','Family',null,'invoice@example.test','EMAIL','123 Mailing Way','INTERNAL HOUSECALL ADDRESS');
insert into fx select 'other',id from save_client(auth.uid(),null,null,'Other','Family',null,'other@example.test','EMAIL',null,null);
insert into fx select 'product',id from save_catalog_product(null,null,'Exam <script>','service','','visit',1001,true);
select create_billing_invoice('98000000-0000-4000-8000-000000000001',(select id from fx where k='client'));
select add_invoice_service('98000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000001',null,(select id from fx where k='product'),1.5);
select throws_ok($$select read_invoice_email_preview('98000000-0000-4000-8000-000000000001',(select id from fx where k='client'))$$,'42501',null,'Draft cannot prepare an invoice email');
select issue_billing_invoice('98000000-0000-4000-8000-000000000001',2);
select throws_ok($$select read_invoice_email_preview('98000000-0000-4000-8000-000000000001',(select id from fx where k='other'))$$,'42501',null,'Wrong household denied');
insert into data values('preview',read_invoice_email_preview('98000000-0000-4000-8000-000000000001',(select id from fx where k='client')));
select is(read_invoice_email_preview('98000000-0000-4000-8000-000000000001',(select id from fx where k='client'))->>'source_hash',(select v->>'source_hash' from data where k='preview'),'Volatile rendering timestamp does not change source hash');
select is((select v#>>'{document,total_cents}' from data where k='preview'),'1502','Exact decimal money is preserved');
select ok((select v::text not like '%INTERNAL HOUSECALL ADDRESS%' from data where k='preview'),'Internal household details excluded');
reset role;
insert into conversations(id,client_id) values('98000000-0000-4000-8000-000000000003',(select id from fx where k='client')),('98000000-0000-4000-8000-000000000099',(select id from fx where k='other'));
set local role authenticated;
create function pg_temp.prepare_invoice(id uuid) returns jsonb language sql as $$select prepare_invoice_email(id,'98000000-0000-4000-8000-000000000001',(select id from fx where k='client'),'98000000-0000-4000-8000-000000000003','invoice@example.test','Your invoice','Reviewed invoice attached',(select v->>'source_hash' from data where k='preview'))$$;
select throws_ok($$select prepare_invoice_email(gen_random_uuid(),'98000000-0000-4000-8000-000000000001',(select id from fx where k='client'),'98000000-0000-4000-8000-000000000099','invoice@example.test','Your invoice','Reviewed invoice attached',(select v->>'source_hash' from data where k='preview'))$$,'42501',null,'Conversation household mismatch denied');
select throws_ok($$select prepare_invoice_email(gen_random_uuid(),'98000000-0000-4000-8000-000000000001',(select id from fx where k='client'),'98000000-0000-4000-8000-000000000003','arbitrary@example.test','Your invoice','Reviewed invoice attached',(select v->>'source_hash' from data where k='preview'))$$,'42501',null,'Arbitrary recipient denied');
insert into data values('prepared',pg_temp.prepare_invoice('98000000-0000-4000-8000-000000000004'));
select is(pg_temp.prepare_invoice('98000000-0000-4000-8000-000000000004')#>'{request,invoice_snapshot}',(select v#>'{request,invoice_snapshot}' from data where k='prepared'),'Retry retains exact original rendering timestamp and snapshot');
select throws_ok($$select pg_temp.prepare_invoice(gen_random_uuid())$$,'23505',null,'One unresolved invoice intent per actor');
select is(recover_invoice_email('98000000-0000-4000-8000-000000000001')#>>'{request,id}','98000000-0000-4000-8000-000000000004','Reload discovers prepared intent without in-memory UUID');
select throws_ok($$select * from invoice_email_requests$$,'42501',null,'No raw staff request table access');
select throws_ok($$select * from invoice_email_payloads$$,'42501',null,'No raw staff payload access');
select throws_ok($$select invoice_document_internal(null,null)$$,'42501',null,'Private document core denied to staff');
select throws_ok($$select invoice_email_preview_internal(null,null)$$,'42501',null,'Private preview core denied to staff');
select throws_ok($$select capture_invoice_email_payload('98000000-0000-4000-8000-000000000004',auth.uid(),'{}')$$,'42501',null,'Staff cannot fabricate attachment bytes');
-- Trusted-server synthetic HTML; real renderer content is covered by adapter tests.
insert into data values('payload',jsonb_build_object('from','care@example.test','reply_to','care@example.test','to',jsonb_build_array('invoice@example.test'),'subject','Your invoice','text','Reviewed invoice attached','attachments',jsonb_build_array(jsonb_build_object('filename','invoice-98000000-0000-4000-8000-000000000001.html','content_type','text/html','content',encode(convert_to('<!doctype html><h1>Invoice fixture</h1>','UTF8'),'base64')))));
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select invoice_email_capture_context('98000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000002')$$,'42501',null,'Capture requires original actor');
select throws_ok($$select invoice_email_context('98000000-0000-4000-8000-000000000004')$$,'42501',null,'Service cannot call private context directly');
select throws_ok($$select capture_invoice_email_payload('98000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001',(select jsonb_set(v,'{attachments,0,filename}','"invoice.pdf"')::text from data where k='payload'))$$,'23514',null,'HTML cannot masquerade as PDF');
select lives_ok($$select capture_invoice_email_payload('98000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001',(select v::text from data where k='payload'))$$,'Service captures frozen invoice HTML');
select lives_ok($$select capture_invoice_email_payload('98000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001',(select v::text from data where k='payload'))$$,'Capture retry is exact');
select throws_ok($$select capture_invoice_email_payload('98000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001',(select (v||'{"text":"changed"}')::text from data where k='payload'))$$,'23505',null,'Captured payload cannot change');
select throws_ok($$select * from invoice_email_payloads$$,'42501',null,'Service cannot directly read payload bytes');
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into data values('recovery',recover_invoice_email('98000000-0000-4000-8000-000000000001'));
select is((select v#>>'{manifest,0,mime_type}' from data where k='recovery'),'text/html','Manifest truthfully describes HTML');
select is(read_invoice_email_attachment('98000000-0000-4000-8000-000000000004',0)->>'content_type','text/html','Owner can inspect exact frozen report');
select throws_ok($$select enqueue_invoice_email('98000000-0000-4000-8000-000000000004',(select v->>'payload_hash' from data where k='recovery'),false)$$,'23514',null,'Explicit review required to queue');
select throws_ok($$select enqueue_invoice_email('98000000-0000-4000-8000-000000000004',repeat('a',64),true)$$,'42501',null,'Wrong reviewed payload hash denied');
insert into fx select 'outbox',id from enqueue_invoice_email('98000000-0000-4000-8000-000000000004',(select v->>'payload_hash' from data where k='recovery'),true);
select is((enqueue_invoice_email('98000000-0000-4000-8000-000000000004',(select v->>'payload_hash' from data where k='recovery'),true)).id,(select id from fx where k='outbox'),'Queued response-loss retry does not duplicate email');
select is((select count(*) from communication_outbox),1::bigint,'Exactly one queued email');
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select ok(recover_invoice_email('98000000-0000-4000-8000-000000000001') is null,'Another actor cannot recover private email');
select throws_ok($$select read_invoice_email_attachment('98000000-0000-4000-8000-000000000004',0)$$,'42501',null,'Another actor cannot download frozen report');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(pg_temp.retry_source_probe((select id from fx where k='outbox'))->>'eligible','true','Current frozen invoice can be reviewed for retry');
select is(pg_temp.retry_source_probe((select id from fx where k='outbox'),$$select void_billing_invoice('98000000-0000-4000-8000-000000000001',(select version from billing_invoices where id='98000000-0000-4000-8000-000000000001'),'Synthetic retry probe')$$)->>'reason','source_ineligible','Voided invoice blocks retry');
insert into fx select 'lease',lease_token from claim_communication();
select is(read_frozen_email_payload((select id from fx where k='outbox'),(select id from fx where k='lease'))->>'payload_text',(select v::text from data where k='payload'),'Generic adapter returns exact serialized invoice request');
select is(read_frozen_email_payload((select id from fx where k='outbox'),(select id from fx where k='lease'))->>'artifact_kind','invoice','Dispatcher receives invoice proof requirement');
select throws_ok($$select read_frozen_email_payload((select id from fx where k='outbox'),gen_random_uuid())$$,'40001',null,'Wrong lease cannot read frozen invoice');
select ok(read_release_email_payload((select id from fx where k='outbox'),(select id from fx where k='lease')) is null,'Old dispatcher cannot discover invoice through clinical release reader');
select is((start_communication_attempt((select id from fx where k='outbox'),(select id from fx where k='lease'),'{"from":"care@example.test","reply_to":"care@example.test"}')).state,'failed','Old plain-text dispatcher fails closed without invoice payload proof');
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select public.requeue_outbox_retry(gen_random_uuid(),(select id from fx where k='outbox'),public.preview_outbox_retry((select id from fx where k='outbox'))->>'expected_work_hash','configuration_repaired',true);
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update fx set id=(claim_communication()).lease_token where k='lease';
reset role;
-- Each real lifecycle mutation + final preflight runs in a rollback subtransaction;
-- the assertion itself is outside that subtransaction so pgTAP accounting is retained.
create function pg_temp.changed_preflight(kind text) returns jsonb language plpgsql as $$
declare state text;receipt uuid;prior_version integer;unchanged boolean;changed boolean;
begin
 begin
  perform set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  select version into prior_version from billing_invoices where id='98000000-0000-4000-8000-000000000001';
  if kind='credit' then perform credit_billing_invoice(gen_random_uuid(),'98000000-0000-4000-8000-000000000001',29,'PRIVATE CREDIT REASON');
  elsif kind='void' then perform void_billing_invoice('98000000-0000-4000-8000-000000000001',prior_version,'PRIVATE VOID REASON');
  elsif kind='household' then update clients set full_name='Changed household',mailing_address='Changed mailing address' where id=(select id from fx where k='client');
  elsif kind='recipient' then update clients set primary_email='changed@example.test' where id=(select id from fx where k='client');
  elsif kind='suppression' then perform suppress_communication(auth.uid(),'EMAIL','invoice@example.test','Client requested no email');
  elsif kind='actor' then update profiles set is_active=false where id=auth.uid();
  elsif kind='conversation' then update conversations set client_id=(select id from fx where k='other') where id='98000000-0000-4000-8000-000000000003';
  else raise exception 'Unknown fixture case';end if;
  select version=prior_version into unchanged from billing_invoices where id='98000000-0000-4000-8000-000000000001';
  if kind='credit' then
   changed:=read_invoice_email_preview('98000000-0000-4000-8000-000000000001',(select id from fx where k='client'))->>'source_hash'<>(select v->>'source_hash' from data where k='preview');
   receipt:=(enqueue_invoice_email('98000000-0000-4000-8000-000000000004',(select v->>'payload_hash' from data where k='recovery'),true)).id;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  state:=(start_communication_attempt((select id from fx where k='outbox'),(select id from fx where k='lease'),jsonb_build_object('from','care@example.test','reply_to','care@example.test','invoice_payload_hash',(select v->>'payload_hash' from data where k='recovery')))).state;
  raise exception 'Rollback fixture mutation' using errcode='P9999';
 exception when sqlstate 'P9999' then null;end;
 return jsonb_build_object('state',state,'invoice_version_unchanged',unchanged,'source_hash_changed',changed,'receipt',receipt);
end $$;
insert into data values('credit_preflight',pg_temp.changed_preflight('credit'));
select is((select v->>'state' from data where k='credit_preflight'),'failed','Credit appended after queue blocks provider preflight');
select ok((select (v->>'invoice_version_unchanged')::boolean and (v->>'source_hash_changed')::boolean from data where k='credit_preflight'),'Full source hash detects credits even when invoice version is unchanged');
select is((select v->>'receipt' from data where k='credit_preflight'),(select id::text from fx where k='outbox'),'Already-queued response-loss retry still returns original receipt after credit');
select is(pg_temp.changed_preflight('void')->>'state','failed','Void after capture blocks provider preflight');
select is(pg_temp.changed_preflight('household')->>'state','failed','Household identity change blocks provider preflight');
select is(pg_temp.changed_preflight('recipient')->>'state','failed','Changed primary email blocks provider preflight');
select is(pg_temp.changed_preflight('suppression')->>'state','failed','Email suppression blocks provider preflight');
select is(pg_temp.changed_preflight('actor')->>'state','failed','Inactive preparation actor blocks provider preflight');
select throws_ok($$select pg_temp.changed_preflight('conversation')$$,'23514',null,'Conversation household cannot change after preparation');
select is((select count(*) from communication_attempts),0::bigint,'All blocked cases create no attempt');
select ok((select bool_and(not (new_data ? 'invoice_snapshot' or new_data ? 'body' or new_data ? 'subject')) from audit_logs where table_name='invoice_email_requests'),'Audit metadata omits rendered invoice content and message');
set local role service_role;
select is((start_communication_attempt((select id from fx where k='outbox'),(select id from fx where k='lease'),jsonb_build_object('from','care@example.test','reply_to','care@example.test','invoice_payload_hash',(select v->>'payload_hash' from data where k='recovery')))).state,'claimed','Verified frozen payload passes final current-invoice preflight');
select finish_communication_attempt((select id from fx where k='outbox'),(select id from fx where k='lease'),'accepted','99000000-0000-4000-8000-000000000001',null);
select is(purge_expired_invoice_email_payloads(100),0,'Fresh accepted payload retained');
reset role;
-- Synthetic operator-backdated rows cover retention without provider calls.
insert into invoice_email_requests(id,invoice_id,actor_id,conversation_id,client_id,recipient,subject,body,invoice_hash,invoice_snapshot,state)
select '98000000-0000-4000-8000-000000000010',invoice_id,actor_id,conversation_id,client_id,recipient,subject,body,invoice_hash,invoice_snapshot,'abandoned' from invoice_email_requests where id='98000000-0000-4000-8000-000000000004';
insert into invoice_email_payloads(request_id,payload_text,payload_hash,manifest,captured_at)
select '98000000-0000-4000-8000-000000000010',payload_text,payload_hash,manifest,now()-interval '91 days' from invoice_email_payloads where request_id='98000000-0000-4000-8000-000000000004';
insert into invoice_email_requests(id,invoice_id,actor_id,conversation_id,client_id,recipient,subject,body,invoice_hash,invoice_snapshot,state)
select '98000000-0000-4000-8000-000000000011',invoice_id,actor_id,conversation_id,client_id,recipient,subject,body,invoice_hash,invoice_snapshot,'ready' from invoice_email_requests where id='98000000-0000-4000-8000-000000000004';
insert into invoice_email_payloads(request_id,payload_text,payload_hash,manifest,captured_at)
select '98000000-0000-4000-8000-000000000011',payload_text,payload_hash,manifest,now()-interval '91 days' from invoice_email_payloads where request_id='98000000-0000-4000-8000-000000000004';
set local role service_role;
select is(purge_expired_frozen_email_payloads(100)->>'invoice_payloads','1','Combined retention purges expired abandoned invoice bytes');
reset role;
select ok((select payload_text is null and purged_at is not null and length(payload_hash)=64 and jsonb_array_length(manifest)=1 from invoice_email_payloads where request_id='98000000-0000-4000-8000-000000000010'),'Purged invoice retains manifest/hash audit evidence');
select ok((select payload_text is not null from invoice_email_payloads where request_id='98000000-0000-4000-8000-000000000011'),'Pending invoice bytes never purged for age alone');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$select abandon_invoice_email('98000000-0000-4000-8000-000000000011')$$,'Owner can abandon unqueued invoice preparation');
select throws_ok($$select abandon_invoice_email('98000000-0000-4000-8000-000000000004')$$,'42501',null,'Queued invoice cannot be abandoned');
select throws_ok($$select read_invoice_email_attachment('98000000-0000-4000-8000-000000000010',0)$$,'23514',null,'Purged invoice bytes unavailable');
reset role;set local role anon;
select throws_ok($$select recover_invoice_email('98000000-0000-4000-8000-000000000001')$$,'42501',null,'Anonymous recovery denied');
select * from finish();
rollback;
