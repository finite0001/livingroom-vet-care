import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Capture } from "../lab-work/LabResultState";
import {
  ackSchema,
  recordSchema,
  matchesReceipt,
  pendingAction,
  resumeIntent,
  verification,
  type ExternalRecord,
  type HistoryPage,
  type Mapping,
  type PendingAction,
  type ReceiptPage,
  type Verification,
} from "./ExternalRecordState";
import {
  readHistory,
  readReceipts,
  readMappings,
  recoverAcknowledgment,
  submitAction,
  verifyAction,
  type Cursor,
} from "./ExternalRecordApi";
interface Props {
  petId: string;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
interface Document {
  id: string;
  pet_id: string;
  version: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  status: string;
}
interface InnerProps extends Props {
  actor: string;
  admin: boolean;
  dvm: boolean;
}
const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const date = (v: string) =>
  new Date(v).toLocaleString("en-US", { timeZone: "America/Denver" });
export function PatientExternalRecords(props: Props) {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active ? (
    <ExternalRecords
      key={`${session.user.id}:${props.petId}`}
      {...props}
      actor={session.user.id}
      admin={hasRole("ADMIN")}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
function ExternalRecords({
  petId,
  disabled,
  onDirtyChange,
  actor,
  admin,
  dvm,
}: InnerProps) {
  const [history, setHistory] = useState<HistoryPage | null>(null),
    [receipts, setReceipts] = useState<ReceiptPage | null>(null),
    [mappings, setMappings] = useState<Mapping[]>([]),
    [documents, setDocuments] = useState<Document[]>([]),
    [petVersion, setPetVersion] = useState<number | null>(null);
  const [historyCursor, setHistoryCursor] = useState<Cursor | null>(null),
    [receiptCursor, setReceiptCursor] = useState<Cursor | null>(null);
  const [mappingId, setMappingId] = useState(""),
    [documentId, setDocumentId] = useState(""),
    [exportRef, setExportRef] = useState(""),
    [reason, setReason] = useState(""),
    [previous, setPrevious] = useState<ExternalRecord | null>(null),
    [selected, setSelected] = useState<Verification | null>(null);
  const [checked, setChecked] = useState(false),
    [ackChecked, setAckChecked] = useState(""),
    [reviewedHash, setReviewedHash] = useState(""),
    [pending, setPending] = useState<PendingAction | null>(null),
    [draft, setDraft] = useState(false),
    [busy, setBusy] = useState(false),
    [absent, setAbsent] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pendingRef = useRef<PendingAction | null>(null),
    alive = useRef(true),
    initialized = useRef(false),
    lock = useRef(false),
    generation = useRef(0),
    urls = useRef<string[]>([]);
  const key = `external-record-intent:${actor}:${petId}`;
  const dirty =
    busy || draft || Boolean(pending) || checked || Boolean(ackChecked);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const clearReview = () => {
    generation.current++;
    setReviewedHash("");
    setChecked(false);
    setAckChecked("");
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current || !alive.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch {
      if (alive.current)
        setError(
          "Historical record work is unavailable or unconfirmed. Recover the original request before retrying. Changed patient, mapping, document or replacement history requires a new review.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const load = async (hc = historyCursor, rc = receiptCursor) => {
    const [h, d, p, m, r] = await Promise.all([
      readHistory(petId, hc),
      supabase
        .from("patient_documents")
        .select(
          "id,pet_id,version,file_name,file_path,file_size,mime_type,status",
        )
        .eq("pet_id", petId)
        .eq("status", "ready")
        .eq("category", "medical_record")
        .order("created_at", { ascending: false }),
      supabase.from("pets").select("version").eq("id", petId).single(),
      admin ? readMappings(petId) : Promise.resolve([]),
      admin ? readReceipts(petId, actor, rc) : Promise.resolve(null),
    ]);
    if (d.error) throw d.error;
    if (p.error) throw p.error;
    if (alive.current) {
      setHistory(h);
      setDocuments(
        d.data.filter(
          (v) =>
            ["application/pdf", "image/jpeg", "image/png"].includes(
              v.mime_type,
            ) &&
            v.file_size > 0 &&
            v.file_size <= 20 * 1024 * 1024,
        ),
      );
      setPetVersion(p.data.version);
      setMappings(m);
      setReceipts(r);
    }
  };
  const clearPending = () => {
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
    setAbsent(false);
  };
  const validateSaved = (v: unknown, p: PendingAction) => {
    const r = p.kind === "approve" ? recordSchema.parse(v) : ackSchema.parse(v);
    if (r.id !== p.args.p_id || r.actor_id !== actor)
      throw new Error("Original actor/request differs");
    const fieldNames: Record<string, string> = {
      p_expected_capture_hash: "capture_hash",
      p_expected_receipt_hash: "receipt_hash",
      p_expected_document_version: "document_version",
    };
    for (const [k, v] of Object.entries(p.args)) {
      if (k === "p_attest" || k === "p_pet_id") continue;
      if (
        (r as unknown as Record<string, unknown>)[
          fieldNames[k] ?? k.slice(2)
        ] !== v
      )
        throw new Error("Original action differs");
    }
    if (p.kind === "approve" && (r as ExternalRecord).pet_id !== petId)
      throw new Error("Patient differs");
  };
  const accept = (value: unknown, p?: PendingAction) => {
    const v = verification(
      value,
      petId,
      actor,
      p?.kind === "verify" ? String(p.args.p_id) : undefined,
    );
    if (v && p?.kind === "verify" && !matchesReceipt(v.receipt, p))
      throw new Error("Frozen receipt differs");
    if (v && alive.current) {
      setSelected(v);
      clearReview();
      if (v.capture && p?.kind === "verify") {
        clearPending();
        setDraft(false);
        setNotice(
          "Original bytes verified. Download and review the exact export before approving its patient-chart entry.",
        );
      }
    }
    return v;
  };
  const recoverPending = async () => {
    clearReview();
    setAbsent(false);
    const p = pendingRef.current;
    await load();
    if (!p || !alive.current) return;
    if (p.kind === "ack") {
      const a = await recoverAcknowledgment(String(p.args.p_id));
      if (!alive.current) return;
      if (a) {
        validateSaved(a, p);
        clearPending();
        setDraft(false);
        setNotice("The original veterinarian acknowledgment is saved.");
      } else {
        setAbsent(true);
        setNotice(
          "No saved acknowledgment found. Retry the original reviewed request or discard the uncreated local request.",
        );
      }
      return;
    }
    const id = String(p.kind === "verify" ? p.args.p_id : p.args.p_receipt_id);
    const v = accept(
      await verifyAction("recover", { p_receipt_id: id }),
      p.kind === "verify" ? p : undefined,
    );
    if (!alive.current) return;
    if (p.kind === "approve" && v?.record) {
      validateSaved(v.record, p);
      clearPending();
      setDraft(false);
      setNotice("The original approved record is saved in history.");
    } else if (p.kind === "approve" || !v) {
      setAbsent(true);
      setNotice(
        "No saved action found. Retry the original reviewed request or discard the uncreated local request.",
      );
    } else if (!v.capture)
      setNotice(
        "Receipt saved; byte verification is incomplete. Retry this exact original request.",
      );
  };
  const execute = async (p: PendingAction) => {
    const v = await submitAction(p);
    if (!alive.current) return;
    if (p.kind === "verify") accept(v, p);
    else {
      validateSaved(v, p);
      clearPending();
      clearReview();
      setDraft(false);
      if (p.kind === "approve") setSelected(null);
      setNotice(
        p.kind === "approve"
          ? "Reviewed historical original saved. Native clinical fields remain unchanged."
          : "Veterinarian acknowledgment saved for this exact original.",
      );
    }
    await load();
  };
  const start = (p: PendingAction) =>
    void run(async () => {
      if (disabled || pendingRef.current) throw new Error("Other draft active");
      const valid = pendingAction(p, petId);
      sessionStorage.setItem(key, JSON.stringify(valid));
      pendingRef.current = valid;
      setPending(valid);
      clearReview();
      try {
        await execute(valid);
      } catch {
        await recoverPending();
        if (pendingRef.current)
          throw new Error("Original action remains unconfirmed");
      }
    });
  useEffect(() => {
    alive.current = true;
    const objectUrls = urls.current;
    const leave = () => {
      clearReview();
      objectUrls.forEach(URL.revokeObjectURL);
    };
    window.addEventListener("pagehide", leave);
    const auth = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.user.id !== actor) {
        alive.current = false;
        sessionStorage.removeItem(key);
        leave();
      }
    });
    if (!initialized.current) {
      initialized.current = true;
      void run(async () => {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const p = pendingAction(JSON.parse(raw), petId);
          pendingRef.current = p;
          setPending(p);
        }
        await recoverPending();
      });
    }
    return () => {
      alive.current = false;
      objectUrls.forEach(URL.revokeObjectURL);
      window.removeEventListener("pagehide", leave);
      auth.data.subscription.unsubscribe();
    };
    // The keyed authenticated patient workspace owns the immutable operation and private bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const blocked = busy || disabled,
    frozen = blocked || Boolean(pending);
  const documentFor = (r: { document_id: string; document_version: number }) =>
    documents.find(
      (d) => d.id === r.document_id && d.version === r.document_version,
    );
  const download = (
    r: { document_id: string; document_version: number },
    c: Capture,
  ) =>
    void run(async () => {
      const g = generation.current,
        d = documentFor(r);
      if (!d) throw new Error("Original document unavailable");
      const { data, error } = await supabase.storage
        .from("patient-documents")
        .download(d.file_path);
      if (error) throw error;
      const bytes = await data.arrayBuffer(),
        hash = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (n) => n.toString(16).padStart(2, "0"),
        ).join("");
      if (hash !== c.content_sha256 || bytes.byteLength !== c.file_size)
        throw new Error("Original bytes differ");
      if (!alive.current || g !== generation.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: c.mime_type }));
      urls.current.push(url);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = d.file_name;
      a.rel = "noopener noreferrer";
      a.click();
      setReviewedHash(c.capture_hash);
      setNotice(
        "Verified original downloaded. Review the file before attesting.",
      );
    });
  const edit = (fn: () => void) => {
    fn();
    setDraft(true);
    clearReview();
  };
  const mapping = mappings.find((m) => m.id === mappingId),
    doc = documents.find((d) => d.id === documentId),
    r = selected?.receipt,
    c = selected?.capture;
  const close = () => {
    setSelected(null);
    setPrevious(null);
    setMappingId("");
    setDocumentId("");
    setExportRef("");
    setReason("");
    setDraft(false);
    clearReview();
  };
  return (
    <section
      aria-label="Historical external records"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-lg font-semibold">Reviewed historical originals</h2>
      <p className="text-sm text-muted-foreground">
        Manual ezyVet exports preserved as original private files. Review does
        not imply an API connection, convert clinical facts, or update SOAP
        notes, diagnoses, vaccinations or billing.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Button
        variant="outline"
        disabled={blocked}
        onClick={() => void run(recoverPending)}
      >
        Recover historical record work
      </Button>
      {pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Original {pending.kind} request retained. Retry uses the same
            reviewed identifiers and arguments.
          </p>
          <Button
            disabled={blocked}
            onClick={() =>
              void run(async () => {
                await recoverPending();
                if (pendingRef.current) await execute(pendingRef.current);
              })
            }
          >
            Retry original historical record request
          </Button>
          {absent && (
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() =>
                void run(async () => {
                  const p = pendingRef.current;
                  if (!p) return;
                  const value =
                    p.kind === "ack"
                      ? await recoverAcknowledgment(String(p.args.p_id))
                      : verification(
                          await verifyAction("recover", {
                            p_receipt_id: String(
                              p.kind === "verify"
                                ? p.args.p_id
                                : p.args.p_receipt_id,
                            ),
                          }),
                          petId,
                          actor,
                        );
                  const exists =
                    p.kind === "approve"
                      ? Boolean((value as Verification | null)?.record)
                      : Boolean(value);
                  if (exists)
                    throw new Error("Original action now exists; recover it");
                  if (alive.current) {
                    clearPending();
                    setDraft(true);
                    setNotice(
                      "Uncreated local request discarded. Review current patient and document before a new action.",
                    );
                  }
                })
              }
            >
              Discard confirmed uncreated historical request
            </Button>
          )}
        </div>
      )}
      {admin && (
        <>
          <fieldset disabled={frozen} className="space-y-3">
            <legend className="font-medium">
              Stage a reviewed manual export
            </legend>
            <p className="text-sm">
              Patient version {petVersion ?? "unavailable"}.{" "}
              {previous
                ? `Replacement for export ${previous.export_reference}, version ${previous.version}. The server checks that this remains the latest version.`
                : "New original export. Use a stable source export reference; replacing an earlier original starts from its history entry below."}
            </p>
            <Label htmlFor="external-mapping">
              Approved ezyVet patient mapping
            </Label>
            <select
              id="external-mapping"
              className={selectClass}
              disabled={Boolean(previous)}
              value={mappingId}
              onChange={(e) => edit(() => setMappingId(e.target.value))}
            >
              <option value="">Select an approved patient identity</option>
              {mappings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.source_origin} · site {m.source_site_uid} · animal{" "}
                  {m.external_id}
                </option>
              ))}
            </select>
            {!mappings.length && (
              <p>
                An approved patient identity is required. Review the mapping in{" "}
                <Link className="text-primary underline" to="/hub/tools/ezyvet">
                  ezyVet import review
                </Link>
                .
              </p>
            )}
            {mapping && (
              <p className="text-sm">
                Mapping approved {date(mapping.created_at)} Denver by staff{" "}
                {mapping.approved_by}. Source references do not overwrite the
                local patient.
              </p>
            )}
            <Label htmlFor="external-document">
              Ready private medical-record original
            </Label>
            <select
              id="external-document"
              className={selectClass}
              value={documentId}
              onChange={(e) => edit(() => setDocumentId(e.target.value))}
            >
              <option value="">Select an uploaded medical record</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name} · document version {d.version}
                </option>
              ))}
            </select>
            <Label htmlFor="external-reference">Source export reference</Label>
            <Input
              id="external-reference"
              maxLength={500}
              readOnly={Boolean(previous)}
              value={exportRef}
              onChange={(e) => edit(() => setExportRef(e.target.value))}
            />
            <Label htmlFor="external-reason">
              Original/replacement review reason
            </Label>
            <Textarea
              id="external-reason"
              maxLength={2000}
              value={reason}
              onChange={(e) => edit(() => setReason(e.target.value))}
            />
            <Button
              disabled={
                !mapping ||
                !doc ||
                !petVersion ||
                !exportRef.trim() ||
                !reason.trim()
              }
              onClick={() =>
                start({
                  kind: "verify",
                  args: {
                    p_id: crypto.randomUUID(),
                    p_animal_link_id: mapping!.id,
                    p_expected_pet_version: petVersion!,
                    p_document_id: doc!.id,
                    p_document_version: doc!.version,
                    p_export_reference: exportRef.trim(),
                    p_received_at: new Date().toISOString(),
                    p_previous_record_id: previous?.id ?? null,
                    p_review_reason: reason.trim(),
                  },
                })
              }
            >
              Verify historical original bytes
            </Button>
          </fieldset>
          <Label htmlFor="external-receipt">
            Your staged and approved export receipts
          </Label>
          <select
            id="external-receipt"
            className={selectClass}
            disabled={blocked || Boolean(pending) || draft}
            value={r?.id ?? ""}
            onChange={(e) => {
              setSelected(
                receipts?.receipts.find(
                  (v) => v.receipt.id === e.target.value,
                ) ?? null,
              );
              clearReview();
            }}
          >
            <option value="">Select a saved receipt</option>
            {receipts?.receipts.map((v) => (
              <option key={v.receipt.id} value={v.receipt.id}>
                {v.receipt.export_reference} ·{" "}
                {v.record
                  ? "approved"
                  : v.capture
                    ? "bytes verified"
                    : "verification incomplete"}{" "}
                · {date(v.receipt.created_at)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={blocked || dirty || !receiptCursor}
              onClick={() =>
                void run(async () => {
                  await load(historyCursor, null);
                  if (alive.current) setReceiptCursor(null);
                })
              }
            >
              Newest export receipts
            </Button>
            <Button
              variant="outline"
              disabled={blocked || dirty || !receipts?.has_more}
              onClick={() =>
                void run(async () => {
                  const last = receipts?.receipts.at(-1)?.receipt;
                  if (!last) return;
                  const next = { at: last.created_at, id: last.id };
                  await load(historyCursor, next);
                  if (alive.current) setReceiptCursor(next);
                })
              }
            >
              Older export receipts
            </Button>
          </div>
          {r && (
            <div className="space-y-3 rounded-md border p-3">
              <h3 className="font-medium">Review frozen export provenance</h3>
              <p>
                {r.source_origin} · site {r.source_site_uid} · animal{" "}
                {r.source_animal_id}
              </p>
              <p>
                Export {r.export_reference} · received {date(r.received_at)}{" "}
                Denver · patient version {r.pet_version} · document version{" "}
                {r.document_version}
              </p>
              <p>
                {r.mime_type} · {r.file_size} bytes ·{" "}
                {r.previous_record_id
                  ? "Replacement of a preserved original"
                  : "Original export"}
              </p>
              <p>{r.review_reason}</p>
              {r.pet_version !== petVersion && (
                <p role="alert">
                  The local patient changed since this receipt was staged. This
                  receipt remains recoverable; approval requires a new reviewed
                  receipt.
                </p>
              )}
              {c ? (
                <>
                  <Button
                    variant="outline"
                    disabled={blocked || Boolean(pending) || !documentFor(r)}
                    onClick={() => download(r, c)}
                  >
                    Download verified historical original
                  </Button>
                  <details>
                    <summary>Original-file integrity</summary>
                    <p className="break-all text-xs">
                      SHA-256 {c.content_sha256}
                    </p>
                    <p>Verified {date(c.captured_at)} Denver</p>
                  </details>
                  {selected.record ? (
                    <p>
                      This export is already preserved in the patient chart.
                      Clinical acknowledgment remains separate.
                    </p>
                  ) : (
                    <>
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          disabled={frozen || reviewedHash !== c.capture_hash}
                          checked={checked}
                          onChange={(e) => setChecked(e.target.checked)}
                        />
                        I reviewed the downloaded original, approved ezyVet
                        identity, exact patient/document versions and
                        original/replacement provenance. This does not
                        acknowledge clinical review.
                      </label>
                      <Button
                        disabled={
                          frozen ||
                          !checked ||
                          !documentFor(r) ||
                          r.pet_version !== petVersion
                        }
                        onClick={() =>
                          start({
                            kind: "approve",
                            args: {
                              p_id: crypto.randomUUID(),
                              p_receipt_id: r.id,
                              p_expected_receipt_hash: r.receipt_hash,
                              p_expected_capture_hash: c.capture_hash,
                              p_attest: true,
                            },
                          })
                        }
                      >
                        Approve historical original in patient chart
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p>Original bytes are not yet verified.</p>
                  <Button
                    disabled={blocked || Boolean(pending) || !documentFor(r)}
                    onClick={() => {
                      try {
                        start(resumeIntent(r, actor, petId));
                      } catch {
                        setError(
                          "Original receipt metadata is unavailable for exact recovery.",
                        );
                      }
                    }}
                  >
                    Resume original export verification
                  </Button>
                </>
              )}
            </div>
          )}
        </>
      )}
      <div className="space-y-3">
        <h3 className="font-medium">Historical original versions</h3>
        {history && !history.records.length && (
          <p>No reviewed external originals on this page.</p>
        )}
        {history?.records.map((v) => (
          <article key={v.id} className="space-y-2 rounded-md border p-3">
            <h4 className="font-medium">
              {v.export_reference} · version {v.version} · {v.kind}
            </h4>
            <p>
              Staff-reviewed manual ezyVet export · {v.source_origin} · site{" "}
              {v.source_site_uid} · animal {v.source_animal_id}
            </p>
            <p>
              Received {date(v.received_at)} Denver · reviewed{" "}
              {date(v.created_at)} Denver by {v.actor_id}
            </p>
            <p>{v.review_reason}</p>
            <p>
              Document version {v.document_version} · {v.document_status}
            </p>
            <p>
              {v.acknowledgments.length
                ? `${v.acknowledgments.length} veterinarian acknowledgment(s) for this exact original.`
                : "No veterinarian acknowledgment for this version."}
            </p>
            {v.acknowledgments.map((a) => (
              <p key={a.id} className="text-sm">
                DVM {a.actor_id} · {date(a.created_at)} Denver
              </p>
            ))}
            <Button
              variant="outline"
              disabled={blocked || Boolean(pending) || !documentFor(v)}
              onClick={() => download(v, v.capture)}
            >
              Download {v.export_reference} version {v.version}
            </Button>
            {admin && (
              <Button
                variant="outline"
                disabled={blocked || dirty}
                onClick={() => {
                  setPrevious(v);
                  setMappingId(v.animal_link_id);
                  setExportRef(v.export_reference);
                  setDocumentId("");
                  setReason("");
                  setSelected(null);
                  setDraft(true);
                  clearReview();
                }}
              >
                Prepare replacement for {v.export_reference} version {v.version}
              </Button>
            )}
            {dvm && !v.acknowledgments.some((a) => a.actor_id === actor) && (
              <>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    disabled={frozen || reviewedHash !== v.capture_hash}
                    checked={ackChecked === v.id}
                    onChange={(e) =>
                      setAckChecked(e.target.checked ? v.id : "")
                    }
                  />
                  I reviewed the clinical original for {v.export_reference},
                  version {v.version}. This acknowledgment applies only to this
                  version.
                </label>
                <Button
                  disabled={frozen || ackChecked !== v.id || !documentFor(v)}
                  onClick={() =>
                    start({
                      kind: "ack",
                      args: {
                        p_id: crypto.randomUUID(),
                        p_record_id: v.id,
                        p_pet_id: petId,
                        p_expected_capture_hash: v.capture_hash,
                        p_expected_document_version: v.document_version,
                        p_attest: true,
                      },
                    })
                  }
                >
                  Acknowledge {v.export_reference} version {v.version}
                </Button>
              </>
            )}
          </article>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={blocked || dirty || !historyCursor}
            onClick={() =>
              void run(async () => {
                await load(null, receiptCursor);
                if (alive.current) setHistoryCursor(null);
              })
            }
          >
            Newest historical originals
          </Button>
          <Button
            variant="outline"
            disabled={blocked || dirty || !history?.has_more}
            onClick={() =>
              void run(async () => {
                const last = history?.records.at(-1);
                if (!last) return;
                const next = { at: last.created_at, id: last.id };
                await load(next, receiptCursor);
                if (alive.current) setHistoryCursor(next);
              })
            }
          >
            Older historical originals
          </Button>
        </div>
      </div>
      {!admin && (
        <p className="text-sm">
          An administrator reviews and preserves manual exports after patient
          identity mapping.
        </p>
      )}
      {!dvm && (
        <p className="text-sm">
          A veterinarian with the DVM role acknowledges clinical review
          separately; replacements require their own acknowledgment.
        </p>
      )}
      <Button
        variant="outline"
        disabled={blocked || Boolean(pending)}
        onClick={close}
      >
        Close historical record review
      </Button>
    </section>
  );
}
