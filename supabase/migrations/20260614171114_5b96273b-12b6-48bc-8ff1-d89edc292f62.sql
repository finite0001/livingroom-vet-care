CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.time_entries TO authenticated;
GRANT ALL ON public.time_entries TO service_role;

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_per_staff
  ON public.time_entries (staff_id) WHERE clock_out_at IS NULL;

CREATE POLICY "Read own or admin time entries" ON public.time_entries FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Admins update time entries" ON public.time_entries FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN')) WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));

CREATE POLICY "Admins delete time entries" ON public.time_entries FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'ADMIN'));

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_on_duty boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.clock_in()
RETURNS public.time_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _entry public.time_entries;
BEGIN
  IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Only active staff can clock in'; END IF;
  IF EXISTS (SELECT 1 FROM public.time_entries WHERE staff_id = auth.uid() AND clock_out_at IS NULL) THEN
    RAISE EXCEPTION 'Already clocked in';
  END IF;
  INSERT INTO public.time_entries (staff_id, clock_in_at) VALUES (auth.uid(), now()) RETURNING * INTO _entry;
  UPDATE public.profiles SET is_on_duty = true WHERE id = auth.uid();
  RETURN _entry;
END; $$;

REVOKE ALL ON FUNCTION public.clock_in() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clock_in() TO authenticated;

CREATE OR REPLACE FUNCTION public.clock_out()
RETURNS public.time_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _entry public.time_entries;
BEGIN
  IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Only active staff can clock out'; END IF;
  UPDATE public.time_entries SET clock_out_at = now()
    WHERE staff_id = auth.uid() AND clock_out_at IS NULL
    RETURNING * INTO _entry;
  IF _entry.id IS NULL THEN RAISE EXCEPTION 'Not clocked in'; END IF;
  UPDATE public.profiles SET is_on_duty = false WHERE id = auth.uid();
  RETURN _entry;
END; $$;

REVOKE ALL ON FUNCTION public.clock_out() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clock_out() TO authenticated;

DROP TRIGGER IF EXISTS audit_time_entries ON public.time_entries;
CREATE TRIGGER audit_time_entries AFTER INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();