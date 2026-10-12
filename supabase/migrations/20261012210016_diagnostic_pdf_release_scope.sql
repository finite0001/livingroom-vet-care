-- 3A2a: staff metadata review and private binding only. No schema14 export/recipient path.
-- Every embedded diagnostic root is locked before callers may lock other clinical sources.
create function public.diagnostic_pdf_release_binding(p_job uuid,p_pet uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j public.diagnostic_pdf_jobs;v public.diagnostic_panel_versions;m public.diagnostic_pdf_manifests;
 a public.diagnostic_pdf_artifacts;i public.diagnostic_pdf_upload_intents;c public.diagnostic_pdf_captures;
 val public.diagnostic_pdf_validations;o storage.objects;row_source jsonb;embedded jsonb:='[]';root uuid;head uuid;
begin
 if p_mode is null or p_mode not in ('current','historical') then raise exception 'Explicit diagnostic version scope required' using errcode='23514';end if;
 perform 1 from public.pets where id=p_pet for share;if not found then raise exception 'Diagnostic patient unavailable' using errcode='42501';end if;
 select * into j from public.diagnostic_pdf_jobs where id=p_job and pet_id=p_pet;
 if not found then raise exception 'Diagnostic source unavailable' using errcode='42501';end if;
 select * into m from public.diagnostic_pdf_manifests where job_id=p_job;
 if not found then raise exception 'Verified diagnostic PDF required' using errcode='PT409';end if;
 if jsonb_typeof(m.source->'panels') is distinct from 'array' or jsonb_array_length(m.source->'panels') not between 1 and 200
  or not m.source->'panels' @> jsonb_build_array(j.snapshot->'diagnostic')
  or m.source#>'{job,snapshot}' is distinct from j.snapshot
 then raise exception 'Diagnostic manifest census differs' using errcode='23514';end if;
 -- Immutable manifest IDs can be discovered before acquiring mutable source locks.
 for root in select distinct (x->>'panel_id')::uuid from jsonb_array_elements(m.source->'panels') x order by 1 loop
  perform 1 from public.diagnostic_panels where id=root and pet_id=p_pet for share;
  if not found then raise exception 'Embedded diagnostic root unavailable' using errcode='23514';end if;
 end loop;
 select * into j from public.diagnostic_pdf_jobs where id=p_job and pet_id=p_pet for share;
 select * into strict v from public.diagnostic_panel_versions where id=p_job and panel_id=j.panel_id and pet_id=p_pet;
 select current_finalized_id into head from public.diagnostic_panels where id=j.panel_id;
 if p_mode='current' and head is distinct from p_job then raise exception 'Current diagnostic version changed; select historical explicitly' using errcode='PT409';end if;
 for row_source in select value from jsonb_array_elements(m.source->'panels') loop
  if not exists(select 1 from public.diagnostic_panel_versions ev where ev.id=(row_source->>'id')::uuid and ev.pet_id=p_pet and to_jsonb(ev)=row_source) then
   raise exception 'Embedded reviewed diagnostic version differs' using errcode='23514';end if;
  embedded:=embedded||jsonb_build_array(jsonb_build_object('id',row_source->'id','panel_id',row_source->'panel_id',
   'version',row_source->'number','label',row_source#>'{snapshot,panel_name}','reviewed_at',row_source->'reviewed_at','source_hash',row_source->'source_hash'));
 end loop;
 if (select count(distinct x->>'panel_id') from jsonb_array_elements(embedded) x)<>jsonb_array_length(embedded)
  or (m.source->>'total_panels')::integer<jsonb_array_length(embedded) or m.source->>'total_panels' is null
 then raise exception 'Diagnostic manifest census invalid' using errcode='23514';end if;
 select * into a from public.diagnostic_pdf_artifacts where job_id=p_job;
 select * into i from public.diagnostic_pdf_upload_intents where job_id=p_job;
 select * into c from public.diagnostic_pdf_captures where job_id=p_job;
 select * into val from public.diagnostic_pdf_validations where claim_id=a.claim_id and job_id=p_job;
 if a.job_id is null or i.job_id is null or c.job_id is null or val.job_id is null
  or row(j.source_hash,j.snapshot_hash,m.manifest_sha256,c.sha256,c.byte_length)
   is distinct from row(c.source_hash,c.snapshot_hash,i.manifest_sha256,i.sha256,i.byte_length)
  or row(val.manifest_sha256,val.sha256,val.byte_length) is distinct from row(m.manifest_sha256,c.sha256,c.byte_length)
  or v.source_hash is distinct from j.source_hash or octet_length(c.bytes)<>c.byte_length or encode(sha256(c.bytes),'hex')<>c.sha256
 then raise exception 'Admitted diagnostic artifact binding differs' using errcode='PT409';end if;
 select * into o from storage.objects where id=a.object_id for share;
 if not found or row(o.bucket_id,o.name,o.created_at,o.updated_at,o.version,o.metadata->>'mimetype',o.metadata->>'size')
  is distinct from row(i.bucket_id,i.object_path,a.object_created_at,a.object_updated_at,a.object_version,'application/pdf'::text,i.byte_length::text)
 then raise exception 'Registered diagnostic PDF object unavailable' using errcode='PT409';end if;
 return jsonb_build_object('binding_version',1,'job_id',j.id,'pet_id',j.pet_id,'panel_id',j.panel_id,'mode',p_mode,
  'version',v.number,'label',v.snapshot->>'panel_name','reviewed_at',v.reviewed_at,'source_hash',j.source_hash,'snapshot_hash',j.snapshot_hash,
  'manifest_sha256',m.manifest_sha256,'sha256',c.sha256,'byte_length',c.byte_length,
  'embedded_versions',embedded,'total_panels',(m.source->>'total_panels')::integer,
  'bucket',i.bucket_id,'object_path',i.object_path,'object_id',o.id,'object_created_at',o.created_at,'object_updated_at',o.updated_at,'object_version',o.version);
end $$;

-- Future schema14 capture must compare actual private readback after recipient-current checks.
-- This helper grants no recipient authority and is not callable through the Data API.
create function public.verify_diagnostic_pdf_release_bytes(p_binding jsonb,p_bytes bytea) returns void
language plpgsql security definer set search_path=public as $$
declare current_binding jsonb;c public.diagnostic_pdf_captures;begin
 if p_binding is null or jsonb_typeof(p_binding)<>'object' or p_bytes is null or octet_length(p_bytes) not between 1 and 3145728 then
  raise exception 'Exact bounded diagnostic release bytes required' using errcode='23514';end if;
 current_binding:=public.diagnostic_pdf_release_binding((p_binding->>'job_id')::uuid,(p_binding->>'pet_id')::uuid,p_binding->>'mode');
 if current_binding is distinct from p_binding then raise exception 'Diagnostic release binding changed' using errcode='PT409';end if;
 select * into strict c from public.diagnostic_pdf_captures where job_id=(p_binding->>'job_id')::uuid;
 if p_bytes is distinct from c.bytes then raise exception 'Diagnostic release readback differs from admitted capture' using errcode='23514';end if;
end $$;

create function public.read_diagnostic_pdf_release_scope(p_job uuid,p_pet uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();binding jsonb;begin
 -- Current reader, never the historical processing owner or internal download authority.
 binding:=public.diagnostic_pdf_release_binding(p_job,p_pet,p_mode);
 perform 1 from public.profiles where id=actor for share;
 perform 1 from public.user_roles where user_id=actor order by id for share;
 perform public.clinical_require_staff();
 return (binding-array['bucket','object_path','object_id','object_created_at','object_updated_at','object_version'])
  ||jsonb_build_object('export_available',false,'scope_expansion_required',jsonb_array_length(binding->'embedded_versions')>1);
end $$;
revoke all on function public.diagnostic_pdf_release_binding(uuid,uuid,text),public.verify_diagnostic_pdf_release_bytes(jsonb,bytea),public.read_diagnostic_pdf_release_scope(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_diagnostic_pdf_release_scope(uuid,uuid,text) to authenticated;
