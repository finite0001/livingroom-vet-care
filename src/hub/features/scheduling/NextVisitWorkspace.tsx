import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { patientHref, scheduleHref } from "@/hub/features/patient-360/model";
import { NextVisitDraftGuard } from "./NextVisitDraftGuard";
import {
  pendingNextVisits,
  nextVisitContext,
  nextVisitFutureAppointments,
  nextVisitDueCare,
  nextVisitOutcomeRequest,
} from "./next-visit-api";
import {
  patientNextVisits,
  readNextVisitReview,
  executeNextVisitReview,
  cancelNextVisitReview,
} from "./next-visit-review-api";
import {
  editorCompletionReceiptSchema,
  readReviewMetadata,
  forgetReview,
  type ReviewMetadata,
  type NextVisitReview,
} from "./next-visit-review-model";
import {
  useNextVisitReview,
  reviewChangeEvent,
  type ReviewReceipt,
} from "./use-next-visit-review";
import { reviewedActionError } from "./use-reviewed-action";
import { AppointmentEditor } from "./AppointmentEditor";
import { denverLocal, formatDenverDayLabel, formatDenverTime } from "./time";
import {
  nextVisitCompletionReceiptSchema,
  nextVisitContextSchema,
  type NextVisitContext,
  type nextVisitCursorSchema,
  type dueCareCursorSchema,
} from "./next-visit-model";
import type { z } from "zod";
interface WorkspaceProps {
  context: NextVisitContext | null;
  onContext: (context: NextVisitContext | null) => void;
  patientId?: string;
  onDirtyChange?: (dirty: boolean) => void;
}
function receiptContext(receipt: ReviewReceipt): NextVisitContext | null {
  const editor = editorCompletionReceiptSchema.safeParse(receipt);
  if (editor.success) return editor.data.context;
  const completed = nextVisitCompletionReceiptSchema.safeParse(receipt);
  return completed.success
    ? completed.data.context
    : nextVisitContextSchema.parse(receipt);
}
function nextVisitDate(instant: string) {
  const day = denverLocal(instant).slice(0, 10);
  return `${formatDenverDayLabel(day)}, ${day.slice(0, 4)}`;
}
function outcomeLabel(context: NextVisitContext) {
  return context.decision?.kind === "booked"
    ? "Next visit recorded"
    : context.decision?.kind === "declined"
      ? "Client declined"
      : context.decision?.kind === "later"
        ? "Schedule later"
        : "Next visit pending";
}
function useRefreshNextVisits() {
  const cache = useQueryClient();
  return () => {
    void cache.invalidateQueries({ queryKey: ["next-visits"] });
    void cache.invalidateQueries({ queryKey: ["schedule"] });
    void cache.invalidateQueries({ queryKey: ["hub-today"] });
  };
}
export function NextVisitWorkspace(props: WorkspaceProps) {
  const { onContext } = props;
  const { session } = useAuth(),
    actor = session?.user.id ?? "",
    previous = useRef(actor);
  const sameActor = previous.current === actor;
  useEffect(() => {
    if (previous.current !== actor) {
      previous.current = actor;
      onContext(null);
    }
  }, [actor, onContext]);
  return actor ? (
    <ActorWorkspace
      key={actor}
      {...props}
      context={sameActor ? props.context : null}
      actor={actor}
    />
  ) : null;
}
function ActorWorkspace({
  context,
  onContext,
  patientId,
  actor,
  onDirtyChange,
}: WorkspaceProps & { actor: string }) {
  const [booking, setBooking] = useState(false),
    refresh = useRefreshNextVisits();
  const open = (value: NextVisitContext) => {
    setBooking(false);
    onContext(value);
  };
  return (
    <>
      {!patientId && <ReviewRecovery actor={actor} onOpen={open} />}
      <PendingNextVisitOutcomes
        actor={actor}
        patientId={patientId}
        onOpen={open}
      />
      {context && !booking && (
        <NextVisitOutcomeDialog
          key={context.occurrence.id + ":" + context.version}
          onDirtyChange={onDirtyChange}
          initial={context}
          actor={actor}
          close={() => onContext(null)}
          onSaved={(value) => {
            refresh();
            open(value);
          }}
          onBook={() => setBooking(true)}
        />
      )}
      {context && booking && (
        <AppointmentEditor
          key={context.occurrence.id}
          appointment={null}
          initialDay=""
          onDirtyChange={onDirtyChange}
          followup={context}
          onOutcome={(value) => {
            refresh();
            open(value);
          }}
          close={() => setBooking(false)}
        />
      )}
    </>
  );
}
interface QueueProps {
  actor: string;
  patientId?: string;
  onOpen: (value: NextVisitContext) => void;
}
export function PendingNextVisitOutcomes({
  actor,
  patientId,
  onOpen,
}: QueueProps) {
  const queue = useInfiniteQuery({
    queryKey: ["next-visits", "queue", actor, patientId ?? "pending"],
    initialPageParam: null as z.infer<typeof nextVisitCursorSchema> | null,
    queryFn: ({ pageParam }) =>
      patientId
        ? patientNextVisits(patientId, pageParam)
        : pendingNextVisits(pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 30000,
  });
  const rows = queue.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section
      aria-label={patientId ? "Next visit decisions" : "Pending next visits"}
      className="space-y-3 rounded-2xl border bg-card p-4 shadow-card"
    >
      <h2 className="font-display text-xl">
        {patientId ? "Next visit decisions" : "Pending next visits"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {patientId
          ? "Recorded completion and follow-up history."
          : "Completed visits awaiting follow-up review, across all calendar dates."}
      </p>
      {queue.isPending ? (
        <p role="status">Loading next visits…</p>
      ) : queue.isError ? (
        <p role="alert">
          Next visits unavailable.{" "}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => void queue.refetch()}
          >
            Retry next visits
          </Button>
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {patientId
            ? "No next-visit decisions recorded."
            : "No completed visits awaiting review."}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li
              key={row.occurrence.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold break-words">
                  {row.patient_name} · {row.client_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {outcomeLabel(row)}
                  {row.decision?.followup_on
                    ? ` · Staff review ${row.decision.followup_on}`
                    : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Completed{" "}
                  {nextVisitDate(row.occurrence.snapshot.scheduled_at)}
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => onOpen(row)}
              >
                Review next visit
              </Button>
            </li>
          ))}
        </ul>
      )}
      {queue.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          Load more next visits
        </Button>
      )}
    </section>
  );
}
function ReviewRecovery({
  actor,
  onOpen,
}: {
  actor: string;
  onOpen: (value: NextVisitContext) => void;
}) {
  const [items, setItems] = useState<ReviewMetadata[]>([]),
    [storageError, setStorageError] = useState("");
  useEffect(() => {
    const update = () => {
      try {
        setItems(readReviewMetadata(localStorage, actor));
        setStorageError("");
      } catch {
        setItems([]);
        setStorageError(
          "Stored next-visit reviews could not load. No new booking has been submitted.",
        );
      }
    };
    update();
    window.addEventListener(reviewChangeEvent, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(reviewChangeEvent, update);
      window.removeEventListener("storage", update);
    };
  }, [actor]);
  if (!items.length && !storageError) return null;
  return (
    <section
      aria-label="Unconfirmed next visit reviews"
      className="space-y-3 rounded-2xl border border-warning bg-card p-4"
    >
      <h2 className="font-display text-xl">Unconfirmed next visit reviews</h2>
      <p className="text-sm">
        Check these saved review identifiers before submitting new work. Reload
        keeps the exact server review.
      </p>
      {storageError && <p role="alert">{storageError}</p>}
      {items.map((meta) => (
        <RecoveryRow key={meta.id} meta={meta} onOpen={onOpen} />
      ))}
    </section>
  );
}
function RecoveryRow({
  meta,
  onOpen,
}: {
  meta: ReviewMetadata;
  onOpen: (value: NextVisitContext) => void;
}) {
  const [review, setReview] = useState<NextVisitReview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = useRefreshNextVisits();
  async function run(action: "check" | "retry" | "release") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (data.session?.user.id !== meta.actor_id) throw { code: "42501" };
      const result = await readNextVisitReview(meta);
      setReview(result);
      let receipt = result?.receipt ?? null;
      if (!receipt && action === "retry")
        receipt = await executeNextVisitReview(meta);
      if (!receipt && action === "release")
        receipt = await cancelNextVisitReview(meta);
      const current = await supabase.auth.getSession();
      if (current.error) throw current.error;
      if (current.data.session?.user.id !== meta.actor_id)
        throw { code: "42501" };
      if (receipt || action === "release") {
        forgetReview(localStorage, meta);
        window.dispatchEvent(new Event(reviewChangeEvent));
        refresh();
        if (receipt) {
          const restored = receiptContext(receipt);
          if (restored) onOpen(restored);
        }
      } else if (!result)
        setError(
          "No prepared review is confirmed yet. Check again, or check and release this identifier to stop any pending preparation.",
        );
    } catch (cause) {
      setError(reviewedActionError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-sm font-semibold">
        {meta.operation === "decide" ? "Follow-up decision" : "Completion"} ·{" "}
        {review?.state ?? "Needs checking"}
      </p>
      <p className="text-sm break-words">
        {review?.operation === "decide"
          ? `Reviewed action: ${review.request.values.action}${review.request.values.note ? ` · ${review.request.values.note}` : ""}`
          : "Exact reviewed work stays on the server."}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => void run("check")}
        >
          Check saved review
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={busy || !review || review.state !== "prepared"}
          onClick={() => void run("retry")}
        >
          Retry exact server review
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={busy}
          onClick={() => void run("release")}
        >
          Check and release review
        </Button>
      </div>
    </div>
  );
}
interface OutcomeDialogProps {
  initial: NextVisitContext;
  actor: string;
  close: () => void;
  onSaved: (value: NextVisitContext) => void;
  onBook: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}
