import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { readAudio } from "../dictation/audio/api";
import {
  noteIntentSchema,
  noteJobReadSchema,
  noteReserveSchema,
} from "./model";
import {
  cancelNoteAttempt,
  cancelNoteReservation,
  processNote,
  readNoteJob,
  readNotes,
  reserveNote,
} from "./api";
import { TemplateEditor } from "./TemplateEditor";
import { TemplatePreview } from "./TemplatePreview";
interface ClinicalNoteDraftsProps {
  encounter: Tables<"clinical_encounters">;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}
const retryReasons = {
  previous_failure_reviewed: "Previous processing failure reviewed",
  uncertain_outcome_duplicate_charge_authorized:
    "Prior outcome uncertain; possible duplicate charge authorized",
  expired_attempt_reviewed: "Expired processing attempt reviewed",
};
const retryReasonSchema = z.enum([
  "previous_failure_reviewed",
  "uncertain_outcome_duplicate_charge_authorized",
  "expired_attempt_reviewed",
]);
const pendingIntentSchema = noteIntentSchema.extend({
  reason: z.union([z.literal(""), retryReasonSchema]),
});
const pendingSchema = z
  .object({ job_id: z.string().uuid(), intent: pendingIntentSchema.nullable() })
  .strict();
type Pending = z.infer<typeof pendingSchema>;
type JobRead = z.infer<typeof noteJobReadSchema>;
interface AttemptState {
  state?: string;
  lease_until?: string;
}
const isActiveAttempt = (attempt: AttemptState) => {
  if (!attempt.state || !attempt.lease_until) return true;
  const lease = Date.parse(attempt.lease_until);
  if (!Number.isFinite(lease)) return true;
  return ["claimed", "sending"].includes(attempt.state) && lease > Date.now();
};
const failureMessage = (failure: unknown) =>
  failure instanceof Error
    ? failure.message
    : failure && typeof failure === "object" && "message" in failure
      ? String(failure.message)
      : "The note action could not be confirmed. Recover its original request.";
