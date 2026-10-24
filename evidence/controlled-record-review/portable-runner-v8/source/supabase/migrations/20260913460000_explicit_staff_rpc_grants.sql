-- Creation-role default ACLs can grant application roles directly. Revoking only
-- PUBLIC does not remove those grants; CREATE OR REPLACE preserves them as well.
-- Make these six existing RPC contracts explicit without changing their bodies,
-- owners, SECURITY DEFINER settings or any global default privilege policy.
revoke all on function
 public.admin_set_staff_active(uuid,boolean),
 public.admin_update_staff_role(uuid,public.user_role),
 public.clock_in(),
 public.clock_out(),
 public.get_consent_submission(text),
 public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text)
from public,anon,authenticated,service_role;

grant execute on function
 public.admin_set_staff_active(uuid,boolean),
 public.admin_update_staff_role(uuid,public.user_role),
 public.clock_in(),
 public.clock_out(),
 public.review_ezyvet_snapshot(uuid,text,uuid,uuid,text)
to authenticated;

-- This lookup is intentionally available to the holder of an unexpired consent
-- token. Preserve the public client workflow; do not grant a service RPC path.
grant execute on function public.get_consent_submission(text) to anon,authenticated;
