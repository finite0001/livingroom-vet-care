
-- ============================================================
-- VET CONNECT HUB: Consolidated Schema for The Living Room Vet
-- ============================================================

-- ENUMS
CREATE TYPE public.channel_type AS ENUM ('SMS', 'EMAIL', 'VOICE', 'VOICEMAIL');
CREATE TYPE public.conversation_status AS ENUM ('ACTIVE', 'PENDING', 'ARCHIVED');
CREATE TYPE public.message_type AS ENUM ('SMS', 'EMAIL', 'CALL_INBOUND', 'CALL_OUTBOUND', 'VOICEMAIL', 'SYSTEM', 'NOTE');
CREATE TYPE public.sender_type AS ENUM ('CLIENT', 'STAFF', 'SYSTEM');
CREATE TYPE public.user_role AS ENUM ('ADMIN', 'DVM', 'TECH', 'STAFF');
CREATE TYPE public.ticket_form_type AS ENUM ('WELLNESS', 'ILLNESS', 'EUTHANASIA', 'HEALTH_CERTIFICATE');
CREATE TYPE public.ticket_status AS ENUM ('OPEN', 'DVM_REVIEW', 'READY_FOR_SCHEDULING', 'CLOSED');
CREATE TYPE public.pet_sex AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');
CREATE TYPE public.call_type AS ENUM ('inbound', 'outbound', 'browser');
CREATE TYPE public.conversation_priority AS ENUM ('URGENT', 'NORMAL', 'LOW');
CREATE TYPE public.file_category AS ENUM ('RECORD', 'LAB_RESULT', 'VACCINATION', 'XRAY', 'PRESCRIPTION', 'OTHER');
CREATE TYPE public.consent_method AS ENUM ('SMS_KEYWORD', 'WEB_FORM', 'VERBAL', 'WRITTEN', 'IMPORT');
CREATE TYPE public.appointment_status AS ENUM ('SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
CREATE TYPE public.reminder_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TYPE public.follow_up_status AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'FAILED');
CREATE TYPE public.survey_type AS ENUM ('NPS', 'STAR_RATING', 'THUMBS');
CREATE TYPE public.survey_status AS ENUM ('PENDING', 'SENT', 'COMPLETED', 'EXPIRED');
CREATE TYPE public.refill_status AS ENUM ('REQUESTED', 'APPROVED', 'DENIED', 'READY', 'PICKED_UP');
CREATE TYPE public.callback_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE public.waitlist_status AS ENUM ('WAITING', 'NOTIFIED', 'ACCEPTED', 'DECLINED', 'EXPIRED');
CREATE TYPE public.campaign_status AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED');
CREATE TYPE public.wellness_reminder_type AS ENUM ('VACCINE_DUE', 'ANNUAL_CHECKUP', 'DENTAL');
CREATE TYPE public.wellness_reminder_status AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'CANCELLED');

-- ============================================================
-- UTILITY FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  role public.user_role DEFAULT 'STAFF' NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  phone TEXT,
  email_signature TEXT
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "System can insert profiles" ON public.profiles FOR INSERT WITH CHECK (true);

-- ============================================================
-- USER ROLES (separate table per security best practices)
-- ============================================================
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.user_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all roles" ON public.user_roles FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins can insert roles" ON public.user_roles FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins can update roles" ON public.user_roles FOR UPDATE USING (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "Admins can delete roles" ON public.user_roles FOR DELETE USING (public.has_role(auth.uid(), 'ADMIN'));

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _first text;
  _last text;
  _role public.user_role;
BEGIN
  _first := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
  _last := COALESCE(NEW.raw_user_meta_data->>'last_name', '');
  _role := COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'STAFF');

  INSERT INTO public.profiles (id, first_name, last_name, full_name, role)
  VALUES (NEW.id, _first, _last, TRIM(_first || ' ' || _last), _role);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _role);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ezyvet_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  primary_phone TEXT,
  primary_email TEXT,
  preferred_channel public.channel_type DEFAULT 'SMS'
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients viewable by authenticated" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update clients" ON public.clients FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- PETS
-- ============================================================
CREATE TABLE public.pets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  breed TEXT,
  weight_lbs NUMERIC,
  dob DATE,
  allergies TEXT,
  medications TEXT,
  vaccination_notes TEXT,
  last_visit_at TIMESTAMPTZ,
  microchip_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.pets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pets viewable by authenticated" ON public.pets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert pets" ON public.pets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update pets" ON public.pets FOR UPDATE TO authenticated USING (true);
