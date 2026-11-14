begin;
create table workforce.backup_runs(id uuid primary key,started_at timestamptz not null,finished_at timestamptz not null default now(),status text not null check(status in('SUCCEEDED','FAILED','NAS_PENDING')),object_count integer not null check(object_count>=0),encrypted_bytes bigint not null check(encrypted_bytes>=0),archive_sha256 text check(archive_sha256~'^[a-f0-9]{64}$'),failure_code text check(failure_code in('BACKUP_FAILED','UPLOAD_FAILED','CONFIGURATION_MISSING')));
alter table workforce.backup_runs enable row level security;
revoke all on workforce.backup_runs from public,anon,authenticated,service_role;
create function public.record_staff_backup(p_id uuid,p_started_at timestamptz,p_status text,p_object_count integer,p_bytes bigint,p_sha256 text,p_failure text)returns void language plpgsql security definer set search_path=pg_catalog as $$begin
 insert into workforce.backup_runs(id,started_at,status,object_count,encrypted_bytes,archive_sha256,failure_code)values(p_id,p_started_at,p_status,p_object_count,p_bytes,p_sha256,p_failure);
end$$;
create function public.read_staff_backups()returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$begin
 perform workforce.require_manager(true);return(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select * from workforce.backup_runs order by finished_at desc limit 30)q);
end$$;
revoke all on function public.record_staff_backup(uuid,timestamptz,text,integer,bigint,text,text)from public,anon,authenticated;
grant execute on function public.record_staff_backup(uuid,timestamptz,text,integer,bigint,text,text)to service_role;
revoke all on function public.read_staff_backups()from public,anon,service_role;
grant execute on function public.read_staff_backups()to authenticated;
commit;
