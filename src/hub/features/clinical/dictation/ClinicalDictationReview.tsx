import { readAudioProvenance } from "./audio/api";
import {
  validateAudioSoap,
  audioSoapFields,
} from "../../../../../supabase/functions/_shared/clinical-audio-model.ts";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  emptySections,
  proposalSchema,
  reviewSchema,
  soapFields,
  submitSchema,
  type DictationAction,
} from "./model";
import {
  readDictation,
  readLatestDictationEncounter,
  recoverDictationAction,
  saveDictationAction,
} from "./api";

interface ClinicalDictationReviewProps {
  encounter: Tables<"clinical_encounters">;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onAccepted: (row: Tables<"clinical_encounters">) => void;
}
export function ClinicalDictationReview(props: ClinicalDictationReviewProps) {
  const { session } = useAuth();
  return session ? (
    <DictationSession
      key={`${session.user.id}:${props.encounter.id}`}
      {...props}
      actor={session.user.id}
    />
  ) : null;
}
interface DictationSessionProps extends ClinicalDictationReviewProps {
  actor: string;
}
type Proposal = z.infer<typeof proposalSchema>;
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const date = (s: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(s));

function DictationSession({
  actor,
  encounter,
  blocked,
  onDirtyChange,
  onBusyChange,
  onAccepted,
}: DictationSessionProps) {
  const prefix = useId();
  const data = useQuery({
    queryKey: ["clinical-dictation", actor, encounter.pet_id, encounter.id],
    queryFn: () => readDictation(actor, encounter.pet_id, encounter.id),
  });
  const [creating, setCreating] = useState(false),
    [captureVersion, setCaptureVersion] = useState(encounter.version);
  const [transcript, setTranscript] = useState(""),
    [sourceNote, setSourceNote] = useState(""),
    [authorized, setAuthorized] = useState(false);
  const [sections, setSections] = useState(emptySections);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const provenance = useQuery({
    queryKey: ["clinical-audio-provenance", actor, selected?.id],
    enabled: !!selected,
    queryFn: async () => {
      const value = await readAudioProvenance(actor, selected!.id);
      if (value) {
        validateAudioSoap(value.payload, selected!.transcript);
        if (value.transcript_hash !== selected!.source_hash)
          throw Error("AI transcript source differs.");
      }
      return value;
    },
  });
  const [chosen, setChosen] = useState<string[]>([]),
    [edits, setEdits] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<DictationAction | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const active = useRef(true),
    locked = useRef(false);
  const importDirty =
    creating &&
    (Boolean(transcript || sourceNote || authorized) ||
      soapFields.some(
        (f) => sections[f].text !== "" || sections[f].quote !== "",
      ));
  const reviewDirty = Boolean(
    selected &&
      !selected.review &&
      (chosen.length ||
        reviewNote ||
        reviewed ||
        soapFields.some((f) => edits[f] !== selected.sections[f].text)),
  );
  const dirty = Boolean(importDirty || reviewDirty || pending || busy);
  const disabled =
    blocked ||
    busy ||
    Boolean(pending) ||
    !data.data ||
    data.isError ||
    Boolean(selected && (provenance.isPending || provenance.isError));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  function clearEditors() {
    setCreating(false);
    setTranscript("");
    setSourceNote("");
    setAuthorized(false);
    setSections(emptySections());
    setSelected(null);
    setChosen([]);
    setEdits({});
    setReviewNote("");
    setReviewed(false);
  }
  function canSwitch() {
    return (
      !busy &&
      !pending &&
      (!dirty || window.confirm("Discard unsaved dictation review changes?"))
    );
  }
  function start() {
    if (!canSwitch()) return;
    clearEditors();
    setCreating(true);
    setCaptureVersion(encounter.version);
    setError("");
    setNotice("");
  }
  function select(proposal: Proposal) {
    if (!canSwitch()) return;
    clearEditors();
    setSelected(proposal);
    setEdits(
      Object.fromEntries(soapFields.map((f) => [f, proposal.sections[f].text])),
    );
    setError("");
    setNotice("");
  }
  async function refresh() {
    if (!canSwitch()) return;
    clearEditors();
    setError("");
    const result = await data.refetch();
    if (result.error && active.current)
      setError("History could not be loaded. Retry before editing.");
  }
  async function run(action: DictationAction, recoverOnly = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const wasPending = Boolean(pending);
    setPending(action);
    let writing = false;
    try {
      let receipt = await recoverDictationAction(action);
      if (!active.current) return;
      if (!receipt) {
        if (recoverOnly) {
          setNotice(
            "No saved receipt found. Retry this same request to finish saving.",
          );
          return;
        }
        writing = true;
        receipt = await saveDictationAction(action);
      }
      if (!active.current) return;
      setPending(null);
      clearEditors();
      setNotice(
        receipt.decision === "submitted"
          ? "Draft imported for review. The encounter has not changed."
          : receipt.decision === "accepted"
            ? "Selected sections saved to the encounter draft. Review and sign separately."
            : "Draft rejected. The encounter has not changed.",
      );
      if (receipt.encounter) {
        try {
          // An immutable receipt may predate a later edit/sign. Adopt current saved state, never the old receipt snapshot.
          const latest = await readLatestDictationEncounter(
            encounter.pet_id,
            encounter.id,
          );
          if (!active.current) return;
          // Runtime schema requires every key; Required compensates for non-strict-null Zod inference.
          onAccepted(latest as Required<typeof latest>);
          if (latest.status === "signed")
            setNotice(
              "Acceptance confirmed. The encounter has since been signed; its text is locked.",
            );
          else if (latest.version > receipt.encounter.version)
            setNotice(
              "Acceptance confirmed. Later saved changes have been loaded; review the current encounter.",
            );
        } catch {
          if (active.current)
            setError(
              "Acceptance was confirmed, but the current encounter could not refresh. Use Reload latest saved record before editing.",
            );
        }
      }
      const result = await data.refetch();
      if (result.error && active.current)
        setError(
          "The save was confirmed, but history could not refresh. Reload dictation history.",
        );
    } catch (failure) {
      if (!active.current) return;
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? String(failure.code)
          : "";
      if (
        writing &&
        !wasPending &&
        ["23514", "23503", "42501", "PT409", "22P02", "23505"].includes(code)
      )
        setPending(null);
      setError(
        code === "PT409"
          ? "The encounter or proposal changed. Your edits are retained; review the latest saved encounter and history."
          : failure && typeof failure === "object" && "message" in failure
            ? String(failure.message)
            : "The save could not be confirmed. Recover or retry the same request.",
      );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function submit() {
    const parsed = submitSchema.safeParse({
      pet_id: encounter.pet_id,
      encounter_id: encounter.id,
      expected_version: captureVersion,
      transcript,
      source_note: sourceNote,
      attest_authorized: authorized,
      sections,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    void run({
      id: crypto.randomUUID(),
      actor,
      kind: "submit",
      request: parsed.data,
    });
  }
  function review(decision: "accepted" | "rejected") {
    if (!selected) return;
    const parsed = reviewSchema.safeParse({
      pet_id: encounter.pet_id,
      encounter_id: encounter.id,
      expected_version: selected.expected_version,
      proposal_id: selected.id,
      decision,
      accepted_sections:
        decision === "accepted"
          ? Object.fromEntries(chosen.map((f) => [f, edits[f]]))
          : {},
      review_note: reviewNote,
      attest_reviewed: reviewed,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    void run({
      id: crypto.randomUUID(),
      actor,
      kind: "review",
      request: parsed.data,
    });
  }
  const canAccept =
    selected &&
    !selected.review &&
    encounter.status === "draft" &&
    selected.expected_version === encounter.version;
  return (
    <details
      className="rounded-lg border border-border bg-background p-4"
      aria-label="Dictation drafts"
    >
      <summary className="min-h-11 cursor-pointer font-semibold">
        Dictation drafts
      </summary>
      <div className="mt-3 space-y-4">
        <p className="text-sm text-muted-foreground">
          Import a staff-supplied transcript and proposed SOAP text for review.
          This tool does not record audio or generate notes. Only explicitly
          accepted sections change the saved encounter draft.
        </p>
        {blocked && (
          <p role="status" className="text-sm">
            Dictation changes are unavailable while this patient is inactive or
            other clinical edits are unsaved or saving.
          </p>
        )}
        {data.isPending && <p role="status">Loading dictation history…</p>}
        {data.isError && <p role="alert">Dictation history is unavailable.</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        {busy && <p role="status">Saving dictation review…</p>}
        {pending && !busy && (
          <div className="space-y-2">
            <p className="text-sm">
              The save is unconfirmed. Recover or retry its original request
              before changing this draft.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                variant="outline"
                onClick={() => void run(pending, true)}
              >
                Recover dictation save
              </Button>
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                onClick={() => void run(pending)}
              >
                Retry dictation save
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {encounter.status === "draft" && (
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              variant="outline"
              disabled={disabled}
              onClick={start}
            >
              Import dictation draft
            </Button>
          )}
          <Button
            className="h-auto min-h-11 max-w-full whitespace-normal"
            variant="outline"
            disabled={busy || Boolean(pending)}
            onClick={() => void refresh()}
          >
            Reload dictation history
          </Button>
          {(creating || selected) && (
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              variant="ghost"
              disabled={busy || Boolean(pending)}
              onClick={() => {
                if (canSwitch()) clearEditors();
              }}
            >
              Close dictation editor
            </Button>
          )}
        </div>
        {data.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No dictation drafts imported for this encounter.
          </p>
        )}
        {data.data?.items.map((p) => (
          <Button
            key={p.id}
            data-testid={`dictation-${p.id}`}
            variant={p.id === selected?.id ? "secondary" : "outline"}
            className="h-auto min-h-11 max-w-full whitespace-normal text-left"
            disabled={busy || Boolean(pending)}
            onClick={() => select(p)}
          >
            <span className="min-w-0 break-words">
              {date(p.created_at)} · {p.actor_name} ·{" "}
              {p.review ? title(p.review.decision) : "Awaiting review"}
            </span>
          </Button>
        ))}
        {data.data?.has_more && (
          <p className="text-xs text-muted-foreground">
            Showing the latest 20 imported drafts. Earlier source and review
            history is retained.
          </p>
        )}
        {creating && (
          <fieldset disabled={disabled} className="space-y-4 border-t pt-4">
            <legend className="font-medium">
              Import transcript and proposed text
            </legend>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-transcript`}>Source transcript</Label>
              <Textarea
                id={`${prefix}-transcript`}
                rows={6}
                maxLength={60000}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-source`}>
                Transcript source and authorization
              </Label>
              <Textarea
                id={`${prefix}-source`}
                maxLength={1000}
                value={sourceNote}
                onChange={(e) => setSourceNote(e.target.value)}
                placeholder="Describe where the transcript came from and permission to use it."
              />
            </div>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
              />
              I verified this transcript belongs to this patient and is
              authorized for use.
            </label>
            {soapFields.map((field) => (
              <div
                key={field}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <Label htmlFor={`${prefix}-import-${field}`}>
                  Proposed {title(field)}
                </Label>
                <Textarea
                  id={`${prefix}-import-${field}`}
                  rows={3}
                  maxLength={50000}
                  value={sections[field].text}
                  onChange={(e) =>
                    setSections({
                      ...sections,
                      [field]: { ...sections[field], text: e.target.value },
                    })
                  }
                />
                <Label htmlFor={`${prefix}-quote-${field}`}>
                  {title(field)} supporting transcript excerpt
                </Label>
                <Textarea
                  id={`${prefix}-quote-${field}`}
                  maxLength={2000}
                  value={sections[field].quote}
                  onChange={(e) =>
                    setSections({
                      ...sections,
                      [field]: { ...sections[field], quote: e.target.value },
                    })
                  }
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Leave unused sections and their excerpts empty. Copy excerpts
              exactly. The source and proposed text are retained when imported.
            </p>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              onClick={submit}
            >
              Save dictation draft for review
            </Button>
          </fieldset>
        )}
        {selected && (
          <section
            className="space-y-4 border-t pt-4"
            aria-label="Review dictation draft"
          >
            <p className="break-words text-sm">
              Imported by {selected.actor_name} · {date(selected.created_at)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              Source: {selected.source_note}
            </p>
            {provenance.isPending && (
              <p role="status" className="text-sm">
                Checking source provenance…
              </p>
            )}
            {provenance.isError && (
              <p role="alert" className="text-sm text-destructive">
                Source provenance could not be verified.{" "}
                <Button
                  variant="outline"
                  onClick={() => void provenance.refetch()}
                >
                  Retry source provenance
                </Button>
              </p>
            )}
            {provenance.data && (
              <section
                aria-label="AI source provenance"
                className="min-w-0 space-y-3 rounded-md border border-border p-3"
              >
                <h4 className="font-medium">
                  AI-generated proposal — review every claim and excerpt
                </h4>
                <p className="whitespace-pre-wrap break-words text-sm">
                  Dictation source: {provenance.data.source_note}
                </p>
                <p className="text-sm">
                  OpenAI transcription: {provenance.data.transcription_model}.
                  SOAP draft: {provenance.data.soap_model}. The app does not
                  retain the audio file. These checks verify source references,
                  not medical accuracy.
                </p>
                {!!provenance.data.payload.review_flags.length && (
                  <div role="note">
                    <p className="font-medium">Needs clinician attention</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {provenance.data.payload.review_flags.map((flag, i) => (
                        <li
                          className="whitespace-pre-wrap break-words text-sm"
                          key={i}
                        >
                          {flag}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {audioSoapFields
                  .filter((field) => provenance.data!.payload[field].length > 0)
                  .map((field) => (
                    <div key={field}>
                      <h5 className="font-medium">
                        {title(field)} claim sources
                      </h5>
                      <ul className="space-y-2">
                        {provenance.data!.payload[field].map((claim, i) => (
                          <li
                            className="rounded-md border border-border p-2"
                            key={i}
                          >
                            <p className="whitespace-pre-wrap break-words text-sm">
                              {claim.text}
                            </p>
                            <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-sm text-muted-foreground">
                              {claim.quote}
                            </blockquote>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </section>
            )}
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <h4 className="font-medium">Retained source transcript</h4>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 font-sans text-sm">
                  {selected.transcript}
                </pre>
              </div>
              <fieldset
                disabled={disabled && !selected.review}
                className="min-w-0 space-y-4"
              >
                <legend className="font-medium">Proposed sections</legend>
                {soapFields
                  .filter((f) => selected.sections[f].text !== "")
                  .map((field) => (
                    <div key={field} className="space-y-2">
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={Boolean(selected.review)}
                          checked={
                            selected.review
                              ? Object.prototype.hasOwnProperty.call(
                                  selected.review.accepted_sections,
                                  field,
                                )
                              : chosen.includes(field)
                          }
                          onChange={(e) =>
                            setChosen(
                              e.target.checked
                                ? [...chosen, field]
                                : chosen.filter((f) => f !== field),
                            )
                          }
                        />
                        Accept {title(field)}
                      </label>
                      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        Source excerpt: {selected.sections[field].quote}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm">
                        Current saved {title(field)}:{" "}
                        {encounter[field] || "No text saved."}
                      </p>
                      <Label htmlFor={`${prefix}-review-${field}`}>
                        {title(field)} reviewed wording
                      </Label>
                      <Textarea
                        id={`${prefix}-review-${field}`}
                        readOnly={Boolean(selected.review)}
                        rows={4}
                        maxLength={50000}
                        value={
                          selected.review
                            ? (selected.review.accepted_sections[field] ??
                              selected.sections[field].text)
                            : (edits[field] ?? "")
                        }
                        onChange={(e) =>
                          setEdits({ ...edits, [field]: e.target.value })
                        }
                      />
                      {!selected.review &&
                        edits[field] !== selected.sections[field].text && (
                          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            Originally proposed: {selected.sections[field].text}
                          </p>
                        )}
                    </div>
                  ))}
              </fieldset>
            </div>
            {selected.review ? (
              <div className="space-y-2 text-sm">
                <p>
                  {title(selected.review.decision)} by{" "}
                  {selected.review.actor_name} ·{" "}
                  {date(selected.review.created_at)}
                </p>
                <p className="whitespace-pre-wrap">
                  {selected.review.review_note}
                </p>
                <p>
                  Original transcript and proposal remain retained. Signing is a
                  separate clinical action.
                </p>
              </div>
            ) : (
              <fieldset disabled={disabled} className="space-y-3">
                {!canAccept && (
                  <p role="status" className="text-sm">
                    This encounter changed or was signed after import. This
                    proposal cannot replace its text. Reject it with a reason,
                    or import a new draft against the latest saved encounter.
                  </p>
                )}
                <Label htmlFor={`${prefix}-review-note`}>
                  Review note (required for rejection)
                </Label>
                <Textarea
                  id={`${prefix}-review-note`}
                  maxLength={2000}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed the patient attribution, transcript and selected
                  wording.
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="h-auto min-h-11 max-w-full whitespace-normal"
                    disabled={!canAccept || !reviewed || chosen.length === 0}
                    onClick={() => review("accepted")}
                  >
                    Accept selected sections into saved draft
                  </Button>
                  <Button
                    className="h-auto min-h-11 max-w-full whitespace-normal"
                    variant="outline"
                    disabled={!reviewed || !reviewNote.trim()}
                    onClick={() => review("rejected")}
                  >
                    Reject dictation draft
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Acceptance replaces selected sections only. Other saved
                  sections remain unchanged. The encounter stays unsigned.
                </p>
              </fieldset>
            )}
          </section>
        )}
      </div>
    </details>
  );
}