export function NextVisitOutcomeDialog({
  initial,
  actor,
  close,
  onSaved,
  onBook,
  onDirtyChange,
}: OutcomeDialogProps) {
  const context = useQuery({
    queryKey: ["next-visits", "context", actor, initial.occurrence.id],
    queryFn: () => nextVisitContext(initial.occurrence.id),
    initialData: initial,
  });
  const row = context.data,
    [choice, setChoice] = useState<"later" | "declined" | null>(null),
    [note, setNote] = useState(""),
    [reviewOn, setReviewOn] = useState("");
  const action = useNextVisitReview(actor, "decide", (receipt) =>
    onSaved(receiptContext(receipt)),
  );
  const eligible =
    row.current &&
    !["booked", "declined"].includes(row.decision?.kind ?? "") &&
    !context.isFetching &&
    !context.isError;
  const dirty = Boolean(
      note || reviewOn || choice || action.busy || action.pending,
    ),
    guard = (
      <NextVisitDraftGuard
        dirty={dirty}
        onDirtyChange={onDirtyChange}
        description="This next-visit decision has unsaved or unconfirmed work. Confirmed completion stays saved; unconfirmed server reviews remain recoverable on Home and Schedule."
      />
    );
  const future = useInfiniteQuery({
    queryKey: ["next-visits", "future", actor, row.occurrence.id],
    enabled: eligible,
    initialPageParam: null as {
      asOf: string;
      after: z.infer<typeof nextVisitCursorSchema>;
    } | null,
    queryFn: ({ pageParam }) =>
      nextVisitFutureAppointments(
        row.occurrence.id,
        pageParam?.asOf ?? null,
        pageParam?.after ?? null,
      ),
    getNextPageParam: (last) =>
      last.next ? { asOf: last.as_of, after: last.next } : undefined,
  });
  const care = useInfiniteQuery({
    queryKey: ["next-visits", "care", actor, row.occurrence.id],
    enabled: eligible,
    initialPageParam: null as z.infer<typeof dueCareCursorSchema> | null,
    queryFn: ({ pageParam }) => nextVisitDueCare(row.occurrence.id, pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const linked = useQuery({
    queryKey: ["next-visits", "linked", actor, row.decision?.appointment_id],
    enabled: Boolean(row.decision?.appointment_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("id,status,scheduled_at,version,client_id,pet_id")
        .eq("id", row.decision!.appointment_id!)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });
  function dismiss() {
    if (action.busy) return;
    if (
      !dirty ||
      window.confirm(
        action.pending
          ? "Leave this unconfirmed decision? Its server review remains available on Home and Schedule."
          : "Discard this unsaved decision? The completed visit stays saved.",
      )
    )
      close();
  }
  async function decide(
    kind: "later" | "declined" | "existing",
    appointment?: { id?: string; version?: number },
  ) {
    if (!eligible) return;
    await action.save(
      nextVisitOutcomeRequest(row.occurrence.id, row.version, {
        action: kind,
        note,
        followup_on: kind === "later" && reviewOn ? reviewOn : null,
        booking: null,
        appointment_id: appointment?.id ?? null,
        appointment_version: appointment?.version ?? null,
      }),
    );
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl [&_button]:min-h-11 [&_input]:min-h-11 [&>button]:min-w-11 [&>button]:right-1 [&>button]:top-1">
          <DialogHeader className="pr-10">
            <DialogTitle>Next visit for {row.patient_name}</DialogTitle>
            <DialogDescription>
              {row.client_name} · This visit’s completion is saved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <StatusChip status="COMPLETED" />
            <p className="text-sm">
              {outcomeLabel(row)}
              {row.decision
                ? ` · Recorded ${denverLocal(row.decision.recorded_at).replace("T", " ")} by staff ${row.decision.actor_id.slice(0, 8)}`
                : ""}
            </p>
            {row.decision?.note && (
              <p className="text-sm break-words">{row.decision.note}</p>
            )}
            {row.decision?.followup_on && (
              <p className="text-sm">
                Staff review date: {row.decision.followup_on}
              </p>
            )}
            <Link
              className="inline-flex min-h-11 items-center text-primary underline"
              to={patientHref(row.occurrence.pet_id, "schedule")}
            >
              Open patient record
            </Link>
            {context.isError && (
              <p role="alert">
                Current completion details unavailable.{" "}
                <Button
                  className="min-h-11"
                  onClick={() => void context.refetch()}
                >
                  Refresh completion
                </Button>
              </p>
            )}
            {!row.current && (
              <p role="status">
                Follow-up decisions are unavailable: this completion is
                historical or the patient is inactive. Its recorded completion
                remains saved.
              </p>
            )}
            {row.decision?.appointment_id && (
              <section aria-label="Recorded next booking">
                <h3 className="font-semibold">Recorded next booking</h3>
                {linked.isPending ? (
                  <p role="status">Loading current booking…</p>
                ) : linked.isError ? (
                  <p role="alert">
                    Current booking unavailable.{" "}
                    <Button
                      className="min-h-11"
                      onClick={() => void linked.refetch()}
                    >
                      Refresh booking
                    </Button>
                  </p>
                ) : linked.data ? (
                  <>
                    <StatusChip status={linked.data.status} />
                    <p>
                      {nextVisitDate(linked.data.scheduled_at)} ·{" "}
                      {formatDenverTime(linked.data.scheduled_at)}
                    </p>
                    <Link
                      className="inline-flex min-h-11 items-center text-primary underline"
                      to={scheduleHref({
                        date: denverLocal(linked.data.scheduled_at).slice(
                          0,
                          10,
                        ),
                      })}
                    >
                      Open current booking
                    </Link>
                  </>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Current status is read separately; cancellation or
                  rescheduling keeps the original decision.
                </p>
              </section>
            )}
            {eligible && (
              <>
                <section
                  aria-label="Due care context"
                  className="space-y-2 rounded-xl border p-3"
                >
                  <h3 className="font-semibold">Due care context</h3>
                  <p className="text-sm text-muted-foreground">
                    Reviewed care and explicitly planned labs. Choose the visit
                    date after clinical review.
                  </p>
                  {care.isPending ? (
                    <p role="status">Loading care context…</p>
                  ) : care.isError ? (
                    <p role="alert">
                      Care context unavailable.{" "}
                      <Button
                        className="min-h-11"
                        onClick={() => void care.refetch()}
                      >
                        Retry care context
                      </Button>
                    </p>
                  ) : care.data?.pages.flatMap((p) => p.items).length ? (
                    <ul>
                      {care.data.pages
                        .flatMap((p) => p.items)
                        .map((item) => (
                          <li
                            key={item.kind + item.id}
                            className="py-1 text-sm break-words"
                          >
                            {item.label} · {item.due_on} ·{" "}
                            {item.review_state === "reviewed"
                              ? "Reviewed care"
                              : `${item.review_state} lab`}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-sm">
                      No reviewed due-care dates or planned labs recorded.
                    </p>
                  )}
                  {care.hasNextPage && (
                    <Button
                      className="min-h-11"
                      variant="outline"
                      disabled={care.isFetchingNextPage}
                      onClick={() => void care.fetchNextPage()}
                    >
                      Load more care context
                    </Button>
                  )}
                </section>
                <section
                  aria-label="Existing future appointments"
                  className="space-y-2"
                >
                  <h3 className="font-semibold">Already scheduled</h3>
                  {future.isPending ? (
                    <p role="status">Loading future visits…</p>
                  ) : future.isError ? (
                    <p role="alert">
                      Future visits unavailable.{" "}
                      <Button
                        className="min-h-11"
                        onClick={() => void future.refetch()}
                      >
                        Retry future visits
                      </Button>
                    </p>
                  ) : future.data?.pages.flatMap((p) => p.items).length ? (
                    <ul className="space-y-2">
                      {future.data.pages
                        .flatMap((p) => p.items)
                        .map((item) => (
                          <li key={item.id} className="rounded-xl border p-3">
                            <p className="text-sm break-words">
                              {item.appointment_type} ·{" "}
                              {nextVisitDate(item.scheduled_at)} ·{" "}
                              {formatDenverTime(item.scheduled_at)} ·{" "}
                              {item.assigned_dvm_id
                                ? `Staff ${item.assigned_dvm_id.slice(0, 8)}`
                                : "Unassigned"}
                            </p>
                            <Button
                              className="mt-2 min-h-11"
                              disabled={action.busy || action.pending}
                              onClick={() => void decide("existing", item)}
                            >
                              Use this appointment
                            </Button>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-sm">
                      No active future appointments recorded.
                    </p>
                  )}
                  {future.hasNextPage && (
                    <Button
                      className="min-h-11"
                      variant="outline"
                      disabled={future.isFetchingNextPage}
                      onClick={() => void future.fetchNextPage()}
                    >
                      Load more future visits
                    </Button>
                  )}
                </section>
                <fieldset
                  disabled={action.busy || action.pending}
                  className="space-y-3"
                >
                  <Label htmlFor="next-visit-note">
                    Next visit note (optional)
                  </Label>
                  <Textarea
                    id="next-visit-note"
                    maxLength={2000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      onClick={() => {
                        if (
                          !dirty ||
                          window.confirm(
                            "Discard this unsaved decision and review a new booking?",
                          )
                        )
                          onBook();
                      }}
                    >
                      Schedule next visit
                    </Button>
                    <Button
                      className="min-h-11"
                      variant={choice === "later" ? "default" : "outline"}
                      onClick={() => setChoice("later")}
                    >
                      Schedule later
                    </Button>
                    <Button
                      className="min-h-11"
                      variant={choice === "declined" ? "default" : "outline"}
                      onClick={() => setChoice("declined")}
                    >
                      Client declined
                    </Button>
                  </div>
                  {choice === "later" && (
                    <>
                      <Label htmlFor="next-visit-review-date">
                        Staff review date (optional)
                      </Label>
                      <Input
                        id="next-visit-review-date"
                        type="date"
                        min={denverLocal(new Date()).slice(0, 10)}
                        value={reviewOn}
                        onChange={(event) => setReviewOn(event.target.value)}
                      />
                      <p className="text-sm text-muted-foreground">
                        This date is for staff follow-up. It doesn’t change
                        clinical due dates or send a message.
                      </p>
                    </>
                  )}
                  {choice && (
                    <Button
                      className="min-h-11"
                      onClick={() => void decide(choice)}
                    >
                      Save{" "}
                      {choice === "later"
                        ? "schedule later"
                        : "client declined"}
                    </Button>
                  )}
                </fieldset>
              </>
            )}
            {action.error && (
              <p role="alert" className="text-destructive">
                {action.error}
              </p>
            )}
            {action.error && !action.pending && (
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => {
                  void context.refetch();
                  void future.refetch();
                }}
              >
                Refresh saved outcome
              </Button>
            )}
            {action.pending && (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  disabled={action.busy}
                  onClick={() => void action.retry()}
                >
                  Retry unchanged decision
                </Button>
                <Button
                  className="min-h-11"
                  disabled={action.busy}
                  onClick={() => void action.checkSaved()}
                >
                  Check saved decision
                </Button>
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() => void action.release()}
                >
                  Check and release review
                </Button>
              </div>
            )}
            <Button
              className="min-h-11"
              variant="outline"
              disabled={action.busy}
              onClick={dismiss}
            >
              Close next visit review
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {guard}
    </>
  );
}
