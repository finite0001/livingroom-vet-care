CREATE OR REPLACE FUNCTION public.admin_update_staff_role(_target_user uuid, _new_role public.user_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Only admins can change staff roles';
  END IF;
  IF _target_user IS NULL OR _new_role IS NULL THEN
    RAISE EXCEPTION 'Missing target user or role';
  END IF;

  -- Atomic: both updates run inside the same function call / transaction
  UPDATE public.profiles SET role = _new_role, updated_at = now() WHERE id = _target_user;
  DELETE FROM public.user_roles WHERE user_id = _target_user;
  INSERT INTO public.user_roles (user_id, role) VALUES (_target_user, _new_role);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_staff_role(uuid, public.user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_staff_role(uuid, public.user_role) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_set_staff_active(_target_user uuid, _is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Only admins can change staff active status';
  END IF;
  UPDATE public.profiles SET is_active = _is_active, updated_at = now() WHERE id = _target_user;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_active(uuid, boolean) TO authenticated;
