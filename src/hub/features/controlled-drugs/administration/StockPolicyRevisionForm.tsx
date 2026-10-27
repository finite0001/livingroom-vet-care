import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { TextField } from "./FormFields";
import { StockPermissionFields } from "./StockPermissionFields";
import { buildStockPolicy, initialStockPolicyDraft } from "./stock-policy-form.ts";
import { stockPolicyRevisionDefinitionSchema } from "./opening-definition.ts";
import type { z } from "zod";
import type { AdministrationOptions, CurrentStockPolicy } from "./queries.ts";
interface StockPolicyRevisionFormProps { readonly current: CurrentStockPolicy; readonly options: AdministrationOptions; readonly disabled: boolean; readonly onSubmit: (definition: z.infer<typeof stockPolicyRevisionDefinitionSchema>) => Promise<void>; readonly onDirtyChange: () => void }
export function StockPolicyRevisionForm({ current, options, disabled, onSubmit, onDirtyChange }: StockPolicyRevisionFormProps) {
  const [draft, setDraft] = useState(() => initialStockPolicyDraft(current.data?.policy)), [reason, setReason] = useState(""), [error, setError] = useState(""), [attempted, setAttempted] = useState(false), sent = useRef(false);
  const source = current.data;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || sent.current || !source) return;
    let definition: z.infer<typeof stockPolicyRevisionDefinitionSchema>;
    try { definition = stockPolicyRevisionDefinitionSchema.parse({ draft_version_id: source.current_draft_version_id, expected_policy_version_id: source.policy_version_id,
      policy: buildStockPolicy(draft, options.sites.map(site => site.id!)), reason }); }
    catch { setError("Complete every permission, policy review reference, and reason for revision."); return; }
    sent.current = true; setAttempted(true); setError("");
    try { await onSubmit(definition); } catch (cause) { if (cause instanceof ControlledOperationNotSentError) { sent.current = false; setAttempted(false); setError("The preparation was not sent. Your entries are preserved."); } else setError("Check the original operation before submitting again."); }
  }
  if (!source || source.state.state === "retired" || !source.opening_id) return <p role="alert">An existing opening and a current non-retired policy are required.</p>;
  return <form className="space-y-5" aria-label="Revise controlled stock policy" onSubmit={event => void submit(event)}><h2 className="font-display text-xl">Revise stock policy · {source.product.name}</h2><p className="text-sm text-muted-foreground">Review the current policy version {source.policy_version}. This revision retains the existing opening stock.</p>{error && <p role="alert" className="text-destructive">{error}</p>}<fieldset disabled={disabled || attempted} className="space-y-5"><StockPermissionFields value={draft} sites={options.sites} onChange={value => { setDraft(value); setError(""); onDirtyChange(); }} /><TextField label="Reason for revision" maxLength={2000} value={reason} onChange={value => { setReason(value); onDirtyChange(); }} /><Button type="submit" className="min-h-11">Prepare policy revision</Button></fieldset></form>;
}
