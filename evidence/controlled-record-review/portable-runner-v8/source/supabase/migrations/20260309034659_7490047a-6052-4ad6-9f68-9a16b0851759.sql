
-- Attach trigger: track response metrics on new messages
CREATE TRIGGER trg_track_response
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.track_response_metric();

-- Attach trigger: create appointment reminders on new appointments
CREATE TRIGGER trg_appointment_reminders
  AFTER INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_appointment_reminders();

-- Attach trigger: updated_at on appointments
CREATE TRIGGER trg_updated_at_appointments
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Attach trigger: updated_at on tickets
CREATE TRIGGER trg_updated_at_tickets
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Attach trigger: vaccine wellness reminder
CREATE TRIGGER trg_vaccine_reminder
  AFTER INSERT ON public.pet_vaccinations
  FOR EACH ROW
  EXECUTE FUNCTION public.create_vaccine_wellness_reminder();

-- Fix track_response_metric to compute response_time_seconds
CREATE OR REPLACE FUNCTION public.track_response_metric()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE _client_msg RECORD;
BEGIN
  IF NEW.sender_type = 'STAFF' AND NEW.is_internal = false THEN
    SELECT id, created_at, type INTO _client_msg
    FROM public.messages
    WHERE conversation_id = NEW.conversation_id AND sender_type = 'CLIENT' AND created_at < NEW.created_at
    ORDER BY created_at DESC LIMIT 1;

    IF _client_msg.id IS NOT NULL THEN
      INSERT INTO public.response_metrics (conversation_id, message_id, staff_id, client_message_at, staff_reply_at, response_time_seconds, channel)
      VALUES (
        NEW.conversation_id, NEW.id, NEW.sender_id, _client_msg.created_at, NEW.created_at,
        EXTRACT(EPOCH FROM (NEW.created_at - _client_msg.created_at))::INT,
        NEW.type
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
