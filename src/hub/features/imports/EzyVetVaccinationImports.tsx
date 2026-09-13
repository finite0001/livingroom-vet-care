import { searchMappings, listClinicalCandidates } from "./clinical-api";
import { contextOf } from "./vaccination-api";
import type { VaccinationContext } from "./vaccination-api";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listVaccinationRuns,
  listVaccinationCandidates,
  recoverVaccinationRun,
  stageVaccinationPage,
} from "./vaccination-api";
import type {
  VaccinationMapping,
  VaccinationRun,
  VaccinationCursor,
  VaccinationCandidate,
} from "./vaccination-api";
interface Props {
  actor: string;
  onDirtyChange: (dirty: boolean) => void;
}
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Vaccination import unavailable. Recover the original run.";
export function EzyVetVaccinationImports({ actor, onDirtyChange }: Props) {
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState<VaccinationMapping | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    onDirtyChange(locked);
  }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const maps = useQuery({
    queryKey: ["ezyvet-vaccination", actor, "mapping", search],
    enabled: search.trim().length >= 2,
    queryFn: () => searchMappings(search),
  });
  return (
    <section
      aria-label="Consult-scoped vaccination import"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-xl font-semibold">Import source vaccinations</h2>
      <p>
        Read vaccination evidence through an approved patient mapping and a
        current scoped consult. One completed consult scan is not a complete
        patient migration. Product, dates and quantity remain uninterpreted
        source values; this workflow creates no treatments, due dates,
        certificates, stock movements, charges or reminders.
      </p>
      <label className="block">
        Find vaccination import patient
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
        <VaccinationPatient
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
  mapping: VaccinationMapping;
  onLocked: (locked: boolean) => void;
}
function VaccinationPatient({ actor, mapping, onLocked }: PatientProps) {
  const resource = "vaccination";
  const [context, setContext] = useState<VaccinationContext | null>(null);
  const contextRef = useRef<VaccinationContext | null>(null);
  const [consultCursor, setConsultCursor] = useState<VaccinationCursor | null>(
    null,
  );
  const consults = useQuery({
    queryKey: [
      "ezyvet-vaccination-consults",
      actor,
      mapping.link_id,
      consultCursor,
    ],
    queryFn: () => listClinicalCandidates(mapping, "consult", consultCursor),
    retry: false,
  });
  const [id, setId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const [run, setRun] = useState<VaccinationRun | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runCursor, setRunCursor] = useState<VaccinationCursor | null>(null);
  const [sourceCursor, setSourceCursor] = useState<VaccinationCursor | null>(
    null,
  );
  const [selected, setSelected] = useState<VaccinationCandidate | null>(null);
  const key = `lrv-ezyvet-vaccination-run:${actor}:${mapping.link_id}:${resource}`;
  const runs = useQuery({
    queryKey: [
      "ezyvet-vaccination",
      actor,
      mapping.link_id,
      resource,
      "runs",
      runCursor,
    ],
    queryFn: () => listVaccinationRuns(actor, mapping, resource, runCursor),
    retry: false,
  });
  const sources = useQuery({
    queryKey: [
      "ezyvet-vaccination",
      actor,
      mapping.link_id,
      resource,
      "sources",
      sourceCursor,
    ],
    queryFn: () => listVaccinationCandidates(mapping, resource, sourceCursor),
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
    let savedContext: VaccinationContext | null = null;
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
    if (!intent) throw new Error("Select a current scoped consult first.");
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
    const saved = await recoverVaccinationRun(
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
            ? "Consult scan complete. This is not a complete patient migration; no clinical approval occurred."
            : saved.status === "page_limit_reached"
              ? "Scan safety limit reached. More source records may remain; this is not complete migration."
              : "Saved run recovered. Continue only when its lease and provider cooldown have ended.",
      );
    }
    await Promise.all([runs.refetch(), sources.refetch(), consults.refetch()]);
  }
  async function stage() {
    if (!contextRef.current)
      throw new Error("Select a current scoped consult first.");
    let target = idRef.current;
    if (target) {
      const saved = await recoverVaccinationRun(
        target,
        actor,
        mapping,
        contextRef.current!,
      );
      if (!alive.current) return;
      if (saved) {
        setRun(saved);
        if (
          saved.scope !== "consult_scoped" ||
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
      await stageVaccinationPage(target, mapping, contextRef.current);
    } catch (e) {
      if (alive.current) setError(message(e));
    }
    if (alive.current) await recover(target);
  }
  const blockedRun =
    run &&
    (run.scope !== "consult_scoped" ||
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
      <section aria-label="Vaccination consult selection" className="space-y-2">
        <h3 className="font-semibold">Choose a current scoped consult</h3>
        {consults.isError && (
          <p role="alert">
            Consult evidence unavailable. Import patient-scoped consults first.
          </p>
        )}
        {consults.data?.candidates.length === 0 && (
          <p>
            No scoped consults on this page. Import patient-scoped consults
            first.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {consults.data?.candidates.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              disabled={dirty || !!id || !c.is_current}
              onClick={() => {
                const value = {
                  consult_snapshot_id: c.id,
                  consult_payload_hash: c.payload_hash,
                  consult_observed_head_version: c.observed_head_version,
                };
                contextRef.current = value;
                setContext(value);
              }}
            >
              Consult {c.external_id} · {text(c.payload.description)} ·{" "}
              {c.is_current ? "current" : "stale"}
            </Button>
          ))}
          <Button
            variant="outline"
            disabled={dirty || !consultCursor}
            onClick={() => setConsultCursor(null)}
          >
            Newest consults
          </Button>
          <Button
            variant="outline"
            disabled={dirty || !consults.data?.next_cursor}
            onClick={() => setConsultCursor(consults.data!.next_cursor)}
          >
            Older consults
          </Button>
        </div>
        {context && (
          <p className="break-all text-sm">
            Selected consult snapshot {context.consult_snapshot_id} · observed
            revision {context.consult_observed_head_version}
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
            : "Start consult vaccination scan"}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !id}
          onClick={() => void work(() => recover())}
        >
          Recheck saved vaccination run
        </Button>
        <Button
          variant="outline"
          disabled={
            dirty ||
            !run ||
            (run.status === "running" && run.scope === "consult_scoped")
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
      <section aria-label="Vaccination scan history" className="space-y-2">
        <h3 className="font-semibold">Saved vaccination scans</h3>
        {runs.isError && <p role="alert">Run history unavailable.</p>}
        {runs.data?.runs.map((r) => (
          <div key={r.id} className="rounded border p-2">
            <p>
              {r.created_at} · {r.status} ·{" "}
              {r.scope === "legacy_unscoped"
                ? "Legacy unscoped — cannot continue"
                : `Consult ${r.consult_external_id}`}
            </p>
            <Button
              variant="outline"
              disabled={dirty}
              onClick={() =>
                void work(async () => {
                  if (
                    !r.consult_snapshot_id ||
                    !r.consult_payload_hash ||
                    !r.consult_observed_head_version
                  )
                    throw new Error(
                      "Legacy unscoped scan cannot resume. Select a current scoped consult for a new scan.",
                    );
                  persist(r.id, {
                    consult_snapshot_id: r.consult_snapshot_id,
                    consult_payload_hash: r.consult_payload_hash,
                    consult_observed_head_version:
                      r.consult_observed_head_version,
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
                consults.refetch(),
              ]);
            })
          }
        >
          Refresh vaccination data
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
        aria-label="Staged patient vaccination observations"
        className="space-y-2"
      >
        <h3 className="font-semibold">Patient-scoped source observations</h3>
        <p>
          Read-only evidence. Source product, quantity, author and dates have
          not been interpreted as local vaccination fields.
        </p>
        {sources.isError && (
          <p role="alert">Source vaccinations unavailable.</p>
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
            Consult {selected.consult_external_id} ·{" "}
            {selected.consult_is_current ? "consult current" : "consult stale"}{" "}
            · First stored {selected.created_at} · head version{" "}
            {selected.head_version} ·{" "}
            {selected.is_current
              ? "Current source observation"
              : "Historical source observation"}
          </p>
          <dl>
            {[
              "consult_id",
              "product_id",
              "date_of_administration",
              "date_of_next_administration",
              "qty",
              "vet_id",
              "description",
              "notes",
              "active",
            ].map((field) => (
              <div key={field}>
                <dt className="font-medium">
                  {field === "vet_id"
                    ? "Source clinician reference (unverified)"
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
