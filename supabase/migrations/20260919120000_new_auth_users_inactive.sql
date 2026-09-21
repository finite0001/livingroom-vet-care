
-- A1: a new auth user is inactive and role-less until an admin explicitly
-- activates them and assigns a role through the staff onboarding path
-- (docs/staff-access.md, src/hub/pages/AdminStaffPage.tsx).
--
-- Previous behaviour (20260613223600) created an active STAFF profile and a
-- STAFF user_roles row for every auth.users insert, so any new auth identity
-- was immediately an active staff member. That is the gap this closes.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _first text;
  _last text;
BEGIN
  _first := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
  _last := COALESCE(NEW.raw_user_meta_data->>'last_name', '');

  INSERT INTO public.profiles (id, first_name, last_name, full_name, role, is_active)
  VALUES (NEW.id, _first, _last, TRIM(_first || ' ' || _last), 'STAFF', false);

  -- Deliberately no user_roles row: a new auth user has no role until an
  -- admin assigns one. is_active_staff() and has_role() both require an
  -- active profile, so this profile cannot act as staff until activated.

  RETURN NEW;
END;
$function$;
