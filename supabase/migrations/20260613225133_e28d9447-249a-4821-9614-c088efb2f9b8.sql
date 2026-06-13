
-- R2-1: Lock apply_retention_policies to service_role only
REVOKE ALL ON FUNCTION public.apply_retention_policies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_retention_policies() FROM anon;
REVOKE ALL ON FUNCTION public.apply_retention_policies() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_retention_policies() TO service_role;

-- R2-3: Remove arbitrary insert path into response_metrics
DROP POLICY IF EXISTS "System insert response_metrics" ON public.response_metrics;
REVOKE INSERT ON public.response_metrics FROM anon, authenticated;

-- R2-4: Enforce expiry on consent token lookup
CREATE OR REPLACE FUNCTION public.get_consent_submission(p_token text)
RETURNS public.consent_submissions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.consent_submissions
  WHERE access_token = p_token AND expires_at > now()
  LIMIT 1;
$$;

-- R2-5: Restrict process_due_reminders to authenticated/service_role
REVOKE ALL ON FUNCTION public.process_due_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_due_reminders() FROM anon;
GRANT EXECUTE ON FUNCTION public.process_due_reminders() TO authenticated, service_role;

-- R2-6: Re-gate contact_submissions reads to active staff
DROP POLICY IF EXISTS "Auth read contact_submissions" ON public.contact_submissions;
CREATE POLICY "Staff read contact_submissions" ON public.contact_submissions
  FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
