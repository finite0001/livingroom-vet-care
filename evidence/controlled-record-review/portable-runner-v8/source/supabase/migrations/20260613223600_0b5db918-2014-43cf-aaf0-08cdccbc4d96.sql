
-- 1. consent_submissions anon read fix
DROP POLICY IF EXISTS "Anon read submission by token" ON public.consent_submissions;

CREATE OR REPLACE FUNCTION public.get_consent_submission(p_token text)
RETURNS public.consent_submissions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.consent_submissions WHERE access_token = p_token LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_consent_submission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_consent_submission(text) TO anon, authenticated;

-- 2. profiles.updated_at column + trigger
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. handle_new_user — never trust raw_user_meta_data.role
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

  INSERT INTO public.profiles (id, first_name, last_name, full_name, role)
  VALUES (NEW.id, _first, _last, TRIM(_first || ' ' || _last), 'STAFF');

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'STAFF');

  RETURN NEW;
END;
$function$;

-- 4. delete_conversation_cascade — admin only
CREATE OR REPLACE FUNCTION public.delete_conversation_cascade(conv_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'ADMIN') THEN
    RAISE EXCEPTION 'Only admins may delete conversations';
  END IF;
  DELETE FROM public.message_attachments WHERE message_id IN (SELECT id FROM public.messages WHERE conversation_id = conv_id);
  DELETE FROM public.client_files WHERE conversation_id = conv_id;
  DELETE FROM public.messages WHERE conversation_id = conv_id;
  DELETE FROM public.conversations WHERE id = conv_id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_conversation_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_conversation_cascade(uuid) TO authenticated;

-- 5. Storage bucket re-gating
DROP POLICY IF EXISTS "Auth read voicemails" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload voicemails" ON storage.objects;
DROP POLICY IF EXISTS "Auth read message-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload message-attachments" ON storage.objects;
DROP POLICY IF EXISTS "Auth read client-files" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload client-files" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete client-files" ON storage.objects;

CREATE POLICY "Staff read voicemails" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'voicemails' AND public.is_active_staff(auth.uid()));
CREATE POLICY "Staff upload voicemails" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voicemails' AND public.is_active_staff(auth.uid()));
CREATE POLICY "Staff read message-attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'message-attachments' AND public.is_active_staff(auth.uid()));
CREATE POLICY "Staff upload message-attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-attachments' AND public.is_active_staff(auth.uid()));
CREATE POLICY "Staff read client-files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-files' AND public.is_active_staff(auth.uid()));
CREATE POLICY "Staff upload client-files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'client-files' AND public.is_active_staff(auth.uid()));
CREATE POLICY "Staff delete client-files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'client-files' AND public.is_active_staff(auth.uid()));

-- 6. Duplicate trigger cleanup
DROP TRIGGER IF EXISTS trg_create_appointment_reminders ON public.appointments;
DROP TRIGGER IF EXISTS trg_appointment_reminders ON public.appointments;
CREATE TRIGGER trg_create_appointment_reminders
  AFTER INSERT ON public.appointments
  FOR EACH ROW WHEN (NEW.status = 'SCHEDULED')
  EXECUTE FUNCTION public.create_appointment_reminders();

DROP TRIGGER IF EXISTS trg_track_response_metric ON public.messages;
DROP TRIGGER IF EXISTS trg_track_response ON public.messages;
CREATE TRIGGER trg_track_response_metric
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.track_response_metric();

DELETE FROM public.appointment_reminders a USING public.appointment_reminders b
  WHERE a.ctid < b.ctid AND a.appointment_id = b.appointment_id
    AND a.remind_at = b.remind_at AND a.channel = b.channel;

ALTER TABLE public.appointment_reminders
  ADD CONSTRAINT appointment_reminders_unique UNIQUE (appointment_id, remind_at, channel);
