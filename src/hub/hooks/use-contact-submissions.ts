import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ContactSubmissionStatus = "NEW" | "CONTACTED" | "CLOSED";

export const CONTACT_SUBMISSION_STATUSES: ContactSubmissionStatus[] = ["NEW", "CONTACTED", "CLOSED"];

export const contactSubmissionStatusLabel = (status: ContactSubmissionStatus) =>
  ({ NEW: "New", CONTACTED: "Contacted", CLOSED: "Closed" } as Record<ContactSubmissionStatus, string>)[status];

export interface ContactSubmission {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  triage_status: ContactSubmissionStatus;
  staff_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  contacted_at: string | null;
  contacted_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateContactSubmissionTriageInput {
  id: string;
  triage_status?: ContactSubmissionStatus;
  staff_notes?: string | null;
}

export function useContactSubmissions(status: ContactSubmissionStatus | "ALL" = "ALL") {
  return useQuery<ContactSubmission[]>({
    queryKey: ["contact-submissions", status],
    staleTime: 30 * 1000,
    queryFn: async () => {
      let query = supabase
        .from("contact_submissions")
        .select("id, name, email, phone, subject, message, triage_status, staff_notes, reviewed_at, reviewed_by, contacted_at, contacted_by, closed_at, closed_by, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (status !== "ALL") {
        query = query.eq("triage_status", status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ContactSubmission[];
    },
  });
}

export function useContactSubmissionCount(status: ContactSubmissionStatus | "ALL" = "ALL") {
  return useQuery<number>({
    queryKey: ["contact-submission-count", status],
    staleTime: 45 * 1000,
    queryFn: async () => {
      let query = supabase
        .from("contact_submissions")
        .select("id", { count: "exact", head: true });

      if (status !== "ALL") {
        query = query.eq("triage_status", status);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useUpdateContactSubmissionTriage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, triage_status, staff_notes }: UpdateContactSubmissionTriageInput) => {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user.id) throw new Error("Sign in again to update contact submissions.");

      const now = new Date().toISOString();
      const updates: {
        triage_status?: ContactSubmissionStatus;
        staff_notes?: string | null;
        reviewed_at: string;
        reviewed_by: string;
        contacted_at?: string;
        contacted_by?: string;
        closed_at?: string | null;
        closed_by?: string | null;
      } = {
        reviewed_at: now,
        reviewed_by: session.user.id,
      };

      if (staff_notes !== undefined) updates.staff_notes = staff_notes;
      if (triage_status !== undefined) {
        updates.triage_status = triage_status;
        if (triage_status === "CONTACTED") {
          updates.contacted_at = now;
          updates.contacted_by = session.user.id;
          updates.closed_at = null;
          updates.closed_by = null;
        }
        if (triage_status === "CLOSED") {
          updates.closed_at = now;
          updates.closed_by = session.user.id;
        }
        if (triage_status === "NEW") {
          updates.closed_at = null;
          updates.closed_by = null;
        }
      }

      const { error } = await supabase.from("contact_submissions").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contact-submissions"] });
      void queryClient.invalidateQueries({ queryKey: ["contact-submission-count"] });
    },
  });
}
