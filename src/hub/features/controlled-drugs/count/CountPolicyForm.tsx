import { ControlledOperationNotSentError } from "../operation-errors.ts";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedChanges } from "../../clinical/use-unsaved-changes";
import { countPolicyRoles, type CountConfiguredPolicy, type CountPolicyPublishRequest, type CountPolicyRole } from "./count-admin-schema.ts";
import { countPolicyAges, countPolicyDraft, countPolicyFlags, countPolicyRoleFields, countPolicySettingsFromDraft, countPolicyTexts, type CountPolicyDraft } from "./count-policy-form.ts";

interface CountPolicyFormProps {
  readonly actorId: string; readonly productId: string; readonly siteId: string; readonly policy: CountConfiguredPolicy | null;
  readonly busy: boolean; readonly pending: boolean; readonly publish: (request: CountPolicyPublishRequest) => Promise<void>;
  readonly onDraftDirtyChange?: (dirty: boolean) => void;
}
const flagLabels = { observation_enabled: "Record independent physical counts", management_enabled: "Finalize and cancel counts", read_enabled: "Read count records", reconciliation_enabled: "Investigate and correct discrepancies" };
const roleLabels = { observer_roles: "Record observations", manager_roles: "Finalize or cancel counts", reader_roles: "Read count records", reconciliation_preparer_roles: "Prepare a stock correction",
  reconciliation_approver_roles: "Approve a correction", reconciliation_executor_roles: "Execute an approved correction", reconciliation_confirmer_roles: "Confirm corrected stock", reconciliation_resolver_roles: "Resolve an investigation" };
const ageLabels = { max_observation_age_seconds: "Maximum observation age (seconds, 1–86400)", max_reconciliation_preparation_age_seconds: "Correction preparation validity (seconds, 1–900)",
  max_reconciliation_approval_age_seconds: "Correction approval validity (seconds, 1–900)", max_reconciliation_confirmation_age_seconds: "Correction confirmation validity (seconds, 1–900)" };
const textLabels = { meaning_text: "What staff confirm when recording a count", meaning_version: "Count confirmation wording version", reconciliation_meaning_text: "What staff confirm for a stock correction", reconciliation_meaning_version: "Correction confirmation wording version" };
const roleNames = { ADMIN: "Administrator", DVM: "Veterinarian", STAFF: "Staff", TECH: "Technician" };
const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";

