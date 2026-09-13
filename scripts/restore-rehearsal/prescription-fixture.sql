-- Substitutions are validated UUIDs and the generated local rehearsal site.
do $fixture$
declare
 a uuid := '__ACTOR__'; p uuid := '__PET__'; client uuid := '__CLIENT__';
 mapping uuid; header_run uuid:=gen_random_uuid(); item_run uuid:=gen_random_uuid();
 first_review uuid:=gen_random_uuid(); correction uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid();
 package uuid:=gen_random_uuid(); claimed jsonb; parent jsonb; context jsonb; payload jsonb;
 prepared jsonb; approved jsonb; corrected jsonb; selection jsonb; preview jsonb;
 was_admin boolean; was_dvm boolean; prior_policy jsonb;
begin
 select exists(select 1 from user_roles where user_id=a and role='ADMIN') into was_admin;
 select exists(select 1 from user_roles where user_id=a and role='DVM') into was_dvm;
 if not was_admin then insert into user_roles(user_id,role) values(a,'ADMIN');end if;
 if not was_dvm then insert into user_roles(user_id,role) values(a,'DVM');end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 select id into strict mapping from ezyvet_record_links where pet_id=p and source_site_uid='__SITE__' and resource='animal';
 claimed:=claim_ezyvet_prescription_import(header_run,a,'__SITE__','prescription','https://api.trial.ezyvet.com',mapping);
 perform stage_ezyvet_import_page(header_run,a,(claimed->>'lease_id')::uuid,1,false,
  '[{"external_id":"301","payload":{"id":301,"animal_id":77,"prescription_item_list":[401,402],"date_of_prescription":"uninterpreted"}}]');
 parent:=list_ezyvet_prescription_candidates(mapping,'prescription')#>'{candidates,0}';
 claimed:=claim_ezyvet_prescriptionitem_import(item_run,a,'__SITE__','prescriptionitem','https://api.trial.ezyvet.com',mapping,
  (parent->>'id')::uuid,parent->>'payload_hash',(parent->>'observed_head_version')::integer);
 perform stage_ezyvet_import_page(item_run,a,(claimed->>'lease_id')::uuid,1,false,
  '[{"external_id":"401","payload":{"id":401,"prescription_id":301,"qty":"source units","remaining":"unknown","instructions":"Synthetic original prescription"}},{"external_id":"402","payload":{"id":402,"prescription_id":301,"instructions":"Uninterpreted omitted source item"}}]');
 context:=get_ezyvet_prescription_review_candidate(p,item_run);
 payload:=jsonb_build_object('item_run_id',item_run,'patient_version',context->'patient_version','interpretation',jsonb_build_object(
  'prescribed_on',null,'prescription_date_status','uninterpreted','status','unknown','outside_author',null,
  'reason','Synthetic restoration of outside prescription evidence','completeness','partial','partial_reason','Scan is unfinished and one item remains uninterpreted',
  'replaces_id',null,'expected_predecessor_hash',null,'items',jsonb_build_array(jsonb_build_object(
   'snapshot_id',context#>'{source_context,items,0,snapshot_id}','start_on',null,'start_date_status','unknown','product_id',null,'product_version',null,'note',null))));
 prepared:=prepare_ezyvet_prescription_review(first_review,p,payload);
 approved:=approve_ezyvet_prescription_review(first_review,p,prepared#>>'{request,request_hash}',true);
 payload:=jsonb_set(payload,'{interpretation}',(payload->'interpretation')||jsonb_build_object('replaces_id',first_review,
  'expected_predecessor_hash',approved#>>'{receipt,version_hash}','outside_author','Synthetic reviewed clinician','reason','Synthetic preserved correction of attribution'));
 prepared:=prepare_ezyvet_prescription_review(correction,p,payload);
 corrected:=approve_ezyvet_prescription_review(correction,p,prepared#>>'{request,request_hash}',true);
 payload:=jsonb_set(payload,'{interpretation}',(payload->'interpretation')||jsonb_build_object('replaces_id',correction,
  'expected_predecessor_hash',corrected#>>'{receipt,version_hash}','reason','Synthetic pending review survives backup'));
 perform prepare_ezyvet_prescription_review(pending,p,payload);
 select to_jsonb(r) into prior_policy from record_release_policy r where id;
 insert into record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version)
  values(true,true,'Synthetic restore fixture',now(),'TEST ONLY',8)
  on conflict(id) do update set enabled=true,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,acceptance_reference=excluded.acceptance_reference,accepted_schema_version=8;
 selection:=jsonb_build_object('imported_prescription_ids',jsonb_build_array(correction));
 preview:=preview_record_release_v8(p,client,'EMAIL','restore@example.test',selection);
 perform confirm_record_release(package,p,client,'EMAIL','restore@example.test',selection,preview->'snapshot',preview->>'source_hash',true);
 delete from record_release_policy where id;
 if prior_policy is not null then insert into record_release_policy select * from jsonb_populate_record(null::record_release_policy,prior_policy);end if;
 if not was_dvm then delete from user_roles where user_id=a and role='DVM';end if;
 if not was_admin then delete from user_roles where user_id=a and role='ADMIN';end if;
end $fixture$;
