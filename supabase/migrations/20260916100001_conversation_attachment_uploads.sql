-- Private staff upload reservations. Message queueing remains a separate reviewed step.
create table public.conversation_attachment_uploads (
 id uuid primary key,
 actor_id uuid not null references public.profiles(id),
 conversation_id uuid not null references public.conversations(id),
 file_name text not null check(length(file_name) between 1 and 255 and file_name=trim(file_name) and file_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 byte_length bigint not null check(byte_length between 1 and 10485760),
 storage_path text not null unique,
 status text not null default 'uploading' check(status in ('uploading','ready','abandoned')),
 sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(), verified_at timestamptz,
 check((status='ready' and sha256 is not null and verified_at is not null) or (status<>'ready' and sha256 is null and verified_at is null))
);
create index conversation_attachment_owner on public.conversation_attachment_uploads(actor_id,status,created_at);
alter table public.conversation_attachment_uploads enable row level security;
revoke all on public.conversation_attachment_uploads from public,anon,authenticated,service_role;
grant select on public.conversation_attachment_uploads to authenticated;
create policy "Owner reads attachment reservation" on public.conversation_attachment_uploads for select to authenticated
 using(actor_id=auth.uid() and public.is_active_staff(auth.uid()));

create function public.guard_conversation_attachment_upload() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if tg_op='DELETE' then raise exception 'Attachment upload evidence cannot be deleted' using errcode='23514';end if;
 if (to_jsonb(new)-array['status','sha256','verified_at']) is distinct from (to_jsonb(old)-array['status','sha256','verified_at'])
  or old.status<>'uploading' or new.status not in ('ready','abandoned') then
  raise exception 'Attachment upload metadata is immutable' using errcode='23514';end if;
 return new;
end $$;
create trigger conversation_attachment_upload_guard before update or delete on public.conversation_attachment_uploads
 for each row execute function public.guard_conversation_attachment_upload();

create function public.prepare_conversation_attachment(p_id uuid,p_conversation_id uuid,p_file_name text,p_mime_type text,p_byte_length bigint)
returns public.conversation_attachment_uploads language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();result public.conversation_attachment_uploads;
begin
 if p_id is null or p_conversation_id is null then raise exception 'Upload identity required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-attachment-owner:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended('conversation-attachment:'||p_id::text,0));
 if public.is_active_staff(actor) is not true then raise exception 'Active staff required' using errcode='42501';end if;
 select * into result from public.conversation_attachment_uploads where id=p_id;
 if found then
  if result.actor_id<>actor then raise exception 'Owned upload required' using errcode='42501';end if;
  if row(result.conversation_id,result.file_name,result.mime_type,result.byte_length) is distinct from row(p_conversation_id,p_file_name,p_mime_type,p_byte_length) then
   raise exception 'Upload identity already used with different metadata' using errcode='23505';end if;
  return result;
 end if;
 if not exists(select 1 from public.conversations where id=p_conversation_id) then raise exception 'Conversation required' using errcode='42501';end if;
 if (select count(*) from public.conversation_attachment_uploads where actor_id=actor and status='uploading')>=20 then
  raise exception 'Finish or abandon pending uploads before starting another' using errcode='23514';end if;
 insert into public.conversation_attachment_uploads(id,actor_id,conversation_id,file_name,mime_type,byte_length,storage_path)
 values(p_id,actor,p_conversation_id,p_file_name,p_mime_type,p_byte_length,actor::text||'/'||p_conversation_id::text||'/'||p_id::text||'/original') returning * into result;
 return result;
end $$;

create function public.abandon_conversation_attachment(p_id uuid)
returns public.conversation_attachment_uploads language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.clinical_require_staff();result public.conversation_attachment_uploads;
begin
 select * into result from public.conversation_attachment_uploads where id=p_id and actor_id=actor for update;
 if not found then raise exception 'Owned upload required' using errcode='42501';end if;
 if public.is_active_staff(result.actor_id) is not true then raise exception 'Active staff required' using errcode='42501';end if;
 if result.status='ready' then raise exception 'Verified attachment evidence is retained' using errcode='23514';end if;
 if result.status='uploading' then update public.conversation_attachment_uploads set status='abandoned' where id=p_id returning * into result;end if;
 return result;
end $$;

-- Only the byte-verification Edge handler may finalize. User-supplied hashes are not proof.
create function public.verify_conversation_attachment(p_id uuid,p_actor_id uuid,p_byte_length bigint,p_mime_type text,p_sha256 text)
returns public.conversation_attachment_uploads language plpgsql security definer set search_path=public as $$
declare result public.conversation_attachment_uploads;meta jsonb;
begin
 if public.is_active_staff(p_actor_id) is not true then raise exception 'Active staff required' using errcode='42501';end if;
 select * into result from public.conversation_attachment_uploads where id=p_id and actor_id=p_actor_id for update;
 if not found then raise exception 'Owned upload required' using errcode='42501';end if;
 if public.is_active_staff(result.actor_id) is not true then raise exception 'Active staff required' using errcode='42501';end if;
 if p_byte_length is distinct from result.byte_length or p_mime_type is distinct from result.mime_type or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then
  raise exception 'Verified bytes do not match reservation' using errcode='23514';end if;
 if result.status='ready' then
  if result.sha256<>p_sha256 then raise exception 'Attachment bytes changed' using errcode='23514';end if;
  return result;
 end if;
 if result.status<>'uploading' then raise exception 'Upload was abandoned' using errcode='23514';end if;
 select metadata into meta from storage.objects where bucket_id='conversation-attachment-uploads' and name=result.storage_path for share;
 if not found or meta->>'size' is distinct from result.byte_length::text or meta->>'mimetype' is distinct from result.mime_type then
  raise exception 'Stored object does not match reservation' using errcode='23514';end if;
 update public.conversation_attachment_uploads set status='ready',sha256=p_sha256,verified_at=clock_timestamp() where id=p_id returning * into result;
 return result;
end $$;

create function public.conversation_attachment_storage_write(p_path text)
returns boolean language plpgsql security definer set search_path=public as $$
declare result public.conversation_attachment_uploads;
begin
 if public.is_active_staff(auth.uid()) is not true then return false;end if;
 select * into result from public.conversation_attachment_uploads where storage_path=p_path and actor_id=auth.uid() for update;
 return found and result.status='uploading' and public.is_active_staff(auth.uid()) is true;
end $$;
create function public.conversation_attachment_storage_read(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.is_active_staff(auth.uid()) and exists(select 1 from public.conversation_attachment_uploads where storage_path=p_path and actor_id=auth.uid() and status in ('uploading','ready'))
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('conversation-attachment-uploads','conversation-attachment-uploads',false,10485760,array['application/pdf','image/png','image/jpeg']);
create policy "Upload own reserved conversation file" on storage.objects for insert to authenticated
 with check(bucket_id='conversation-attachment-uploads' and public.conversation_attachment_storage_write(name));
create policy "Read own reserved conversation file" on storage.objects for select to authenticated
 using(bucket_id='conversation-attachment-uploads' and public.conversation_attachment_storage_read(name));
-- No UPDATE/DELETE object policy: bytes cannot be replaced between verification and review.
revoke all on function public.guard_conversation_attachment_upload() from public,anon,authenticated,service_role;
revoke all on function public.prepare_conversation_attachment(uuid,uuid,text,text,bigint) from public,anon,authenticated,service_role;
revoke all on function public.abandon_conversation_attachment(uuid) from public,anon,authenticated,service_role;
revoke all on function public.verify_conversation_attachment(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.conversation_attachment_storage_write(text) from public,anon,authenticated,service_role;
revoke all on function public.conversation_attachment_storage_read(text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_conversation_attachment(uuid,uuid,text,text,bigint),public.abandon_conversation_attachment(uuid),public.conversation_attachment_storage_write(text),public.conversation_attachment_storage_read(text) to authenticated;
grant execute on function public.verify_conversation_attachment(uuid,uuid,bigint,text,text) to service_role;
