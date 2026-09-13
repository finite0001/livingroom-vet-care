import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  parseHistoryRequest,
  equalHistoryPayload,
  historyCursor,
  importedHistory,
  problemRow,
  problemExtraction,
  historyId,
} from "./history-state";
import type {
  HistoryRequestKind,
  HistoryPayload,
  HistoryCursor,
} from "./history-state";
interface Database {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
    Functions: {
      [key: string]: { Args: Record<string, unknown>; Returns: unknown };
    };
  };
}
const client = supabase as unknown as SupabaseClient<Database>;
export async function historyRpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      "Clinical review was not confirmed. Recover the original request; changed source or patient data may require a new review.",
    );
  return data;
}
export async function recoverHistoryRequest(
  id: string,
  actor: string,
  petId: string,
  kind: HistoryRequestKind,
) {
  return parseHistoryRequest(
    await historyRpc("recover_ezyvet_history_request", {
      p_id: id,
      p_pet_id: petId,
      p_kind: kind,
    }),
    actor,
    petId,
    kind,
    id,
  );
}
export async function prepareHistoryRequest(
  id: string,
  actor: string,
  petId: string,
  kind: HistoryRequestKind,
  payload: HistoryPayload,
) {
  await historyRpc(
    kind === "history_approval"
      ? "prepare_ezyvet_history_approval"
      : kind === "problem_extraction"
        ? "prepare_ezyvet_problem_extraction"
        : "prepare_ezyvet_history_discrepancy",
    { p_id: id, p_pet_id: petId, p_payload: payload },
  );
  const r = await recoverHistoryRequest(id, actor, petId, kind);
  if (!r || !equalHistoryPayload(r.request.payload, payload))
    throw new Error(
      "Prepared review differs or is not visible yet. Recover the original request.",
    );
  return r;
}
export async function approveHistoryRequest(
  id: string,
  actor: string,
  petId: string,
  kind: HistoryRequestKind,
  hash: string,
) {
  await historyRpc(
    kind === "history_approval"
      ? "approve_ezyvet_history"
      : kind === "problem_extraction"
        ? "approve_ezyvet_problem_extraction"
        : "approve_ezyvet_history_discrepancy",
    { p_id: id, p_pet_id: petId, p_expected_hash: hash, p_confirmed: true },
  );
  const saved = await recoverHistoryRequest(id, actor, petId, kind);
  if (saved && saved.request.request_hash !== hash)
    throw new Error(
      "Recovered approval hash differs. Original request retained.",
    );
  return saved;
}
export async function abandonHistoryRequest(
  id: string,
  actor: string,
  petId: string,
  kind: HistoryRequestKind,
) {
  await historyRpc("abandon_ezyvet_history_request", {
    p_id: id,
    p_pet_id: petId,
    p_kind: kind,
    p_confirmed: true,
  });
  return recoverHistoryRequest(id, actor, petId, kind);
}
export async function listHistoryRequests(
  actor: string,
  petId: string,
  kind: HistoryRequestKind,
  cursor: HistoryCursor | null,
) {
  const p = z
    .object({
      requests: z.array(z.unknown()).max(20),
      has_more: z.boolean(),
      next_cursor: historyCursor.nullable(),
    })
    .parse(
      await historyRpc("list_ezyvet_history_requests", {
        p_pet_id: petId,
        p_kind: kind,
        p_before_at: cursor?.before_at ?? null,
        p_before_id: cursor?.before_id ?? null,
        p_limit: 20,
      }),
    );
  if (p.has_more !== !!p.next_cursor)
    throw new Error("Review history pagination unavailable");
  return {
    ...p,
    requests: p.requests.map(
      (r) => parseHistoryRequest(r, actor, petId, kind)!,
    ),
  };
}
export async function listImportedHistories(
  petId: string,
  cursor: HistoryCursor | null,
) {
  const p = z
    .object({
      histories: z.array(importedHistory).max(20),
      has_more: z.boolean(),
      next_cursor: historyCursor.nullable(),
    })
    .parse(
      await historyRpc("list_patient_imported_histories", {
        p_pet_id: petId,
        p_before_at: cursor?.before_at ?? null,
        p_before_id: cursor?.before_id ?? null,
        p_limit: 20,
      }),
    );
  if (
    p.has_more !== !!p.next_cursor ||
    p.histories.some((h) => h.pet_id !== petId)
  )
    throw new Error("Imported patient history differs");
  return p;
}
export async function searchHistoryProblems(petId: string, search: string) {
  const rows = z
    .array(problemRow)
    .max(20)
    .parse(
      await historyRpc("search_patient_problems", {
        p_pet_id: petId,
        p_search: search,
        p_limit: 20,
      }),
    );
  if (rows.some((p) => p.pet_id !== petId))
    throw new Error("Problem patient differs");
  return rows;
}
export async function readProblemProvenance(petId: string, ids: string[]) {
  if (ids.length > 50)
    throw new Error("Read at most 50 problem sources at a time");
  if (!ids.length) return [];
  const rows = z
    .array(
      z.object({
        problem_id: historyId,
        extractions: z.array(problemExtraction),
      }),
    )
    .max(50)
    .parse(
      await historyRpc("read_patient_problem_import_provenance", {
        p_pet_id: petId,
        p_problem_ids: ids,
      }),
    );
  if (
    rows.some(
      (r) =>
        !ids.includes(r.problem_id) ||
        r.extractions.some((e) => e.problem_id !== r.problem_id),
    )
  )
    throw new Error("Problem provenance differs");
  return rows;
}