CREATE INDEX idx_pets_client_id ON public.pets(client_id);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  assigned_to_id UUID REFERENCES public.profiles(id),
  status public.conversation_status DEFAULT 'ACTIVE' NOT NULL,
  priority public.conversation_priority NOT NULL DEFAULT 'NORMAL',
  tags TEXT[] NOT NULL DEFAULT '{}',
  first_message_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Conversations viewable by authenticated" ON public.conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert conversations" ON public.conversations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update conversations" ON public.conversations FOR UPDATE TO authenticated USING (true);
CREATE INDEX idx_conversations_client_id ON public.conversations(client_id);
CREATE INDEX idx_conversations_assigned_to ON public.conversations(assigned_to_id);
CREATE INDEX idx_conversations_status ON public.conversations(status);
CREATE INDEX idx_conversations_last_message ON public.conversations(last_message_at DESC);
CREATE INDEX idx_conversations_priority ON public.conversations(priority);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  type public.message_type NOT NULL,
  sender_type public.sender_type NOT NULL,
  sender_id UUID REFERENCES public.profiles(id),
  content TEXT,
  audio_url TEXT,
  transcription TEXT,
  is_internal BOOLEAN DEFAULT FALSE NOT NULL,
  ivr_path TEXT,
  triage_priority TEXT,
  triage_confidence REAL,
  triage_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Messages viewable by authenticated" ON public.messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert messages" ON public.messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- ============================================================
-- MESSAGE ATTACHMENTS
-- ============================================================
CREATE TABLE public.message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth view attachments" ON public.message_attachments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert attachments" ON public.message_attachments FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX idx_message_attachments_message_id ON public.message_attachments(message_id);

-- ============================================================
-- TICKETS
-- ============================================================
CREATE TABLE public.tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  form_type public.ticket_form_type NOT NULL,
  status public.ticket_status NOT NULL DEFAULT 'OPEN',
  client_name TEXT NOT NULL,
  client_contact TEXT NOT NULL,
  pet_name TEXT NOT NULL,
  species_breed TEXT,
  dob_age TEXT,
  sex public.pet_sex DEFAULT 'UNKNOWN',
  rdvm TEXT,
  rdvm_records_requested BOOLEAN NOT NULL DEFAULT false,
  vaccine_status_reviewed BOOLEAN NOT NULL DEFAULT false,
  new_client BOOLEAN NOT NULL DEFAULT false,
  form_contract_sent BOOLEAN NOT NULL DEFAULT false,
  estimate_sent BOOLEAN NOT NULL DEFAULT false,
  dvm_review_needed BOOLEAN NOT NULL DEFAULT true,
  symptom_summary TEXT,
  consent_form_sent BOOLEAN NOT NULL DEFAULT false,
  confirm_with_jane BOOLEAN NOT NULL DEFAULT false,
  destination_country TEXT,
  travel_date DATE,
  health_cert_form_sent BOOLEAN NOT NULL DEFAULT false,
  assigned_to_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT
);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read tickets" ON public.tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update tickets" ON public.tickets FOR UPDATE TO authenticated USING (true);

CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- CALL LOGS
-- ============================================================
CREATE TABLE public.call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_sid TEXT NOT NULL,
  call_type public.call_type NOT NULL DEFAULT 'outbound',
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated',
  duration_seconds INTEGER,
  initiated_by UUID REFERENCES public.profiles(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read call_logs" ON public.call_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert call_logs" ON public.call_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update call_logs" ON public.call_logs FOR UPDATE TO authenticated USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_logs;

-- ============================================================
-- VOICEMAIL MESSAGES
-- ============================================================
CREATE TABLE public.voicemail_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  call_sid TEXT NOT NULL,
  from_number TEXT NOT NULL,
  to_number TEXT,
  recording_url TEXT,
  recording_path TEXT,
  recording_duration INTEGER,
  transcription TEXT,
  transcription_status TEXT DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'new',
  is_read BOOLEAN NOT NULL DEFAULT false,
  ai_summary TEXT,
  summary_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voicemail_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read voicemails" ON public.voicemail_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert voicemails" ON public.voicemail_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth update voicemails" ON public.voicemail_messages FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- APP SETTINGS
-- ============================================================
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read settings" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth update settings" ON public.app_settings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth insert settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.app_settings (key, value) VALUES
  ('after_hours_enabled', 'false'),
  ('triage_enabled', 'true'),
  ('triage_urgent_keywords', 'emergency,poisoning,bleeding,seizure,choking,hit by car,not breathing,unconscious,collapse,toxin,rat poison,antifreeze,chocolate,xylitol'),
  ('retention_archive_days', '365'),
  ('retention_purge_days', '730'),
  ('retention_enabled', 'false'),
  ('wellness_reminders_enabled', 'true'),
  ('wellness_reminder_days_before', '30');

-- ============================================================
-- RESPONSE METRICS
-- ============================================================
CREATE TABLE public.response_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id),
  message_id uuid REFERENCES public.messages(id),
  staff_id uuid NOT NULL,
  client_message_at timestamptz NOT NULL,
  staff_reply_at timestamptz NOT NULL,
  response_time_seconds integer GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (staff_reply_at - client_message_at))::integer
  ) STORED,
  channel public.message_type NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.response_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read response_metrics" ON public.response_metrics FOR SELECT USING (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "System insert response_metrics" ON public.response_metrics FOR INSERT WITH CHECK (true);

