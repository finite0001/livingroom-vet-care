import { listCaptureMappings } from "./attachment-capture-api";
import type { CaptureCursor } from "./attachment-capture-state";
import { AttachmentOriginalCapture } from "./AttachmentOriginalCapture";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchMappings } from "./prescription-api";
import {
  listAttachmentRuns,
  listAttachmentObservations,
  recoverAttachmentRun,
  stageAttachmentPage,
} from "./attachment-api";
import type {
  AttachmentMapping,
  AttachmentRun,
  AttachmentRunCursor,
  AttachmentObservationCursor,
} from "./attachment-api";
interface Props {
  actor: string;
  onDirtyChange: (dirty: boolean) => void;
}
export function EzyVetAttachmentImports(props: Props) {
  return <AttachmentSelector key={props.actor} {...props} />;
}
function AttachmentSelector({ actor, onDirtyChange }: Props) {
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState<AttachmentMapping | null>(null);
  const [locked, setLocked] = useState(false);
  const [historyOnly, setHistoryOnly] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<CaptureCursor | null>(
    null,
  );
  const historical = useQuery({
    queryKey: ["attachment-capture-mappings", actor, historyCursor],
    queryFn: () => listCaptureMappings(historyCursor),
    retry: false,
  });
  useEffect(() => {
    onDirtyChange(locked);
  }, [locked, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const maps = useQuery({
    queryKey: ["attachment-mappings", actor, search],
    enabled: search.trim().length >= 2,
    queryFn: () => searchMappings(search),
  });
  return (
    <section
      aria-label="Attachment metadata import"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-xl font-semibold">Import attachment metadata</h2>
      <p>
        Discover attachment names and source references for an approved patient.
        Files are not downloaded or added to the clinical record by this scan.
      </p>
      <label className="block">
        Find attachment patient
        <Input
          value={search}
          disabled={locked}
          maxLength={200}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {maps.isError && <p role="alert">Mapped patient search unavailable.</p>}
      {maps.data?.length === 0 && <p>No approved patient mappings found.</p>}
      <div className="flex flex-wrap gap-2">
        {maps.data?.map((m) => (
          <Button
            key={m.link_id}
            variant="outline"
            disabled={locked}
            onClick={() => {
              setHistoryOnly(false);
              setMapping({
                ...m,
                link_id: m.link_id!,
                pet_id: m.pet_id!,
                patient_name: m.patient_name!,
                household_name: m.household_name!,
                source_origin: m.source_origin!,
                source_site_uid: m.source_site_uid!,
                external_id: m.external_id!,
                patient_version: m.patient_version!,
              });
            }}
          >
            {m.patient_name} · {m.household_name} · {m.source_site_uid}
          </Button>
        ))}
      </div>
      <section
        aria-label="Historical original capture patients"
        className="space-y-2"
      >
        <h3 className="font-semibold">
          Recover your earlier original captures
        </h3>
        <p>
          Owned capture history remains available when a patient’s household
          mapping changes.
        </p>
        {historical.isError && (
          <p role="alert">Historical capture patients unavailable.</p>
        )}
        {historical.data?.mappings.map((m) => (
          <Button
            key={m.link_id}
            variant="outline"
            disabled={locked}
            onClick={() => {
              setHistoryOnly(true);
              setMapping(m);
            }}
          >
            Earlier captures: {m.patient_name} · {m.household_name} ·{" "}
            {m.source_site_uid}
          </Button>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => void historical.refetch()}
          >
            Refresh historical capture patients
          </Button>
          <Button
            variant="outline"
            disabled={locked || !historyCursor}
            onClick={() => setHistoryCursor(null)}
          >
            Newest capture patients
          </Button>
          <Button
            variant="outline"
            disabled={locked || !historical.data?.next_cursor}
            onClick={() => setHistoryCursor(historical.data!.next_cursor)}
          >
            Older capture patients
          </Button>
        </div>
      </section>
      {mapping && historyOnly && (
        <div
          key={`historical:${actor}:${mapping.link_id}`}
          className="space-y-2"
        >
          <p>
            Historical capture patient: {mapping.patient_name} ·{" "}
            {mapping.household_name}
          </p>
          <p className="break-all text-sm">
            {mapping.source_origin} · {mapping.source_site_uid} · source animal{" "}
            {mapping.external_id}
          </p>
          <AttachmentOriginalCapture
            actor={actor}
            mapping={mapping}
            observations={[]}
            disabled={false}
            onDirtyChange={setLocked}
          />
        </div>
      )}
      {mapping && !historyOnly && (
        <AttachmentPatient
          key={`${actor}:${mapping.link_id}:${mapping.source_origin}:${mapping.source_site_uid}`}
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
  mapping: AttachmentMapping;
  onLocked: (value: boolean) => void;
}
function AttachmentPatient({ actor, mapping, onLocked }: PatientProps) {
  const [id, setId] = useState<string | null>(null);
  const idRef = useRef<string | null>(null);
  const [run, setRun] = useState<AttachmentRun | null>(null);
  const [captureDirty, setCaptureDirty] = useState(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [runCursor, setRunCursor] = useState<AttachmentRunCursor | null>(null);
  const [observationCursor, setObservationCursor] =
    useState<AttachmentObservationCursor | null>(null);
  const alive = useRef(true),
    lock = useRef(false);
  const key = `lrv-ezyvet-attachment-run:${actor}:${mapping.link_id}`;
  const runs = useQuery({
    queryKey: ["attachment-runs", actor, mapping, runCursor],
    queryFn: () => listAttachmentRuns(actor, mapping, runCursor),
    retry: false,
  });
  const observations = useQuery({
    queryKey: [
      "attachment-observations",
      actor,
      mapping,
      run,
      observationCursor,
    ],
    enabled: !!run,
    queryFn: () => listAttachmentObservations(run!, mapping, observationCursor),
    retry: false,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onLocked(false);
    };
  }, [onLocked]);
  useEffect(() => {
    onLocked(busy || uncertain || captureDirty);
  }, [busy, uncertain, captureDirty, onLocked]);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      /* Server history still discovers committed runs. */
    }
    if (
      saved &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        saved,
      )
    )
      saved = null;
    idRef.current = saved;
    setId(saved);
    setUncertain(!!saved);
    if (saved)
      setNotice(
        "An earlier request is retained. Recheck its saved state before continuing.",
      );
  }, [key]);
  function persist(value: string) {
    // Persist before sending; if unavailable, leave the provider untouched.
    sessionStorage.setItem(key, value);
    idRef.current = value;
    setId(value);
  }
  async function work(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (alive.current)
        setError(
          "Attachment request could not be confirmed. Recheck the original run before continuing.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover(target = idRef.current) {
    if (!target) return;
    const saved = await recoverAttachmentRun(target, actor, mapping);
    if (!alive.current) return;
    setRun(saved);
    setUncertain(!saved);
    setObservationCursor(null);
    setNotice(
      !saved
        ? "No saved run is visible yet. Retry this same request; an in-flight request may still commit."
        : saved.status === "review_ready"
          ? "Metadata scan complete. Original files have not been captured or clinically approved."
          : saved.status === "page_limit_reached"
            ? "Scan safety limit reached. Additional metadata may remain."
            : "Saved run recovered. Check its lease and cooldown before continuing.",
    );
    await runs.refetch();
  }
  const blocked = (r: AttachmentRun) =>
    r.status !== "running" ||
    r.lease_active ||
    !!(r.retry_after && Date.parse(r.retry_after) > Date.now());
  async function stage() {
    let target = idRef.current;
    if (target) {
      const saved = await recoverAttachmentRun(target, actor, mapping);
      if (!alive.current) return;
      setRun(saved);
      if (saved && blocked(saved)) {
        setUncertain(false);
        setNotice(
          "Saved run cannot advance now. Review its state and cooldown.",
        );
        return;
      }
    } else {
      target = crypto.randomUUID();
      persist(target);
    }
    setUncertain(true);
    try {
      await stageAttachmentPage(target, mapping);
    } catch {
      if (alive.current)
        setError(
          "Page response unconfirmed. The original request is retained; source access may require administrator setup.",
        );
    }
    if (alive.current) await recover(target);
  }
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
        Each explicit request reads at most 10 metadata records. Attachment
        access must be commissioned separately.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={captureDirty || busy || !!(run && blocked(run))}
          onClick={() => void work(stage)}
        >
          {id
            ? "Fetch next attachment page using this run"
            : "Start attachment metadata scan"}
        </Button>
        <Button
          variant="outline"
          disabled={captureDirty || busy || !id}
          onClick={() => void work(() => recover())}
        >
          Recheck saved attachment run
        </Button>
        <Button
          variant="outline"
          disabled={
            captureDirty ||
            busy ||
            uncertain ||
            !run ||
            run.status === "running"
          }
          onClick={() => {
            sessionStorage.removeItem(key);
            idRef.current = null;
            setId(null);
            setRun(null);
            setNotice("");
            setObservationCursor(null);
          }}
        >
          Prepare a separate attachment scan
        </Button>
      </div>
      {id && (
        <p className="break-all text-xs">Attachment run reference: {id}</p>
      )}
      {run && (
        <div>
          <p>
            Saved state: {run.status} · next page {run.next_page}
            {run.lease_active ? " · worker lease active" : ""}
            {run.retry_after ? ` · retry after ${run.retry_after}` : ""}
          </p>
          <p>
            {run.observed_count} metadata observations · {run.staged_count}{" "}
            distinct staged versions. This metadata scan does not capture files.
          </p>
          {run.last_error_code && (
            <p>Last scan result: {run.last_error_code}</p>
          )}
        </div>
      )}
      <section aria-label="Attachment scan history" className="space-y-2">
        <h3 className="font-semibold">Saved attachment scans</h3>
        {runs.isError && (
          <p role="alert">Attachment run history unavailable.</p>
        )}
        {runs.data?.runs.length === 0 && <p>No saved scans on this page.</p>}
        {runs.data?.runs.map((r) => (
          <div key={r.id} className="rounded border p-2">
            <p>
              {r.created_at} · {r.status} · {r.observed_count} observations ·{" "}
              {r.staged_count} staged versions
            </p>
            <Button
              variant="outline"
              disabled={captureDirty || busy || uncertain}
              onClick={() =>
                void work(async () => {
                  persist(r.id);
                  setRun(null);
                  setUncertain(true);
                  await recover(r.id);
                })
              }
            >
              Recover attachment scan {r.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={captureDirty || busy}
            onClick={() =>
              void work(async () => {
                await runs.refetch();
                if (run) await observations.refetch();
              })
            }
          >
            Refresh attachment data
          </Button>
          <Button
            variant="outline"
            disabled={captureDirty || busy || !runCursor}
            onClick={() => setRunCursor(null)}
          >
            Newest attachment scans
          </Button>
          <Button
            variant="outline"
            disabled={captureDirty || busy || !runs.data?.next_cursor}
            onClick={() => setRunCursor(runs.data!.next_cursor)}
          >
            Older attachment scans
          </Button>
        </div>
      </section>
      <AttachmentOriginalCapture
        actor={actor}
        mapping={mapping}
        observations={observations.data?.observations ?? []}
        disabled={busy || uncertain}
        onDirtyChange={setCaptureDirty}
      />
      {run && (
        <section aria-label="Attachment observations" className="space-y-2">
          <h3 className="font-semibold">Observed attachment metadata</h3>
          <p>
            Source metadata only. Independent original captures appear in the
            capture panel below.
          </p>
          {observations.isError && (
            <p role="alert">Attachment observations unavailable.</p>
          )}
          {observations.data?.observations.length === 0 && (
            <p>No observations on this page.</p>
          )}
          {observations.data?.observations.map((o) => (
            <article
              key={`${o.page}:${o.ordinal}`}
              className="space-y-2 rounded border p-3"
            >
              <h4 className="font-medium break-words">
                {o.metadata.name || `Attachment ${o.external_id}`}
              </h4>
              <p>
                Page {o.page} · observation {o.ordinal} · source attachment{" "}
                {o.external_id} · file reference {o.file_id}
              </p>
              <p
                className={
                  o.is_current ? "text-muted-foreground" : "text-destructive"
                }
              >
                {o.is_current
                  ? "Current metadata observation"
                  : "Stale metadata or patient mapping — retained as history"}
              </p>
              <dl className="space-y-1">
                {Object.entries(o.metadata).map(([field, value]) => (
                  <div key={field}>
                    <dt className="font-medium">{field}</dt>
                    <dd className="whitespace-pre-wrap break-words">
                      {value === null ? "Not supplied" : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>Metadata provenance</summary>
                <p className="break-all text-xs">
                  Raw record digest: {o.raw_record_sha256}
                  <br />
                  Stable metadata digest: {o.stable_metadata_sha256}
                  <br />
                  Snapshot: {o.snapshot_id} · observed revision{" "}
                  {o.observed_head_version}
                  <br />
                  Observed: {o.created_at}
                </p>
              </details>
            </article>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={captureDirty || busy || !observationCursor}
              onClick={() => setObservationCursor(null)}
            >
              First attachment observations
            </Button>
            <Button
              variant="outline"
              disabled={captureDirty || busy || !observations.data?.next_cursor}
              onClick={() =>
                setObservationCursor(observations.data!.next_cursor)
              }
            >
              Next attachment observations
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
