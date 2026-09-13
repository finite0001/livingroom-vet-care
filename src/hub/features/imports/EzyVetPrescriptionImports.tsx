import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchMappings,
  listPrescriptionRuns,
  listPrescriptionCandidates,
  recoverPrescriptionRun,
  stagePrescriptionPage,
} from "./prescription-api";
import type {
  PrescriptionMapping,
  PrescriptionResource,
  PrescriptionRun,
  PrescriptionCursor,
  PrescriptionCandidate,
} from "./prescription-api";
interface Props {
  actor: string;
  onDirtyChange: (dirty: boolean) => void;
}
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Prescription import unavailable. Recover the original run.";
export function EzyVetPrescriptionImports({ actor, onDirtyChange }: Props) {
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState<PrescriptionMapping | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    onDirtyChange(locked);
  }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const maps = useQuery({
    queryKey: ["ezyvet-prescription", actor, "mapping", search],
    enabled: search.trim().length >= 2,
    queryFn: () => searchMappings(search),
  });
  return (
    <section
      aria-label="Patient-scoped prescription import"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-xl font-semibold">Import source prescriptions</h2>
      <p>
        Read outside prescriptions through an approved ezyVet patient mapping.
        Source dates, prescribers and medication references remain available for
        veterinarian review. Importing does not authorize refills or dispensing.
      </p>
      <label className="block">
        Find prescription import patient
        <Input
          value={search}
          disabled={locked}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={200}
        />
      </label>
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
        <PrescriptionPatient
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
  mapping: PrescriptionMapping;
  onLocked: (locked: boolean) => void;
}
function PrescriptionPatient({ actor, mapping, onLocked }: PatientProps) {
  const resource: PrescriptionResource = "prescription";
  const [id, setId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const [run, setRun] = useState<PrescriptionRun | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runCursor, setRunCursor] = useState<PrescriptionCursor | null>(null);
  const [sourceCursor, setSourceCursor] = useState<PrescriptionCursor | null>(null);
  const [selected, setSelected] = useState<PrescriptionCandidate | null>(null);
  const key = `lrv-ezyvet-prescription-run:${actor}:${mapping.link_id}:${resource}`;
  const runs = useQuery({
    queryKey: [
      "ezyvet-prescription",
      actor,
      mapping.link_id,
      resource,
      "runs",
      runCursor,
    ],
    queryFn: () => listPrescriptionRuns(actor, mapping, resource, runCursor),
    retry: false,
  });
  const sources = useQuery({
    queryKey: [
      "ezyvet-prescription",
      actor,
      mapping.link_id,
      resource,
      "sources",
      sourceCursor,
    ],
    queryFn: () => listPrescriptionCandidates(mapping, resource, sourceCursor),
    retry: false,
  });
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
    if (stored && !/^[a-f0-9-]{36}$/i.test(stored)) stored = null;
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
  const persist = (value: string) => {
    sessionStorage.setItem(key, value);
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
    if (!target) return;
    const saved = await recoverPrescriptionRun(target, actor, mapping, resource);
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
            ? "Scan complete. Source observations await prescription review; no chart approval occurred."
            : saved.status === "page_limit_reached"
              ? "Scan safety limit reached. More source records may remain; this is not complete migration."
              : "Saved run recovered. Continue only when its lease and provider cooldown have ended.",
      );
    }
    await Promise.all([runs.refetch(), sources.refetch()]);
  }
  async function stage() {
    let target = idRef.current;
    if (target) {
      const saved = await recoverPrescriptionRun(target, actor, mapping, resource);
      if (!alive.current) return;
      if (saved) {
        setRun(saved);
        if (
          saved.scope !== "patient_scoped" ||
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
      await stagePrescriptionPage(target, mapping, resource);
    } catch (e) {
      if (alive.current) setError(message(e));
    }
    if (alive.current) await recover(target);
  }
  const blockedRun =
    run &&
    (run.scope !== "patient_scoped" ||
      run.status !== "running" ||
      run.lease_active ||
      (!!run.retry_after && Date.parse(run.retry_after) > Date.now()));
  const text = (value: unknown) =>
    value === undefined || value === null || value === ""
      ? "Not supplied"
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

      <p className="text-sm text-muted-foreground">
        Requires configured read-{resource} access. Each explicit request reads
        at most 10 source records. Source access remains disabled until
        commissioned.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !!blockedRun}
          onClick={() => void work(stage)}
        >
          {id ? "Fetch next page using this run" : "Start mapped prescription scan"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !id}
          onClick={() => void work(() => recover())}
        >
          Recheck saved prescription run
        </Button>
        <Button
          variant="outline"
          disabled={
            dirty ||
            !run ||
            (run.status === "running" && run.scope === "patient_scoped")
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
      <section aria-label="Prescription scan history" className="space-y-2">
        <h3 className="font-semibold">Saved prescription scans</h3>
        {runs.isError && <p role="alert">Run history unavailable.</p>}
        {runs.data?.runs.map((r) => (
          <div key={r.id} className="rounded border p-2">
            <p>
              {r.created_at} · {r.status} ·{" "}
              {r.scope === "legacy_unscoped"
                ? "Legacy unscoped — cannot continue"
                : "Patient scoped"}
            </p>
            <Button
              variant="outline"
              disabled={dirty}
              onClick={() =>
                void work(async () => {
                  persist(r.id);
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
              await Promise.all([runs.refetch(), sources.refetch()]);
            })
          }
        >
          Refresh prescription data
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
        aria-label="Staged patient prescription observations"
        className="space-y-2"
      >
        <h3 className="font-semibold">Patient-scoped source observations</h3>
        <p>
          Read-only evidence. Source category, author and dates have not been
          interpreted as local prescription fields.
        </p>
        {sources.isError && (
          <p role="alert">Source observations unavailable.</p>
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
            First stored {selected.created_at} · head version{" "}
            {selected.head_version} ·{" "}
            {selected.is_current
              ? "Current source observation"
              : "Historical source observation"}
          </p>
          <dl>
            {["animal_id", "consult_id", "prescribing_vet_user_id", "date_of_prescription", "prescription_item_list", "active"].map((field) => (
              <div key={field}>
                <dt className="font-medium">
                  {field === "prescribing_vet_user_id"
                    ? "Source clinician reference (unverified)"
                    : field === "date_of_prescription"
                      ? "Original timestamp (uninterpreted)"
                      : field}
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