-- ============================================================
-- MESSAGE TEMPLATES
-- ============================================================
CREATE TABLE public.message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  channel TEXT NOT NULL DEFAULT 'SMS',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage templates" ON public.message_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- CLIENT FILES
-- ============================================================
CREATE TABLE public.client_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer NOT NULL DEFAULT 0,
  mime_type text,
  category public.file_category NOT NULL DEFAULT 'OTHER',
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage client_files" ON public.client_files FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_client_files_client_id ON public.client_files(client_id);
CREATE INDEX idx_client_files_message_id ON public.client_files(message_id);

-- ============================================================
-- CLIENT NOTES
-- ============================================================
CREATE TABLE public.client_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage client_notes" ON public.client_notes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_client_notes_updated_at BEFORE UPDATE ON public.client_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- URGENT ALERTS
-- ============================================================
CREATE TABLE public.urgent_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  campaign_id TEXT,
  sent_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.urgent_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read urgent_alerts" ON public.urgent_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert urgent_alerts" ON public.urgent_alerts FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pet_id UUID REFERENCES public.pets(id) ON DELETE SET NULL,
  ezyvet_appointment_id TEXT UNIQUE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  appointment_type TEXT NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'SCHEDULED',
  assigned_dvm_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage appointments" ON public.appointments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_appointments_client_id ON public.appointments(client_id);
CREATE INDEX idx_appointments_scheduled_at ON public.appointments(scheduled_at);
CREATE INDEX idx_appointments_status ON public.appointments(status);
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- APPOINTMENT REMINDERS
-- ============================================================
CREATE TABLE public.appointment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  channel TEXT NOT NULL DEFAULT 'SMS',
  status public.reminder_status NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage reminders" ON public.appointment_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_reminders_remind_at ON public.appointment_reminders(remind_at);

-- Auto-create reminders on appointment insert
CREATE OR REPLACE FUNCTION public.create_appointment_reminders()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.appointment_reminders (appointment_id, remind_at, channel)
  VALUES (NEW.id, NEW.scheduled_at - INTERVAL '48 hours', 'SMS');
  INSERT INTO public.appointment_reminders (appointment_id, remind_at, channel)
  VALUES (NEW.id, NEW.scheduled_at - INTERVAL '24 hours', 'SMS');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_create_appointment_reminders
  AFTER INSERT ON public.appointments
  FOR EACH ROW WHEN (NEW.status = 'SCHEDULED')
  EXECUTE FUNCTION public.create_appointment_reminders();

