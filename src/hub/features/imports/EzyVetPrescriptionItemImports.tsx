import { searchMappings, listPrescriptionCandidates } from "./prescription-api";
import { contextOf } from "./prescription-item-api";
import type { PrescriptionItemContext } from "./prescription-item-api";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listPrescriptionItemRuns,
  listPrescriptionItemCandidates,
  recoverPrescriptionItemRun,
  stagePrescriptionItemPage,
} from "./prescription-item-api";
import type {
  PrescriptionItemMapping,
  PrescriptionItemRun,
  PrescriptionItemCursor,
  PrescriptionItemCandidate,
} from "./prescription-item-api";
interface Props {
  actor: string;
  onDirtyChange: (dirty: boolean) => void;
}
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Prescription item import unavailable. Recover the original run.";
export function EzyVetPrescriptionItemImports({ actor, onDirtyChange }: Props) {
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState<PrescriptionItemMapping | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    onDirtyChange(locked);
  }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const maps = useQuery({
    queryKey: ["ezyvet-prescriptionitem", actor, "mapping", search],
    enabled: search.trim().length >= 2,
    queryFn: () => searchMappings(search),
  });
  return (
    <section
      aria-label="Prescription medication item import"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-xl font-semibold">Import prescription medication items</h2>
      <p>
        Select a current imported prescription to read its medication items.
        Quantities and instructions remain original source evidence for review.
        A completed scan does not prove that every listed medication was returned
        and does not authorize refills, dispensing or charges.
      </p>
      <label className="block">
        Find prescription item patient
        <Input
          value={search}
          disabled={locked}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={200}
        />
      </label>
      {maps.data?.length === 0 && search.trim().length >= 2 && (
        <p>No approved patient mappings found.</p>
      )}
      {maps.isError && <p role="alert">Mapped patient search unavailable.</p>}
      <div className="flex flex-wrap gap-2">
        {maps.data?.map((m) => (
          <Button
            key={m.link_id}
            variant="outline"
            disabled={locked}
            onClick={() => setMapping(m)}
          >
            {m.patient_name} · {m.household_name} · {m.source_site_uid}
          </Button>
        ))}
      </div>
      {mapping && (
        <PrescriptionItemPatient
          key={`${actor}:${mapping.link_id}`}
          actor={actor}
          mapping={mapping}
          onLocked={setLocked}
        />
      )}
    </section>
  );
}
interface PatientProps {
  actor: string;
  mapping: PrescriptionItemMapping;
  onLocked: (locked: boolean) => void;
}
function PrescriptionItemPatient({ actor, mapping, onLocked }: PatientProps) {
  const resource = "prescriptionitem";
  const [context, setContext] = useState<PrescriptionItemContext | null>(null);
  const contextRef = useRef<PrescriptionItemContext | null>(null);
  const [prescriptionCursor, setPrescriptionCursor] = useState<PrescriptionItemCursor | null>(
    null,
  );
  const prescriptions = useQuery({
    queryKey: [
      "ezyvet-prescriptionitem-prescriptions",
      actor,
      mapping.link_id,
      prescriptionCursor,
    ],
    queryFn: () => listPrescriptionCandidates(mapping, "prescription", prescriptionCursor),
    retry: false,
  });
  const [id, setId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const [run, setRun] = useState<PrescriptionItemRun | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runCursor, setRunCursor] = useState<PrescriptionItemCursor | null>(null);
  const [sourceCursor, setSourceCursor] = useState<PrescriptionItemCursor | null>(
    null,
  );
  const [selected, setSelected] = useState<PrescriptionItemCandidate | null>(null);
  const key = `lrv-ezyvet-prescriptionitem-run:${actor}:${mapping.link_id}:${resource}`;
  const runs = useQuery({
    queryKey: [
      "ezyvet-prescriptionitem",
      actor,
      mapping.link_id,
      resource,
      "runs",
      runCursor,
    ],
    queryFn: () => listPrescriptionItemRuns(actor, mapping, resource, runCursor),
    retry: false,
  });
  const sources = useQuery({
    queryKey: [
      "ezyvet-prescriptionitem",
      actor,
      mapping.link_id,
      resource,
      "sources",
      sourceCursor,
    ],
    queryFn: () => listPrescriptionItemCandidates(mapping, resource, sourceCursor),
    retry: false,
  });
  useEffect(() => {
    if (sources.data)
      setSelected((previous) =>
        previous
          ? (sources.data.candidates.find((c) => c.id === previous.id) ?? null)
          : null,
      );
  }, [sources.data]);
  const dirty = busy || uncertain;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onLocked(false);
    };
  }, [onLocked]);
  useEffect(() => {
    onLocked(dirty);
  }, [dirty, onLocked]);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(key);
    } catch {
      /* Recover through server discovery. */
    }
    let savedContext: PrescriptionItemContext | null = null;
    if (stored) {
      try {
        const intent = JSON.parse(stored);
        if (!/^[a-f0-9-]{36}$/i.test(intent.id))
          throw new Error("Invalid run reference");
        savedContext = contextOf(intent.context);
        stored = intent.id;
      } catch {
        stored = null;
      }
    }
    contextRef.current = savedContext;
    setContext(savedContext);
    idRef.current = stored;
    setId(stored);
    setRun(null);
    setUncertain(!!stored);
    setSelected(null);
    setNotice(
      stored
        ? "An earlier run is retained. Recheck its saved state before continuing."
        : "",
    );
    setError("");
  }, [key]);
  const persist = (value: string, intent = contextRef.current) => {
    if (!intent) throw new Error("Select a current scoped prescription first.");
    sessionStorage.setItem(
      key,
      JSON.stringify({ id: value, context: contextOf(intent) }),
    );
    contextRef.current = intent;
    setContext(intent);
    idRef.current = value;
    setId(value);
  };
  async function work(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover(target = idRef.current) {
    if (!target || !contextRef.current) return;
    const saved = await recoverPrescriptionItemRun(
      target,
      actor,
      mapping,
      contextRef.current!,
    );
    if (!alive.current) return;
    setRun(saved);
    if (!saved) {
      setUncertain(true);
      setNotice(
        "No saved run is visible yet. Keep this request and retry it unchanged; an in-flight request may still commit.",
      );
    } else {
      setUncertain(false);
      setNotice(
        saved.scope === "legacy_unscoped"
          ? "Legacy unscoped evidence is read-only. Continue with a separate mapped scan after any source cooldown."
          : saved.status === "review_ready"
            ? "Prescription scan complete. This is not a complete patient migration; no clinical approval occurred."
            : saved.status === "page_limit_reached"
              ? "Scan safety limit reached. More source records may remain; this is not complete migration."
              : "Saved run recovered. Continue only when its lease and provider cooldown have ended.",
      );
    }
    await Promise.all([runs.refetch(), sources.refetch(), prescriptions.refetch()]);
  }
  async function stage() {
    if (!contextRef.current)
      throw new Error("Select a current scoped prescription first.");
    let target = idRef.current;
    if (target) {
      const saved = await recoverPrescriptionItemRun(
        target,
        actor,
        mapping,
        contextRef.current!,
      );
      if (!alive.current) return;
      if (saved) {
        setRun(saved);
        if (
          saved.scope !== "prescription_scoped" ||
          saved.status !== "running" ||
          saved.lease_active ||
          (saved.retry_after && Date.parse(saved.retry_after) > Date.now())
        ) {
          setUncertain(false);
          setNotice(
            "Saved run cannot advance now. Review its state and cooldown.",
          );
          return;
        }
      }
    } else {
      target = crypto.randomUUID();
      persist(target);
    }
    setUncertain(true);
    try {
      await stagePrescriptionItemPage(target, mapping, contextRef.current);
    } catch (e) {
      if (alive.current) setError(message(e));
    }
    if (alive.current) await recover(target);
  }
  const blockedRun =
    run &&
    (run.scope !== "prescription_scoped" ||
      run.status !== "running" ||
      run.lease_active ||
      (!!run.retry_after && Date.parse(run.retry_after) > Date.now()));
  const text = (value: unknown) =>
    value === undefined || value === null || value === ""
      ? "Unknown / not supplied"
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return (
    <div className="space-y-4">
      <p className="font-medium">
        Selected patient: {mapping.patient_name} · {mapping.household_name}
      </p>
      <p className="break-all text-sm">
        {mapping.source_origin} · {mapping.source_site_uid} · source animal{" "}
        {mapping.external_id}
      </p>
      <section aria-label="PrescriptionItem prescription selection" className="space-y-2">
        <h3 className="font-semibold">Choose a current scoped prescription</h3>
        {prescriptions.isError && (
          <p role="alert">
            Prescription evidence unavailable. Import patient-scoped prescriptions first.
          </p>
        )}
        {prescriptions.data?.candidates.length === 0 && (
          <p>
            No scoped prescriptions on this page. Import patient-scoped prescriptions
            first.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {prescriptions.data?.candidates.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              disabled={dirty || !!id || !c.is_current}
              onClick={() => {
                const value = {
                  prescription_snapshot_id: c.id,
                  prescription_payload_hash: c.payload_hash,
                  prescription_observed_head_version: c.observed_head_version,
                };
                contextRef.current = value;
                setContext(value);
              }}
            >
              Prescription {c.external_id} · {text(c.payload.date_of_prescription)} ·{" "}
              {c.is_current ? "current" : "stale"}
            </Button>
          ))}
          <Button
            variant="outline"
            disabled={dirty || !prescriptionCursor}
            onClick={() => setPrescriptionCursor(null)}
          >
            Newest prescriptions
          </Button>
          <Button
            variant="outline"
            disabled={dirty || !prescriptions.data?.next_cursor}
            onClick={() => setPrescriptionCursor(prescriptions.data!.next_cursor)}
          >
            Older prescriptions
          </Button>
        </div>
        {context && (
          <p className="break-all text-sm">
            Selected prescription snapshot {context.prescription_snapshot_id} · observed
            revision {context.prescription_observed_head_version}
          </p>
        )}
      </section>
      <p className="text-sm text-muted-foreground">
        Requires configured read-{resource} access. Each explicit request reads
        at most 10 source records. Source access remains disabled until
        commissioned.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !context || !!blockedRun}
          onClick={() => void work(stage)}
        >
          {id
            ? "Fetch next page using this run"
            : "Start medication item scan"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !id}
          onClick={() => void work(() => recover())}
        >
          Recheck saved medication item run
        </Button>
        <Button
          variant="outline"
          disabled={
            dirty ||
            !run ||
            (run.status === "running" && run.scope === "prescription_scoped")
          }
          onClick={() => {
            sessionStorage.removeItem(key);
            idRef.current = null;
            setId(null);
            setRun(null);
            setNotice(
              "A separate mapped scan will use a new request. Existing history remains available.",
            );
          }}
        >
          Prepare a separate mapped scan
        </Button>
      </div>
      {id && <p className="break-all text-xs">Run reference: {id}</p>}
      {run && (
        <p>
          Saved state: {run.status} · next page {run.next_page}
          {run.lease_active ? " · worker lease active" : ""}
          {run.retry_after ? ` · retry after ${run.retry_after}` : ""}
        </p>
      )}
      <section aria-label="PrescriptionItem scan history" className="space-y-2">
        <h3 className="font-semibold">Saved medication item scans</h3>
        {runs.isError && <p role="alert">Run history unavailable.</p>}
        {runs.data?.runs.map((r) => (
          <div key={r.id} className="rounded border p-2">
            <p>
              {r.created_at} · {r.status} ·{" "}
              {r.scope === "legacy_unscoped"
                ? "Legacy unscoped — cannot continue"
                : `Prescription ${r.prescription_external_id}`}
            </p>
            <Button
              variant="outline"
              disabled={dirty}
              onClick={() =>
                void work(async () => {
                  if (
                    !r.prescription_snapshot_id ||
                    !r.prescription_payload_hash ||
                    !r.prescription_observed_head_version
                  )
                    throw new Error(
                      "Legacy unscoped scan cannot resume. Select a current scoped prescription for a new scan.",
                    );
                  persist(r.id, {
                    prescription_snapshot_id: r.prescription_snapshot_id,
                    prescription_payload_hash: r.prescription_payload_hash,
                    prescription_observed_head_version:
                      r.prescription_observed_head_version,
                  });
                  setUncertain(true);
                  setRun(null);
                  await recover(r.id);
                })
              }
            >
              Recover scan {r.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              await Promise.all([
                runs.refetch(),
                sources.refetch(),
                prescriptions.refetch(),
              ]);
            })
          }
        >
          Refresh medication item data
        </Button>
        <Button
          variant="outline"
          disabled={busy || !runCursor}
          onClick={() => setRunCursor(null)}
        >
          Newest scans
        </Button>
        <Button
          variant="outline"
          disabled={busy || !runs.data?.next_cursor}
          onClick={() => setRunCursor(runs.data!.next_cursor)}
        >
          Older scans
        </Button>
      </section>
      <section
        aria-label="Staged prescription medication items"
        className="space-y-2"
      >
        <h3 className="font-semibold">Patient-scoped source observations</h3>
        <p>
          Read-only evidence. Source product, quantity, author and dates have
          not been interpreted as local prescribing instructions.
        </p>
        {sources.isError && (
          <p role="alert">Source medication items unavailable.</p>
        )}
        {sources.data?.candidates.length === 0 && (
          <p>No patient-scoped observations on this page.</p>
        )}
        {sources.data?.candidates.map((c) => (
          <Button
            key={c.id}
            variant="outline"
            disabled={busy}
            onClick={() => setSelected(c)}
          >
            Read {c.resource} {c.external_id} ·{" "}
            {c.is_current ? "current observation" : "earlier observation"}
          </Button>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy || !sourceCursor}
            onClick={() => setSourceCursor(null)}
          >
            Newest observations
          </Button>
          <Button
            variant="outline"
            disabled={busy || !sources.data?.next_cursor}
            onClick={() => setSourceCursor(sources.data!.next_cursor)}
          >
            Older observations
          </Button>
        </div>
      </section>
      {selected && (
        <article
          aria-label="Selected imported observation"
          className="space-y-2 rounded-md border p-3"
        >
          <h3 className="font-semibold">
            Source {selected.resource} {selected.external_id}
          </h3>
          <p>
            Prescription {selected.prescription_external_id} ·{" "}
            {selected.prescription_is_current ? "prescription current" : "prescription stale"}{" "}
            · First stored {selected.created_at} · head version{" "}
            {selected.head_version} ·{" "}
            {selected.is_current
              ? "Current source observation"
              : "Historical source observation"}
          </p>
          <dl>
            {[
              "prescription_id",
              "product_id",
              "date_start",
              "remaining",
              "qty",
              "serial_number",
              "instructions",

              "active",
            ].map((field) => (
              <div key={field}>
                <dt className="font-medium">
                  {field === "serial_number"
                    ? "Source serial number (uninterpreted)"
                    : field === "timestamp"
                      ? "Original timestamp (uninterpreted)"
                      : `${field} (raw source value)`}
                </dt>
                <dd className="whitespace-pre-wrap break-words">
                  {text(selected.payload[field])}
                </dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>Complete staged source fields</summary>
            <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(selected.payload, null, 2)}
            </pre>
          </details>
        </article>
      )}
    </div>
  );
}
