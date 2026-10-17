import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/hub/features/patient-360/model";
import {
  pendingRecapSchema,
  recapSelectionSchema,
  recapReserveSchema,
  recapIntentSchema,
  recapReviewRequestSchema,
  recapDiscoverySchema,
  recapHistorySchema,
  recapPreviewSchema,
  retryReasonSchema,
  retryReasons,
  unresolvedAttempt,
  type JobRead,
  type PendingRecap,
} from "./model";
import {
  readRecapPolicy,
  listRecapSources,
  previewRecap,
  reserveRecap,
  readRecapJob,
  listRecaps,
  cancelRecapReservation,
  cancelRecapAttempt,
  processRecap,
  reviewRecap,
  recoverRecapReview,
  cancelRecapReview,
} from "./api";
import { RecapFeedback } from "./RecapFeedback";
import { recapFeedback } from "./feedback";
import { RecapSourcePreview, RecapCurrentStatus } from "./RecapSourcePreview";
import { RecapReview } from "./RecapReview";
import { RecapPolicy } from "./RecapPolicy";
import { RecapPatientContext } from "./RecapPatientContext";
interface PatientRecapProps {
  petId: string;
  blocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function PatientRecap(props: PatientRecapProps) {
  const { session, hasRole } = useAuth();
  return session ? (
    <RecapSession
      key={`${session.user.id}:${props.petId}`}
      {...props}
      actor={session.user.id}
      canManage={hasRole("ADMIN")}
    />
  ) : null;
}
interface RecapSessionProps extends PatientRecapProps {
  actor: string;
  canManage: boolean;
}
function RecapSession({
  petId,
  blocked,
  onDirtyChange,
  actor,
  canManage,
}: RecapSessionProps) {
  const prefix = useId(),
    cache = useQueryClient(),
    lock = useRef(false),
    active = useRef(true),
    reviewRequest = useRef<z.infer<typeof recapReviewRequestSchema> | null>(
      null,
    );
  const storageKey = `lrv:recap-pending:${actor}:${petId}`;
  const [invalidStorage] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const value = pendingRecapSchema.parse(JSON.parse(raw));
        if (value.actor_id !== actor || value.pet_id !== petId) throw Error();
      }
      return false;
    } catch {
      return true;
    }
  });
  const [pending, setPending] = useState<PendingRecap | null>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const value = raw ? pendingRecapSchema.parse(JSON.parse(raw)) : null;
      return value?.actor_id === actor && value?.pet_id === petId
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sourceCursor, setSourceCursor] =
      useState<z.infer<typeof recapDiscoverySchema>["next"]>(null),
    [historyCursor, setHistoryCursor] =
      useState<z.infer<typeof recapHistorySchema>["next"]>(null),
    [selected, setSelected] = useState<string[]>([]),
    [includeProblems, setIncludeProblems] = useState(false),
    [preview, setPreview] = useState<z.infer<typeof recapPreviewSchema> | null>(
      null,
    ),
    [sourceNote, setSourceNote] = useState(""),
    [authorized, setAuthorized] = useState(false),
    [previous, setPrevious] = useState<string | null>(null);
  const [job, setJob] = useState<JobRead | null>(null),
    [busy, setBusy] = useState(false),
    [reviewDirty, setReviewDirty] = useState(false),
    [policyDirty, setPolicyDirty] = useState(false),
    [policyBusy, setPolicyBusy] = useState(false),
    [ack, setAck] = useState(false),
    [reason, setReason] = useState<z.infer<typeof retryReasonSchema> | "">(""),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(""),
    [formError, setFormError] = useState(""),
    [reviewReset, setReviewReset] = useState(0);
  const policy = useQuery({
    queryKey: ["clinical-recap-policy", actor],
    queryFn: () => readRecapPolicy(actor),
  });
  const discovery = useQuery({
    queryKey: ["clinical-recap-sources", actor, petId, from, to, sourceCursor],
    queryFn: () =>
      listRecapSources(actor, petId, from || null, to || null, sourceCursor),
  });
  const history = useQuery({
    queryKey: ["clinical-recap-history", actor, petId, historyCursor],
    queryFn: () => listRecaps(actor, petId, historyCursor),
  });
  const sourceDirty = !!(
      selected.length ||
      includeProblems ||
      sourceNote ||
      authorized ||
      previous
    ),
    localDirty = sourceDirty || ack || !!reason || reviewDirty;
  const dirty =
    localDirty ||
    !!pending ||
    busy ||
    policyDirty ||
    policyBusy ||
    invalidStorage;
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
  const controlsBlocked =
    blocked || busy || policyDirty || policyBusy || !!pending || invalidStorage;
  const attempt = job?.job.attempts[0];
  const attemptActive = !!attempt && unresolvedAttempt(attempt);
  const sourceBlocked = controlsBlocked || reviewDirty || attemptActive;
  function persist(value: PendingRecap | null) {
    if (value)
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(pendingRecapSchema.parse(value)),
      );
    else sessionStorage.removeItem(storageKey);
    setPending(value);
  }
  function clearAuthorization() {
    setAck(false);
    setReason("");
    setAuthorized(false);
  }
  function clearSource() {
    setSelected([]);
    setIncludeProblems(false);
    setPreview(null);
    setSourceNote("");
    setPrevious(null);
    clearAuthorization();
  }
  async function adopt(value: JobRead) {
    if (value.actor_id !== actor || value.job.pet_id !== petId) throw Error();
    setJob(value);
    await cache.invalidateQueries({
      queryKey: ["clinical-recap-history", actor, petId],
    });
  }
  function startOperation() {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setFormError("");
    setNotice("");
    return true;
  }
  function endOperation() {
    lock.current = false;
    if (active.current) setBusy(false);
  }
  async function load(id: string) {
    if (
      pending ||
      lock.current ||
      (localDirty &&
        !window.confirm("Discard unsaved recap selection or review changes?"))
    )
      return;
    if (!startOperation()) return;
    try {
      const value = await readRecapJob(actor, petId, id);
      if (!active.current) return;
      clearSource();
      setReviewReset((value) => value + 1);
      await adopt(value);
    } catch (failure) {
      setError(failure);
    } finally {
      endOperation();
    }
  }
  async function doPreview() {
    if (sourceBlocked || !startOperation()) return;
    try {
      const selection = recapSelectionSchema.parse({
        encounter_ids: [...selected].sort(),
        include_native_problems: includeProblems,
        visit_from: from || null,
        visit_to: to || null,
      });
      const value = await previewRecap(actor, petId, selection);
      if (active.current) {
        setPreview(value);
        setAuthorized(false);
        setNotice(
          "Exact source preview loaded. Review every selected record and the budget before capture.",
        );
      }
    } catch (failure) {
      setPreview(null);
      setError(failure);
    } finally {
      endOperation();
    }
  }
  async function capture() {
    if (
      !preview ||
      !policy.data ||
      sourceBlocked ||
      policy.data.policy.status !== "approved"
    )
      return;
    const parsed = recapReserveSchema.safeParse({
      pet_id: petId,
      expected_pet_version: preview.source_set.patient.version,
      policy_version: policy.data.policy.version,
      selection: preview.source_set.selection,
      expected_source_fingerprint: preview.source_fingerprint,
      source_note: sourceNote,
      attest_authorized: authorized,
      previous_job_id: previous,
    });
    if (!parsed.success) {
      setFormError(
        "Review the exact source preview, source permission and required authorization before capture.",
      );
      return;
    }
    if (!startOperation()) return;
    const id = crypto.randomUUID();
    try {
      persist({
        kind: "reservation",
        actor_id: actor,
        pet_id: petId,
        job_id: id,
        expected_pet_version: parsed.data.expected_pet_version,
        policy_version: parsed.data.policy_version,
        source_fingerprint: parsed.data.expected_source_fingerprint,
      });
      const value = await reserveRecap(actor, id, parsed.data);
      if (!active.current) return;
      await adopt(value);
      persist(null);
      clearSource();
      setReviewReset((value) => value + 1);
      setNotice(
        "Selected records captured privately. No model request has started. Review the frozen manifest, then authorize generation.",
      );
    } catch (failure) {
      setError(failure);
      if (recapFeedback(failure).refusal.code === "source_changed")
        setPreview(null);
    } finally {
      endOperation();
    }
  }
  async function generate() {
    if (
      !job ||
      job.job.actor_id !== actor ||
      controlsBlocked ||
      sourceDirty ||
      reviewDirty ||
      !ack
    )
      return;
    const latest = job.job.attempts[0];
    if (latest && !reason) {
      setFormError("Choose a fixed processing reason before a new attempt.");
      return;
    }
    const intent = recapIntentSchema.parse({
      job_id: job.job.id,
      attempt_id: crypto.randomUUID(),
      retry_of: latest?.id ?? null,
      reason: latest ? reason : "",
      ack_cost: latest ? ack : false,
    });
    if (!startOperation()) return;
    try {
      persist({
        kind: "attempt",
        actor_id: actor,
        pet_id: petId,
        job_id: job.job.id,
        intent,
      });
      const value = await processRecap(actor, petId, intent);
      if (!active.current) return;
      await adopt(value);
      const saved = value.job.attempts.find(
        (item) => item.id === intent.attempt_id,
      );
      if (saved && !unresolvedAttempt(saved)) {
        persist(null);
        clearAuthorization();
      }
      if (value.output)
        setNotice(
          "Generated recap is ready for claim-by-claim review. No chart text was changed.",
        );
    } catch (failure) {
      setError(failure);
    } finally {
      endOperation();
    }
  }
  async function submitReview(
    request: z.infer<typeof recapReviewRequestSchema>,
  ) {
    if (!job?.output || controlsBlocked || sourceDirty || ack || reason) return;
    const metadata = pendingRecapSchema.parse({
      kind: "review",
      actor_id: actor,
      pet_id: petId,
      job_id: job.job.id,
      action_id: crypto.randomUUID(),
      output_id: job.output.id,
      output_hash: job.output.payload_sha256,
      manifest_hash: job.manifest.sha256,
    });
    if (!startOperation()) return;
    try {
      reviewRequest.current = structuredClone(request);
      persist(metadata);
      await reviewRecap(actor, metadata, reviewRequest.current, job);
      const value = await readRecapJob(actor, petId, job.job.id);
      if (!active.current) return;
      await adopt(value);
      persist(null);
      reviewRequest.current = null;
      clearAuthorization();
      setReviewReset((value) => value + 1);
      setNotice(
        "Internal recap review retained. Clinical records and communications remain unchanged.",
      );
    } catch (failure) {
      setError(failure);
    } finally {
      endOperation();
    }
  }
  async function recover(mode: "read" | "cancel" | "retry") {
    if (!pending || !startOperation()) return;
    const original = pending;
    try {
      if (original.kind === "reservation") {
        if (mode === "cancel") {
          const receipt = await cancelRecapReservation(
            actor,
            petId,
            original.job_id,
          );
          if (receipt.cancelled) {
            persist(null);
            setPreview(null);
            setAuthorized(false);
            setNotice(
              "Unconfirmed capture canceled durably. Its late original request cannot create a job. Selection and permission text remain in this tab for editing.",
            );
            return;
          }
        }
        const value = await readRecapJob(actor, petId, original.job_id);
        if (
          value.job.actor_id !== actor ||
          value.job.policy_version !== original.policy_version ||
          value.manifest.source_set.patient.version !==
            original.expected_pet_version ||
          value.manifest.source_fingerprint !== original.source_fingerprint
        )
          throw Error();
        await adopt(value);
        persist(null);
        clearSource();
        setNotice(
          "Original frozen capture recovered. No new model request was started.",
        );
      } else if (original.kind === "attempt") {
        let cancelled = false;
        if (mode === "cancel") {
          const receipt = await cancelRecapAttempt(
            actor,
            petId,
            original.intent,
          );
          cancelled = receipt.cancelled;
        }
        const value =
          mode === "retry"
            ? await processRecap(actor, petId, original.intent)
            : await readRecapJob(actor, petId, original.job_id);
        await adopt(value);
        const saved = value.job.attempts.find(
          (item) => item.id === original.intent.attempt_id,
        );
        const knownTerminal =
          saved &&
          ["completed", "failed", "uncertain", "superseded"].includes(
            saved.state,
          );
        if (
          cancelled ||
          knownTerminal ||
          (mode !== "cancel" && saved && !unresolvedAttempt(saved))
        ) {
          persist(null);
          clearAuthorization();
          setNotice(
            value.output
              ? "Original completed output recovered. Review its dated claims and frozen citations below."
              : "Original attempt reached a known state. Review its history before another explicitly authorized attempt.",
          );
        } else
          setNotice(
            "The original attempt is unconfirmed or may already have reached the provider. Keep its identity and recover again; no new intent was created.",
          );
      } else {
        let receipt = await recoverRecapReview(
          actor,
          original,
          job?.job.id === original.job_id ? job : undefined,
          reviewRequest.current,
        );
        if (!receipt && mode === "cancel") {
          const cancellation = await cancelRecapReview(
            actor,
            original,
            reviewRequest.current,
          );
          receipt = cancellation.receipt;
          if (cancellation.cancelled) {
            persist(null);
            reviewRequest.current = null;
            setNotice(
              "Unconfirmed review action canceled durably. You may edit again; its late original cannot commit.",
            );
            return;
          }
        }
        if (!receipt && mode === "retry" && reviewRequest.current)
          receipt = await reviewRecap(
            actor,
            original,
            reviewRequest.current,
            job ?? (await readRecapJob(actor, petId, original.job_id)),
          );
        if (receipt) {
          await adopt(await readRecapJob(actor, petId, original.job_id));
          persist(null);
          reviewRequest.current = null;
          clearAuthorization();
          setReviewReset((value) => value + 1);
          setNotice(
            "Original internal review receipt recovered. No duplicate review was created.",
          );
        } else {
          if (!job || job.job.id !== original.job_id)
            await adopt(await readRecapJob(actor, petId, original.job_id));
          setNotice(
            "No committed review receipt was found. Recover or durably cancel the original action before editing. Local review text was not stored in this browser.",
          );
        }
      }
    } catch (failure) {
      setError(failure);
    } finally {
      endOperation();
    }
  }
  async function reloadJob() {
    if (!job || busy || pending || !startOperation()) return;
    try {
      await adopt(await readRecapJob(actor, petId, job.job.id));
      setNotice(
        "Latest saved recap state loaded. Unsaved review wording remains in this tab.",
      );
    } catch (failure) {
      setError(failure);
    } finally {
      endOperation();
    }
  }
  function fresh() {
    if (
      !job ||
      controlsBlocked ||
      (localDirty &&
        !window.confirm(
          "Discard local recap edits before starting a fresh linked capture?",
        ))
    )
      return;
    clearSource();
    setReviewReset((value) => value + 1);
    setPrevious(job.job.id);
    setSelected([...job.manifest.source_set.selection.encounter_ids]);
    setIncludeProblems(
      job.manifest.source_set.selection.include_native_problems,
    );
    setFrom(job.manifest.source_set.selection.visit_from ?? "");
    setTo(job.manifest.source_set.selection.visit_to ?? "");
    setSourceCursor(null);
    setNotice(
      "Choose and preview sources for a new linked recap. Prior output and reviews remain immutable.",
    );
  }
  const canGenerate =
    !!job &&
    !job.output &&
    job.job.actor_id === actor &&
    job.current.source_status === "current" &&
    job.policy.status === "approved" &&
    job.policy.version === job.job.policy_version &&
    !attemptActive &&
    (!attempt ||
      ["failed", "uncertain", "claimed", "sending"].includes(attempt.state));
  return (
    <section
      aria-label="Records recap"
      className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4 shadow-card"
    >
      <h2 className="font-display text-xl">Records recap</h2>
      <p className="text-sm text-muted-foreground">
        A dated, source-cited summary of selected native records for internal
        review. It does not update the clinical chart, sign a record, or send
        anything. Historical archived and deceased patient records remain
        eligible when authorized.
      </p>
      <RecapFeedback error={error} />
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {busy && <p role="status">Confirming recap action…</p>}
      {invalidStorage && (
        <p role="alert" className="text-sm text-destructive">
          Stored recap recovery identifiers could not be validated. Editing
          remains blocked until the original pending state is resolved.
        </p>
      )}
      {blocked && (
        <p role="status" className="text-sm">
          Finish other unsaved patient work before changing recap sources or
          reviews.
        </p>
      )}
      {policy.isPending && (
        <p role="status">Loading independent recap policy…</p>
      )}
      {policy.isError && (
        <div>
          <RecapFeedback error={policy.error} />
          <Button variant="outline" onClick={() => void policy.refetch()}>
            Retry recap policy
          </Button>
        </div>
      )}
      {policy.data?.policy.status === "draft" && (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          Practice approval is pending. You may inspect native sources and
          existing recaps; capture and generation stay off until the independent
          recap policy is approved and processing is activated.
        </p>
      )}
      {pending && (
        <section
          aria-label="Unconfirmed recap action"
          className="space-y-3 rounded-md border border-border p-3"
        >
          <p className="text-sm">
            Resolve the original {pending.kind} before editing or starting
            another action. Recovery stores identifiers, pinned hashes and fixed
            processing choices only; no source or free-text review content is
            stored.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={busy}
              onClick={() => void recover("read")}
            >
              Recover original recap action
            </Button>
            {pending.kind === "attempt" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void recover("retry")}
              >
                Retry original recap intent
              </Button>
            )}
            {pending.kind === "review" && reviewRequest.current && (
              <Button disabled={busy} onClick={() => void recover("retry")}>
                Retry exact recap review
              </Button>
            )}
            <Button
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={busy}
              onClick={() => void recover("cancel")}
            >
              {pending.kind === "reservation"
                ? "Cancel unconfirmed recap capture"
                : pending.kind === "attempt"
                  ? "Cancel undispatched recap attempt"
                  : "Cancel unconfirmed recap review"}
            </Button>
          </div>
        </section>
      )}
      <section
        aria-label="Recap source selection"
        className="min-w-0 space-y-3"
      >
        <h3 className="font-semibold">Choose native historical sources</h3>
        <fieldset disabled={sourceBlocked} className="min-w-0 space-y-3">
          <legend className="sr-only">Select recap sources</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${prefix}-from`}>Visit date from (Denver)</Label>
              <Input
                id={`${prefix}-from`}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setSourceCursor(null);
                  setPreview(null);
                  setAuthorized(false);
                }}
              />
            </div>
            <div>
              <Label htmlFor={`${prefix}-to`}>
                Visit date through (Denver)
              </Label>
              <Input
                id={`${prefix}-to`}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setSourceCursor(null);
                  setPreview(null);
                  setAuthorized(false);
                }}
              />
            </div>
          </div>
          {discovery.isPending && (
            <p role="status">Loading signed encounters…</p>
          )}
          {discovery.isError && (
            <div>
              <RecapFeedback error={discovery.error} />
              <Button
                variant="outline"
                onClick={() => void discovery.refetch()}
              >
                Retry source discovery
              </Button>
            </div>
          )}
          {discovery.data?.encounters.map((row) => (
            <label
              key={row.id}
              className="flex min-h-11 items-start gap-2 rounded-md border border-border p-3 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1"
                disabled={!selected.includes(row.id) && selected.length >= 20}
                checked={selected.includes(row.id)}
                onChange={(e) => {
                  setSelected(
                    e.target.checked
                      ? [...selected, row.id]
                      : selected.filter((id) => id !== row.id),
                  );
                  setPreview(null);
                  setAuthorized(false);
                }}
              />
              <span className="min-w-0 break-words">
                Visit {formatDateTime(row.visit_at)} · signed{" "}
                {formatDateTime(row.signed_at)} (Denver) · v{row.version} ·{" "}
                {row.addendum_count} addenda
              </span>
            </label>
          ))}
          {discovery.data?.encounters.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No signed encounters in this discovery range.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {sourceCursor && (
              <Button variant="outline" onClick={() => setSourceCursor(null)}>
                Latest signed encounters
              </Button>
            )}
            {discovery.data?.has_more && (
              <Button
                variant="outline"
                onClick={() => setSourceCursor(discovery.data!.next)}
              >
                Earlier signed encounters
              </Button>
            )}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeProblems}
              onChange={(e) => {
                setIncludeProblems(e.target.checked);
                setPreview(null);
                setAuthorized(false);
              }}
            />
            Include eligible native problem-list records (
            {discovery.data?.native_problem_count ?? "loading"})
          </label>
          <p className="text-xs text-muted-foreground">
            Outside-linked problem rows excluded:{" "}
            {discovery.data?.outside_linked_problem_count ?? "loading"}.
            Includes all eligible native active and resolved records as of
            capture, not confirmed current diagnoses.
          </p>
          {selected.length > 0 && (
            <details className="min-w-0 rounded-md border border-border p-3">
              <summary className="min-h-11 cursor-pointer text-sm">
                Selected encounters across pages ({selected.length}/20)
              </summary>
              <p className="text-xs text-muted-foreground">
                Changing a date range does not silently discard selected
                records. Remove any selection outside the new range before
                preview.
              </p>
              {selected.map((id) => (
                <div
                  key={id}
                  className="flex min-w-0 flex-wrap items-center gap-2"
                >
                  <span className="min-w-0 break-all text-xs">{id}</span>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelected(selected.filter((item) => item !== id));
                      setPreview(null);
                      setAuthorized(false);
                    }}
                  >
                    Remove selected encounter {id.slice(0, 8)}
                  </Button>
                </div>
              ))}
            </details>
          )}
          <Button
            className="h-auto min-h-11 max-w-full whitespace-normal"
            disabled={
              (!selected.length && !includeProblems) || discovery.isError
            }
            onClick={() => void doPreview()}
          >
            Preview selected recap sources
          </Button>
          {sourceDirty && (
            <Button
              variant="ghost"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard this unsaved recap selection and permission text?",
                  )
                )
                  clearSource();
              }}
            >
              Discard local recap selection
            </Button>
          )}
        </fieldset>
      </section>
      {preview && (
        <section className="min-w-0 space-y-3 border-t border-border pt-4">
          <RecapSourcePreview sourceSet={preview.source_set} />
          <details className="min-w-0 rounded-md border border-border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              Source audit details
            </summary>
            <p className="break-all text-xs text-muted-foreground">
              Current source fingerprint: {preview.source_fingerprint}
            </p>
          </details>
          <fieldset disabled={sourceBlocked} className="space-y-3">
            <legend className="font-medium">
              Capture this exact selection
            </legend>
            <Label htmlFor={`${prefix}-permission`}>
              Recap source and permission
            </Label>
            <Textarea
              id={`${prefix}-permission`}
              rows={3}
              maxLength={1000}
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
            />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(e) => setAuthorized(e.target.checked)}
              />
              I verified the patient, selected records and permission for recap
              processing.
            </label>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={
                !authorized ||
                !sourceNote.trim() ||
                policy.data?.policy.status !== "approved"
              }
              onClick={() => void capture()}
            >
              Capture selected records for recap
            </Button>
            <p className="text-xs text-muted-foreground">
              Capture retains a private immutable source manifest. It does not
              contact a model.
            </p>
          </fieldset>
        </section>
      )}
      <section
        aria-label="Recap history"
        className="min-w-0 space-y-3 border-t border-border pt-4"
      >
        <h3 className="font-semibold">Internal recap history</h3>
        {history.isPending && <p role="status">Loading recap history…</p>}
        {history.isError && (
          <div>
            <RecapFeedback error={history.error} />
            <Button variant="outline" onClick={() => void history.refetch()}>
              Retry recap history
            </Button>
          </div>
        )}
        {history.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No records recaps retained for this patient.
          </p>
        )}
        {history.data?.items.map((item) => (
          <div key={item.id} className="min-w-0 space-y-2">
            <Button
              variant={job?.job.id === item.id ? "secondary" : "outline"}
              className="h-auto min-h-11 max-w-full whitespace-normal text-left"
              disabled={busy || !!pending || policyBusy}
              onClick={() => void load(item.id)}
            >
              Captured {formatDateTime(item.captured_at)} (Denver) ·{" "}
              {item.budgets.encounters} visits ·{" "}
              {item.review_decision ??
                item.latest_attempt?.state ??
                "Source captured"}
            </Button>
            <details className="min-w-0 rounded-md border border-border p-3">
              <summary className="min-h-11 cursor-pointer text-sm font-medium">
                Recap audit details
              </summary>
              <p className="break-all text-xs text-muted-foreground">
                Job {item.id} · operator {item.actor_id} · exact capture time{" "}
                {item.captured_at} · created {item.created_at} · manifest{" "}
                {item.manifest_id} · SHA256 {item.manifest_sha256}
              </p>
            </details>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {historyCursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setHistoryCursor(null)}
            >
              Latest recaps
            </Button>
          )}
          {history.data?.has_more && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setHistoryCursor(history.data!.next)}
            >
              Earlier recaps
            </Button>
          )}
        </div>
      </section>
      {job && (
        <section
          aria-label="Saved records recap"
          className="min-w-0 space-y-4 border-t border-border pt-4"
        >
          <h3 className="font-semibold">Frozen recap job</h3>
          <RecapPatientContext
            patient={job.manifest.source_set.patient}
            capturedAt={job.manifest.captured_at}
          />
          <p className="whitespace-pre-wrap break-words text-sm">
            Source and permission: {job.job.source_note}
          </p>
          <RecapCurrentStatus current={job.current} />
          <details className="min-w-0 rounded-md border border-border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-medium">
              Recap audit details
            </summary>
            <p className="break-all text-xs text-muted-foreground">
              Job {job.job.id} · manifest {job.manifest.sha256} · captured
              policy v{job.job.policy_version} · operator {job.job.actor_id} ·
              exact capture time {job.manifest.captured_at}
            </p>
          </details>
          <details className="min-w-0 rounded-md border border-border p-3">
            <summary className="min-h-11 cursor-pointer font-medium">
              Review frozen source manifest
            </summary>
            <RecapSourcePreview
              sourceSet={job.manifest.source_set}
              capturedAt={job.manifest.captured_at}
            />
          </details>
          <section aria-label="Recap attempt history" className="space-y-2">
            <h4 className="font-medium">Generation attempts</h4>
            {job.job.attempts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No model attempt has started.
              </p>
            )}
            {job.job.attempts.map((item) => (
              <div key={item.id} className="min-w-0 space-y-1">
                <p className="break-words text-sm">
                  {formatDateTime(item.created_at)} (Denver) · {item.state}
                </p>
                <details className="min-w-0 rounded-md border border-border p-3">
                  <summary className="min-h-11 cursor-pointer text-sm font-medium">
                    Recap audit details
                  </summary>
                  <p className="break-all text-xs text-muted-foreground">
                    Attempt {item.id} · exact time {item.created_at} · model{" "}
                    {item.model} · state {item.state}
                    {item.error_code ? ` · error code ${item.error_code}` : ""}
                  </p>
                </details>
              </div>
            ))}
          </section>
          {job.job.actor_id !== actor && (
            <p className="text-sm">
              You may read and review this recap. New provider attempts belong
              to its original operator.
            </p>
          )}
          {!job.output && (
            <fieldset
              disabled={
                controlsBlocked || sourceDirty || reviewDirty || !canGenerate
              }
              className="space-y-3"
            >
              <legend className="font-medium">Explicit recap generation</legend>
              {attempt && (
                <>
                  <Label htmlFor={`${prefix}-reason`}>Recap retry reason</Label>
                  <select
                    id={`${prefix}-reason`}
                    className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background p-2"
                    value={reason}
                    onChange={(e) =>
                      setReason(
                        e.target.value
                          ? retryReasonSchema.parse(e.target.value)
                          : "",
                      )
                    }
                  >
                    <option value="">Choose a fixed processing reason</option>
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
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I authorize sending this frozen record selection to OpenAI and
                understand this attempt may incur a charge.
              </label>
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                disabled={!ack || (!!attempt && !reason)}
                onClick={() => void generate()}
              >
                {attempt
                  ? "Start authorized new recap attempt"
                  : "Generate records recap"}
              </Button>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={busy || !!pending}
              onClick={() => void reloadJob()}
            >
              Reload saved recap state
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={controlsBlocked || attemptActive}
              onClick={fresh}
            >
              Start a fresh linked recap
            </Button>
          </div>
          {!job.output && !canGenerate && (
            <p role="status" className="text-sm">
              Generation is unavailable while sources or policy differ, an
              attempt is active, or this job belongs to another operator. Reload
              the saved state before deciding the next action.
            </p>
          )}
          {job.output && (
            <RecapReview
              key={`${job.output.id}:${reviewReset}`}
              actor={actor}
              job={job}
              blocked={controlsBlocked || sourceDirty || ack || !!reason}
              onDirtyChange={setReviewDirty}
              onSubmit={(request) => void submitReview(request)}
            />
          )}
        </section>
      )}
      {policy.data && (
        <RecapPolicy
          actor={actor}
          policy={policy.data.policy}
          canManage={canManage}
          blocked={blocked || busy || !!pending || localDirty}
          onDirtyChange={setPolicyDirty}
          onBusyChange={setPolicyBusy}
        />
      )}
    </section>
  );
}
