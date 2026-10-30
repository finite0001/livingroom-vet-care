import { reviewEventKindSchema } from "../record-review/queue-model.ts";
import { explicitBoolean } from "./form-values.ts";
import { stockPermissionBasis, stockPolicyDefinitionSchema, type StockPermissionRole, type StockPolicyDefinition } from "./opening-definition.ts";
export interface StockRuleDraft { readonly enabled: string; readonly roles: readonly StockPermissionRole[]; readonly witness: string; readonly secondary: string; readonly locations: readonly ("clinic" | "mobile_kit")[] }
export interface StockPolicyDraft { readonly sites: readonly string[]; readonly rules: Readonly<Record<string, StockRuleDraft>>; readonly retainedReturns: string; readonly reference: string }
export function initialStockPolicyDraft(current?: StockPolicyDefinition): StockPolicyDraft {
  return { sites: current ? [...current.site_ids] : [], retainedReturns: current ? current.clinic_retained_return_permitted ? "yes" : "no" : "", reference: "",
    rules: Object.fromEntries(reviewEventKindSchema.options.map(kind => { const old = current?.permissions[kind]; return [kind, old ? { enabled: old.enabled ? "yes" : "no", roles: [...old.roles], witness: old.witness, secondary: old.secondary_review ? "yes" : "no", locations: [...old.location_kinds] } : { enabled: "", roles: [], witness: "", secondary: "", locations: [] }]; })) };
}
export function buildStockPolicy(draft: StockPolicyDraft, allowedSites: readonly string[]): StockPolicyDefinition {
  if (draft.sites.some(id => !allowedSites.includes(id)) || Object.keys(draft.rules).length !== reviewEventKindSchema.options.length) throw new Error("Choose only currently registered sites and complete every stock rule.");
  return stockPolicyDefinitionSchema.parse({ site_ids: [...draft.sites].sort(), clinic_retained_return_permitted: explicitBoolean(draft.retainedReturns), review_reference: draft.reference,
    permissions: Object.fromEntries(reviewEventKindSchema.options.map(kind => { const row = draft.rules[kind]; if (!row) throw new Error("Complete every stock rule."); return [kind, { enabled: explicitBoolean(row.enabled), roles: [...row.roles].sort(), basis: stockPermissionBasis(kind), witness: row.witness, secondary_review: explicitBoolean(row.secondary), location_kinds: [...row.locations].sort() }]; })) });
}
