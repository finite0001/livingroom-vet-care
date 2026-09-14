import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hub/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  readOriginalHistory,
  listOriginalCandidates,
  recoverOriginalAction,
  submitOriginalAction,
  downloadOriginal,
} from "./attachment-original-review-api";
import { reviewIntent } from "./attachment-original-review-state";
import type {
  ReviewIntent,
  ReviewCursor,
  OriginalReviewCandidate,
  OriginalHistoryRow,
  ApiOriginalRecord,
  OriginalReviewAction,
} from "./attachment-original-review-state";
interface Props {
  petId: string;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
interface InnerProps extends Props {
  actor: string;
  admin: boolean;
  dvm: boolean;
}
export function PatientAttachmentOriginals(props: Props) {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active ? (
    <Originals
      key={`${session.user.id}:${props.petId}`}
      {...props}
      actor={session.user.id}
      admin={hasRole("ADMIN")}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
function Originals({
  petId,
  disabled,
  onDirtyChange,
  actor,
  admin,
  dvm,
}: InnerProps) {
  const [cursor, setCursor] = useState<ReviewCursor | null>(null),
    [candidateCursor, setCandidateCursor] = useState<ReviewCursor | null>(null);
  const [selected, setSelected] = useState<OriginalReviewCandidate | null>(
      null,
    ),
    [reason, setReason] = useState(""),
    [attest, setAttest] = useState(false),
    [withdrawId, setWithdrawId] = useState<string | null>(null),
    [withdrawReason, setWithdrawReason] = useState("");
  const [verified, setVerified] = useState(""),
    [pending, setPending] = useState<ReviewIntent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pendingRef = useRef<ReviewIntent | null>(null),
    alive = useRef(true),
    lock = useRef(false),
    generation = useRef(0),
    urls = useRef<string[]>([]);
  const key = `api-original-review:${actor}:${petId}`;
  const history = useQuery({
    queryKey: ["api-original-history", actor, petId, cursor],
    queryFn: () => readOriginalHistory(petId, cursor),
    retry: false,
  });
  const candidates = useQuery({
    queryKey: ["api-original-candidates", actor, petId, candidateCursor],
    queryFn: () => listOriginalCandidates(petId, candidateCursor),
    enabled: admin,
    retry: false,
  });
  const dirty = busy || !!pending || !!selected || !!withdrawId || attest;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    alive.current = true;
    const clear = () => {
      generation.current++;
      urls.current.forEach(URL.revokeObjectURL);
      urls.current = [];
    };
    const auth = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.user.id !== actor) {
        alive.current = false;
        clear();
      }
    });
    window.addEventListener("pagehide", clear);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const p = reviewIntent(JSON.parse(raw), petId);
        pendingRef.current = p;
        setPending(p);
        setNotice("Original review action retained. Recheck before retrying.");
      }
    } catch {
      setError("Saved review reference unavailable.");
    }
    return () => {
      alive.current = false;
      clear();
      auth.data.subscription.unsubscribe();
      window.removeEventListener("pagehide", clear);
      onDirtyChange(false);
    };
  }, [actor, key, petId, onDirtyChange]);
  useEffect(() => {
    generation.current++;
    setVerified("");
    setAttest(false);
    if (!admin) {
      setSelected(null);
      setReason("");
      setWithdrawId(null);
      setWithdrawReason("");
    }
    // Pending action identity survives role changes for authorized recovery.
  }, [admin, dvm]);
  function clearDraft() {
    generation.current++;
    setSelected(null);
    setReason("");
    setAttest(false);
    setVerified("");
    setWithdrawId(null);
    setWithdrawReason("");
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
          "Original review unavailable or unconfirmed. Recover the same action before retrying.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function accept(result: OriginalReviewAction | null) {
    if (!alive.current) return;
    if (!result) {
      setNotice(
        "No saved action is visible. Retry unchanged or abandon it on the server; its reference is retained.",
      );
      return;
    }
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
    clearDraft();
    setNotice(
      result.status === "abandoned"
        ? "Review action abandoned. A late retry cannot commit it."
        : result.action === "approve"
          ? "Original admitted to the patient chart. Veterinary acknowledgment remains separate."
          : result.action === "acknowledge"
            ? "Veterinary acknowledgment saved for this exact record version."
            : "Withdrawal recorded. Original evidence and earlier acknowledgments remain in history.",
    );
    await history.refetch();
    if (admin) await candidates.refetch();
  }
  async function recover() {
    const p = pendingRef.current;
    if (p) await accept(await recoverOriginalAction(p, petId, actor));
  }
  async function execute(p: ReviewIntent, abandon = false) {
    const old = await recoverOriginalAction(p, petId, actor);
    if (!alive.current) return;
    if (old) {
      await accept(old);
      return;
    }
    const result = await submitOriginalAction(p, petId, actor, abandon);
    if (alive.current) await accept(result);
  }
  function start(p: ReviewIntent) {
    void work(async () => {
      if (pendingRef.current) throw new Error("Pending action");
      const parsed = reviewIntent(p, petId);
      sessionStorage.setItem(key, JSON.stringify(parsed));
      pendingRef.current = parsed;
      setPending(parsed);
      try {
        await execute(parsed);
      } catch {
        if (alive.current) await recover();
        if (pendingRef.current) throw new Error("Action unconfirmed");
      }
    });
  }
  function download(
    value: OriginalReviewCandidate | ApiOriginalRecord,
    admitted: boolean,
  ) {
    void work(async () => {
      setVerified("");
      setAttest(false);
      const epoch = generation.current;
      const blob = await downloadOriginal(value, actor, admitted);
      if (!alive.current || epoch !== generation.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ezyvet-original-${value.source_attachment_id}.${value.mime_type === "application/pdf" ? "pdf" : value.mime_type === "image/png" ? "png" : "jpg"}`;
      link.rel = "noopener noreferrer";
      link.click();
      setVerified(
        admitted
          ? (value as ApiOriginalRecord).record_hash
          : value.capture_hash,
      );
      setNotice(
        "Original downloaded after checksum verification. Review the file before attesting.",
      );
    });
  }
  const frozen = busy || disabled || !!pending;
  function approve() {
    if (!selected || !attest || verified !== selected.capture_hash) return;
    start({
      kind: "approve",
      args: {
        p_id: crypto.randomUUID(),
        p_pet_id: petId,
        p_capture_id: selected.capture_id,
        p_expected_capture_hash: selected.capture_hash,
        p_expected_patient_version: selected.patient_version,
        p_previous_record_id: selected.latest_record?.id ?? null,
        p_review_reason: reason.trim(),
        p_attest: true,
      },
    });
  }
  function acknowledge(row: OriginalHistoryRow) {
    const r = row.record as ApiOriginalRecord;
    if (verified !== r.record_hash || !attest) return;
    start({
      kind: "acknowledge",
      args: {
        p_id: crypto.randomUUID(),
        p_pet_id: petId,
        p_record_id: r.id,
        p_expected_record_hash: r.record_hash,
        p_expected_capture_hash: r.capture_hash,
        p_attest: true,
      },
    });
  }
  return (
    <section
      aria-label="Imported API originals"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-xl font-semibold">Imported API originals</h2>
      <p>
        Verified historical files admitted to this patient’s chart. Provenance
        admission and veterinary acknowledgment are separate. Latest,
        nonwithdrawn originals with DVM acknowledgment can be selected for
        reviewed record packages. Confirmation requires practice acceptance of
        the release policy.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="space-y-2 rounded border p-3">
          <p className="break-all">
            Unconfirmed {pending.kind} action: {pending.args.p_id}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || disabled}
              onClick={() => void work(recover)}
            >
              Recheck original review action
            </Button>
            <Button
              disabled={busy || disabled}
              onClick={() => void work(() => execute(pending))}
            >
              Retry original review action
            </Button>
            <Button
              variant="outline"
              disabled={busy || disabled}
              onClick={() => void work(() => execute(pending, true))}
            >
              Abandon original review action
            </Button>
          </div>
        </div>
      )}
      {admin && (
        <section
          aria-label="Owned API original admission"
          className="space-y-2"
        >
          <h3 className="font-semibold">
            Review your captured originals for admission
          </h3>
          {candidates.isError && (
            <p role="alert">Original admission candidates unavailable.</p>
          )}
          {candidates.data?.candidates.map((c) => (
            <div key={c.capture_id} className="rounded border p-2">
              <p>
                {c.metadata.name || `Attachment ${c.source_attachment_id}`} ·{" "}
                {c.source_site_uid} ·{" "}
                {c.source_current
                  ? "source current"
                  : "historical source observation"}
                {!c.mapping_current ? " · patient mapping changed" : ""}
                {c.admitted_record ? " · already admitted" : ""}
              </p>
              <Button
                variant="outline"
                disabled={frozen || !!withdrawId || !!selected}
                onClick={() => {
                  generation.current++;
                  setSelected(c);
                  setVerified("");
                  setAttest(false);
                  setReason("");
                }}
              >
                Review capture {c.capture_id.slice(0, 8)}
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={frozen || !!selected || !candidateCursor}
              onClick={() => setCandidateCursor(null)}
            >
              Newest admission candidates
            </Button>
            <Button
              variant="outline"
              disabled={frozen || !!selected || !candidates.data?.next_cursor}
              onClick={() => setCandidateCursor(candidates.data!.next_cursor)}
            >
              Older admission candidates
            </Button>
          </div>
          {selected && (
            <article
              aria-label="Selected API original admission"
              className="space-y-3 rounded border p-3"
            >
              <p>
                {selected.metadata.name ||
                  `Attachment ${selected.source_attachment_id}`}{" "}
                · {selected.mime_type} · {selected.file_size} bytes
              </p>
              <p className="break-all">
                {selected.source_origin} · {selected.source_site_uid} · animal{" "}
                {selected.source_animal_id} · attachment{" "}
                {selected.source_attachment_id} · file {selected.source_file_id}
              </p>
              <p>
                {selected.source_current
                  ? "Source current at discovery"
                  : "Historical source observation; admission does not assert current provider contents."}
              </p>
              {selected.latest_record && (
                <p>
                  Explicit replacement of chart version{" "}
                  {selected.latest_record.version}, record{" "}
                  {selected.latest_record.id}. Earlier evidence remains
                  available.
                </p>
              )}
              <Button
                variant="outline"
                disabled={frozen}
                onClick={() => download(selected, false)}
              >
                Download captured original for provenance review
              </Button>
              {selected.admitted_record ? (
                <p>
                  Already admitted as chart version{" "}
                  {selected.admitted_record.version}; use chart history for
                  clinical acknowledgment.
                </p>
              ) : (
                <>
                  <label className="block">
                    Provenance review reason
                    <Input
                      value={reason}
                      maxLength={2000}
                      disabled={frozen}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setAttest(false);
                      }}
                    />
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={attest}
                      disabled={
                        frozen ||
                        verified !== selected.capture_hash ||
                        !selected.mapping_current
                      }
                      onChange={(e) => setAttest(e.target.checked)}
                    />
                    I reviewed this downloaded captured original, patient/source
                    identity and{" "}
                    {selected.latest_record ? "replacement" : "original"}{" "}
                    provenance. This does not acknowledge clinical review.
                  </label>
                  <Button
                    disabled={
                      frozen ||
                      !selected.mapping_current ||
                      !attest ||
                      !reason.trim() ||
                      verified !== selected.capture_hash
                    }
                    onClick={approve}
                  >
                    {selected.latest_record
                      ? "Admit explicit replacement original"
                      : "Admit original to patient chart"}
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                disabled={busy || !!pending}
                onClick={clearDraft}
              >
                Cancel original admission review
              </Button>
            </article>
          )}
        </section>
      )}
      <section aria-label="API original chart history" className="space-y-3">
        <h3 className="font-semibold">Admitted original history</h3>
        {history.isError && (
          <p role="alert">API original chart history unavailable.</p>
        )}
        {history.data?.records.length === 0 && (
          <p>No API originals admitted to this chart.</p>
        )}
        {history.data?.records.map((row) => {
          const r = row.record as ApiOriginalRecord;
          return (
            <article key={r.id} className="space-y-2 rounded border p-3">
              <h4 className="font-medium">
                {r.metadata.name || `Attachment ${r.source_attachment_id}`} ·
                version {r.version}
              </h4>
              <p>
                {row.is_latest ? "Latest series version" : "Superseded version"}
                {row.withdrawal ? " · withdrawn" : ""} · provenance reviewed by{" "}
                {r.approved_by} at {r.approved_at}
              </p>
              <p>{r.review_reason}</p>
              <p>
                {r.source_current_at_review
                  ? "Source current at admission"
                  : "Historical source at admission"}{" "}
                · {r.source_site_uid} · source attachment{" "}
                {r.source_attachment_id}
              </p>
              <p className="break-all text-xs">
                Record {r.id} · byte SHA-256 {r.content_sha256}
              </p>
              {row.withdrawal && (
                <p>
                  Withdrawal: {row.withdrawal.reason} ·{" "}
                  {row.withdrawal.actor_id} · {row.withdrawal.created_at}
                </p>
              )}
              {row.acknowledgments.length === 0 ? (
                <p>
                  {row.is_latest && !row.withdrawal
                    ? "Clinical review pending."
                    : "No veterinary acknowledgment recorded for this historical version."}
                </p>
              ) : (
                row.acknowledgments.map((a) => (
                  <p key={a.id}>
                    DVM acknowledgment: {a.actor_id} · {a.created_at} · this
                    exact version
                  </p>
                ))
              )}
              {dvm && (
                <Button
                  variant="outline"
                  disabled={frozen || !!selected || !!withdrawId}
                  onClick={() => {
                    setAttest(false);
                    download(r, true);
                  }}
                >
                  Download chart original version {r.version}
                </Button>
              )}
              {dvm &&
                row.is_latest &&
                !row.withdrawal &&
                !row.acknowledgments.some((a) => a.actor_id === actor) && (
                  <>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={
                          frozen ||
                          !!selected ||
                          !!withdrawId ||
                          verified !== r.record_hash
                        }
                        checked={verified === r.record_hash && attest}
                        onChange={(e) => setAttest(e.target.checked)}
                      />
                      I clinically reviewed this exact downloaded original
                      version {r.version}.
                    </label>
                    <Button
                      disabled={
                        frozen ||
                        !!selected ||
                        !!withdrawId ||
                        !attest ||
                        verified !== r.record_hash
                      }
                      onClick={() => acknowledge(row)}
                    >
                      Acknowledge original version {r.version}
                    </Button>
                  </>
                )}
              {admin && row.is_latest && !row.withdrawal && (
                <Button
                  variant="outline"
                  disabled={frozen || !!selected || !!withdrawId}
                  onClick={() => {
                    generation.current++;
                    setVerified("");
                    setAttest(false);
                    setWithdrawId(r.id);
                    setWithdrawReason("");
                  }}
                >
                  Prepare withdrawal of version {r.version}
                </Button>
              )}
              {withdrawId === r.id && (
                <div className="space-y-2">
                  <label className="block">
                    Withdrawal reason
                    <Input
                      value={withdrawReason}
                      maxLength={2000}
                      disabled={frozen}
                      onChange={(e) => setWithdrawReason(e.target.value)}
                    />
                  </label>
                  <p>
                    Withdrawal retains the original and earlier acknowledgments
                    as historical evidence.
                  </p>
                  <Button
                    disabled={frozen || !withdrawReason.trim()}
                    onClick={() =>
                      start({
                        kind: "withdraw",
                        args: {
                          p_id: crypto.randomUUID(),
                          p_pet_id: petId,
                          p_record_id: r.id,
                          p_expected_record_hash: r.record_hash,
                          p_reason: withdrawReason.trim(),
                        },
                      })
                    }
                  >
                    Record withdrawal of version {r.version}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || !!pending}
                    onClick={clearDraft}
                  >
                    Cancel original withdrawal
                  </Button>
                </div>
              )}
            </article>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={frozen || dirty}
            onClick={() => void history.refetch()}
          >
            Refresh API original history
          </Button>
          <Button
            variant="outline"
            disabled={frozen || dirty || !cursor}
            onClick={() => setCursor(null)}
          >
            Newest chart originals
          </Button>
          <Button
            variant="outline"
            disabled={frozen || dirty || !history.data?.next_cursor}
            onClick={() => setCursor(history.data!.next_cursor)}
          >
            Older chart originals
          </Button>
        </div>
      </section>
    </section>
  );
}
