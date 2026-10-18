import { useEffect, useId, useState } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/integrations/supabase/types";
import { soapFields } from "../dictation/model";
import { callNoteReviewRequestSchema, type CallNoteProcessingRead } from "../../../../../supabase/functions/_shared/clinical-call-note-processing-model.ts";
import { CallSourcePreview } from "./CallSourcePreview";
interface CallNoteReviewProps {
  value: CallNoteProcessingRead;
  encounter: Tables<"clinical_encounters">;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onReview: (request: z.infer<typeof callNoteReviewRequestSchema>) => void;
}
export function CallNoteReview({ value, encounter, blocked, onDirtyChange, onReview }: CallNoteReviewProps) {
  const prefix = useId(), { proposal, generation, review } = value;
  const [chosen, setChosen] = useState<string[]>([]), [edits, setEdits] = useState<Record<string, string>>(() => Object.fromEntries(soapFields.map((field) => [field, proposal?.sections[field].text ?? ""])));
  const [reviewNote, setReviewNote] = useState(""), [attested, setAttested] = useState(false), [error, setError] = useState("");
  const dirty = !review && (!!chosen.length || !!reviewNote || attested || soapFields.some((field) => edits[field] !== (proposal?.sections[field].text ?? "")));
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  if (!proposal || !generation) return null;
  const canAccept = !review && encounter.status === "draft" && encounter.id === proposal.encounter_id && encounter.pet_id === proposal.pet_id && encounter.version === proposal.expected_version;
  function submit(decision: "accepted" | "rejected") {
    if (blocked || review || !proposal) return;
    const request = callNoteReviewRequestSchema.safeParse({ proposal_id: proposal.id, expected_version: proposal.expected_version, decision, accepted_sections: decision === "accepted" ? Object.fromEntries(chosen.map((field) => [field, edits[field]])) : {}, review_note: reviewNote, attest_reviewed: attested });
    if (!request.success) { setError("Choose nonempty reviewed sections, or reject with a reason, and confirm your review."); return; }
    setError(""); onReview(request.data);
  }
  return <section aria-label="Private call draft review" className="min-w-0 space-y-4 rounded-lg border border-border p-3">
    <h4 className="font-display text-lg">Review private call draft</h4>
    <p className="text-sm text-muted-foreground">Check the selected patient, attribution, wording and every cited excerpt. Exact quotations verify source membership; they do not establish medical correctness. Only selected reviewed sections enter this unsigned encounter.</p>
    <p className="break-words text-sm">Selected patient: {value.patient.name} · {value.patient.species}. Source speaker labels remain the provider’s labels; an agent label does not identify a doctor.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {generation.payload.review_flags.map((flag, index) => <p key={index} role="note" className="whitespace-pre-wrap break-words text-sm">Needs review: {flag}</p>)}
    <section aria-label="Private call claim evidence" className="min-w-0 space-y-3">
      {generation.payload.fields.map((field, index) => <article key={field.field_id} className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <h5 className="break-words font-medium">{value.template.definition.fields[index].label} · {field.status}</h5>
        {field.status === "missing" && <p className="text-sm text-muted-foreground">No finding supplied{value.template.definition.fields[index].required ? "; required information remains missing" : ""}. No normal result was invented.</p>}
        {field.uncertainty && <p className="whitespace-pre-wrap break-words text-sm">Uncertainty: {field.uncertainty}</p>}
        {field.claims.map((claim, claimIndex) => <div key={claimIndex} className="min-w-0 space-y-2 border-t border-border pt-2">
          <p className="whitespace-pre-wrap break-words text-sm">{claim.text}</p>
          <p className="text-xs font-medium">{claim.patient_scope === "selected_patient" ? "Proposed for selected patient — verify attribution" : claim.patient_scope === "other_patient" ? "Other patient — excluded from SOAP" : "Patient unassigned — excluded from SOAP"}</p>
          {claim.supports.map((support, supportIndex) => {
            const segment = value.source.document.segments.find((item) => item.ordinal === support.segment_ordinal)!;
            return <details key={supportIndex} className="min-w-0 rounded-md border border-border p-2">
              <summary className="min-h-11 cursor-pointer break-words text-sm">Segment {segment.ordinal} · {segment.start}–{segment.end} seconds · original speaker {segment.caller}</summary>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-sm">{support.quote}</blockquote>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm"><span>{segment.text.slice(0, support.from)}</span><mark className="bg-accent text-accent-foreground">{segment.text.slice(support.from, support.to)}</mark><span>{segment.text.slice(support.to)}</span></p>
              <p className="break-all text-xs text-muted-foreground">Exact UTF-16 range {support.from}–{support.to} · segment SHA256 {support.segment_sha256}</p>
            </details>;
          })}
        </div>)}
      </article>)}
    </section>
    <details className="min-w-0"><summary className="min-h-11 cursor-pointer font-medium">Inspect complete frozen call transcript</summary><CallSourcePreview source={value.source} patientName={value.patient.name} encounterDate={encounter.visit_at} /></details>
    <fieldset disabled={blocked || !!review} className="min-w-0 space-y-4"><legend className="font-medium">Selected reviewed SOAP wording</legend>
      {soapFields.filter((field) => proposal.sections[field].text !== "").map((field) => <div key={field} className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <label className="flex min-h-11 items-center gap-2 capitalize"><input type="checkbox" checked={review ? Object.prototype.hasOwnProperty.call(review.accepted_sections, field) : chosen.includes(field)} onChange={(event) => setChosen(event.target.checked ? [...chosen, field] : chosen.filter((item) => item !== field))} />Accept {field}</label>
        <p className="whitespace-pre-wrap break-words text-sm">Current saved {field}: {encounter[field] || "No text saved."}</p>
        <Label htmlFor={`${prefix}-${field}`} className="capitalize">{field} reviewed wording</Label><Textarea id={`${prefix}-${field}`} rows={4} maxLength={50000} value={review ? review.accepted_sections[field] ?? proposal.sections[field].text : edits[field]} onChange={(event) => setEdits({ ...edits, [field]: event.target.value })} />
        {!review && edits[field] !== proposal.sections[field].text && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">Originally proposed: {proposal.sections[field].text}</p>}
      </div>)}
      {!review && <><Label htmlFor={`${prefix}-note`}>Call draft review note (required for rejection)</Label><Textarea id={`${prefix}-note`} rows={3} maxLength={2000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />I reviewed patient attribution, all relevant call evidence and the selected wording.</label>
        {!canAccept && <p role="status" className="text-sm">The saved encounter changed or was signed. This proposal cannot replace its sections; rejection remains available.</p>}
        <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!canAccept || !attested || !chosen.length} onClick={() => submit("accepted")}>Accept selected call sections into saved draft</Button><Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={!attested || !reviewNote.trim()} onClick={() => submit("rejected")}>Reject private call draft</Button><Button variant="outline" disabled={!dirty} onClick={() => { setChosen([]); setEdits(Object.fromEntries(soapFields.map((field) => [field, proposal.sections[field].text]))); setReviewNote(""); setAttested(false); }}>Discard unsaved call review edits</Button></div>
      </>}
    </fieldset>
    {review && <section aria-label="Saved call draft decision" className="space-y-2 text-sm"><p>{review.decision} · {review.actor_name} · {review.created_at}</p><p className="whitespace-pre-wrap break-words">{review.review_note}</p><p>The source and original proposal remain private. Signing is a separate clinical action.</p></section>}
    <details className="min-w-0"><summary className="min-h-11 cursor-pointer text-sm font-medium">Generation audit details</summary><p className="break-all text-xs text-muted-foreground">Requested model {generation.manifest.requested_model} · returned {generation.manifest.provider_model} · prompt {generation.manifest.prompt_version} · veterinary context {generation.manifest.veterinary_context.version} · source {value.source.sha256} · template {value.template.sha256}</p><p className="text-xs text-muted-foreground">{value.events_has_more ? "The 100 most recent processing events are loaded; earlier events remain retained." : `${value.events.length} processing events retained for this draft.`}</p></details>
    <p className="text-xs text-muted-foreground">Acceptance replaces selected sections only. All other saved sections remain unchanged. The encounter stays unsigned.</p>
  </section>;
}
