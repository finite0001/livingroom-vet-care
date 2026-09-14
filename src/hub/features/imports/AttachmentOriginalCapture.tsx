import { AttachmentDecisionForm } from "./AttachmentDecisionForm";
import { AttachmentReviewHistory } from "./AttachmentReviewHistory";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  captureIntentSchema,
  canAdvanceCapture,
  intentOf,
} from "./attachment-capture-state";
import type {
  CaptureIntent,
  CaptureCursor,
  OriginalCapture,
} from "./attachment-capture-state";
import {
  prepareCapture,
  abandonCapturePreparation,
  recoverCapture,
  listCaptures,
  captureAction,
  retrieveCapture,
} from "./attachment-capture-api";
import type {
  AttachmentMapping,
  AttachmentObservation,
} from "./attachment-api";
interface Props {
  actor: string;
  mapping: AttachmentMapping;
  observations: AttachmentObservation[];
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
const labels = {
  prepared: "Queued",
  reserved: "Verifying saved file",
  ready: "Original captured privately",
  blocked: "Capture blocked",
  discarding: "Discard in progress",
  abandoned: "Unfinished capture discarded",
};
export function AttachmentOriginalCapture({
  actor,
  mapping,
  observations,
  disabled,
  onDirtyChange,
}: Props) {
  const [decisionLocked, setDecisionLocked] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [verifiedHash, setVerifiedHash] = useState<string | null>(null);
  const onDecisionState = useCallback((locked: boolean, working: boolean) => {
    setDecisionLocked(locked);
    setDecisionBusy(working);
  }, []);
  const [selected, setSelected] = useState("");
  const [intent, setIntent] = useState<CaptureIntent | null>(null),
    intentRef = useRef<CaptureIntent | null>(null);
  const [capture, setCapture] = useState<OriginalCapture | null>(null);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [cursor, setCursor] = useState<CaptureCursor | null>(null);
  const alive = useRef(true),
    lock = useRef(false),
    generation = useRef(0),
    urls = useRef<string[]>([]);
  const key = `lrv-ezyvet-attachment-capture:${actor}:${mapping.link_id}`;
  const history = useQuery({
    queryKey: ["attachment-captures", actor, mapping, cursor],
    queryFn: () => listCaptures(actor, mapping, cursor),
    retry: false,
  });
  useEffect(() => {
    onDirtyChange(busy || uncertain || decisionLocked);
  }, [busy, uncertain, decisionLocked, onDirtyChange]);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      generation.current++;
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
    };
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actor) {
        alive.current = false;
        clear();
      }
    });
    window.addEventListener("pagehide", clear);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = captureIntentSchema.parse(JSON.parse(raw));
        if (saved.p_animal_link_id !== mapping.link_id)
          throw new Error("Mapping differs");
        intentRef.current = saved;
        setIntent(saved);
        setUncertain(true);
        setNotice(
          "Original capture request retained. Recheck its saved state.",
        );
      }
    } catch {
      setError(
        "Saved capture reference unavailable. Use owned capture history to recover.",
      );
    }
    return () => {
      alive.current = false;
      clear();
      auth.data.subscription.unsubscribe();
      window.removeEventListener("pagehide", clear);
      onDirtyChange(false);
    };
  }, [actor, key, mapping.link_id, onDirtyChange]);
  const row = observations.find(
    (o) => `${o.run_id}:${o.page}:${o.ordinal}` === selected,
  );
  function persist(value: CaptureIntent) {
    const parsed = captureIntentSchema.parse(value);
    sessionStorage.setItem(key, JSON.stringify(parsed));
    intentRef.current = parsed;
    setIntent(parsed);
    setUncertain(true);
    setConfirmDiscard(false);
  }
  async function work(action: () => Promise<void>) {
    if (lock.current || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (alive.current)
        setError(
          "Original capture unavailable or unconfirmed. Recheck the same request before retrying.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover(p = intentRef.current) {
    if (!p) return null;
    const saved = await recoverCapture(p.p_id, actor, mapping, p);
    if (!alive.current) return null;
    setCapture(saved);
    setUncertain(!saved);
    setConfirmDiscard(false);
    setNotice(
      saved
        ? "Saved capture state recovered. Capture does not approve clinical content or make it available for release."
        : "No saved request is visible yet. Keep this original reference and retry unchanged.",
    );
    await history.refetch();
    return saved;
  }
  async function abandonUnsaved() {
    const p = intentRef.current;
    if (!p || !confirmDiscard || capture) return;
    setUncertain(true);
    const result = await abandonCapturePreparation(p, actor, mapping);
    if (!alive.current) return;
    setCapture(result);
    setUncertain(false);
    setConfirmDiscard(false);
    setNotice(
      result.status === "abandoned"
        ? "Unsaved request abandoned on the server. A delayed preparation cannot restart it."
        : "The original request was saved concurrently. Review its actual state; unfinished saved captures require explicit discard.",
    );
    await history.refetch();
  }
  async function advance() {
    let p = intentRef.current;
    if (!p) {
      if (!row?.is_current) throw new Error("Current observation required");
      p = {
        p_id: crypto.randomUUID(),
        p_animal_link_id: mapping.link_id,
        p_run_id: row.run_id,
        p_page: row.page,
        p_ordinal: row.ordinal,
        p_snapshot_id: row.snapshot_id,
        p_observed_head_version: row.observed_head_version,
        p_stable_metadata_sha256: row.stable_metadata_sha256,
      };
      persist(p);
    }
    const saved = await recover(p);
    if (!alive.current) return;
    const prepared = saved ?? (await prepareCapture(p, actor, mapping));
    if (!alive.current) return;
    setCapture(prepared);
    if (!canAdvanceCapture(prepared)) {
      setUncertain(false);
      return;
    }
    setUncertain(true);
    try {
      await captureAction("capture", p.p_id);
    } catch {
      if (alive.current)
        setError("Capture response unconfirmed. Original request retained.");
    }
    if (alive.current) await recover(p);
  }
  async function discard() {
    const p = intentRef.current;
    if (!p || !confirmDiscard) return;
    const saved = await recover(p);
    if (!alive.current || !saved) return;
    if (["ready", "abandoned"].includes(saved.status)) return;
    setUncertain(true);
    try {
      await captureAction("discard", p.p_id);
    } catch {
      if (alive.current)
        setError("Discard response unconfirmed. Recheck the original request.");
    }
    if (alive.current) await recover(p);
  }
  async function download() {
    const p = intentRef.current;
    if (!p) return;
    const saved = await recover(p);
    if (!alive.current || saved?.status !== "ready" || !saved.capture) return;
    const epoch = generation.current;
    const blob = await retrieveCapture(saved);
    if (!alive.current || epoch !== generation.current) return;
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ezyvet-attachment-${saved.external_id}.${saved.capture.mime_type === "application/pdf" ? "pdf" : saved.capture.mime_type === "image/png" ? "png" : "jpg"}`;
    link.rel = "noopener noreferrer";
    link.click();
    setVerifiedHash(saved.capture.capture_hash);
    setNotice(
      "Original downloaded after byte checksum verification. No clinical approval occurred.",
    );
  }
  const frozen = busy || disabled || decisionLocked;
  return (
    <section
      aria-label="Original attachment capture"
      className="space-y-3 rounded-md border p-4"
    >
      <h3 className="text-lg font-semibold">Capture original attachment</h3>
      <p>
        Explicitly preserve one current attachment as a private API original.
        PDF, JPEG and PNG files up to 20 MiB are supported. This does not
        approve clinical content or add a record-release source.
      </p>
      <label className="block">
        Current attachment to capture
        <select
          className="mt-1 block w-full rounded-md border border-input bg-background p-2 text-foreground"
          disabled={frozen || !!intent || uncertain}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">
            Choose an observation from this metadata page
          </option>
          {observations.map((o) => (
            <option
              key={`${o.run_id}:${o.page}:${o.ordinal}`}
              value={`${o.run_id}:${o.page}:${o.ordinal}`}
              disabled={!o.is_current}
            >
              {o.metadata.name || `Attachment ${o.external_id}`} · file{" "}
              {o.file_id} · observation {o.page}/{o.ordinal}
              {o.is_current ? "" : " · stale"}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            frozen ||
            (!intent && !row?.is_current) ||
            !!(capture && !canAdvanceCapture(capture))
          }
          onClick={() => void work(advance)}
        >
          {intent ? "Retry original capture" : "Capture selected original"}
        </Button>
        <Button
          variant="outline"
          disabled={frozen || !intent}
          onClick={() =>
            void work(async () => {
              await recover();
            })
          }
        >
          Recheck original capture
        </Button>
        <Button
          variant="outline"
          disabled={
            frozen ||
            uncertain ||
            !capture ||
            !["ready", "blocked", "abandoned"].includes(capture.status)
          }
          onClick={() => {
            sessionStorage.removeItem(key);
            intentRef.current = null;
            setIntent(null);
            setCapture(null);
            setSelected("");
            setConfirmDiscard(false);
            setNotice("");
          }}
        >
          Choose another original
        </Button>
      </div>
      {intent && (
        <p className="break-all text-xs">Capture request: {intent.p_id}</p>
      )}
      {intent && uncertain && !capture && (
        <div className="space-y-2 rounded border p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmDiscard}
              disabled={frozen}
              onChange={(e) => setConfirmDiscard(e.target.checked)}
            />
            Abandon this unsaved request on the server before choosing another
            original.
          </label>
          <Button
            variant="outline"
            disabled={frozen || !confirmDiscard}
            onClick={() => void work(abandonUnsaved)}
          >
            Discard unsaved capture request
          </Button>
        </div>
      )}
      {capture && (
        <article className="space-y-2 rounded border p-3">
          <h4 className="font-medium">{labels[capture.status]}</h4>
          <p>
            {capture.metadata.name || `Attachment ${capture.external_id}`} ·
            source attachment {capture.external_id} · file {capture.file_id}
          </p>
          <p
            className={
              capture.source_current
                ? "text-muted-foreground"
                : "text-destructive"
            }
          >
            {capture.source_current
              ? "Source observation current"
              : "Source or patient mapping has changed; retained original evidence is historical."}
          </p>
          {capture.lease_active && (
            <p>Capture worker active. Recheck before retrying.</p>
          )}
          {capture.retry_after && <p>Retry after {capture.retry_after}</p>}
          {capture.last_error_code && (
            <p>Last result: {capture.last_error_code}</p>
          )}
          {capture.capture && (
            <>
              <p>
                {capture.capture.mime_type} · {capture.capture.file_size} bytes
                · captured {capture.capture.captured_at}
              </p>
              <p className="break-all text-xs">
                Byte SHA-256: {capture.capture.content_sha256}
              </p>
              <Button
                variant="outline"
                disabled={busy || disabled || decisionBusy || uncertain}
                onClick={() => void work(download)}
              >
                Download verified original
              </Button>
              <AttachmentDecisionForm key={`decision:${actor}:${capture.id}`} actor={actor} capture={capture} verifiedHash={verifiedHash} disabled={busy || disabled || uncertain} onState={onDecisionState} />
              <AttachmentReviewHistory key={`${actor}:${capture.id}`} actor={actor} capture={capture} disabled={frozen || uncertain} />
            </>
          )}
          {!["ready", "abandoned"].includes(capture.status) && (
            <div className="space-y-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmDiscard}
                  disabled={frozen || uncertain}
                  onChange={(e) => setConfirmDiscard(e.target.checked)}
                />
                Discard only this unfinished capture. Its request history will
                remain.
              </label>
              <Button
                variant="outline"
                disabled={frozen || uncertain || !confirmDiscard}
                onClick={() => void work(discard)}
              >
                {capture.status === "discarding"
                  ? "Resume unfinished discard"
                  : "Discard unfinished capture"}
              </Button>
            </div>
          )}
        </article>
      )}
      <section
        aria-label="Owned original capture history"
        className="space-y-2"
      >
        <h4 className="font-semibold">Your original capture requests</h4>
        {history.isError && <p role="alert">Capture history unavailable.</p>}
        {history.data?.captures.length === 0 && (
          <p>No capture requests on this page.</p>
        )}
        {history.data?.captures.map((c) => (
          <div key={c.id} className="rounded border p-2">
            <p>
              {c.metadata.name || `Attachment ${c.external_id}`} ·{" "}
              {labels[c.status]} · {c.created_at}
              {c.source_current ? "" : " · stale source"}
            </p>
            <Button
              variant="outline"
              disabled={frozen || uncertain}
              onClick={() =>
                void work(async () => {
                  const p = intentOf(c);
                  persist(p);
                  setCapture(null);
                  await recover(p);
                })
              }
            >
              Recover original {c.id.slice(0, 8)}
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={frozen}
            onClick={() => void history.refetch()}
          >
            Refresh original capture history
          </Button>
          <Button
            variant="outline"
            disabled={frozen || !cursor}
            onClick={() => setCursor(null)}
          >
            Newest original captures
          </Button>
          <Button
            variant="outline"
            disabled={frozen || !history.data?.next_cursor}
            onClick={() => setCursor(history.data!.next_cursor)}
          >
            Older original captures
          </Button>
        </div>
      </section>
    </section>
  );
}