export function ClinicalNoteDrafts(props: ClinicalNoteDraftsProps) {
  const { session, hasRole } = useAuth();
  return session ? (
    <NoteSession
      key={`${session.user.id}:${props.encounter.id}`}
      {...props}
      actor={session.user.id}
      canManage={hasRole("ADMIN")}
    />
  ) : null;
}
interface NoteSessionProps extends ClinicalNoteDraftsProps {
  actor: string;
  canManage: boolean;
}
function NoteSession({
  encounter,
  blocked,
  actor,
  canManage,
  onDirtyChange,
  onBusyChange,
}: NoteSessionProps) {
  const prefix = useId(),
    cache = useQueryClient(),
    lock = useRef(false),
    active = useRef(true);
  const key = `lrv:clinical-note-pending:${actor}:${encounter.pet_id}:${encounter.id}`;
  const data = useQuery({
    queryKey: ["clinical-notes", actor, encounter.pet_id, encounter.id],
    queryFn: () => readNotes(actor, encounter.pet_id, encounter.id),
  });
  const audio = useQuery({
    queryKey: ["clinical-audio", actor, encounter.pet_id, encounter.id],
    queryFn: () => readAudio(actor, encounter.pet_id, encounter.id),
  });
  const [templateId, setTemplateId] = useState(""),
    [sourceKind, setSourceKind] = useState<"typed" | "audio_transcript">(
      "typed",
    ),
    [source, setSource] = useState(""),
    [audioId, setAudioId] = useState(""),
    [sourceNote, setSourceNote] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [ackCost, setAckCost] = useState(false),
    [reason, setReason] = useState<z.infer<typeof retryReasonSchema> | "">("");
  const [job, setJob] = useState<JobRead | null>(null),
    [busy, setBusy] = useState(false),
    [editorDirty, setEditorDirty] = useState(false),
    [editorBusy, setEditorBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? pendingSchema.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  });
  const localDirty =
    !!source || !!sourceNote || authorized || ackCost || !!reason;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange(
      localDirty ||
        !!pending ||
        busy ||
        editorDirty ||
        editorBusy ||
        !!job?.job.attempts.some((item) => isActiveAttempt(item)),
    );
    return () => onDirtyChange(false);
  }, [localDirty, pending, busy, editorDirty, editorBusy, job, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy || editorBusy);
    return () => onBusyChange(false);
  }, [busy, editorBusy, onBusyChange]);
  const templates =
    data.data?.templates.filter((root) => !root.retired && root.approved) ?? [];
  const selected = templates.find((root) => root.id === templateId);
  const activeAttempt = job?.job.attempts.some((item) => isActiveAttempt(item));
  const disabled =
    blocked ||
    busy ||
    editorDirty ||
    editorBusy ||
    !!pending ||
    !!activeAttempt ||
    !data.data ||
    data.isError ||
    encounter.status !== "draft";
  const policyApproved = data.data?.policy.status === "approved";
  const audioJobs =
    audio.data?.jobs.filter(
      (item) => item.actor_id === actor && !!item.transcript,
    ) ?? [];
  const attempt = job?.job.attempts[0];
  function persist(value: Pending | null) {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    setPending(value);
  }
  async function adopt(value: JobRead) {
    if (
      value.job.pet_id !== encounter.pet_id ||
      value.job.encounter_id !== encounter.id ||
      value.job.actor_id !== actor
    )
      throw Error("Recovered note belongs to a different destination.");
    setJob(value);
    await cache.invalidateQueries({
      queryKey: ["clinical-notes", actor, encounter.pet_id, encounter.id],
    });
    if (value.job.proposal_id) {
      await cache.invalidateQueries({
        queryKey: ["clinical-dictation", actor, encounter.pet_id, encounter.id],
      });
      setNotice(
        "Generated proposal is ready. Open Dictation drafts below and review its field evidence before accepting any sections.",
      );
    }
  }
  async function recover() {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await readNoteJob(actor, pending.job_id);
      if (!active.current) return;
      await adopt(value);
      const originalAttempt =
        pending.intent &&
        value.job.attempts.find(
          (item) => item.id === pending.intent!.attempt_id,
        );
      if (
        pending.intent &&
        (!originalAttempt || isActiveAttempt(originalAttempt))
      ) {
        setNotice(
          "The original provider attempt is still unconfirmed or active. Recover its state again; only the original intent may be retried.",
        );
        return;
      }
      persist(null);
      setSource("");
      setSourceNote("");
      setAuthorized(false);
      setAckCost(false);
      setReason("");
      if (!value.job.proposal_id)
        setNotice(
          "Saved source and attempt state recovered. No provider request was started by this recovery.",
        );
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function resolvePending(cancel: boolean) {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (cancel && !pending.intent) {
        const receipt = await cancelNoteReservation(actor, pending.job_id);
        if (receipt.cancelled) {
          persist(null);
          setNotice(
            "The unconfirmed source reservation was canceled. No late request can save it.",
          );
        } else {
          await adopt(await readNoteJob(actor, pending.job_id));
          persist(null);
          setSource("");
          setSourceNote("");
          setAuthorized(false);
          setAckCost(false);
          setReason("");
          setNotice(
            "The original source had already been saved; its immutable history is retained.",
          );
        }
      } else if (pending.intent) {
        const value = await processNote(pending.intent);
        await adopt(value);
        const original = value.job.attempts.find(
          (item) => item.id === pending.intent!.attempt_id,
        );
        if (original && !isActiveAttempt(original)) {
          persist(null);
          setSource("");
          setSourceNote("");
          setAuthorized(false);
          setAckCost(false);
          setReason("");
        }
      }
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function cancelPendingAttempt() {
    if (!pending?.intent || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const receipt = await cancelNoteAttempt(actor, pending.intent);
      await adopt(await readNoteJob(actor, pending.job_id));
      const original = receipt.job.attempts.find(
        (item) => item.id === pending.intent!.attempt_id,
      );
      if (
        receipt.cancelled ||
        (original &&
          ["completed", "failed", "uncertain", "superseded"].includes(
            original.state,
          ))
      ) {
        persist(null);
        setSource("");
        setSourceNote("");
        setAuthorized(false);
        setAckCost(false);
        setReason("");
        if (!receipt.job.proposal_id)
          setNotice(
            receipt.cancelled
              ? "The undispatched attempt was canceled. Its original identifier cannot dispatch later."
              : "The original attempt reached a known state. Review its saved history before another attempt.",
          );
      } else
        setNotice(
          "This attempt may already have reached the provider. Its pending identity is retained; recover its state before editing or generating again.",
        );
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reserve() {
    if (lock.current || disabled || !selected?.approved || !data.data) return;
    const parsed = noteReserveSchema.safeParse({
      pet_id: encounter.pet_id,
      encounter_id: encounter.id,
      expected_version: encounter.version,
      policy_version: data.data.policy.version,
      template_id: selected.id,
      template_version: selected.approved.version,
      template_hash: selected.approved.sha256,
      source_kind: sourceKind,
      source_text: sourceKind === "typed" ? source : null,
      audio_job_id: sourceKind === "audio_transcript" ? audioId : null,
      source_note: sourceNote,
      attest_authorized: authorized,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    const id = crypto.randomUUID();
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      persist({ job_id: id, intent: null });
      await reserveNote(actor, id, parsed.data);
      const value = await readNoteJob(actor, id);
      if (!active.current) return;
      await adopt(value);
      persist(null);
      setSource("");
      setSourceNote("");
      setAuthorized(false);
      setAckCost(false);
      setNotice(
        "Source saved privately. Review the pinned source and template, then explicitly start generation.",
      );
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function generate() {
    if (
      !job ||
      lock.current ||
      blocked ||
      editorDirty ||
      editorBusy ||
      !ackCost
    )
      return;
    const latest = job.job.attempts[0];
    const intent = pendingIntentSchema.parse({
      job_id: job.job.id,
      attempt_id: crypto.randomUUID(),
      retry_of: latest?.id ?? null,
      reason: latest ? reason : "",
      ack_cost: latest ? ackCost : false,
    });
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      persist({ job_id: job.job.id, intent });
      const value = await processNote(intent);
      if (!active.current) return;
      await adopt(value);
      persist(null);
      setAckCost(false);
      setReason("");
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function selectJob(id: string) {
    if (
      lock.current ||
      pending ||
      (localDirty && !window.confirm("Discard unsaved note input?"))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await adopt(await readNoteJob(actor, id));
      setSource("");
      setSourceNote("");
      setAuthorized(false);
      setAckCost(false);
      setReason("");
    } catch (failure) {
      setError(failureMessage(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const canGenerate =
    !!job &&
    !job.job.proposal_id &&
    job.policy.status === "approved" &&
    job.template.status === "approved" &&
    job.job.expected_version === encounter.version &&
    encounter.status === "draft" &&
    (!attempt ||
      ["failed", "uncertain"].includes(attempt.state) ||
      (["claimed", "sending"].includes(attempt.state) &&
        !isActiveAttempt(attempt)));
  return (
    <section
      aria-label="Template note drafts"
      className="min-w-0 space-y-4 rounded-lg border border-border bg-background p-4"
    >
      <h3 className="font-semibold">Template note drafts</h3>
      <p className="text-sm text-muted-foreground">
        Generate from typed observations or a completed dictation transcript.
        Source-backed proposals wait for your review; no normal findings or
        signature are supplied automatically.
      </p>
      {data.isPending && <p role="status">Loading note templates…</p>}
      {data.isError && (
        <p role="alert">
          Clinical note configuration is unavailable.{" "}
          <Button variant="outline" onClick={() => void data.refetch()}>
            Retry note configuration
          </Button>
        </p>
      )}
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {busy && <p role="status">Confirming clinical note action…</p>}
      {blocked && (
        <p className="text-sm" role="status">
          Save or finish other clinical edits before changing note drafts.
        </p>
      )}
      {!policyApproved && data.data && (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          Practice approval is pending. Note generation stays off until Susan’s
          clinical processing policy and a template are approved. Template
          preview and existing proposal history remain available.
        </p>
      )}
      {pending && (
        <section
          aria-label="Unconfirmed note action"
          className="space-y-2 rounded-md border border-border p-3"
        >
          <p className="text-sm">
            The original source or provider attempt is unconfirmed. Recover it
            before editing or generating again. This browser stores job and
            attempt identifiers with a fixed processing intent, never source
            text or a free-text retry reason.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void recover()}
            >
              Recover original note action
            </Button>
            {pending.intent && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void cancelPendingAttempt()}
              >
                Cancel undispatched note attempt
              </Button>
            )}
            {pending.intent ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void resolvePending(false)}
              >
                Retry original note intent
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void resolvePending(true)}
              >
                Cancel unconfirmed source reservation
              </Button>
            )}
          </div>
        </section>
      )}
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <legend className="font-medium">New note source</legend>
        <Label htmlFor={`${prefix}-template`}>Approved template</Label>
        <select
          id={`${prefix}-template`}
          className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background p-2"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Choose a practice-approved template</option>
          {templates.map((root) => (
            <option key={root.id} value={root.id}>
              {root.approved!.definition.name} · v{root.approved!.version}
            </option>
          ))}
        </select>
        <Label htmlFor={`${prefix}-kind`}>Source type</Label>
        <select
          id={`${prefix}-kind`}
          className="min-h-11 w-full rounded-md border border-input bg-background p-2"
          value={sourceKind}
          onChange={(e) => {
            setSourceKind(e.target.value as "typed" | "audio_transcript");
            setAuthorized(false);
          }}
        >
          <option value="typed">Typed observations</option>
          <option value="audio_transcript">
            Completed dictation transcript
          </option>
        </select>
        {sourceKind === "typed" ? (
          <>
            <Label htmlFor={`${prefix}-source`}>Typed observations</Label>
            <Textarea
              id={`${prefix}-source`}
              rows={6}
              maxLength={60000}
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Enter observed findings, reported history and plans. State uncertainty and anything not examined explicitly."
            />
          </>
        ) : (
          <>
            <Label htmlFor={`${prefix}-audio`}>
              Your completed transcript for this encounter
            </Label>
            <select
              id={`${prefix}-audio`}
              className="min-h-11 w-full rounded-md border border-input bg-background p-2"
              value={audioId}
              onChange={(e) => {
                setAudioId(e.target.value);
                setAuthorized(false);
              }}
            >
              <option value="">Choose the exact completed transcript</option>
              {audioJobs.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.created_at).toLocaleString()} ·{" "}
                  {item.source_note}
                </option>
              ))}
            </select>
            {audio.isError && (
              <p role="alert">Completed transcripts are unavailable.</p>
            )}
            {!audioJobs.length && (
              <p className="text-sm text-muted-foreground">
                Complete an authorized recording and transcription above first.
                This adapter preserves the separate recording policy gate.
              </p>
            )}
            {audioJobs.find((item) => item.id === audioId) && (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 font-sans text-sm">
                {audioJobs.find((item) => item.id === audioId)!.transcript}
              </pre>
            )}
          </>
        )}
        <Label htmlFor={`${prefix}-authorization`}>Source and permission</Label>
        <Textarea
          id={`${prefix}-authorization`}
          value={sourceNote}
          maxLength={1000}
          onChange={(e) => setSourceNote(e.target.value)}
          placeholder="Describe the source and permission to use it."
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          I verified this source belongs to this patient and is authorized for
          clinical processing.
        </label>
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={!selected || !authorized || !policyApproved}
          onClick={() => void reserve()}
        >
          Save source for template generation
        </Button>
        <p className="text-xs text-muted-foreground">
          Saving retains the source privately. It does not contact the model or
          change the encounter.
        </p>
      </fieldset>
      {selected?.approved && (
        <TemplatePreview definition={selected.approved.definition} />
      )}
      <div className="flex flex-wrap gap-2">
        {data.data?.jobs
          .filter((item) => item.actor_id === actor)
          .map((item) => (
            <Button
              key={item.id}
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal text-left"
              disabled={busy || !!pending}
              onClick={() => void selectJob(item.id)}
            >
              {new Date(item.created_at).toLocaleString()} ·{" "}
              {item.source_kind === "typed" ? "Typed note" : "Transcript note"}{" "}
              ·{" "}
              {item.proposal_id
                ? "Awaiting proposal review"
                : (item.attempts[0]?.state ?? "Source saved")}
            </Button>
          ))}
      </div>
      {job && (
        <section
          aria-label="Saved template note source"
          className="min-w-0 space-y-3 border-t border-border pt-3"
        >
          <h4 className="font-medium">Pinned source and generation history</h4>
          <p className="break-words text-sm">
            {job.template.definition.name} · template v{job.template.version} ·{" "}
            {job.template.status} ·{" "}
            {job.job.source_kind === "typed"
              ? "Typed observations"
              : "Completed dictation transcript"}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            Template SHA256: {job.job.template_hash} · Source SHA256:{" "}
            {job.job.source_sha256}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">
            {job.job.source_note}
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 font-sans text-sm">
            {job.job.source_text}
          </pre>
          <TemplatePreview definition={job.template.definition} />
          {job.job.attempts.map((item) => (
            <p key={item.id} className="break-words text-sm">
              {new Date(item.created_at).toLocaleString()} · {item.model} ·{" "}
              {item.state}
              {item.error_code ? ` · ${item.error_code}` : ""}
            </p>
          ))}
          {job.job.proposal_id ? (
            <p className="text-sm">
              Review this generated proposal in Dictation drafts below. Accept
              only the sections you have checked against the source.
            </p>
          ) : (
            <fieldset disabled={disabled || !canGenerate} className="space-y-3">
              <legend className="font-medium">Explicit generation</legend>
              {attempt && (
                <>
                  <Label htmlFor={`${prefix}-retry`}>
                    Reason for a new attempt
                  </Label>
                  <select
                    id={`${prefix}-retry`}
                    className="min-h-11 w-full rounded-md border border-input bg-background p-2"
                    value={reason}
                    onChange={(e) =>
                      setReason(
                        e.target.value
                          ? retryReasonSchema.parse(e.target.value)
                          : "",
                      )
                    }
                  >
                    <option value="">Choose the processing reason</option>
                    {Object.entries(retryReasons).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ackCost}
                  onChange={(e) => setAckCost(e.target.checked)}
                />
                I authorize this source to be sent to OpenAI and understand this
                attempt may incur a charge.
              </label>
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                disabled={!ackCost || (!!attempt && !reason.trim())}
                onClick={() => void generate()}
              >
                {attempt
                  ? "Start explicitly authorized new attempt"
                  : "Generate template proposal"}
              </Button>
            </fieldset>
          )}
          <Button
            variant="outline"
            disabled={busy || !!pending}
            onClick={() => void selectJob(job.job.id)}
          >
            Reload saved note and attempt state
          </Button>
          {!canGenerate && !job.job.proposal_id && (
            <p role="status" className="text-sm">
              Generation is unavailable while an attempt is active, approvals
              have changed, or this encounter version is no longer current.
              Reload the saved state before deciding the next action.
            </p>
          )}
        </section>
      )}
      <TemplateEditor
        actor={actor}
        canManage={canManage}
        blocked={blocked || busy || !!pending || localDirty}
        onDirtyChange={setEditorDirty}
        onBusyChange={setEditorBusy}
      />
    </section>
  );
}