/** Existing settings are explicit revision input. First setup stays entirely blank. */
export function CountPolicyForm({ actorId, productId, siteId, policy, busy, pending, publish, onDraftDirtyChange }: CountPolicyFormProps) {
  const prefix = useId(), baseline = useRef(JSON.stringify(countPolicyDraft(policy?.settings ?? null)));
  const [draft, setDraft] = useState<CountPolicyDraft>(() => countPolicyDraft(policy?.settings ?? null));
  const [attest, setAttest] = useState(false), [error, setError] = useState(""), [attempted, setAttempted] = useState(false), [done, setDone] = useState(false);
  const latch = useRef(false);
  const dirty = !done && (attest || JSON.stringify(draft) !== baseline.current);
  const notifyDirty = useRef(onDraftDirtyChange); notifyDirty.current = onDraftDirtyChange;
  useEffect(() => { notifyDirty.current?.(dirty); }, [dirty]);
  useEffect(() => () => { notifyDirty.current?.(false); }, []);
  const guard = useUnsavedChanges(dirty, "Your count-access settings have not been published. Leaving will discard this draft; a pending publication remains recoverable.");
  const locked = busy || pending || attempted;
  function change(value: CountPolicyDraft) { if (locked) return; setDraft(value); setAttest(false); setError(""); }
  function toggleRole(key: typeof countPolicyRoleFields[number], role: CountPolicyRole, checked: boolean) {
    const roles = checked ? [...draft.roles[key], role].sort() : draft.roles[key].filter(value => value !== role);
    change({ ...draft, roles: { ...draft.roles, [key]: roles } });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || latch.current || !attest) return;
    let request: CountPolicyPublishRequest;
    try { request = { schema_version: 1, actor_id: actorId, operation_id: crypto.randomUUID(), product_id: productId, site_id: siteId,
      expected_prior_policy_id: policy?.policy_id ?? null, settings: countPolicySettingsFromDraft(draft) }; }
    catch { setError("Complete every setting. Enabled capabilities require eligible roles; use whole-number limits and nonblank confirmation wording."); return; }
    latch.current = true; setAttempted(true); setError("");
    try { await publish(request); setDone(true); }
    catch (error) {
      if (error instanceof ControlledOperationNotSentError) { latch.current = false; setAttempted(false); setError("This publication was not sent. Your settings are preserved; publish deliberately after the other action finishes."); }
      else setError("The publication is unconfirmed. Recover the original attempt before publishing again.");
    }
  }
  return <form className="min-w-0 space-y-5" aria-label="Controlled-count access settings" onSubmit={event => void submit(event)}>
    {guard}
    <header className="space-y-2"><h2 className="font-display text-xl">Count access and review settings</h2>
      <p className="text-sm text-muted-foreground">{policy ? `Revising policy version ${policy.version}. The existing record is retained.` : "First setup: no permissions, time limits, or confirmation wording have been chosen for you."}</p>
      <p className="text-sm text-muted-foreground">Choose each setting, including limits and wording for capabilities you leave disabled. Saving applies the selected permissions to this medication and site.</p></header>
    <fieldset disabled={locked} className="min-w-0 space-y-5">
      <div className="grid gap-4 md:grid-cols-2">{countPolicyFlags.map(key => <div key={key} className="grid gap-1"><Label htmlFor={`${prefix}-${key}`}>{flagLabels[key]}</Label>
        <select id={`${prefix}-${key}`} className={selectClass} required value={draft.flags[key]} onChange={event => change({ ...draft, flags: { ...draft.flags, [key]: event.target.value as "" | "true" | "false" } })}>
          <option value="">Choose enabled or disabled</option><option value="true">Enabled</option><option value="false">Disabled</option>
        </select></div>)}</div>
      <div className="grid gap-1"><Label htmlFor={`${prefix}-method`}>Observation method</Label><select id={`${prefix}-method`} className={selectClass} required value={draft.method} onChange={event => change({ ...draft, method: event.target.value as CountPolicyDraft["method"] })}>
        <option value="">Choose a method</option><option value="manual_count">Staff physical count</option><option value="none">None · observations disabled</option></select></div>
      <section className="space-y-3" aria-label="Eligible staff roles"><h3 className="font-medium">Eligible staff roles</h3><p className="text-sm text-muted-foreground">Select each role deliberately. An enabled capability needs at least one eligible role; reading and recording are separate permissions.</p>
        <div className="grid gap-3 md:grid-cols-2">{countPolicyRoleFields.map(key => <fieldset key={key} className="min-w-0 rounded-xl border p-3"><legend className="max-w-full break-words px-1 text-sm font-medium">{roleLabels[key]}</legend>
          <div className="grid grid-cols-2 gap-1">{countPolicyRoles.map(role => <label key={role} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.roles[key].includes(role)} onChange={event => toggleRole(key, role, event.target.checked)} />{roleNames[role]}</label>)}</div>
        </fieldset>)}</div></section>
      <section className="space-y-3" aria-label="Observation and correction limits"><h3 className="font-medium">Freshness and validity limits</h3><div className="grid gap-4 md:grid-cols-2">{countPolicyAges.map(key => <div key={key} className="grid gap-1"><Label htmlFor={`${prefix}-${key}`}>{ageLabels[key]}</Label><Input id={`${prefix}-${key}`} inputMode="numeric" autoComplete="off" required maxLength={5} value={draft.ages[key]} onChange={event => change({ ...draft, ages: { ...draft.ages, [key]: event.target.value } })} /></div>)}</div></section>
      <section className="space-y-3" aria-label="Staff confirmation wording"><h3 className="font-medium">Staff confirmation wording</h3>{countPolicyTexts.map(key => <div key={key} className="grid gap-1"><Label htmlFor={`${prefix}-${key}`}>{textLabels[key]}</Label>
        {key.endsWith("version") ? <Input id={`${prefix}-${key}`} required maxLength={160} value={draft.texts[key]} onChange={event => change({ ...draft, texts: { ...draft.texts, [key]: event.target.value } })} /> :
          <Textarea id={`${prefix}-${key}`} required maxLength={4000} value={draft.texts[key]} onChange={event => change({ ...draft, texts: { ...draft.texts, [key]: event.target.value } })} />}
      </div>)}</section>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={attest} onChange={event => setAttest(event.target.checked)} /><span>I reviewed all permissions, methods, limits, and confirmation wording for this medication and site.</span></label>
    </fieldset>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {(pending || attempted) && !done && <p role="status" className="text-sm">Check the original publication before making another attempt.</p>}
    {done && <p role="status">Settings published.</p>}
    <Button type="submit" className="min-h-11" disabled={locked || !attest}>Publish reviewed settings</Button>
  </form>;
}
