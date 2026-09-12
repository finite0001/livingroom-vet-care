-- Stopping delivery must not depend on an active wording template.
create function public.disable_reminder_automation_policy(p_id uuid,p_expected_version integer,p_review_note text)
returns public.reminder_automation_policies language plpgsql security definer set search_path=public as $$
declare actor uuid:=public.care_require_admin();r public.reminder_automation_policies;
begin
 if p_id is null or p_expected_version is null or p_review_note is null or length(trim(p_review_note)) not between 1 and 2000 then
  raise exception 'Policy version and review reason are required' using errcode='23514';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,18));
 select * into r from public.reminder_automation_policies where id=p_id for update;
 if not found then raise exception 'Policy unavailable' using errcode='23514';end if;
 if r.approved_by=actor and r.version=p_expected_version+1 and not r.enabled and r.review_note=trim(p_review_note) then return r;end if;
 if r.version<>p_expected_version then raise exception 'Automation policy version conflict' using errcode='40001';end if;
 update public.reminder_automation_policies set enabled=false,version=version+1,review_note=trim(p_review_note),approved_by=actor,approved_at=now() where id=p_id returning * into r;
 insert into public.reminder_automation_policy_history(policy_id,version,snapshot) values(r.id,r.version,to_jsonb(r));
 return r;
end $$;
revoke all on function public.disable_reminder_automation_policy(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.disable_reminder_automation_policy(uuid,integer,text) to authenticated;
