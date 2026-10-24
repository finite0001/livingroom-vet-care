
-- ============================================================
-- 1. outbound_message_attempts audit table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.outbound_message_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  delivered BOOLEAN NOT NULL DEFAULT false,
  provider TEXT,
  status_note TEXT,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oma_conversation ON public.outbound_message_attempts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_oma_created ON public.outbound_message_attempts(created_at DESC);

GRANT SELECT, DELETE ON public.outbound_message_attempts TO authenticated;
GRANT ALL ON public.outbound_message_attempts TO service_role;

ALTER TABLE public.outbound_message_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active staff read outbound_message_attempts"
  ON public.outbound_message_attempts FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()));

CREATE POLICY "Admins delete outbound_message_attempts"
  ON public.outbound_message_attempts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));
-- No INSERT/UPDATE policy: only service_role (edge functions) can write.

-- ============================================================
-- 2. Helper: drop & recreate standard staff-gated policies
-- ============================================================
DO $$
DECLARE
  t TEXT;
  op_tables TEXT[] := ARRAY[
    'campaigns','campaign_recipients','tickets','appointments','appointment_reminders',
    'consent_form_templates','call_logs','callback_queue','voicemail_messages',
    'client_files','wellness_reminders','waitlist_entries','pet_vaccinations','refill_requests',
    'surveys','survey_responses','urgent_alerts','on_call_schedules','payment_links',
    'message_templates','sms_consent','lab_results',
    'follow_up_templates','follow_up_instances','follow_up_messages','message_attachments'
  ];
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY op_tables LOOP
    -- Drop every existing policy on this table
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
    -- Recreate standard active-staff policies
    EXECUTE format('CREATE POLICY "Active staff read %I" ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY "Active staff insert %I" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_staff(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY "Active staff update %I" ON public.%I FOR UPDATE TO authenticated USING (public.is_active_staff(auth.uid())) WITH CHECK (public.is_active_staff(auth.uid()))', t, t);
    EXECUTE format('CREATE POLICY "Admins delete %I" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''ADMIN''))', t, t);
  END LOOP;
END $$;

-- ============================================================
-- 3. consent_submissions — keep anon token read, harden the rest
-- ============================================================
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='consent_submissions' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.consent_submissions', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Anon read submission by token"
  ON public.consent_submissions FOR SELECT TO anon
  USING (access_token IS NOT NULL);
CREATE POLICY "Active staff read consent_submissions"
  ON public.consent_submissions FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff insert consent_submissions"
  ON public.consent_submissions FOR INSERT TO authenticated
  WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Active staff update consent_submissions"
  ON public.consent_submissions FOR UPDATE TO authenticated
  USING (public.is_active_staff(auth.uid()))
  WITH CHECK (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins delete consent_submissions"
  ON public.consent_submissions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));

-- ============================================================
-- 4. app_settings — read by any active staff, write admin only
-- ============================================================
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.app_settings', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Active staff read app_settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (public.is_active_staff(auth.uid()));
CREATE POLICY "Admins insert app_settings"
  ON public.app_settings FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins update app_settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'))
  WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins delete app_settings"
  ON public.app_settings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));

-- ============================================================
-- 5. audit_logs — admin read only; only system (triggers) insert
-- ============================================================
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_logs', pol.policyname);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

CREATE POLICY "Admins read audit_logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));
-- No INSERT policy: SECURITY DEFINER trigger (audit_trigger_fn) writes as definer/service.
