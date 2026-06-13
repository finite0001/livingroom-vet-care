
-- 1. Helper: is the user an active staff member?
CREATE OR REPLACE FUNCTION public.is_active_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.id = _user_id
      AND p.is_active = true
      AND ur.role IN ('ADMIN','DVM','TECH','STAFF')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_staff(uuid) TO authenticated, service_role;

-- 2. Trigger: prevent non-admins from changing is_active or role on profiles
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- definer/system contexts
  END IF;
  IF public.has_role(auth.uid(), 'ADMIN') THEN
    RETURN NEW;
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only admins can change profile active status';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only admins can change profile role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileges_trg ON public.profiles;
CREATE TRIGGER protect_profile_privileges_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- 3. PROFILES
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "System can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Active staff can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile basics" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;

CREATE POLICY "Active staff can read profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()) OR auth.uid() = id);

CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Users can update own profile basics" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));

-- 4. USER_ROLES — keep existing admin policies, ensure scoped to authenticated
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;

CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));

-- 5. CLIENTS
DROP POLICY IF EXISTS "Clients viewable by authenticated" ON public.clients;
DROP POLICY IF EXISTS "Auth insert clients" ON public.clients;
DROP POLICY IF EXISTS "Auth update clients" ON public.clients;
DROP POLICY IF EXISTS "Active staff read clients" ON public.clients;
DROP POLICY IF EXISTS "Active staff insert clients" ON public.clients;
DROP POLICY IF EXISTS "Active staff update clients" ON public.clients;
DROP POLICY IF EXISTS "Admins delete clients" ON public.clients;

CREATE POLICY "Active staff read clients" ON public.clients
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff insert clients" ON public.clients
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff update clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_active_staff(auth.uid()))
  WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins delete clients" ON public.clients
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));

-- 6. PETS
DROP POLICY IF EXISTS "Pets viewable by authenticated" ON public.pets;
DROP POLICY IF EXISTS "Auth insert pets" ON public.pets;
DROP POLICY IF EXISTS "Auth update pets" ON public.pets;
DROP POLICY IF EXISTS "Active staff read pets" ON public.pets;
DROP POLICY IF EXISTS "Active staff insert pets" ON public.pets;
DROP POLICY IF EXISTS "Active staff update pets" ON public.pets;
DROP POLICY IF EXISTS "Admins delete pets" ON public.pets;

CREATE POLICY "Active staff read pets" ON public.pets
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff insert pets" ON public.pets
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff update pets" ON public.pets
  FOR UPDATE TO authenticated
  USING (public.is_active_staff(auth.uid()))
  WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins delete pets" ON public.pets
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));

-- 7. CONVERSATIONS
DROP POLICY IF EXISTS "Conversations viewable by authenticated" ON public.conversations;
DROP POLICY IF EXISTS "Auth insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Auth update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Auth delete conversations" ON public.conversations;
DROP POLICY IF EXISTS "Active staff read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Active staff insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Active staff update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Admins delete conversations" ON public.conversations;

CREATE POLICY "Active staff read conversations" ON public.conversations
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff insert conversations" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff update conversations" ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_active_staff(auth.uid()))
  WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins delete conversations" ON public.conversations
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));

-- 8. MESSAGES
DROP POLICY IF EXISTS "Messages viewable by authenticated" ON public.messages;
DROP POLICY IF EXISTS "Auth insert messages" ON public.messages;
DROP POLICY IF EXISTS "Auth delete messages" ON public.messages;
DROP POLICY IF EXISTS "Active staff read messages" ON public.messages;
DROP POLICY IF EXISTS "Active staff insert messages" ON public.messages;
DROP POLICY IF EXISTS "Admins delete messages" ON public.messages;

CREATE POLICY "Active staff read messages" ON public.messages
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff insert messages" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins delete messages" ON public.messages
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));

-- 9. CLIENT_NOTES
DROP POLICY IF EXISTS "Auth manage client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Active staff read client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Active staff insert client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Active staff update client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Admins delete client_notes" ON public.client_notes;

CREATE POLICY "Active staff read client_notes" ON public.client_notes
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff insert client_notes" ON public.client_notes
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff update client_notes" ON public.client_notes
  FOR UPDATE TO authenticated
  USING (public.is_active_staff(auth.uid()))
  WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins delete client_notes" ON public.client_notes
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));
