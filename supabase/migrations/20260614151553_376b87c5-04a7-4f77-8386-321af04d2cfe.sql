
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.user_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _user_id AND ur.role = _role AND p.is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION public.track_response_metric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _client_msg RECORD;
BEGIN
  IF NEW.sender_type = 'STAFF' AND NEW.is_internal = false THEN
    SELECT id, created_at, type INTO _client_msg
    FROM public.messages
    WHERE conversation_id = NEW.conversation_id AND sender_type = 'CLIENT' AND created_at < NEW.created_at
    ORDER BY created_at DESC LIMIT 1;
    IF _client_msg.id IS NOT NULL THEN
      INSERT INTO public.response_metrics (conversation_id, message_id, staff_id, client_message_at, staff_reply_at, channel)
      VALUES (NEW.conversation_id, NEW.id, NEW.sender_id, _client_msg.created_at, NEW.created_at, NEW.type);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_staff_role(_target_user uuid, _new_role public.user_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN RAISE EXCEPTION 'Only admins can change staff roles'; END IF;
  IF _target_user IS NULL OR _new_role IS NULL THEN RAISE EXCEPTION 'Missing target user or role'; END IF;
  IF _new_role <> 'ADMIN'
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = 'ADMIN')
     AND (SELECT count(*) FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
          WHERE ur.role = 'ADMIN' AND p.is_active = true) <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last active admin';
  END IF;
  UPDATE public.profiles SET role = _new_role, updated_at = now() WHERE id = _target_user;
  DELETE FROM public.user_roles WHERE user_id = _target_user;
  INSERT INTO public.user_roles (user_id, role) VALUES (_target_user, _new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_staff_active(_target_user uuid, _is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN RAISE EXCEPTION 'Only admins can change staff active status'; END IF;
  IF _target_user IS NULL THEN RAISE EXCEPTION 'Missing target user'; END IF;
  IF _is_active = false
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _target_user AND role = 'ADMIN')
     AND (SELECT count(*) FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
          WHERE ur.role = 'ADMIN' AND p.is_active = true) <= 1 THEN
    RAISE EXCEPTION 'Cannot deactivate the last active admin';
  END IF;
  UPDATE public.profiles SET is_active = _is_active, updated_at = now() WHERE id = _target_user;
END;
$$;

DROP TRIGGER IF EXISTS audit_lab_results ON public.lab_results;
CREATE TRIGGER audit_lab_results AFTER INSERT OR UPDATE OR DELETE ON public.lab_results FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_pet_vaccinations ON public.pet_vaccinations;
CREATE TRIGGER audit_pet_vaccinations AFTER INSERT OR UPDATE OR DELETE ON public.pet_vaccinations FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_client_files ON public.client_files;
CREATE TRIGGER audit_client_files AFTER INSERT OR UPDATE OR DELETE ON public.client_files FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_client_notes ON public.client_notes;
CREATE TRIGGER audit_client_notes AFTER INSERT OR UPDATE OR DELETE ON public.client_notes FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_consent_submissions ON public.consent_submissions;
CREATE TRIGGER audit_consent_submissions AFTER INSERT OR UPDATE OR DELETE ON public.consent_submissions FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_sms_consent ON public.sms_consent;
CREATE TRIGGER audit_sms_consent AFTER INSERT OR UPDATE OR DELETE ON public.sms_consent FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

CREATE OR REPLACE FUNCTION public.prevent_conversation_client_reassignment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'conversation.client_id is immutable';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_conversation_client_immutable ON public.conversations;
CREATE TRIGGER trg_conversation_client_immutable BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_conversation_client_reassignment();

DROP POLICY IF EXISTS "Auth manage payment_links" ON public.payment_links;
DROP POLICY IF EXISTS "Staff read payment_links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins insert payment_links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins update payment_links" ON public.payment_links;
DROP POLICY IF EXISTS "Admins delete payment_links" ON public.payment_links;
CREATE POLICY "Staff read payment_links"   ON public.payment_links FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins insert payment_links" ON public.payment_links FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins update payment_links" ON public.payment_links FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins delete payment_links" ON public.payment_links FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));
DROP TRIGGER IF EXISTS audit_payment_links ON public.payment_links;
CREATE TRIGGER audit_payment_links AFTER INSERT OR UPDATE OR DELETE ON public.payment_links FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
