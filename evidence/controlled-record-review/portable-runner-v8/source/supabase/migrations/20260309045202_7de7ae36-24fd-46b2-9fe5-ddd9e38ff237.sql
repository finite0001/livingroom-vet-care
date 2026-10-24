
-- Fix get_current_on_call: add SET search_path
CREATE OR REPLACE FUNCTION public.get_current_on_call()
  RETURNS TABLE(dvm_id uuid, dvm_name text, phone_number text, schedule_id uuid)
  LANGUAGE sql
  STABLE
  SET search_path TO 'public'
AS $function$
  SELECT oc.dvm_id, p.full_name, COALESCE(oc.phone_number, p.phone), oc.id
  FROM public.on_call_schedules oc
  JOIN public.profiles p ON p.id = oc.dvm_id
  WHERE now() BETWEEN oc.start_time AND oc.end_time
  ORDER BY oc.start_time DESC LIMIT 1;
$function$;

-- Fix audit_trigger_fn: add SET search_path
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), TG_OP, TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;
