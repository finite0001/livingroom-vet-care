import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildReleaseEmailPayload } from '../../supabase/functions/_shared/release-email-payload.ts';
import { buildDocumentLinkArtifacts } from '../../supabase/functions/_shared/document-link-artifacts.ts';
import { documentLinkConfig, materializeDocumentLink } from '../../supabase/functions/_shared/document-link-capability.ts';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data; };

export async function seedReleasePackages({state, api, admin, sql, includePrescription=false}) {
  const staff = async (name,args) => checked(await api.rpc(name,args));
  const service = async (name,args) => checked(await admin.rpc(name,args));
  const download = async (bucket,path,size) => {
    const bytes = new Uint8Array(await checked(await admin.storage.from(bucket).download(path)).arrayBuffer());
    assert.equal(bytes.length,size); return bytes;
  };
  const selected = state.apiDecisions.find(item => item.outcome.record?.version === 2).outcome.record;
  const conversation = state.releasePackages?.conversation ?? randomUUID();
  if (!state.releasePackages) sql(`insert into conversations(id,client_id) values('${conversation}','${state.client}');
    update record_release_policy set accepted_schema_version=9,acceptance_reference='Synthetic isolated restore schema9 only',enabled=true;`);
  const saved = {selection:{api_attachment_ids:[selected.id]},conversation};
  if (includePrescription) {
    const prescription = JSON.parse(sql(`select to_jsonb(p) from ezyvet_imported_prescriptions p where pet_id='${state.pet}' and version=2`));
    assert.equal(prescription.version,2);
    saved.prescription = {id:prescription.id,version_hash:prescription.version_hash,source_site_uid:prescription.source_site_uid,prescription_external_id:prescription.prescription_external_id};
    saved.selection.imported_prescription_ids = [prescription.id];
  }
  for (const channel of ['EMAIL','SMS']) {
    const recipient = channel === 'EMAIL' ? 'restore@example.test' : '+13035550481';
    const previewArgs = {p_pet_id:state.pet,p_client_id:state.client,p_channel:channel,p_recipient:recipient,p_selection:saved.selection};
    const preview = await staff('preview_record_release_v9',previewArgs);
    assert.equal(preview.snapshot.schema_version,9);
    assert.equal(preview.snapshot.api_attachments.length,1);
    if (includePrescription) {
      assert.equal(preview.snapshot.imported_prescriptions.length,1);
      const prescription=preview.snapshot.imported_prescriptions[0];
      assert.equal(prescription.id,saved.prescription.id);
      assert.equal(prescription.version_hash,saved.prescription.version_hash);
      assert.equal(prescription.context.reviewed.completeness,'partial');
      assert.equal(prescription.context.reviewed.partial_reason,'Source item 5 was not observed');
    }
    const args = {...previewArgs,p_id:randomUUID(),p_reviewed_snapshot:preview.snapshot,p_reviewed_hash:preview.source_hash,p_attest_review:true};
    const release = await staff('confirm_record_release',args);
    saved[channel] = {args,release};
    if (includePrescription) {
      const sources=JSON.parse(sql(`select jsonb_agg(source_kind order by source_kind) from record_release_sources where release_id='${release.id}'`));
      assert.deepEqual(sources,['api_attachment','imported_prescription']);
    }
  }
  const email = saved.EMAIL;
  email.prepare = {p_request_id:randomUUID(),p_release_id:email.release.id,p_conversation_id:conversation,p_subject:'Synthetic restore records',p_body:'Synthetic package; never sent',p_release_hash:email.release.source_hash};
  const prepared = await staff('prepare_release_email',email.prepare);
  email.payload = await buildReleaseEmailPayload(prepared.request,await staff('read_record_release',{p_id:email.release.id}),{from:'care@example.test',replyTo:'care@example.test'},download);
  await service('capture_release_email_payload',{p_request_id:email.prepare.p_request_id,p_actor_id:state.user,p_payload_text:email.payload.payload_text});
  email.recovered = await staff('recover_release_email',{p_release_id:email.release.id,p_request_id:email.prepare.p_request_id});
  assert.equal(email.recovered.payload_hash,email.payload.payload_hash);
  const sms = saved.SMS;
  await staff('record_sms_consent',{p_actor_id:state.user,p_client_id:state.client,p_phone:'+13035550481',p_opted_in:true,p_method:'WRITTEN',p_details:'Synthetic local restore consent only',p_expected_updated_at:sql(`select coalesce(max(updated_at)::text,'') from sms_consent where client_id='${state.client}' and phone_number='+13035550481'`) || null});
  const preview = await staff('preview_document_link',{p_family:'record_release',p_source_id:sms.release.id,p_client_id:state.client});
  sms.prepare = {p_request_id:randomUUID(),p_family:'record_release',p_source_id:sms.release.id,p_client_id:state.client,p_conversation_id:conversation,p_recipient:'+13035550481',p_source_hash:preview.source_hash,p_expires_at:new Date(Date.now()+86400000).toISOString(),p_message_template:'Synthetic restore: {{document_link}}',p_origin:'https://thelivingroom.vet',p_key_version:'synthetic'};
  await staff('prepare_document_link',sms.prepare);
  const context = await service('document_link_capture_context',{p_id:sms.prepare.p_request_id,p_actor_id:state.user});
  const config = documentLinkConfig({origin:'https://thelivingroom.vet',activeKeyVersion:'synthetic',keys:JSON.stringify({synthetic:Buffer.from('synthetic-local-secret-00000000000').toString('base64')}),publicEnabled:'true'});
  sms.capability = await materializeDocumentLink(context.grant,config);
  sms.payload = await buildDocumentLinkArtifacts(context.grant,{name:'Synthetic',address:'Synthetic',domain:null},download);
  await service('capture_document_link',{p_id:sms.prepare.p_request_id,p_actor_id:state.user,p_payload_text:sms.payload.payload_text,p_token_hash:sms.capability.token_hash,p_message_hash:sms.capability.message_hash});
  await staff('attest_document_link',{p_request_id:sms.prepare.p_request_id,p_reviewed_artifact_hash:sms.payload.artifact_hash,p_reviewed_message_hash:sms.capability.message_hash,p_attest:true});
  sms.recovered = await staff('recover_document_link',{p_family:'record_release',p_source_id:sms.release.id,p_request_id:sms.prepare.p_request_id});
  assert.equal(sms.recovered.artifact_hash,sms.payload.artifact_hash);
  state.releasePackages = saved;
}

