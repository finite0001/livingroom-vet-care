
-- Create table for website contact form submissions
CREATE TABLE public.contact_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Staff can read submissions
CREATE POLICY "Auth read contact_submissions"
  ON public.contact_submissions
  FOR SELECT
  TO authenticated
  USING (true);

-- Anyone (including anon) can insert submissions (public contact form)
CREATE POLICY "Anon insert contact_submissions"
  ON public.contact_submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
