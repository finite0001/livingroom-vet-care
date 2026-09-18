/** Versioned native return reconciliation contracts; database owns authority, hashes and stock. */
import type { CorrectionHead, CorrectionTarget } from "./native-dispense-corrections.ts";
import type { ReturnAllocationInput, ReturnBalance, ReturnContext, ReturnEvent, ReturnIntent, ReturnIntakeBalance, ReturnPolicy, ReturnStockReview } from "./native-dispense-returns.ts";
import type { ReturnQuantityReplay } from "./native-return-quantity-replay.ts";
export interface ReturnCorrectionSource { event_id: string; record_hash: string }
export interface ReturnPhysicalAttestations { reviewed_physical_facts: true; intake_claim_incorrect: boolean; remains_physically_held: boolean; was_not_destroyed: boolean; removed_from_available_stock: boolean }
export interface ReconciliationIntent {
 target: CorrectionTarget;
 action: ReturnIntent["action"] | "retract_intake" | "retract_disposal" | "retract_restock";
 intake_id: string | null; correction_target: ReturnCorrectionSource | null; discrepancy_id: string | null;
 allocations: ReturnAllocationInput[];
 custody: ReturnIntent["custody"]; package_condition: ReturnIntent["package_condition"]; storage_history: ReturnIntent["storage_history"];
 reason: string; note: string;
}
export interface ReturnDiscrepancyAllocation { allocation_id: string; lot_id: string; quantity: string }
export interface ReturnDiscrepancyIntent {
 target: CorrectionTarget; action: "report" | "note" | "resolve_corrected" | "resolve_confirmed_original";
 case_id: string | null; source: ReturnCorrectionSource;
 allocations: ReturnAllocationInput[]; observation: string; correction_ids: string[];
}
export interface ReturnDiscrepancyEvent {
 version: 1; id: string; target: CorrectionTarget; sequence: number;
 prior_event_id: string | null; prior_record_hash: string | null;
 actor: { id: string; name: string; authority: "active_staff" | "active_dvm" };
 action: ReturnDiscrepancyIntent["action"]; case_id: string;
 source: ReturnCorrectionSource; allocations: ReturnDiscrepancyAllocation[];
 observation: string; correction_ids: string[]; return_head: CorrectionHead;
 reviewed_context_hash: string; created_at: string; record_hash: string;
}
export interface ReturnDiscrepancyCase {
 id: string; source: ReturnCorrectionSource; allocations: ReturnDiscrepancyAllocation[];
 status: "open" | "resolved_corrected" | "resolved_confirmed_original";
 report: ReturnDiscrepancyEvent; decisions: ReturnDiscrepancyEvent[];
}
export interface ReturnDiscrepancyState { version: 1; head: CorrectionHead; open_case_count: number; held_lot_ids: string[]; cases: ReturnDiscrepancyCase[] }
export interface ReconciliationContext {
 version: 2; target: CorrectionTarget; authorization_hash: string; dispense_document_hash: string; dispensed_at: string;
 head: CorrectionHead; discrepancy_head: CorrectionHead;
 original_pickup: ReturnContext["original_pickup"]; correction_head: CorrectionHead;
 allocations: ReturnBalance[]; intake: ReturnIntakeBalance | null;
 replay: ReturnQuantityReplay; discrepancies: ReturnDiscrepancyState;
 stock_review: ReturnStockReview | null; policy: ReturnPolicy | null; intent: ReconciliationIntent;
}
export interface ReconciliationPreview { version: 2; actor_id: string; observed_at: string; context: ReconciliationContext; context_hash: string; allowed: boolean; blockers: string[] }
export interface ReconciliationRequest {
 intent: ReconciliationIntent; expected_context_hash: string; expected_head: CorrectionHead;
 expected_discrepancy_head: CorrectionHead; attest_review: true; attest_restock: boolean;
 physical_attestations: ReturnPhysicalAttestations;
}
export interface ReconciliationEvent {
 version: 2; id: string; target: CorrectionTarget; authorization_hash: string; dispense_document_hash: string;
 sequence: number; prior_event_id: string | null; prior_record_hash: string | null;
 actor: ReturnEvent["actor"]; action: ReconciliationIntent["action"]; intake_id: string | null;
 allocations: ReturnEvent["allocations"]; custody: ReturnIntent["custody"];
 package_condition: ReturnIntent["package_condition"]; storage_history: ReturnIntent["storage_history"];
 reason: string; note: string; policy: ReturnPolicy | null;
 correction_target: ReturnCorrectionSource | null; discrepancy_id: string | null;
 physical_attestations: ReturnPhysicalAttestations;
 reviewed_context_hash: string; created_at: string; record_hash: string;
}
export interface ReconciliationReceipt { version: 2; id: string; actor_id: string; request: ReconciliationRequest; request_hash: string; result: ReconciliationEvent; created_at: string }
export interface ReconciliationRead {
 version: 2; target: CorrectionTarget; authorization_hash: string; dispense_document_hash: string; dispensed_at: string;
 head: CorrectionHead; allocations: ReturnBalance[]; replay: ReturnQuantityReplay; discrepancies: ReturnDiscrepancyState;
}
export interface ReconciliationIntakeRead { version: 2; target: CorrectionTarget; head: CorrectionHead; discrepancy_head: CorrectionHead; intake: ReturnIntakeBalance }
export interface ReconciliationPage { version: 2; target: CorrectionTarget; head: CorrectionHead; discrepancy_head: CorrectionHead; events: Array<ReturnEvent | ReconciliationEvent>; next_before_version: number | null }
export interface ReconciliationDisclosure { version: 2; head: CorrectionHead; events: Array<ReturnEvent | ReconciliationEvent>; allocations: ReturnBalance[]; replay: ReturnQuantityReplay; discrepancies: ReturnDiscrepancyState }
export interface ReconciliationSummary { version: 2; event_count: number; discrepancy_event_count: number; open_case_count: number; affected_dispense_count: number; heads_hash: string }
export interface ReturnDiscrepancyContext {
 version: 1; target: CorrectionTarget; return_head: CorrectionHead; discrepancy_head: CorrectionHead;
 source: ReturnEvent | ReconciliationEvent; replay: ReturnQuantityReplay; discrepancies: ReturnDiscrepancyState;
 intent: ReturnDiscrepancyIntent;
}
export interface ReturnDiscrepancyPreview { version: 1; actor_id: string; observed_at: string; context: ReturnDiscrepancyContext; context_hash: string; allowed: boolean; blockers: string[] }
export interface ReturnDiscrepancyRequest { intent: ReturnDiscrepancyIntent; expected_context_hash: string; expected_return_head: CorrectionHead; expected_discrepancy_head: CorrectionHead; attest_physical_review: true; attest_original_quantities_custody_and_stock_accurate: boolean }
export interface ReturnDiscrepancyReceipt { version: 1; id: string; actor_id: string; request: ReturnDiscrepancyRequest; request_hash: string; result: ReturnDiscrepancyEvent; created_at: string }
