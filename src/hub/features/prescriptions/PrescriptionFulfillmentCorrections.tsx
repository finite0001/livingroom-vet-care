import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { PrescriptionRpc } from "./prescription-api";
import type { NativeDispense } from "./fulfillment-api";
import {
  createFulfillmentCorrectionsApi,
  correctionEqual,
  correctionRequestSchema,
  type CorrectionEvent,
  type CorrectionPreview,
  type CorrectionRequest,
} from "./fulfillment-corrections-api";
import { usePrescriptionOperation } from "./usePrescriptionOperation";
interface Props {
  actor: string;
  evidenceRevision: number;
  dispense: NativeDispense;
  medicationName: string;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onConfirmed: () => void;
  onClose: () => void;
}
export function PrescriptionFulfillmentCorrections(props: Props) {
  return (
    <CorrectionWorkspace
      key={`${props.actor}:${props.dispense.pet_id}:${props.dispense.id}`}
      {...props}
    />
  );
}
function CorrectionWorkspace({
  actor,
  evidenceRevision,
  dispense,
  medicationName,
  disabled,
  onDirtyChange,
  onConfirmed,
  onClose,
}: Props) {
  const target = useMemo(
    () => ({
      authorization_id: dispense.authorization_id,
      pet_id: dispense.pet_id,
      dispense_id: dispense.id,
    }),
    [dispense],
  );
  const api = useMemo(
    () =>
      createFulfillmentCorrectionsApi(
        supabase as unknown as PrescriptionRpc,
        actor,
        target,
      ),
    [actor, target],
  );
  const alive = useRef(true);
  const attemptedRevision = useRef(-1);
  const [observedRevision, setObservedRevision] = useState(-1);
  const [events, setEvents] = useState<CorrectionEvent[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [loaded, setLoaded] = useState(false);
  const [current, setCurrent] =
    useState<Awaited<ReturnType<typeof api.read>>>(null);
  const [kind, setKind] = useState<CorrectionRequest["kind"]>(
      "operational_annotation",
    ),
    [reason, setReason] = useState(""),
    [note, setNote] = useState(""),
    [amends, setAmends] = useState("");
  const [disposition, setDisposition] = useState<
      "recorded_in_error" | "corrected_handoff"
    >("recorded_in_error"),
    [name, setName] = useState(""),
    [relationship, setRelationship] = useState(""),
    [time, setTime] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<CorrectionPreview | null>(null),
    [ack, setAck] = useState(false);
  const operation = usePrescriptionOperation({
    actor,
    patientId: dispense.pet_id,
    execute: api.execute,
    recover: api.recover,
    onConfirmed: () => {
      setPreview(null);
      setAck(false);
      setReason("");
      setNote("");
      setAmends("");
      setName("");
      setRelationship("");
      setTime("");
      onConfirmed();
      void load();
    },
  });
  const dirty =
    !!reason || !!note || !!name || !!relationship || !!time || operation.dirty;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirtyChange(false);
    };
    // This keyed instance owns the initial read; editor changes must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  useEffect(() => {
    if (
      !dirty &&
      !busy &&
      observedRevision !== evidenceRevision &&
      attemptedRevision.current !== evidenceRevision
    ) {
      attemptedRevision.current = evidenceRevision;
      void load();
    }
    // Refresh only clean evidence; never replace an uncertain correction request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, observedRevision, evidenceRevision]);
  async function load(more = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const [r, page] = await Promise.all([
        api.read(),
        api.history(more ? cursor : null),
      ]);
      if (!alive.current) return;
      if (!r || !page)
        throw new Error("This exact dispense could not be read.");
      if (
        !correctionEqual(r.context.head, page.head) ||
        (more && current && !correctionEqual(current.context.head, page.head))
      )
        throw new Error(
          "Correction history changed while loading. Refresh its current evidence before continuing through history.",
        );
      setCurrent(r);
      setObservedRevision(evidenceRevision);
      setEvents((old) => (more ? [...old, ...page.events] : page.events));
      setCursor(page.next_before_version);
      setLoaded(true);
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Correction history could not be loaded.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function review() {
    setBusy(true);
    setError("");
    setAck(false);
    try {
      const p = await api.preview();
      if (!alive.current) return;
      if (
        p.context.dispense_artifact_hash !== dispense.artifact_hash ||
        p.context.authorization_hash !== dispense.authorization_hash ||
        p.context.dispensed_at !== dispense.dispensed_at
      )
        throw new Error(
          "Reviewed correction target differs from the selected immutable dispense.",
        );
      const pickup = p.context.original_pickup;
      if (kind === "pickup_amendment" && !pickup)
        throw new Error(
          "An original pickup is required before amending its acknowledgment.",
        );
      const handoffTime = time ? new Date(time).toISOString() : "";
      if (
        kind === "pickup_amendment" &&
        disposition === "corrected_handoff" &&
        (!handoffTime ||
          Date.parse(handoffTime) < Date.parse(p.context.dispensed_at) ||
          Date.parse(handoffTime) > Date.parse(p.observed_at))
      )
        throw new Error(
          "Enter an actual handoff time between dispensing and this review.",
        );
      const request = correctionRequestSchema.parse({
        ...target,
        kind,
        expected_context_hash: p.context_hash,
        expected_head: p.context.head,
        reason: reason.trim(),
        note: note.trim(),
        amends_event_id:
          kind === "pickup_amendment"
            ? (p.context.latest_pickup_amendment?.event_id ?? null)
            : amends || null,
        pickup_amendment:
          kind === "pickup_amendment"
            ? {
                original_pickup_id: pickup!.id,
                disposition,
                handoff:
                  disposition === "corrected_handoff"
                    ? {
                        picked_up_at: handoffTime,
                        recipient_name: name.trim(),
                        recipient_relationship: relationship.trim(),
                      }
                    : null,
              }
            : null,
        attest_review: true,
      });
      setPreview(p);
      setObservedRevision(evidenceRevision);
      setCurrent({
        version: 1,
        context: p.context,
        context_hash: p.context_hash,
      });
      operation.review({
        id: crypto.randomUUID(),
        kind: "append_correction",
        payload: request,
      });
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "Correction review failed; entered values are retained.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const request = operation.state.operation?.payload as
    | CorrectionRequest
    | undefined;
  const blocked = disabled || busy || operation.dirty;
  return (
    <section
      className="space-y-3 rounded border p-3"
      aria-label="Dispense record corrections"
    >
      <h4 className="font-medium">Original record and later annotations</h4>
      {observedRevision !== evidenceRevision && loaded && (
        <p role="status">
          Correction evidence needs refresh after a saved change. Your draft and
          any original uncertain request are retained.
        </p>
      )}
      <p>
        Original dispense: {dispense.quantity} {dispense.unit} ·{" "}
        {dispense.dispensed_at}
      </p>
      <p>{medicationName}</p>
      <p className="whitespace-pre-wrap">{dispense.reason}</p>
      <p>
        This annotation preserves the original dispense. It does not change
        stock, charges, prescription allowance or refill status.
      </p>
      {current?.context.original_pickup && (
        <p>
          Original pickup: {current.context.original_pickup.recipient_name} (
          {current.context.original_pickup.recipient_relationship}) ·{" "}
          {current.context.original_pickup.picked_up_at}
        </p>
      )}
      {current?.context.latest_pickup_amendment && (
        <p>
          Latest pickup assertion:{" "}
          {current.context.latest_pickup_amendment.value.disposition ===
          "recorded_in_error"
            ? "Original acknowledgment disputed; actual handoff is not established by this amendment."
            : `Corrected handoff attested to ${current.context.latest_pickup_amendment.value.handoff?.recipient_name} at ${current.context.latest_pickup_amendment.value.handoff?.picked_up_at}`}
        </p>
      )}
      {(error || operation.error) && (
        <p role="alert">{error || operation.error}</p>
      )}
      {operation.notice && <p role="status">{operation.notice}</p>}
      <h5 className="font-medium">Later annotations</h5>
      {!loaded ? (
        <p>Correction history has not loaded.</p>
      ) : !events.length ? (
        <p>No annotations recorded.</p>
      ) : (
        events.map((e) => (
          <article className="rounded border p-2" key={e.id}>
            <p>
              {e.kind.replace(/_/g, " ")} · {e.actor.name} (
              {e.actor.authority === "active_dvm" ? "clinician" : "staff"}) ·{" "}
              {e.created_at}
            </p>
            <p className="whitespace-pre-wrap">{e.reason}</p>
            <p className="whitespace-pre-wrap">{e.note}</p>
            {e.pickup_amendment && (
              <p>
                {e.pickup_amendment.disposition === "recorded_in_error"
                  ? "Original acknowledgment disputed; no replacement handoff asserted."
                  : `Corrected handoff: ${e.pickup_amendment.handoff?.recipient_name} (${e.pickup_amendment.handoff?.recipient_relationship}) · ${e.pickup_amendment.handoff?.picked_up_at}`}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Entry {e.sequence} · {e.id}
              {e.amends_event_id && ` · follows ${e.amends_event_id}`}
            </p>
          </article>
        ))
      )}
      <Button
        variant="outline"
        disabled={blocked || dirty}
        onClick={() => void load()}
      >
        Refresh correction history
      </Button>
      {cursor && (
        <Button
          variant="outline"
          disabled={blocked || dirty}
          onClick={() => void load(true)}
        >
          Load earlier annotations
        </Button>
      )}
      <fieldset disabled={blocked || !loaded} className="space-y-3">
        <label className="block">
          Annotation type
          <select
            className="block w-full rounded border bg-background p-2"
            aria-label="Annotation type"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as CorrectionRequest["kind"]);
              setAmends("");
            }}
          >
            <option value="operational_annotation">
              Operational record annotation
            </option>
            <option value="clinical_annotation">
              Clinical annotation — DVM role required
            </option>
            <option
              value="pickup_amendment"
              disabled={!current?.context.original_pickup}
            >
              Amend original pickup acknowledgment
            </option>
          </select>
        </label>
        {kind === "clinical_annotation" && (
          <p>
            Current active DVM authority is checked when saving. This annotation
            does not sign or change a prescription.
          </p>
        )}
        {kind !== "pickup_amendment" && (
          <label className="block">
            Earlier entry to follow up
            <select
              className="block w-full rounded border bg-background p-2"
              aria-label="Earlier entry to follow up"
              value={amends}
              onChange={(e) => setAmends(e.target.value)}
            >
              <option value="">New annotation</option>
              {events
                .filter((e) => e.kind === kind)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    Entry {e.sequence}: {e.reason}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === "pickup_amendment" && (
          <>
            <label className="block">
              Pickup amendment meaning
              <select
                className="block w-full rounded border bg-background p-2"
                aria-label="Pickup amendment meaning"
                value={disposition}
                onChange={(e) =>
                  setDisposition(e.target.value as typeof disposition)
                }
              >
                <option value="recorded_in_error">
                  Original acknowledgment is inaccurate; no replacement handoff
                  asserted
                </option>
                <option value="corrected_handoff">
                  Attest corrected actual handoff facts
                </option>
              </select>
            </label>
            {disposition === "corrected_handoff" && (
              <>
                <label className="block">
                  Corrected recipient name
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block">
                  Corrected recipient relationship
                  <Input
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                  />
                </label>
                <label className="block">
                  Actual handoff time (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone})
                  <Input
                    type="datetime-local"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}
        <label className="block">
          Reason for annotation
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <label className="block">
          Correction note
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p>
          These notes can be included in an explicitly selected client
          medical-record release. Include clinical and record facts suitable for
          sharing with the client.
        </p>
        <Button onClick={() => void review()}>Review record correction</Button>
      </fieldset>
      {operation.state.phase === "review" && preview && request && (
        <section
          aria-label="Frozen correction review"
          className="space-y-2 rounded border p-3"
        >
          <h5>Review proposed {request.kind.replace(/_/g, " ")}</h5>
          <p className="whitespace-pre-wrap">{request.reason}</p>
          <p className="whitespace-pre-wrap">{request.note}</p>
          {request.pickup_amendment && (
            <p>
              {request.pickup_amendment.disposition === "recorded_in_error"
                ? "Dispute original acknowledgment; do not assert a replacement handoff."
                : `Attest actual handoff to ${request.pickup_amendment.handoff?.recipient_name} (${request.pickup_amendment.handoff?.recipient_relationship}) at ${request.pickup_amendment.handoff?.picked_up_at}`}
            </p>
          )}
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={ack}
              disabled={disabled}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed the original record and proposed correction, attest any
            corrected handoff facts, and confirm this reason and note are
            suitable for a selected client medical-record release.
          </label>
          <Button
            disabled={disabled || !ack}
            onClick={() => void operation.commit()}
          >
            Save reviewed correction
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => {
              operation.discard();
              setPreview(null);
              setAck(false);
            }}
          >
            Edit correction
          </Button>
        </section>
      )}
      {operation.locked && (
        <div className="space-y-2">
          <p role="status">
            Preserve the original correction request until its result is
            confirmed.
          </p>
          <Button
            disabled={
              disabled ||
              !["uncertain", "retryable"].includes(operation.state.phase)
            }
            onClick={() => void operation.recoverOriginal()}
          >
            Recover original correction
          </Button>
          {operation.state.phase === "retryable" && (
            <Button disabled={disabled} onClick={() => void operation.commit()}>
              Retry identical correction
            </Button>
          )}
        </div>
      )}
      <Button
        variant="outline"
        disabled={disabled || busy || operation.locked}
        onClick={() => {
          operation.discard();
          onClose();
        }}
      >
        Close annotation panel{dirty ? " and discard draft" : ""}
      </Button>
    </section>
  );
}
