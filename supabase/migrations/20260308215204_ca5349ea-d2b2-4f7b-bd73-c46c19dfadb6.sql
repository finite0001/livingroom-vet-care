
-- Triggers may already exist, use CREATE OR REPLACE via drop+create
DROP TRIGGER IF EXISTS trg_track_response_metric ON public.messages;
CREATE TRIGGER trg_track_response_metric
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.track_response_metric();

DROP TRIGGER IF EXISTS trg_create_appointment_reminders ON public.appointments;
CREATE TRIGGER trg_create_appointment_reminders
  AFTER INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.create_appointment_reminders();
