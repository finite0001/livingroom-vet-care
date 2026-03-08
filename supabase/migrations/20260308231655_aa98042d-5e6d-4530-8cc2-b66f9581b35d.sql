
-- Step 3: DELETE RLS policies for messages and conversations
CREATE POLICY "Auth delete messages" ON public.messages FOR DELETE TO authenticated USING (true);
CREATE POLICY "Auth delete conversations" ON public.conversations FOR DELETE TO authenticated USING (true);

-- Transactional cascade delete function
CREATE OR REPLACE FUNCTION public.delete_conversation_cascade(conv_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.message_attachments WHERE message_id IN (SELECT id FROM public.messages WHERE conversation_id = conv_id);
  DELETE FROM public.client_files WHERE conversation_id = conv_id;
  DELETE FROM public.messages WHERE conversation_id = conv_id;
  DELETE FROM public.conversations WHERE id = conv_id;
END;
$$;

-- Step 4: DISTINCT ON function for last message per conversation
CREATE OR REPLACE FUNCTION public.get_last_messages(conv_ids uuid[])
RETURNS TABLE(conversation_id uuid, content text, type public.message_type, created_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.content, m.type, m.created_at
  FROM public.messages m
  WHERE m.conversation_id = ANY(conv_ids)
  ORDER BY m.conversation_id, m.created_at DESC;
$$;

-- Step 2: Unique constraint on sms_consent (idempotent - may already exist from prior migration attempt)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_consent_client_phone_unique') THEN
    ALTER TABLE public.sms_consent ADD CONSTRAINT sms_consent_client_phone_unique UNIQUE (client_id, phone_number);
  END IF;
END $$;
