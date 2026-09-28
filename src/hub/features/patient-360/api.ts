import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import type { Read360, TimelineFilter, TimelinePage } from "./model";
import { filterKinds } from "./model";

const PAGE_SIZE = 20;

function assertRead(data: unknown, scope: "patient" | "household"): Read360 {
  const read = data as Read360 | null;
  if (!read || read.version !== 1 || read.scope !== scope || !read.household || !read.signals) {
    throw new Error("The 360 summary returned an unexpected shape. Reload to try again.");
  }
  return read;
}

function assertPage(data: unknown): TimelinePage {
  const page = data as TimelinePage | null;
  if (!page || page.version !== 1 || !Array.isArray(page.entries)) {
    throw new Error("The timeline returned an unexpected shape. Reload to try again.");
  }
  return page;
}

interface ReadOptions { paused?: boolean }

/** One round trip for the patient header, red flags and next-step facts. */
export function usePatient360(patientId: string, options: ReadOptions = {}) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["patient-360", session?.user.id, patientId],
    enabled: Boolean(session?.user.id && patientId),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: !options.paused,
    refetchOnReconnect: !options.paused,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("read_patient_360", { p_patient_id: patientId }).abortSignal(signal);
      if (error) throw error;
      return assertRead(data, "patient");
    },
  });
}

export function useHousehold360(clientId: string, options: ReadOptions = {}) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["household-360", session?.user.id, clientId],
    enabled: Boolean(session?.user.id && clientId),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: !options.paused,
    refetchOnReconnect: !options.paused,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.rpc("read_household_360", { p_client_id: clientId }).abortSignal(signal);
      if (error) throw error;
      return assertRead(data, "household");
    },
  });
}

/** Keyset-paginated unified timeline, newest first. */
export function useTimeline360(scope: "patient" | "household", id: string, filter: TimelineFilter) {
  const { session } = useAuth();
  const kinds = filterKinds(filter);
  return useInfiniteQuery({
    queryKey: ["timeline-360", session?.user.id, scope, id, filter],
    enabled: Boolean(session?.user.id && id),
    staleTime: 30_000,
    initialPageParam: null as TimelinePage["next_cursor"],
    getNextPageParam: (last: TimelinePage) => (last.has_more ? last.next_cursor : undefined),
    queryFn: async ({ pageParam, signal }) => {
      const common = {
        p_kinds: kinds ?? undefined,
        p_before_at: pageParam?.before_at ?? undefined,
        p_before_key: pageParam?.before_key ?? undefined,
        p_limit: PAGE_SIZE,
      };
      const { data, error } = scope === "patient"
        ? await supabase.rpc("list_patient_timeline", { p_patient_id: id, ...common }).abortSignal(signal)
        : await supabase.rpc("list_household_timeline", { p_client_id: id, ...common }).abortSignal(signal);
      if (error) throw error;
      return assertPage(data);
    },
  });
}