export async function verifyReleasePackages({state,api,admin,sql,packages=state.releasePackages}) {
  const saved = packages;
  assert.ok(saved);
  const staff = async (name,args) => checked(await api.rpc(name,args));
  const service = async (name,args) => checked(await admin.rpc(name,args));
  const {EMAIL:email,SMS:sms} = saved;
  assert.deepEqual(await staff('prepare_release_email',email.prepare),email.recovered);
  assert.deepEqual(await staff('prepare_document_link',sms.prepare),sms.recovered);
  for (const item of [email,sms]) {
    assert.deepEqual(await staff('confirm_record_release',item.args),item.release);
    assert.equal((await staff('read_record_release',{p_id:item.release.id})).eligible,true);
  }
  const payloadRows = () => sql(`select jsonb_build_object('email',(select to_jsonb(p) from release_email_payloads p where request_id='${email.prepare.p_request_id}'),'link',(select to_jsonb(p) from document_link_payloads p where grant_id='${sms.prepare.p_request_id}'))`);
  const before = payloadRows();
  const rows = JSON.parse(before);
  assert.equal(rows.email.payload_text,email.payload.payload_text);
  assert.equal(rows.link.payload_text,sms.payload.payload_text);
  assert.equal(digest(rows.email.payload_text),email.payload.payload_hash);
  assert.equal(digest(rows.link.payload_text),sms.payload.artifact_hash);
  for (const [payload,key] of [[JSON.parse(rows.email.payload_text),'attachments'],[JSON.parse(rows.link.payload_text),'artifacts']]) {
    assert.equal(payload[key].length,2);
    const report=Buffer.from(payload[key][0].content,'base64').toString('utf8');
    assert.match(report,/Selected ezyVet API originals/);
    if (saved.prescription) {
      assert.match(report,/Clinician-reviewed outside prescription history/);
      assert.match(report,/Partial history disclosure/);
      assert.match(report,/Source item 5 was not observed/);
      assert.match(report,/does not authorize local prescribing/);
    }
    const original = state.apiOriginals.find(item => item.status==='ready');
    assert.equal(digest(Buffer.from(payload[key][1].content,'base64')),original.contentSha256);
  }
  const usedBefore = Number(sql(`select used from document_link_access_budget where grant_id='${sms.prepare.p_request_id}'`));
  const manifest = await service('retrieve_document_link',{p_id:sms.prepare.p_request_id,p_token_hash:sms.capability.token_hash,p_artifact_index:null});
  assert.deepEqual(manifest.manifest,sms.recovered.manifest);
  const artifact = await service('retrieve_document_link',{p_id:sms.prepare.p_request_id,p_token_hash:sms.capability.token_hash,p_artifact_index:1});
  assert.equal(digest(Buffer.from(artifact.content,'base64')),sms.recovered.manifest[1].sha256);
  assert.equal(Number(sql(`select used from document_link_access_budget where grant_id='${sms.prepare.p_request_id}'`)),usedBefore+2);
  // Each mutation is isolated and rolled back: the second case must not inherit
  // disabled policy or an already-invalid release from the first case.
  const review = state.apiDecisions.find(item => item.outcome.record?.version===2).outcome.record;
  const mutations = [
    ['policy','update record_release_policy set enabled=false;'],
    ['source',`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(review.source_site_uid)} and resource='animal' and external_id=${quote(review.source_context.parent.animal_external_id)};`],
  ];
  if (saved.prescription) mutations.push(['prescription',`update ezyvet_identity_heads set version=version+1 where source_site_uid=${quote(saved.prescription.source_site_uid)} and resource='prescription' and external_id=${quote(saved.prescription.prescription_external_id)};`]);
  for (const [kind,mutation] of mutations) {
    sql(`begin;
      select set_config('request.jwt.claims','{"sub":"${state.user}","role":"authenticated"}',true);
      ${mutation}
      do $probe$ declare result jsonb; old_used integer; begin
        result:=read_record_release('${email.release.id}');
        ${kind !== 'policy' ? "if (result->>'eligible')::boolean is distinct from false or jsonb_array_length(result->'events')=0 then raise exception 'Source change must invalidate release';end if;" : ''}
        begin
          perform authorize_record_release('${email.release.id}','${state.client}','EMAIL','restore@example.test');
          raise exception 'Changed policy/source must deny release authorization';
        exception when insufficient_privilege then null;end;
        if (recover_release_email('${email.release.id}','${email.prepare.p_request_id}')->>'payload_hash') is distinct from '${email.payload.payload_hash}' then raise exception 'Saved email recovery differs';end if;
        if (recover_document_link('record_release','${sms.release.id}','${sms.prepare.p_request_id}')->>'artifact_hash') is distinct from '${sms.payload.artifact_hash}' then raise exception 'Saved link recovery differs';end if;
        select used into old_used from document_link_access_budget where grant_id='${sms.prepare.p_request_id}';
        begin
          perform retrieve_document_link('${sms.prepare.p_request_id}','${sms.capability.token_hash}',1);
          raise exception 'Changed policy/source must deny public artifact';
        exception when insufficient_privilege then null;end;
        if (select used from document_link_access_budget where grant_id='${sms.prepare.p_request_id}')<>old_used then raise exception 'Denied retrieval spent budget';end if;
      end $probe$;
      rollback;`);
  }
  assert.equal(payloadRows(),before,'Restore verification must not rewrite saved delivery bytes');
  assert.equal((await staff('read_record_release',{p_id:email.release.id})).eligible,true);
  assert.equal(sql('select count(*) from communication_outbox'),'0');
}
