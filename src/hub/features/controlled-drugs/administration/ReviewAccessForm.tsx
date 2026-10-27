import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { SelectField, TextField } from "./FormFields";
import { explicitBoolean, yesNoChoices } from "./form-values.ts";
import { ReviewStaffFields, type ReviewMemberDraft } from "./ReviewStaffFields";
import { reviewAdministrationDefinitionSchema, reviewAdministrationMembersSchema, type ReviewAdministrationDefinition } from "./review-administration-definition.ts";
import { reviewConfigurationDefinitionSchema, reviewMembersSchema, type ReviewConfigurationDefinition, type ReviewConfigurationScope } from "./review-configuration-definition.ts";
import type { AdministrationConfiguration } from "./configuration-query.ts";
import type { AdministrationStaff } from "./queries.ts";
interface ReviewAccessFormProps { readonly kind: "administration" | "eligibility" | "routing"; readonly scope: ReviewConfigurationScope; readonly current: AdministrationConfiguration; readonly staff: readonly AdministrationStaff[]; readonly disabled: boolean; readonly onSubmit: (definition: ReviewAdministrationDefinition | ReviewConfigurationDefinition) => Promise<void>; readonly onDirtyChange: () => void }
export function ReviewAccessForm({ kind, scope, current, staff, disabled, onSubmit, onDirtyChange }: ReviewAccessFormProps) {
  const old = current.data.current;
  const [enabled, setEnabled] = useState(old ? old.enabled ? "yes" : "no" : ""), [reference, setReference] = useState(""), [error, setError] = useState("");
  const [members, setMembers] = useState<readonly ReviewMemberDraft[]>(() => {
    if (!old || !("members" in old.body)) return [];
    if (kind === "administration") { const parsed = reviewAdministrationMembersSchema.parse(old.body.members); return parsed.map(row => ({ actor_id: row.actor_id!, roles: row.roles, capabilities: row.capabilities })); }
    return reviewMembersSchema.parse(old.body.members).map(row => ({ actor_id: row.actor_id!, roles: row.roles, capabilities: [] }));
  });
  const [attempted, setAttempted] = useState(false), sent = useRef(false);
  function changed() { setError(""); onDirtyChange(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || sent.current) return;
    let definition: ReviewAdministrationDefinition | ReviewConfigurationDefinition;
    try {
      if (members.some(row => !staff.some(person => person.id === row.actor_id && row.roles.every(role => person.roles.includes(role as typeof person.roles[number]))))) throw new Error("Membership differs from active staff.");
      const common = { enabled: explicitBoolean(enabled), expected_predecessor_id: old?.id ?? null, approval_reference: reference };
      const rows = [...members].sort((a, b) => a.actor_id < b.actor_id ? -1 : 1).map(row => ({ actor_id: row.actor_id, roles: [...row.roles].sort(), ...(kind === "administration" ? { capabilities: [...row.capabilities].sort() } : {}) }));
      definition = kind === "administration" ? reviewAdministrationDefinitionSchema.parse({ ...common, members: rows }) : reviewConfigurationDefinitionSchema.parse({ ...common, kind, scope, body: { members: rows } });
    } catch { setError("Choose enabled status, eligible staff roles, required capabilities, and an approval reference."); return; }
    sent.current = true; setAttempted(true); setError("");
    try { await onSubmit(definition); } catch (cause) { if (cause instanceof ControlledOperationNotSentError) { sent.current = false; setAttempted(false); setError("The preparation was not sent. Your entries are preserved."); } else setError("Check the original operation before submitting again."); }
  }
  return <form className="space-y-5" aria-label="Configure controlled record access" onSubmit={event => void submit(event)}><h2 className="font-display text-xl">{kind === "administration" ? "Review administrators" : kind === "eligibility" ? "Staff record access" : "Escalation recipients"}</h2><p className="text-sm text-muted-foreground">{old ? `Replaces saved version ${old.version} after review.` : "No configuration exists for this exact scope."}</p>{error && <p role="alert" className="text-destructive">{error}</p>}<fieldset disabled={disabled || attempted} className="space-y-4"><SelectField label="Enable this configuration?" value={enabled} onChange={value => { changed(); setEnabled(value); }} choices={yesNoChoices} /><ReviewStaffFields staff={staff} members={members} administration={kind === "administration"} onChange={value => { changed(); setMembers(value); }} /><TextField label="Approval reference" maxLength={200} value={reference} onChange={value => { changed(); setReference(value); }} /><Button type="submit" className="min-h-11">Prepare access for review</Button></fieldset></form>;
}
