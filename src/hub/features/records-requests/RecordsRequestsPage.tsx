import { useEffect, useState } from "react";
import { z } from "zod";
import { Link, useBlocker, useParams, useSearchParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { denverCalendarDay } from "../care-reminders/date-tools";
import { patientHref } from "../patient-360/model";
import { choices, detail, queue } from "./api";
import {
  filterSchema,
  selectClass,
  statusLabel,
  statuses,
  type RecordRequest,
  type SaveValues,
} from "./model";
import { useRequestAction } from "./use-request-action";
import { RequestWorkspace } from "./RequestWorkspace";
export function RecordsRequestsPage() {
  const { session } = useAuth();
  return (
    <RequestSession
      key={session?.user.id ?? ""}
      actorId={session?.user.id ?? ""}
    />
  );
}
interface RequestSessionProps {
  actorId: string;
}
function RequestSession({ actorId }: RequestSessionProps) {
  const { id } = useParams(),
    [params] = useSearchParams();
  const [dirty, setDirty] = useState(false),
    blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const parsed = filterSchema.safeParse(
    Object.fromEntries(
      ["pet_id", "client_id", "ticket_id"]
        .filter((k) => params.has(k))
        .map((k) => [k, params.get(k)]),
    ),
  );
  return (
    <section className="mx-auto min-w-0 max-w-6xl space-y-6 p-4 [overflow-wrap:anywhere] md:p-6">
      <header>
        <h1 className="font-display text-2xl">Records requests</h1>
        <p className="text-muted-foreground">
          Track incoming records and review exactly what leaves each patient’s
          chart.
        </p>
      </header>
      {!parsed.success ? (
        <p role="alert">
          This request link has an invalid patient, household or ticket ID.
        </p>
      ) : id ? (
        <RequestDetail key={id} id={id} actorId={actorId} onDirty={setDirty} />
      ) : (
        <RequestQueue
          actorId={actorId}
          scope={parsed.data}
          onDirty={setDirty}
        />
      )}
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Leave with unsaved records work?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Your draft or unconfirmed action will be lost. Keep this review
              open to recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => blocker.state === "blocked" && blocker.reset()}
            >
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => blocker.state === "blocked" && blocker.proceed()}
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
interface RequestScope {
  pet_id?: string;
  client_id?: string;
  ticket_id?: string;
}
interface QueueProps {
  actorId: string;
  scope: RequestScope;
  onDirty: (v: boolean) => void;
}
function RequestQueue({ actorId, scope, onDirty }: QueueProps) {
  const [filter, setFilter] = useState(""),
    [overdue, setOverdue] = useState(false),
    [creating, setCreating] = useState(false),
    [newId, setNewId] = useState("");
  const cache = useQueryClient();
  const requests = useInfiniteQuery({
    queryKey: ["record-requests", actorId, scope, filter, overdue],
    enabled: !!actorId,
    initialPageParam: null as { updated_at: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      queue(
        {
          ...scope,
          ...(filter ? { status: filter as RecordRequest["status"] } : {}),
          ...(overdue ? { overdue: true } : {}),
        },
        pageParam,
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="request-status">Status</Label>
          <select
            id="request-status"
            className={selectClass}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={creating}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={overdue}
            onChange={(e) => setOverdue(e.target.checked)}
            disabled={creating}
          />
          Overdue only
        </label>
        <Button
          disabled={creating}
          onClick={() => {
            setNewId(crypto.randomUUID());
            setCreating(true);
          }}
        >
          New records request
        </Button>
      </div>
      {creating && (
        <RequestEditor
          key={newId}
          actorId={actorId}
          id={newId}
          scope={scope}
          onDirty={onDirty}
          onSaved={async () => {
            setCreating(false);
            onDirty(false);
            await cache.invalidateQueries({ queryKey: ["record-requests"] });
          }}
          onCancel={() => {
            setCreating(false);
            onDirty(false);
          }}
        />
      )}
      {requests.isPending && <p role="status">Loading requests…</p>}
      {requests.isError && (
        <p role="alert">
          Could not load requests.{" "}
          <Button variant="outline" onClick={() => void requests.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {requests.data?.pages
        .flatMap((p) => p.items)
        .map((r) => (
          <article
            key={r.id}
            className="space-y-2 rounded-xl border bg-card p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <Link
                className="font-semibold underline"
                to={`/hub/tools/record-requests/${r.id}`}
              >
                {r.pet_name} · {r.client_name}
              </Link>
              <span>{statusLabel(r.status)}</span>
            </div>
            <p>
              {r.direction === "incoming" ? "Request from" : "Share with"}{" "}
              {r.requester_name} ·{" "}
              {r.subset === "full" ? "Full eligible chart" : r.subset} records
            </p>
            <p className="text-sm text-muted-foreground">
              Requested {r.requested_on} · Due {r.due_on ?? "not set"} ·{" "}
              {r.assignee_name || "Unassigned"}
            </p>
          </article>
        ))}
      {requests.data && !requests.data.pages.some((p) => p.items.length) && (
        <p>No records requests match these filters.</p>
      )}
      {requests.hasNextPage && (
        <Button
          variant="outline"
          disabled={requests.isFetchingNextPage || creating}
          onClick={() => void requests.fetchNextPage()}
        >
          More requests
        </Button>
      )}
    </>
  );
}
interface RequestDetailProps {
  id: string;
  actorId: string;
  onDirty: (v: boolean) => void;
}
function RequestDetail({ id, actorId, onDirty }: RequestDetailProps) {
  const [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false);
  const record = useQuery({
    queryKey: ["record-request", actorId, id],
    queryFn: () => detail(id),
    enabled: !!actorId && !dirty,
  });
  const change = (v: boolean) => {
    setDirty(v);
    onDirty(v);
  };
  if (record.isPending) return <p role="status">Loading request…</p>;
  if (record.isError)
    return (
      <p role="alert">
        Could not load this request.{" "}
        <Button onClick={() => void record.refetch()}>Retry</Button>
      </p>
    );
  if (!record.data) return <p role="alert">Request not found.</p>;
  const data = record.data,
    r = data.request;
  return (
    <>
      <Link className="underline" to="/hub/tools/record-requests">
        All requests
      </Link>
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-display text-xl">
          {data.pet_name} · {data.client_name}
        </h2>
        <p>
          {r.direction} · {statusLabel(r.status)} · {r.subset} records
        </p>
        <p>
          Requested {r.requested_on} · Due {r.due_on ?? "not set"}
        </p>
        <p>
          {r.requester_name}
          {r.recipient ? ` · ${r.recipient_name} · ${r.recipient}` : ""}
        </p>
        <p className="whitespace-pre-wrap text-sm">{r.request_note}</p>
        <Link className="underline" to={patientHref(r.pet_id, "documents")}>
          Open patient documents
        </Link>
        <Button
          className="ml-3"
          variant="outline"
          disabled={dirty || ["fulfilled", "cancelled"].includes(r.status)}
          onClick={() => setEditing(true)}
        >
          Edit request
        </Button>
      </div>
      {editing ? (
        <RequestEditor
          actorId={actorId}
          id={id}
          initial={r}
          scope={{}}
          onDirty={change}
          onSaved={async () => {
            setEditing(false);
            change(false);
            await record.refetch();
          }}
          onCancel={() => {
            setEditing(false);
            change(false);
          }}
        />
      ) : (
        <RequestWorkspace
          key={id}
          actorId={actorId}
          data={data}
          onDirty={change}
          refresh={async () => {
            await record.refetch();
          }}
        />
      )}
    </>
  );
}
interface EditorProps {
  actorId: string;
  id: string;
  initial?: RecordRequest;
  scope: QueueProps["scope"];
  onDirty: (v: boolean) => void;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}
function RequestEditor({
  actorId,
  id,
  initial,
  scope,
  onDirty,
  onSaved,
  onCancel,
}: EditorProps) {
  const action = useRequestAction(actorId),
    [search, setSearch] = useState(""),
    [after, setAfter] = useState<string | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<{
    id: string;
    client_id: string;
    name: string;
    client_name: string;
  } | null>(null);
  const [values, setValues] = useState<SaveValues>(() =>
    initial
      ? {
          ...initial,
          recipient_email:
            initial.recipient_kind === "third_party" ? initial.recipient : null,
        }
      : {
          pet_id: scope.pet_id ?? "",
          client_id: scope.client_id ?? "",
          direction: "incoming",
          subset: "full",
          channel: null,
          recipient_kind: "client",
          recipient_name: null,
          recipient_email: null,
          requester_name: "",
          request_note: "",
          requested_on: denverCalendarDay(),
          due_on: null,
          assigned_to: null,
          ticket_id: scope.ticket_id ?? null,
          conversation_id: null,
        },
  );
  const options = useQuery({
    queryKey: ["record-request-choices", actorId, scope, search, after],
    queryFn: () =>
      choices(
        search,
        initial?.pet_id ?? scope.pet_id ?? null,
        initial?.client_id ?? scope.client_id ?? null,
        after,
      ),
    enabled: !!actorId,
  });
  const [changed, setChanged] = useState(!initial);
  const [expectedVersion, setExpectedVersion] = useState(
    initial?.version ?? null,
  );
  const [latest, setLatest] = useState<RecordRequest | null>(null);
  useEffect(() => {
    onDirty(changed || action.unconfirmed);
  }, [changed, action.unconfirmed, onDirty]);
  const change = (patch: Partial<SaveValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setChanged(true);
  };
  const save = async () => {
    const payload = {
      pet_id: values.pet_id,
      client_id: values.client_id,
      direction: values.direction,
      subset: values.subset,
      channel: values.channel,
      recipient_kind: values.recipient_kind,
      recipient_name: values.recipient_name,
      recipient_email: values.recipient_email,
      requester_name: values.requester_name,
      request_note: values.request_note,
      requested_on: values.requested_on,
      due_on: values.due_on,
      assigned_to: values.assigned_to,
      ticket_id: values.ticket_id,
      conversation_id: values.conversation_id,
    };
    // A scoped patient still requires its authoritative household from the picker.
    const patient =
      selectedPatient ??
      options.data?.patients.find((p) => p.id === values.pet_id);
    if (patient) {
      payload.pet_id = patient.id;
      payload.client_id = patient.client_id;
    }
    try {
      const saved = await action.save({
        kind: "save",
        entityId: id,
        expectedVersion,
        values: payload,
      });
      if (saved) {
        setChanged(false);
        await onSaved();
      }
    } catch (e) {
      action.setError(
        e instanceof z.ZodError
          ? "Review the patient, dates, requester and recipient fields."
          : e instanceof Error
            ? e.message
            : "Review request fields",
      );
    }
  };
  return (
    <section
      aria-label="Records request editor"
      className="space-y-4 rounded-xl border bg-card p-4"
    >
      <h2 className="font-display text-lg">
        {initial ? "Edit records request" : "New records request"}
      </h2>
      <fieldset
        disabled={action.busy || action.unconfirmed}
        className="grid gap-4 md:grid-cols-2"
      >
        {!initial && (
          <>
            <div>
              <Label htmlFor="request-patient-search">
                Find patient or client
              </Label>
              <Input
                id="request-patient-search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setAfter(null);
                }}
              />
            </div>
            <div>
              <Label htmlFor="request-patient">Patient and household</Label>
              <select
                id="request-patient"
                className={selectClass}
                value={values.pet_id}
                onChange={(e) => {
                  const p = options.data?.patients.find(
                    (p) => p.id === e.target.value,
                  );
                  if (p) {
                    setSelectedPatient({
                      id: p.id!,
                      client_id: p.client_id!,
                      name: p.name!,
                      client_name: p.client_name!,
                    });
                    change({ pet_id: p.id, client_id: p.client_id });
                  }
                }}
              >
                <option value="">Choose verified patient</option>
                {selectedPatient &&
                  !options.data?.patients.some(
                    (p) => p.id === selectedPatient.id,
                  ) && (
                    <option value={selectedPatient.id}>
                      {selectedPatient.name} · {selectedPatient.client_name}
                    </option>
                  )}
                {options.data?.patients.slice(0, 50).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.client_name}
                  </option>
                ))}
              </select>
              {options.data?.patients.length === 51 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAfter(options.data!.patients[49].id)}
                >
                  More patients
                </Button>
              )}
            </div>
          </>
        )}
        <div>
          <Label htmlFor="request-direction">Direction</Label>
          <select
            id="request-direction"
            className={selectClass}
            value={values.direction}
            disabled={!!initial}
            onChange={(e) =>
              change({
                direction: e.target.value as SaveValues["direction"],
                channel: e.target.value === "outgoing" ? "EMAIL" : null,
                recipient_kind: "client",
                recipient_name: null,
                recipient_email: null,
              })
            }
          >
            <option value="incoming">
              Request records from another source
            </option>
            <option value="outgoing">Share patient records</option>
          </select>
        </div>
        <div>
          <Label htmlFor="request-subset">Requested records</Label>
          <select
            id="request-subset"
            className={selectClass}
            value={values.subset}
            disabled={!!initial?.active_manifest_id}
            onChange={(e) =>
              change({ subset: e.target.value as SaveValues["subset"] })
            }
          >
            <option value="full">Full eligible chart</option>
            <option value="vaccines">Vaccines only</option>
            <option value="labs">
              Laboratory results and required originals
            </option>
            <option value="custom">Choose exact records</option>
          </select>
        </div>
        <div>
          <Label htmlFor="request-requester">Requesting person or clinic</Label>
          <Input
            id="request-requester"
            maxLength={160}
            value={values.requester_name}
            onChange={(e) => change({ requester_name: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="request-assignee">Assigned staff</Label>
          <select
            id="request-assignee"
            className={selectClass}
            value={values.assigned_to ?? ""}
            onChange={(e) => change({ assigned_to: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {options.data?.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="request-requested">Requested date</Label>
          <Input
            id="request-requested"
            type="date"
            value={values.requested_on}
            onChange={(e) => change({ requested_on: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="request-due">Due date</Label>
          <Input
            id="request-due"
            type="date"
            value={values.due_on ?? ""}
            onChange={(e) => change({ due_on: e.target.value || null })}
          />
        </div>
        {values.direction === "outgoing" && (
          <>
            <div>
              <Label htmlFor="request-recipient-kind">Recipient</Label>
              <select
                id="request-recipient-kind"
                className={selectClass}
                value={values.recipient_kind}
                disabled={!!initial?.active_manifest_id}
                onChange={(e) =>
                  change({
                    recipient_kind: e.target
                      .value as SaveValues["recipient_kind"],
                    channel: "EMAIL",
                    recipient_name: null,
                    recipient_email: null,
                  })
                }
              >
                <option value="client">Client’s current contact</option>
                <option value="third_party">
                  Third party authorized by client
                </option>
              </select>
            </div>
            <div>
              <Label htmlFor="request-channel">Delivery channel</Label>
              <select
                id="request-channel"
                className={selectClass}
                value={values.channel ?? "EMAIL"}
                disabled={
                  values.recipient_kind === "third_party" ||
                  !!initial?.active_manifest_id
                }
                onChange={(e) =>
                  change({ channel: e.target.value as SaveValues["channel"] })
                }
              >
                <option value="EMAIL">Email with records attached</option>
                <option value="SMS">Text with protected records link</option>
              </select>
            </div>
            {values.recipient_kind === "third_party" && (
              <>
                <div>
                  <Label htmlFor="request-recipient-name">
                    Named recipient
                  </Label>
                  <Input
                    id="request-recipient-name"
                    maxLength={160}
                    disabled={!!initial?.active_manifest_id}
                    value={values.recipient_name ?? ""}
                    onChange={(e) => change({ recipient_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="request-recipient-email">
                    Recipient email
                  </Label>
                  <Input
                    id="request-recipient-email"
                    type="email"
                    disabled={!!initial?.active_manifest_id}
                    value={values.recipient_email ?? ""}
                    onChange={(e) =>
                      change({ recipient_email: e.target.value || null })
                    }
                  />
                </div>
              </>
            )}
          </>
        )}
        <div className="md:col-span-2">
          <Label htmlFor="request-note">Request notes</Label>
          <Textarea
            id="request-note"
            maxLength={2000}
            value={values.request_note}
            onChange={(e) => change({ request_note: e.target.value })}
          />
        </div>
      </fieldset>
      {initial && (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={action.busy || action.unconfirmed}
            onClick={() =>
              void detail(id)
                .then((current) => {
                  if (!current) throw new Error("Request unavailable");
                  setLatest(current.request);
                })
                .catch((e) => action.setError(e.message))
            }
          >
            Review latest saved request
          </Button>
          {latest && (
            <div className="rounded-md border p-3">
              <p>
                Saved version {latest.version} · {statusLabel(latest.status)} ·
                Due {latest.due_on ?? "not set"}
              </p>
              <p>Requester: {latest.requester_name}</p>
              <p className="whitespace-pre-wrap">
                Saved note: {latest.request_note}
              </p>
              <p>
                Your draft remains above. Reconcile it with this saved record
                before using the latest version.
              </p>
              <Button
                variant="outline"
                disabled={
                  action.busy ||
                  action.unconfirmed ||
                  ["fulfilled", "cancelled"].includes(latest.status)
                }
                onClick={() => {
                  setExpectedVersion(latest.version);
                  setLatest(null);
                }}
              >
                Use reviewed version and keep draft
              </Button>
            </div>
          )}
        </div>
      )}
      {options.isError && (
        <p role="alert">
          Could not load patient and staff choices.{" "}
          <Button variant="outline" onClick={() => void options.refetch()}>
            Retry choices
          </Button>
        </p>
      )}
      {action.error && <p role="alert">{action.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={action.busy || action.unconfirmed}
          onClick={() => void save()}
        >
          Save request
        </Button>
        {action.unconfirmed && (
          <>
            <Button
              disabled={action.busy}
              onClick={() => void action.retry().then((r) => r && onSaved())}
            >
              Retry unchanged save
            </Button>
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.checkSaved().then((r) => r && onSaved())
              }
            >
              Check saved action
            </Button>
          </>
        )}
        <Button
          variant="outline"
          disabled={action.busy || action.unconfirmed}
          onClick={onCancel}
        >
          Discard draft
        </Button>
      </div>
    </section>
  );
}
