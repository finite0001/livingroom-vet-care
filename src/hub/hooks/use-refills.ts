import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { createNativeRefillApi } from "@/hub/features/refills/refill-api";
import type { NativeRefillCursor } from "@/hub/features/refills/refill-api";
import type { PrescriptionRpc } from "@/hub/features/prescriptions/prescription-api";
export function useRefillApi(actor: string) { return useMemo(() => createNativeRefillApi(supabase as unknown as PrescriptionRpc, actor), [actor]); }
export function useRefills(actor: string, enabled = true) {
  const api = useRefillApi(actor);
  return useInfiniteQuery({ queryKey: ["native-refills", actor], enabled, initialPageParam: null as NativeRefillCursor | null, queryFn: ({ pageParam }) => api.list(pageParam), getNextPageParam: page => page.next_cursor ?? undefined, refetchOnWindowFocus: false, refetchOnReconnect: false });
}
function pattern(search: string) { return `%${search.trim().replace(/[%_\\]/g, "\\$&")}%`; }
export function useRefillClientSearch(actor: string, search: string, enabled: boolean) {
  return useQuery({ queryKey: ["refill-client-search", actor, search.trim()], enabled, refetchOnWindowFocus: false, queryFn: async () => { const { data, error } = await supabase.rpc("search_clients", { p_search: search.trim(), p_limit: 21 }); if (error) throw error; return { rows: data.slice(0, 20), hasMore: data.length > 20 }; } });
}
export function useRefillPatientSearch(actor: string, clientId: string, search: string, enabled: boolean) {
  return useQuery({ queryKey: ["refill-patient-search", actor, clientId, search.trim()], enabled: enabled && !!clientId, refetchOnWindowFocus: false, queryFn: async () => { let query = supabase.from("pets").select("id,client_id,name,species").eq("client_id", clientId).is("archived_at", null).is("deceased_at", null).order("name").order("id").limit(21); if (search.trim()) query = query.ilike("name", pattern(search)); const { data, error } = await query; if (error) throw error; return { rows: data.slice(0, 20), hasMore: data.length > 20 }; } });
}
export function useRefillAssigneeSearch(actor: string, search: string, enabled: boolean) {
  return useQuery({ queryKey: ["refill-assignee-search", actor, search.trim()], enabled, refetchOnWindowFocus: false, queryFn: async () => { let query = supabase.from("profiles").select("id,full_name").eq("is_active", true).order("full_name").order("id").limit(21); if (search.trim()) query = query.ilike("full_name", pattern(search)); const { data, error } = await query; if (error) throw error; return { rows: data.slice(0, 20), hasMore: data.length > 20 }; } });
}
export function useRefillIdentity(actor: string, patientId: string, clientId: string) {
  return useQuery({ queryKey: ["refill-identity", actor, patientId, clientId], enabled: !!patientId && !!clientId, refetchOnWindowFocus: false, queryFn: async () => { const [pet, client] = await Promise.all([supabase.from("pets").select("id,name").eq("id", patientId).maybeSingle(), supabase.from("clients").select("id,full_name").eq("id", clientId).maybeSingle()]); if (pet.error) throw pet.error; if (client.error) throw client.error; return { patient: pet.data?.name ?? null, client: client.data?.full_name ?? null }; } });
}

export function useLegacyRefills(actor: string, enabled = true) { const api = useRefillApi(actor); return useInfiniteQuery({ queryKey: ["legacy-refills", actor], enabled, initialPageParam: null as NativeRefillCursor | null, queryFn: ({ pageParam }) => api.legacy(pageParam), getNextPageParam: page => page.next_cursor ?? undefined, refetchOnWindowFocus: false, refetchOnReconnect: false }); }
