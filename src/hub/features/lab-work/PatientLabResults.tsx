import { useQueryClient } from "@tanstack/react-query";
import { refreshPatientReleases } from "../record-releases/refresh";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LabDatabase, LabOrder } from "./model";
import {
  readLabResults,
  recoverLabReceipt,
  submitLabAction,
} from "./LabResultApi";
import {
  ackSchema,
  mappingSchema,
  reportSchema,
  sourceSchema,
  matchingSource,
  pendingLabAction,
  receiptMatchesIntent,
  resumeReceiptIntent,
  verification,
  type Capture,
  type LabResultHistory,
  type PendingLabAction,
  type Receipt,
  type Verification,
} from "./LabResultState";
interface Props {
  order: LabOrder;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
interface ReadyDocument {
  id: string;
  pet_id: string;
  version: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  status: string;
}
const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const showDate = (v: string) =>
  new Date(v).toLocaleString("en-US", { timeZone: "America/Denver" });
export function PatientLabResults(props: Props) {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active ? (
    <LabResults
      key={`${session.user.id}:${props.order.pet_id}:${props.order.id}`}
      {...props}
      actor={session.user.id}
      admin={hasRole("ADMIN")}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
interface InnerProps extends Props {
  actor: string;
  admin: boolean;
  dvm: boolean;
}
function LabResults({
  order,
  disabled,
  onDirtyChange,
  actor,
  admin,
  dvm,
}: InnerProps) {
  const releaseCache = useQueryClient();
  const [history, setHistory] = useState<LabResultHistory | null>(null),
    [documents, setDocuments] = useState<ReadyDocument[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [source, setSource] = useState(""),
    [patientRef, setPatientRef] = useState(""),
    [orderRef, setOrderRef] = useState(""),
    [mappingReason, setMappingReason] = useState(""),
    [mappingChecked, setMappingChecked] = useState(false);
  const [documentId, setDocumentId] = useState(""),
    [reportRef, setReportRef] = useState(""),
    [selected, setSelected] = useState<Verification | null>(null),
    [linkReason, setLinkReason] = useState(""),
    [linkChecked, setLinkChecked] = useState(false),
    [reviewedDocument, setReviewedDocument] = useState("");
  const [provider, setProvider] = useState("Antech"),
    [account, setAccount] = useState(""),
    [environment, setEnvironment] = useState(""),
    [sourceNote, setSourceNote] = useState(""),
    [sourceChecked, setSourceChecked] = useState(false),
    [ackChecked, setAckChecked] = useState("");
  const [pending, setPending] = useState<PendingLabAction | null>(null),
    [draft, setDraft] = useState(false),
    [loadedVersion, setLoadedVersion] = useState<number | null>(null),
    [absent, setAbsent] = useState(false);
  const pendingRef = useRef<PendingLabAction | null>(null),
    alive = useRef(true),
    lock = useRef(false),
    initialized = useRef(false),
    objectUrls = useRef<string[]>([]),
    reviewGeneration = useRef(0);
  const key = `lab-result-intent:${actor}:${order.pet_id}:${order.id}`;
  const dirty =
    busy ||
    draft ||
    Boolean(pending) ||
    mappingChecked ||
    linkChecked ||
    Boolean(ackChecked) ||
    sourceChecked;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const clearReview = () => {
    reviewGeneration.current++;
    setReviewedDocument("");
    setLinkChecked(false);
    setAckChecked("");
  };
  const load = async () => {
    const [h, d, o] = await Promise.all([
      readLabResults(order.pet_id, order.id),
      supabase
        .from("patient_documents")
        .select(
          "id,pet_id,version,file_name,file_path,file_size,mime_type,status",
        )
        .eq("pet_id", order.pet_id)
        .eq("status", "ready")
        .order("created_at", { ascending: false }),
      (supabase as unknown as SupabaseClient<LabDatabase>)
        .from("patient_lab_orders")
        .select("version")
        .eq("id", order.id)
        .eq("pet_id", order.pet_id)
        .single(),
    ]);
    if (d.error) throw d.error;
    if (o.error) throw o.error;
    const ov = (o.data as unknown as { version: number }).version;
    if (!Number.isInteger(ov)) throw new Error("Order version unavailable");
    if (alive.current) {
      setHistory(h);
      setDocuments(
        d.data.filter(
          (row) =>
            ["application/pdf", "image/jpeg", "image/png"].includes(
              row.mime_type,
            ) &&
            row.file_size >= 1 &&
            row.file_size <= 20 * 1024 * 1024,
        ),
      );
      setLoadedVersion(ov);
    }
    return h;
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
          "This action is unavailable or unconfirmed. Keep the original request and recover it before starting again. Changed order, source mapping or document versions require a fresh review.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const clearPending = () => {
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
  };
  const acceptVerification = (value: unknown, p?: PendingLabAction) => {
    const v = verification(
      value,
      order.pet_id,
      actor,
      p ? String(p.args.p_id) : undefined,
    );
    if (v && p && !receiptMatchesIntent(v.receipt, p))
      throw new Error("Original request differs");
    if (alive.current && v) {
      if (v.report) void refreshPatientReleases(releaseCache, order.pet_id);
      setSelected(v);
      clearReview();
      if (v.capture) {
        clearPending();
        setDraft(false);
        setNotice(
          v.report
            ? "This report was already linked. Review its history below."
            : "Original file bytes verified. Review source matching and the original report before linking.",
        );
      }
    }
    return v;
  };
  const recoverPending = async () => {
    clearReview();
    setMappingChecked(false);
    const p = pendingRef.current;
    setAbsent(false);
    const h = await load();
    if (!p || !alive.current) return;
    if (p.kind === "verify") {
      const v = acceptVerification(
        await recoverLabReceipt(String(p.args.p_id)),
        p,
      );
      if (!v) {
        setAbsent(true);
        setNotice(
          "No saved receipt was found. Retry the original verification request unchanged.",
        );
      } else if (!v.capture)
        setNotice(
          "Receipt saved; byte verification remains incomplete. Retry the original verification request unchanged.",
        );
      return;
    }
    const rows =
      p.kind === "source"
        ? h.sources
        : p.kind === "mapping"
          ? h.source_reviews
          : p.kind === "link"
            ? h.reports
            : h.reports.flatMap((r) => r.acknowledgments);
    const row = rows.find((r) => r.id === p.args.p_id && r.actor_id === actor);
    if (row) {
      validateResult(row, p);
      if (p.kind !== "source")
        void refreshPatientReleases(releaseCache, order.pet_id);
      clearPending();
      setDraft(false);
      setNotice("The original action is saved in history.");
      if (p.kind === "link") setSelected(null);
      setMappingChecked(false);
      setSourceChecked(false);
      clearReview();
    } else {
      setAbsent(true);
      setNotice(
        "No saved action was found. Retry the original reviewed request unchanged, or discard this uncreated local request.",
      );
    }
  };
  function validateResult(value: unknown, p: PendingLabAction) {
    const r =
      p.kind === "source"
        ? sourceSchema.parse(value)
        : p.kind === "mapping"
          ? mappingSchema.parse(value)
          : p.kind === "link"
            ? reportSchema.parse(value)
            : ackSchema.parse(value);
    if (r.id !== p.args.p_id || r.actor_id !== actor)
      throw new Error("Action identity differs");
    const fieldNames: Record<string, string> = {
      p_expected_order_version: "order_version",
      p_expected_capture_hash: "capture_hash",
      p_expected_receipt_hash: "receipt_hash",
      p_expected_document_version: "document_version",
    };
    for (const [k, v] of Object.entries(p.args)) {
      if (k === "p_attest" || (p.kind === "ack" && k === "p_pet_id")) continue;
      const field = fieldNames[k] ?? k.slice(2);
      if ((r as unknown as Record<string, unknown>)[field] !== v)
        throw new Error("Saved action differs from reviewed request");
    }
  }
  const execute = async (p: PendingLabAction) => {
    const value = await submitLabAction(p);
    if (!alive.current) return;
    if (p.kind === "verify") acceptVerification(value, p);
    else {
      validateResult(value, p);
      if (p.kind !== "source")
        void refreshPatientReleases(releaseCache, order.pet_id);
      if (p.kind === "link") setSelected(null);
      clearPending();
      setDraft(false);
      setMappingChecked(false);
      setLinkChecked(false);
      setAckChecked("");
      setSourceChecked(false);
      setNotice(
        "Reviewed action saved. Prior report history and native lab notes remain unchanged.",
      );
    }
    await load();
  };
  const begin = (
    kind: PendingLabAction["kind"],
    args: PendingLabAction["args"],
  ) =>
    void run(async () => {
      if (disabled || pendingRef.current)
        throw new Error("Another draft is active");
      const p = pendingLabAction(
        { kind, args: { p_id: crypto.randomUUID(), ...args } },
        order.pet_id,
        order.id,
      );
      setAbsent(false);
      sessionStorage.setItem(key, JSON.stringify(p));
      pendingRef.current = p;
      setPending(p);
      clearReview();
      try {
        await execute(p);
      } catch {
        await recoverPending();
        if (pendingRef.current)
          throw new Error("Original request remains unconfirmed");
      }
    });
  useEffect(() => {
    alive.current = true;
    const urls = objectUrls.current;
    const pagehide = () => {
      urls.forEach(URL.revokeObjectURL);
      clearReview();
    };
    window.addEventListener("pagehide", pagehide);
    const auth = supabase.auth.onAuthStateChange((_event, s) => {
      if (s?.user.id !== actor) {
        alive.current = false;
        sessionStorage.removeItem(key);
        objectUrls.current.forEach(URL.revokeObjectURL);
      }
    });
    if (!initialized.current) {
      initialized.current = true;
      void run(async () => {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const p = pendingLabAction(JSON.parse(raw), order.pet_id, order.id);
          pendingRef.current = p;
          setPending(p);
        }
        await recoverPending();
      });
    }
    return () => {
      alive.current = false;
      auth.data.subscription.unsubscribe();
      urls.forEach(URL.revokeObjectURL);
      window.removeEventListener("pagehide", pagehide);
    };
    // Each actor, patient and order owns its immutable pending operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    clearReview();
    setMappingChecked(false);
  }, [order.version]);
  const mapping = history?.source_reviews.at(-1),
    prior = history?.reports.at(-1),
    receipt = selected?.receipt,
    capture = selected?.capture;
  const document = documents.find((d) => d.id === documentId),
    blocked = busy || disabled,
    frozen = blocked || Boolean(pending),
    stale = loadedVersion !== order.version;
  const currentDocument = (
    r: Receipt | { document_id: string; document_version: number },
  ) =>
    documents.find(
      (d) => d.id === r.document_id && d.version === r.document_version,
    );
  const readOriginal = (
    r: { document_id: string; document_version: number },
    c: Capture,
  ) =>
    void run(async () => {
      const generation = reviewGeneration.current;
      const d = currentDocument(r);
      if (!d) throw new Error("Original report unavailable");
      const { data, error } = await supabase.storage
        .from("patient-documents")
        .download(d.file_path);
      if (error) throw error;
      const bytes = await data.arrayBuffer();
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (digest !== c.content_sha256 || bytes.byteLength !== c.file_size)
        throw new Error("Original report bytes changed");
      if (!alive.current || generation !== reviewGeneration.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: c.mime_type }));
      objectUrls.current.push(url);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = d.file_name;
      a.rel = "noopener noreferrer";
      a.click();
      setReviewedDocument(c.capture_hash);
      setNotice(
        "Verified original report downloaded. Review the file before confirming the next action.",
      );
    });
  const edit = (fn: () => void) => {
    fn();
    setDraft(true);
    setMappingChecked(false);
    setLinkChecked(false);
    setSourceChecked(false);
  };
  return (
    <section
      className="space-y-4 rounded-md border p-4"
      aria-label="Lab report provenance"
    >
      <h3 className="font-semibold">
        Original lab reports and clinical review
      </h3>
      <p className="text-sm text-muted-foreground">
        Manual import only. Source references are entered by staff; file
        verification does not establish a connection to Antech, interpret
        results, or release them to a client.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {stale && history && (
        <p role="alert">
          The saved lab order changed. Reload native lab work before reviewing a
          new source mapping or report link. Recovery and history remain
          available.
        </p>
      )}
      <Button
        variant="outline"
        disabled={blocked}
        onClick={() => void run(recoverPending)}
      >
        Recover saved lab result work
      </Button>
      {pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p>
            Original{" "}
            {pending.kind === "verify" ? "file verification" : pending.kind}{" "}
            request retained. Recovery checks saved history; retry uses the same
            reviewed arguments.
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
            Retry original lab result request
          </Button>
          {absent && (
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() =>
                void run(async () => {
                  const p = pendingRef.current;
                  if (!p) return;
                  const h = await readLabResults(order.pet_id, order.id);
                  const saved =
                    p.kind === "verify"
                      ? await recoverLabReceipt(String(p.args.p_id))
                      : p.kind === "source"
                        ? h.sources.find((r) => r.id === p.args.p_id)
                        : p.kind === "mapping"
                          ? h.source_reviews.find((r) => r.id === p.args.p_id)
                          : p.kind === "link"
                            ? h.reports.find((r) => r.id === p.args.p_id)
                            : h.reports
                                .flatMap((r) => r.acknowledgments)
                                .find((r) => r.id === p.args.p_id);
                  if (saved) throw new Error("Request now exists; recover it");
                  if (alive.current) {
                    clearPending();
                    setAbsent(false);
                    setDraft(true);
                    setNotice(
                      "Uncreated local request discarded. Review the current source and document again.",
                    );
                  }
                })
              }
            >
              Discard confirmed uncreated request
            </Button>
          )}
        </div>
      )}
      {history && (
        <>
          <fieldset disabled={frozen || stale} className="space-y-3">
            <legend className="font-medium">
              Review this order’s source identity
            </legend>
            {mapping && (
              <p className="text-sm">
                Current source mapping revision {mapping.revision}:{" "}
                {
                  history.sources.find(
                    (s) => s.id === mapping.source_account_id,
                  )?.provider_label
                }{" "}
                · patient {mapping.source_patient_reference} · order{" "}
                {mapping.source_order_reference}
              </p>
            )}
            <Label htmlFor="result-source">Reviewed source account</Label>
            <select
              id="result-source"
              className={selectClass}
              value={source}
              onChange={(e) => edit(() => setSource(e.target.value))}
            >
              <option value="">Select a manual source</option>
              {history.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.provider_label} · {s.account_reference} ·{" "}
                  {s.environment_label}
                </option>
              ))}
            </select>
            {!history.sources.length && (
              <p>
                No source account has been reviewed. An administrator can record
                a nonsecret manual source below.
              </p>
            )}
            <Label htmlFor="result-patient-ref">Source patient reference</Label>
            <Input
              id="result-patient-ref"
              value={patientRef}
              maxLength={500}
              onChange={(e) => edit(() => setPatientRef(e.target.value))}
            />
            <Label htmlFor="result-order-ref">Source order reference</Label>
            <Input
              id="result-order-ref"
              value={orderRef}
              maxLength={500}
              onChange={(e) => edit(() => setOrderRef(e.target.value))}
            />
            <Label htmlFor="result-mapping-reason">
              Source matching review reason
            </Label>
            <Textarea
              id="result-mapping-reason"
              value={mappingReason}
              maxLength={2000}
              onChange={(e) => edit(() => setMappingReason(e.target.value))}
            />
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={mappingChecked}
                onChange={(e) => setMappingChecked(e.target.checked)}
              />
              I reviewed the source account and patient/order references against
              this patient’s saved lab order, version {order.version}.
            </label>
            <Button
              disabled={
                !mappingChecked ||
                !source ||
                !patientRef.trim() ||
                !orderRef.trim() ||
                !mappingReason.trim()
              }
              onClick={() =>
                begin("mapping", {
                  p_order_id: order.id,
                  p_pet_id: order.pet_id,
                  p_expected_order_version: order.version,
                  p_source_account_id: source,
                  p_source_patient_reference: patientRef.trim(),
                  p_source_order_reference: orderRef.trim(),
                  p_previous_review_id: mapping?.id ?? null,
                  p_review_reason: mappingReason.trim(),
                  p_attest: true,
                })
              }
            >
              Save reviewed source mapping
            </Button>
          </fieldset>
          <fieldset disabled={frozen} className="space-y-3">
            <legend className="font-medium">
              Verify an original private report
            </legend>
            <p className="text-sm">
              Uses the source account and patient/order references entered
              above. A mismatched report remains staged and cannot be linked.
            </p>
            <Label htmlFor="result-private-report">
              Ready report for this patient
            </Label>
            <select
              id="result-private-report"
              className={selectClass}
              value={documentId}
              onChange={(e) => edit(() => setDocumentId(e.target.value))}
            >
              <option value="">Select an uploaded original</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.file_name} · version {d.version}
                </option>
              ))}
            </select>
            <Label htmlFor="result-report-ref">Source report reference</Label>
            <Input
              id="result-report-ref"
              maxLength={500}
              value={reportRef}
              onChange={(e) => edit(() => setReportRef(e.target.value))}
            />
            <Button
              disabled={
                !document ||
                !source ||
                !patientRef.trim() ||
                !orderRef.trim() ||
                !reportRef.trim()
              }
              onClick={() =>
                begin("verify", {
                  p_source_account_id: source,
                  p_document_id: document!.id,
                  p_document_version: document!.version,
                  p_source_patient_reference: patientRef.trim(),
                  p_source_order_reference: orderRef.trim(),
                  p_source_report_reference: reportRef.trim(),
                  p_received_at: new Date().toISOString(),
                })
              }
            >
              Verify original report bytes
            </Button>
          </fieldset>
          <Label htmlFor="result-staged">Staged reports for this patient</Label>
          <select
            id="result-staged"
            className={selectClass}
            disabled={blocked || Boolean(pending) || draft}
            value={receipt?.id ?? ""}
            onChange={(e) => {
              const r = history.staged_receipts.find(
                (r) => r.id === e.target.value,
              );
              setSelected(
                r ? { receipt: r, capture: r.capture, report: null } : null,
              );
              clearReview();
              setLinkReason("");
            }}
          >
            <option value="">Select a staged report</option>
            {history.staged_receipts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.source_report_reference} ·{" "}
                {r.capture ? "bytes verified" : "verification incomplete"}
              </option>
            ))}
          </select>
          {receipt && (
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="font-medium">Review staged report</h4>
              <p>
                Source:{" "}
                {
                  history.sources.find(
                    (s) => s.id === receipt.source_account_id,
                  )?.provider_label
                }{" "}
                ·{" "}
                {
                  history.sources.find(
                    (s) => s.id === receipt.source_account_id,
                  )?.account_reference
                }{" "}
                ·{" "}
                {
                  history.sources.find(
                    (s) => s.id === receipt.source_account_id,
                  )?.environment_label
                }
              </p>
              <p>
                Patient reference: {receipt.source_patient_reference} · order
                reference: {receipt.source_order_reference} · report reference:{" "}
                {receipt.source_report_reference}
              </p>
              <p>
                Received {showDate(receipt.received_at)} Denver · document
                version {receipt.document_version} · {receipt.mime_type} ·{" "}
                {receipt.file_size} bytes
              </p>
              {!matchingSource(receipt, mapping) && (
                <p role="alert">
                  This report does not match the current reviewed source
                  mapping. It remains staged.
                </p>
              )}
              {!currentDocument(receipt) && (
                <p role="alert">
                  The original document is unavailable at its verified version.
                  History remains available.
                </p>
              )}
              {capture ? (
                <>
                  <Button
                    variant="outline"
                    disabled={
                      blocked || Boolean(pending) || !currentDocument(receipt)
                    }
                    onClick={() => readOriginal(receipt, capture)}
                  >
                    Download verified original report
                  </Button>
                  <details>
                    <summary>File verification details</summary>
                    <p className="break-all text-xs">
                      SHA-256 {capture.content_sha256}
                    </p>
                    <p>Verified {showDate(capture.captured_at)} Denver</p>
                  </details>
                  <Label htmlFor="result-link-reason">
                    {prior
                      ? "Corrected report reason"
                      : "Report linking reason"}
                  </Label>
                  <Textarea
                    id="result-link-reason"
                    maxLength={2000}
                    disabled={frozen}
                    value={linkReason}
                    onChange={(e) => edit(() => setLinkReason(e.target.value))}
                  />
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      disabled={
                        frozen || reviewedDocument !== capture.capture_hash
                      }
                      checked={linkChecked}
                      onChange={(e) => setLinkChecked(e.target.checked)}
                    />
                    I reviewed the downloaded original, this patient and source
                    mapping, and{" "}
                    {prior
                      ? `the correction to report version ${prior.version}`
                      : "the original report link"}
                    . This does not acknowledge clinical review.
                  </label>
                  <Button
                    disabled={
                      frozen ||
                      stale ||
                      !linkChecked ||
                      !linkReason.trim() ||
                      !matchingSource(receipt, mapping) ||
                      !currentDocument(receipt) ||
                      Boolean(selected?.report) ||
                      history.reports.some((r) => r.receipt_id === receipt.id)
                    }
                    onClick={() =>
                      begin("link", {
                        p_receipt_id: receipt.id,
                        p_expected_receipt_hash: receipt.receipt_hash,
                        p_expected_capture_hash: capture.capture_hash,
                        p_order_id: order.id,
                        p_pet_id: order.pet_id,
                        p_expected_order_version: order.version,
                        p_source_review_id: mapping!.id,
                        p_previous_report_id: prior?.id ?? null,
                        p_kind: prior ? "corrected" : "original",
                        p_review_reason: linkReason.trim(),
                        p_attest: true,
                      })
                    }
                  >
                    {prior ? "Link corrected report" : "Link original report"}
                  </Button>
                </>
              ) : (
                <div className="space-y-2">
                  <p>
                    Byte verification is incomplete. The original staff member
                    can resume this exact receipt.
                  </p>
                  {receipt.actor_id === actor && (
                    <Button
                      disabled={
                        blocked || Boolean(pending) || !currentDocument(receipt)
                      }
                      onClick={() =>
                        void run(async () => {
                          const p = resumeReceiptIntent(
                            receipt,
                            actor,
                            order.pet_id,
                            order.id,
                          );
                          sessionStorage.setItem(key, JSON.stringify(p));
                          pendingRef.current = p;
                          setPending(p);
                          clearReview();
                          try {
                            await recoverPending();
                            if (pendingRef.current)
                              await execute(pendingRef.current);
                          } catch {
                            await recoverPending();
                            if (pendingRef.current)
                              throw new Error(
                                "Original verification remains incomplete",
                              );
                          }
                        })
                      }
                    >
                      Resume original byte verification
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <h4 className="font-medium">
              Report versions and veterinarian acknowledgment
            </h4>
            {!history.reports.length && (
              <p>No provenance-reviewed report has been linked.</p>
            )}
            {history.reports.map((r) => (
              <article key={r.id} className="space-y-2 rounded-md border p-3">
                <p className="font-medium">
                  Report version {r.version} · {r.kind}
                  {prior?.id === r.id ? " · current" : " · historical"}
                </p>
                <p>
                  {r.review_reason} · {showDate(r.created_at)} Denver
                </p>
                <p>
                  Document version {r.document_version} · {r.document_status}
                </p>
                <p>
                  {r.acknowledgments.length
                    ? `${r.acknowledgments.length} veterinarian acknowledgment(s) for this exact version.`
                    : "No veterinarian acknowledgment for this version."}
                </p>
                {r.acknowledgments.map((a) => (
                  <p key={a.id} className="text-sm">
                    DVM {a.actor_id} · {showDate(a.created_at)} Denver
                  </p>
                ))}
                <Button
                  variant="outline"
                  disabled={blocked || Boolean(pending) || !currentDocument(r)}
                  onClick={() => readOriginal(r, r.capture)}
                >
                  Download report version {r.version}
                </Button>
                {dvm &&
                  !r.acknowledgments.some((a) => a.actor_id === actor) && (
                    <>
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          disabled={
                            frozen || reviewedDocument !== r.capture_hash
                          }
                          checked={ackChecked === r.id}
                          onChange={(e) =>
                            setAckChecked(e.target.checked ? r.id : "")
                          }
                        />
                        I reviewed the original clinical report, version{" "}
                        {r.version}. This acknowledgment covers only this
                        version.
                      </label>
                      <Button
                        disabled={
                          frozen || ackChecked !== r.id || !currentDocument(r)
                        }
                        onClick={() =>
                          begin("ack", {
                            p_report_id: r.id,
                            p_pet_id: order.pet_id,
                            p_expected_capture_hash: r.capture_hash,
                            p_expected_document_version: r.document_version,
                            p_attest: true,
                          })
                        }
                      >
                        Record veterinarian acknowledgment for version{" "}
                        {r.version}
                      </Button>
                    </>
                  )}
              </article>
            ))}
            {!dvm && (
              <p className="text-sm text-muted-foreground">
                A veterinarian with the DVM role records clinical acknowledgment
                separately. Corrected reports require their own review.
              </p>
            )}
          </div>
          {admin && (
            <details>
              <summary>Register a manual lab source account</summary>
              <fieldset disabled={frozen} className="space-y-2">
                <p>
                  Nonsecret identifiers only. This records a manual source and
                  does not configure transport or credentials.
                </p>
                <Label htmlFor="result-provider">Provider label</Label>
                <Input
                  id="result-provider"
                  maxLength={200}
                  value={provider}
                  onChange={(e) => edit(() => setProvider(e.target.value))}
                />
                <Label htmlFor="result-account">
                  Practice source account reference
                </Label>
                <Input
                  id="result-account"
                  maxLength={200}
                  value={account}
                  onChange={(e) => edit(() => setAccount(e.target.value))}
                />
                <Label htmlFor="result-environment">
                  Source environment label
                </Label>
                <Input
                  id="result-environment"
                  maxLength={100}
                  value={environment}
                  onChange={(e) => edit(() => setEnvironment(e.target.value))}
                />
                <Label htmlFor="result-source-note">
                  Source identity review note
                </Label>
                <Textarea
                  id="result-source-note"
                  maxLength={2000}
                  value={sourceNote}
                  onChange={(e) => edit(() => setSourceNote(e.target.value))}
                />
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={sourceChecked}
                    onChange={(e) => setSourceChecked(e.target.checked)}
                  />
                  I reviewed these nonsecret manual source identifiers.
                </label>
                <Button
                  disabled={
                    !sourceChecked ||
                    !provider.trim() ||
                    !account.trim() ||
                    !environment.trim() ||
                    !sourceNote.trim()
                  }
                  onClick={() =>
                    begin("source", {
                      p_provider_label: provider.trim(),
                      p_account_reference: account.trim(),
                      p_environment_label: environment.trim(),
                      p_review_note: sourceNote.trim(),
                    })
                  }
                >
                  Register reviewed manual source
                </Button>
              </fieldset>
            </details>
          )}
        </>
      )}
      <Button
        variant="outline"
        disabled={blocked || Boolean(pending)}
        onClick={() => {
          setDraft(false);
          setMappingChecked(false);
          setLinkChecked(false);
          setSourceChecked(false);
          setAckChecked("");
          setSelected(null);
          setLinkReason("");
          setSource("");
          setPatientRef("");
          setOrderRef("");
          setMappingReason("");
          setDocumentId("");
          setReportRef("");
          setAccount("");
          setEnvironment("");
          setSourceNote("");
          clearReview();
          setNotice(
            "Local review closed. Saved provenance and report versions remain in history.",
          );
        }}
      >
        Close local report review
      </Button>
    </section>
  );
}
