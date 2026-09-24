-- Display the current number's consent and effective suppression together.
create function public.current_sms_consent(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare phone text; selected public.sms_consent; result jsonb;
begin
 perform public.clinical_require_staff();
 select public.communication_recipient('SMS',primary_phone) into phone from public.clients where id=p_client_id;
 if not found then raise exception 'Household not found' using errcode='P0002'; end if;
 select * into selected from public.sms_consent where client_id=p_client_id and public.communication_recipient('SMS',phone_number)=phone order by updated_at desc,id desc limit 1;
 result:=case when selected.id is null then jsonb_build_object('id',null,'client_id',p_client_id,'phone_number',phone,'opted_in',false,'updated_at',null) else to_jsonb(selected) end;
 return result || jsonb_build_object('can_message',phone is not null and not public.communication_is_suppressed('SMS',phone,p_client_id));
end $$;
revoke all on function public.current_sms_consent(uuid) from public,anon,authenticated,service_role;
grant execute on function public.current_sms_consent(uuid) to authenticated;