-- ============================================================
-- CAMPAIGNS
-- ============================================================
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  message_template_id UUID REFERENCES public.message_templates(id) ON DELETE SET NULL,
  message_content TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'SMS',
  audience_filter JSONB NOT NULL DEFAULT '{}',
  status public.campaign_status NOT NULL DEFAULT 'DRAFT',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  total_recipients INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ,
  error_message TEXT
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage campaigns" ON public.campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage campaign_recipients" ON public.campaign_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- REFILL REQUESTS
-- ============================================================
CREATE TABLE public.refill_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pet_id UUID REFERENCES public.pets(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  medication_name TEXT,
  original_message TEXT,
  status public.refill_status NOT NULL DEFAULT 'REQUESTED',
  assigned_to_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.refill_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage refill_requests" ON public.refill_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_refill_requests_updated_at BEFORE UPDATE ON public.refill_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- SURVEYS
-- ============================================================
CREATE TABLE public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  survey_type public.survey_type NOT NULL DEFAULT 'NPS',
  question TEXT NOT NULL DEFAULT 'How likely are you to recommend us? Reply 0-10.',
  is_active BOOLEAN NOT NULL DEFAULT true,
  trigger_on_ticket_close BOOLEAN NOT NULL DEFAULT true,
  delay_hours INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  score INT,
  comment TEXT,
  status public.survey_status NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage surveys" ON public.surveys FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage survey_responses" ON public.survey_responses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- FOLLOW-UP SEQUENCES
-- ============================================================
CREATE TABLE public.follow_up_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  trigger_ticket_types TEXT[] NOT NULL DEFAULT '{}',
  steps JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.follow_up_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.follow_up_templates(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pet_id UUID REFERENCES public.pets(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  current_step INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.follow_up_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES public.follow_up_instances(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status public.follow_up_status NOT NULL DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.follow_up_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage follow_up_templates" ON public.follow_up_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage follow_up_instances" ON public.follow_up_instances FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage follow_up_messages" ON public.follow_up_messages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_follow_up_templates_updated_at BEFORE UPDATE ON public.follow_up_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- SMS CONSENT
-- ============================================================
CREATE TABLE public.sms_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  opted_in BOOLEAN NOT NULL DEFAULT false,
  opted_in_at TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ,
  consent_method public.consent_method,
  consent_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, phone_number)
);

ALTER TABLE public.sms_consent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage sms_consent" ON public.sms_consent FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_sms_consent_updated_at BEFORE UPDATE ON public.sms_consent FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- ON-CALL SCHEDULES
-- ============================================================
CREATE TABLE public.on_call_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dvm_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  phone_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT on_call_end_after_start CHECK (end_time > start_time)
);

ALTER TABLE public.on_call_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage on_call_schedules" ON public.on_call_schedules FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_current_on_call()
RETURNS TABLE (dvm_id UUID, dvm_name TEXT, phone_number TEXT, schedule_id UUID)
LANGUAGE sql STABLE AS $$
  SELECT oc.dvm_id, p.full_name, COALESCE(oc.phone_number, p.phone), oc.id
  FROM public.on_call_schedules oc
  JOIN public.profiles p ON p.id = oc.dvm_id
  WHERE now() BETWEEN oc.start_time AND oc.end_time
  ORDER BY oc.start_time DESC LIMIT 1;
$$;

-- ============================================================
-- CALLBACK QUEUE
-- ============================================================
CREATE TABLE public.callback_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  call_sid TEXT,
  reason TEXT,
  status public.callback_status NOT NULL DEFAULT 'PENDING',
  priority INT NOT NULL DEFAULT 0,
  assigned_to_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.callback_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage callback_queue" ON public.callback_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- WAITLIST
-- ============================================================
CREATE TABLE public.waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_type TEXT NOT NULL,
  preferred_date DATE NOT NULL,
  preferred_date_end DATE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pet_id UUID REFERENCES public.pets(id) ON DELETE SET NULL,
  position INT NOT NULL DEFAULT 0,
  status public.waitlist_status NOT NULL DEFAULT 'WAITING',
  notified_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage waitlist_entries" ON public.waitlist_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- PET VACCINATIONS
-- ============================================================
CREATE TABLE public.pet_vaccinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  vaccine_name TEXT NOT NULL,
  administered_at DATE NOT NULL,
  next_due_at DATE,
  administered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  lot_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pet_vaccinations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage pet_vaccinations" ON public.pet_vaccinations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_pet_vaccinations_updated_at BEFORE UPDATE ON public.pet_vaccinations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- WELLNESS REMINDERS
-- ============================================================
CREATE TABLE public.wellness_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id UUID NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vaccination_id UUID REFERENCES public.pet_vaccinations(id) ON DELETE SET NULL,
  reminder_type public.wellness_reminder_type NOT NULL,
  label TEXT NOT NULL,
  next_due_at DATE NOT NULL,
  last_sent_at TIMESTAMPTZ,
  status public.wellness_reminder_status NOT NULL DEFAULT 'PENDING',
  channel TEXT NOT NULL DEFAULT 'SMS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wellness_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage wellness_reminders" ON public.wellness_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- CONSENT FORMS
-- ============================================================
CREATE TABLE public.consent_form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  form_schema JSONB NOT NULL DEFAULT '[]',
  content_html TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.consent_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.consent_form_templates(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pet_id UUID REFERENCES public.pets(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  form_data JSONB NOT NULL DEFAULT '{}',
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  access_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  ip_address TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.consent_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage consent_form_templates" ON public.consent_form_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage consent_submissions" ON public.consent_submissions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon read submission by token" ON public.consent_submissions FOR SELECT TO anon USING (access_token IS NOT NULL);
CREATE TRIGGER update_consent_form_templates_updated_at BEFORE UPDATE ON public.consent_form_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- LAB RESULTS
-- ============================================================
CREATE TABLE public.lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  pet_id UUID REFERENCES public.pets(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  lab_provider TEXT NOT NULL,
  external_order_id TEXT,
  result_type TEXT NOT NULL,
  result_data JSONB NOT NULL DEFAULT '{}',
  pdf_storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage lab_results" ON public.lab_results FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- PAYMENT LINKS
-- ============================================================
CREATE TABLE public.payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  amount_cents INT NOT NULL,
  description TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  external_payment_id TEXT,
  payment_url TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days')
);

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth manage payment_links" ON public.payment_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  table_name text NOT NULL,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'ADMIN'));
CREATE POLICY "System insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);
CREATE INDEX idx_audit_logs_table_name ON public.audit_logs(table_name);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Audit trigger function
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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
$$;

CREATE TRIGGER audit_clients AFTER INSERT OR UPDATE OR DELETE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_conversations AFTER INSERT OR UPDATE OR DELETE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_messages AFTER INSERT OR UPDATE OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();

-- ============================================================
-- RESPONSE METRIC TRACKING TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.track_response_metric()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
$$;

CREATE TRIGGER trg_track_response_metric
  AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.track_response_metric();

-- ============================================================
-- RETENTION POLICY FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_retention_policies()
RETURNS void AS $$
DECLARE v_archive_days INT; v_purge_days INT; v_enabled TEXT;
BEGIN
  SELECT value INTO v_enabled FROM public.app_settings WHERE key = 'retention_enabled';
  IF v_enabled != 'true' THEN RETURN; END IF;
  SELECT value::INT INTO v_archive_days FROM public.app_settings WHERE key = 'retention_archive_days';
  SELECT value::INT INTO v_purge_days FROM public.app_settings WHERE key = 'retention_purge_days';
  UPDATE public.conversations SET status = 'ARCHIVED', archived_at = now()
  WHERE status = 'ACTIVE' AND last_message_at < now() - (v_archive_days || ' days')::INTERVAL;
  DELETE FROM public.conversations WHERE status = 'ARCHIVED' AND archived_at < now() - (v_purge_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- WELLNESS REMINDER AUTO-CREATE TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_vaccine_wellness_reminder()
RETURNS TRIGGER AS $$
DECLARE v_client_id UUID; v_days_before INT;
BEGIN
  IF NEW.next_due_at IS NULL THEN RETURN NEW; END IF;
  SELECT client_id INTO v_client_id FROM public.pets WHERE id = NEW.pet_id;
  SELECT value::INT INTO v_days_before FROM public.app_settings WHERE key = 'wellness_reminder_days_before';
  IF v_days_before IS NULL THEN v_days_before := 30; END IF;
  INSERT INTO public.wellness_reminders (pet_id, client_id, vaccination_id, reminder_type, label, next_due_at)
  VALUES (NEW.pet_id, v_client_id, NEW.id, 'VACCINE_DUE', NEW.vaccine_name || ' due', NEW.next_due_at - (v_days_before || ' days')::INTERVAL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_create_vaccine_wellness_reminder
  AFTER INSERT ON public.pet_vaccinations FOR EACH ROW EXECUTE FUNCTION public.create_vaccine_wellness_reminder();

-- ============================================================
-- DUE REMINDERS RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS TABLE (reminder_id UUID, appointment_id UUID, client_phone TEXT, client_email TEXT, client_name TEXT, pet_name TEXT, scheduled_at TIMESTAMPTZ, appointment_type TEXT, channel TEXT)
AS $$
BEGIN
  RETURN QUERY
  SELECT ar.id, a.id, c.primary_phone, c.primary_email, c.full_name, p.name, a.scheduled_at, a.appointment_type, ar.channel
  FROM public.appointment_reminders ar
  JOIN public.appointments a ON a.id = ar.appointment_id
  JOIN public.clients c ON c.id = a.client_id
  LEFT JOIN public.pets p ON p.id = a.pet_id
  WHERE ar.status = 'PENDING' AND ar.remind_at <= now() AND a.status IN ('SCHEDULED', 'CONFIRMED');
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('voicemails', 'voicemails', false);
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('message-attachments', 'message-attachments', false, 10485760);
INSERT INTO storage.buckets (id, name, public) VALUES ('client-files', 'client-files', false);

-- Storage policies (authenticated only)
CREATE POLICY "Auth read voicemails" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'voicemails');
CREATE POLICY "Auth upload voicemails" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'voicemails');
CREATE POLICY "Auth read message-attachments" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'message-attachments');
CREATE POLICY "Auth upload message-attachments" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'message-attachments');
CREATE POLICY "Auth read client-files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'client-files');
CREATE POLICY "Auth upload client-files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-files');
CREATE POLICY "Auth delete client-files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'client-files');
