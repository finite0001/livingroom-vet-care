import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { downloadReviewedOriginal } from "../imports/attachment-chart-api";
import { sourceLabels, type SourceKind } from "../record-releases/selection";
import { readRelease } from "../record-releases/api";
import { RecordReleaseArtifact } from "../record-releases/RecordReleaseArtifact";
import { ReleaseEmailComposer } from "../record-releases/ReleaseEmailComposer";
import { DocumentSmsComposer } from "../document-links/DocumentSmsComposer";
import { renderRecordRelease } from "../record-releases/print";
import type { ReleaseArtifact, ReleaseBundle } from "../record-releases/print";
import { patientHref } from "../patient-360/model";
import { documents, evidence, packageReview, packages } from "./api";
import {
  detailSchema,
  selectClass,
  statusLabel,
  type RequestAction,
} from "./model";
import { useRequestAction } from "./use-request-action";
interface WorkspaceProps {
  actorId: string;
  data: z.infer<typeof detailSchema>;
  onDirty: (v: boolean) => void;
  refresh: () => Promise<void>;
}
export function RequestWorkspace({
  actorId,
  data,
  onDirty,
  refresh,
}: WorkspaceProps) {
  const r = data.request,
    action = useRequestAction(actorId);
  const [note, setNote] = useState(""),
    [target, setTarget] = useState("blocked"),
    [selection, setSelection] = useState<Record<string, string[]>>({}),
    [received, setReceived] = useState<Record<string, number>>({});
  const [clientAuthority, setClientAuthority] = useState(""),
    [verification, setVerification] = useState(""),
    [expires, setExpires] = useState(""),
    [attestAuthority, setAttestAuthority] = useState(false);
  const [reviewId, setReviewId] = useState(""),
    [transportDirty, setTransportDirty] = useState(false),
    [reviewDirty, setReviewDirty] = useState(false),
    [customDirty, setCustomDirty] = useState(false);
  const [proofId, setProofId] = useState("");
  const dirty =
    !!proofId ||
    !!note ||
    !!clientAuthority ||
    !!verification ||
    !!expires ||
    attestAuthority ||
    Object.keys(received).length > 0 ||
    customDirty ||
    action.unconfirmed ||
    transportDirty ||
    reviewDirty;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const closed = ["fulfilled", "cancelled"].includes(r.status),
    disabled =
      action.busy || action.unconfirmed || transportDirty || reviewDirty;
  const sources = useInfiniteQuery({
    queryKey: ["request-custom-sources", actorId, r.id],
    enabled:
      r.subset === "custom" &&
      r.direction === "outgoing" &&
      !closed &&
      !r.active_manifest_id,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => evidence(r.id, "sources", pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const originals = useInfiniteQuery({
    queryKey: ["request-originals", actorId, r.id],
    enabled: r.direction === "incoming" && !closed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => documents(r.id, pageParam),
    getNextPageParam: (last) => (last.length === 51 ? last[49].id : undefined),
  });
  const proofDocuments = useInfiniteQuery({
    queryKey: ["request-authorization-originals", actorId, r.id],
    enabled:
      r.recipient_kind === "third_party" &&
      !!data.manifest &&
      !data.authorization &&
      !closed,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => documents(r.id, pageParam),
    getNextPageParam: (last) => (last.length === 51 ? last[49].id : undefined),
  });
  const manifests = useInfiniteQuery({
    queryKey: [
      "request-packages",
      actorId,
      r.id,
      r.active_manifest_id,
      r.version,
    ],
    enabled: !!data.manifest,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      packages(r.id, r.active_manifest_id!, pageParam),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const [evidenceKind, setEvidenceKind] = useState<
      "history" | "receipts" | "exclusions"
    >("history"),
    [evidencePage, setEvidencePage] = useState(0);
  const ledger = useQuery({
    queryKey: [
      "request-evidence",
      actorId,
      r.id,
      r.version,
      evidenceKind,
      evidencePage,
    ],
    queryFn: () => evidence(r.id, evidenceKind, evidencePage),
    enabled: !!actorId,
  });
  const reset = async () => {
    setNote("");
    setProofId("");
    setClientAuthority("");
    setVerification("");
    setExpires("");
    setAttestAuthority(false);
    setReceived({});
    setSelection({});
    setCustomDirty(false);
    setReviewDirty(false);
    await refresh();
    if (r.active_manifest_id) await manifests.refetch();
    await ledger.refetch();
  };
  const submit = async (kind: RequestAction["kind"], values: unknown) => {
    try {
      const result = await action.save({
        kind,
        entityId: r.id,
        expectedVersion: r.version,
        values,
      });
      if (result) {
        await reset();
        return true;
      }
      return false;
    } catch (e) {
      action.setError(
        e instanceof z.ZodError
          ? "Review the selected evidence, review notes and required acknowledgments."
          : e instanceof Error
            ? e.message
            : "Review the request action",
      );
      return false;
    }
  };
  const prepare = () =>
    submit("manifest", {
      manifest_id: crypto.randomUUID(),
      selection: r.subset === "custom" ? selection : {},
      review_note: note,
    });
  return (
    <div className="space-y-6 [overflow-wrap:anywhere]">
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => void refresh()}
      >
        Refresh saved request — keep draft
      </Button>
      {action.error && <p role="alert">{action.error}</p>}
      {action.unconfirmed && (
        <div className="flex gap-2">
          <Button
            disabled={action.busy}
            onClick={() => void action.retry().then((v) => v && reset())}
          >
            Retry unchanged action
          </Button>
          <Button
            disabled={action.busy}
            onClick={() => void action.checkSaved().then((v) => v && reset())}
          >
            Check saved action
          </Button>
        </div>
      )}
      {!closed && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-display text-lg">Next action</h2>
          <Label htmlFor="request-review-note">Review note / reason</Label>
          <Textarea
            id="request-review-note"
            value={note}
            maxLength={2000}
            disabled={disabled}
            onChange={(e) => setNote(e.target.value)}
          />
          {r.direction === "outgoing" && (
            <>
              {r.subset === "custom" && !r.active_manifest_id && (
                <div aria-label="Exact source selection" className="space-y-2">
                  <p>
                    Select exact records. Any required originals and provenance
                    are included for review.
                  </p>
                  {sources.data?.pages
                    .flatMap((p) => p.items)
                    .map((item) => {
                      const family = String(item.family) as SourceKind,
                        id = String(item.id);
                      return (
                        <label
                          key={`${family}:${id}`}
                          className="flex gap-2 rounded-md border p-2"
                        >
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={selection[family]?.includes(id) ?? false}
                            onChange={(e) => {
                              setSelection((v) => ({
                                ...v,
                                [family]: e.target.checked
                                  ? [...(v[family] ?? []), id]
                                  : (v[family] ?? []).filter((x) => x !== id),
                              }));
                              setCustomDirty(true);
                            }}
                          />
                          <span>
                            {sourceLabels[family]} ·{" "}
                            {String(item.label ?? "Record")} ·{" "}
                            {String(item.recorded_at ?? "")}
                          </span>
                        </label>
                      );
                    })}
                  {sources.hasNextPage && (
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() => void sources.fetchNextPage()}
                    >
                      More eligible sources
                    </Button>
                  )}
                  {sources.isError && (
                    <p role="alert">
                      Could not load eligible sources.{" "}
                      <Button onClick={() => void sources.refetch()}>
                        Retry sources
                      </Button>
                    </p>
                  )}
                </div>
              )}
              {(!r.active_manifest_id ||
                (r.status === "preparing" &&
                  !data.authorization &&
                  !manifests.data?.pages.some((p) =>
                    p.items.some((x) => x.confirmed),
                  ))) && (
                <Button
                  disabled={disabled || !note.trim()}
                  onClick={() => void prepare()}
                >
                  {r.active_manifest_id
                    ? "Recapture unconfirmed chart"
                    : "Capture numbered packages"}
                </Button>
              )}
              <p className="text-sm text-muted-foreground">
                Capture lists the eligible chart and all exclusions. Each
                package still needs exact content and recipient review before
                delivery.
              </p>
            </>
          )}
          {r.direction === "incoming" && (
            <>
              <p>
                Review the actual finalized originals before recording receipt.
                Upload additional documents on the{" "}
                <Link
                  className="underline"
                  to={patientHref(r.pet_id, "documents")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  patient documents page
                </Link>
                .
              </p>
              {originals.data?.pages
                .flatMap((page) => page.slice(0, 50))
                .map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-3">
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={received[d.id] === d.version}
                        onChange={(e) =>
                          setReceived((v) => {
                            const n = { ...v };
                            if (e.target.checked) n[d.id] = d.version;
                            else delete n[d.id];
                            return n;
                          })
                        }
                      />
                      {d.file_name} · version {d.version}
                    </label>
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        void openOriginal(d.id, r.pet_id, d.version).catch(
                          (e) => action.setError(e.message),
                        )
                      }
                    >
                      Open original
                    </Button>
                  </div>
                ))}
              {originals.hasNextPage && (
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void originals.fetchNextPage()}
                >
                  More originals
                </Button>
              )}
              {originals.isError && (
                <p role="alert">
                  Could not load received originals.{" "}
                  <Button onClick={() => void originals.refetch()}>
                    Retry originals
                  </Button>
                </p>
              )}
              <Button
                disabled={
                  disabled || !note.trim() || !Object.keys(received).length
                }
                onClick={() =>
                  void submit("receive", {
                    documents: Object.entries(received).map(
                      ([id, version]) => ({ id, version }),
                    ),
                    review_note: note,
                  })
                }
              >
                Record reviewed receipt
              </Button>
            </>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="request-next-state">Change request status</Label>
              <select
                id="request-next-state"
                className={selectClass}
                disabled={disabled}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="blocked">Blocked</option>
                <option value="cancelled">Cancelled</option>
                {r.direction === "incoming" && (
                  <option value="awaiting_response">Awaiting response</option>
                )}
                {r.status === "blocked" &&
                  r.direction === "incoming" &&
                  data.receipt_count > 0 && (
                    <option value="received">
                      Resume reviewed incoming originals
                    </option>
                  )}
                {r.status === "blocked" && r.direction === "outgoing" && (
                  <option
                    value={
                      r.active_manifest_id
                        ? manifests.data?.pages.every((p) =>
                            p.items.every((x) => x.confirmed),
                          )
                          ? "ready"
                          : "preparing"
                        : "requested"
                    }
                  >
                    Resume saved package state
                  </option>
                )}
                {["received", "ready"].includes(r.status) && (
                  <option value="fulfilled">
                    Fulfilled — verify actual evidence
                  </option>
                )}
              </select>
            </div>
            <Button
              variant="outline"
              disabled={disabled || !note.trim()}
              onClick={() =>
                void submit("transition", { status: target, review_note: note })
              }
            >
              Save status
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Outgoing fulfillment requires provider-confirmed delivery of every
            package. It does not mean the recipient read it. Cancellation cannot
            recall an email already sent.
          </p>
        </section>
      )}
      {r.recipient_kind === "third_party" && data.manifest && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-display text-lg">
            Client authorization for this recipient
          </h2>
          <p>
            {r.recipient_name} · {r.recipient} · {data.manifest.package_count}{" "}
            packages · {data.manifest.source_count} sources
          </p>
          {!data.disclosure_policy_accepted && (
            <p role="status">
              Third-party disclosure is awaiting practice review. Authorization
              can be recorded; confirmation and delivery remain disabled.
            </p>
          )}
          {data.authorization ? (
            <>
              <p>
                Expires {data.authorization.expires_at} ·{" "}
                {data.authorization.revoked
                  ? "Revoked"
                  : data.authorization.current
                    ? "Current authorization"
                    : "Not currently eligible"}
              </p>
              <p className="whitespace-pre-wrap">
                Client authority: {data.authorization.client_authority}
              </p>
              <p className="whitespace-pre-wrap">
                Destination verified:{" "}
                {data.authorization.destination_verification}
              </p>
              {!data.authorization.revoked && closed && (
                <div>
                  <Label htmlFor="request-revocation-note">
                    Revocation reason
                  </Label>
                  <Textarea
                    id="request-revocation-note"
                    value={note}
                    maxLength={2000}
                    disabled={disabled}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              )}
              {!data.authorization.revoked && (
                <Button
                  variant="outline"
                  disabled={disabled || !note.trim()}
                  onClick={() =>
                    void submit("revoke_authorization", {
                      authorization_id: data.authorization!.id,
                      review_note: note,
                    })
                  }
                >
                  Revoke authorization using review note
                </Button>
              )}
            </>
          ) : (
            !closed && (
              <fieldset disabled={disabled} className="space-y-3">
                <div>
                  <Label htmlFor="request-authority">
                    Who authorized this release, when, and how?
                  </Label>
                  <Textarea
                    id="request-authority"
                    maxLength={2000}
                    value={clientAuthority}
                    onChange={(e) => setClientAuthority(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="request-destination-verification">
                    How did you independently verify this destination?
                  </Label>
                  <Textarea
                    id="request-destination-verification"
                    maxLength={2000}
                    value={verification}
                    onChange={(e) => setVerification(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="request-authorization-expiry">
                    Authorization expiry date (Denver)
                  </Label>
                  <Input
                    id="request-authorization-expiry"
                    type="date"
                    value={expires}
                    onChange={(e) => setExpires(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="request-authorization-evidence">
                    Supporting authorization document (optional)
                  </Label>
                  <select
                    id="request-authorization-evidence"
                    className={selectClass}
                    value={proofId}
                    onChange={(e) => setProofId(e.target.value)}
                  >
                    <option value="">Use the recorded authority notes</option>
                    {proofDocuments.data?.pages
                      .flatMap((page) => page.slice(0, 50))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.file_name} · version {d.version}
                        </option>
                      ))}
                  </select>
                  <p className="text-sm text-muted-foreground">
                    Store private authorization evidence as an internal patient
                    document. Choosing it here does not add it to the medical
                    records package.
                  </p>
                  {proofDocuments.hasNextPage && (
                    <Button
                      variant="outline"
                      onClick={() => void proofDocuments.fetchNextPage()}
                    >
                      More supporting documents
                    </Button>
                  )}
                  {proofDocuments.isError && (
                    <p role="alert">
                      Could not load supporting documents.{" "}
                      <Button onClick={() => void proofDocuments.refetch()}>
                        Retry supporting documents
                      </Button>
                    </p>
                  )}
                </div>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={attestAuthority}
                    onChange={(e) => setAttestAuthority(e.target.checked)}
                  />
                  I verified client authority and this recipient’s email, and
                  reviewed the exact scope of every numbered package below.
                </label>
                <Button
                  disabled={
                    !attestAuthority ||
                    !clientAuthority.trim() ||
                    !verification.trim() ||
                    !expires
                  }
                  onClick={() =>
                    void submit("authorize", {
                      authorization_id: crypto.randomUUID(),
                      manifest_hash: data.manifest!.fingerprint,
                      client_authority: clientAuthority,
                      destination_verification: verification,
                      evidence_document_id: proofId || null,
                      evidence_document_version: proofId
                        ? proofDocuments.data?.pages
                            .flatMap((page) => page.slice(0, 50))
                            .find((d) => d.id === proofId)?.version
                        : null,
                      expires_on: expires,
                      attest_client_authority: true,
                      attest_destination: true,
                      attest_source_scope: true,
                    })
                  }
                >
                  Record exact client authorization
                </Button>
              </fieldset>
            )
          )}
        </section>
      )}
      {data.manifest && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">Numbered packages</h2>
          <p>
            Chart captured {data.manifest.captured_at} ·{" "}
            {data.manifest.package_count} packages ·{" "}
            {data.manifest.source_count} sources
          </p>
          {manifests.data?.pages
            .flatMap((p) => p.items)
            .map((p) => (
              <article
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div>
                  <h3 className="font-semibold">
                    Package {p.ordinal} of {data.manifest!.package_count}
                  </h3>
                  <p>
                    {p.confirmed ? "Confirmed" : "Needs review"}
                    {p.scope_expansion
                      ? " · Required original/provenance expands laboratory scope"
                      : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.deliveries.length
                      ? p.deliveries.map((d) => statusLabel(d.state)).join(", ")
                      : "No delivery queued"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setReviewId(p.id)}
                >
                  Review package {p.ordinal}
                </Button>
              </article>
            ))}
          {manifests.hasNextPage && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void manifests.fetchNextPage()}
            >
              More packages
            </Button>
          )}
          {manifests.isError && (
            <p role="alert">
              Could not load packages.{" "}
              <Button onClick={() => void manifests.refetch()}>
                Retry packages
              </Button>
            </p>
          )}
          {reviewId && (
            <PackagePanel
              key={reviewId}
              id={reviewId}
              data={data}
              actorId={actorId}
              disabled={action.busy || action.unconfirmed}
              onDirty={setReviewDirty}
              onTransportDirty={setTransportDirty}
              onConfirmed={(values) => submit("confirm", values)}
              refresh={refresh}
            />
          )}
        </section>
      )}
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-display text-lg">Request evidence</h2>
        <Label htmlFor="request-evidence-kind">Show</Label>
        <select
          id="request-evidence-kind"
          className={selectClass}
          value={evidenceKind}
          onChange={(e) => {
            setEvidenceKind(e.target.value as typeof evidenceKind);
            setEvidencePage(0);
          }}
        >
          <option value="history">Saved request history</option>
          <option value="receipts">Received original evidence</option>
          {data.manifest && (
            <option value="exclusions">Excluded / out-of-scope records</option>
          )}
        </select>
        {ledger.data?.items.map((item, i) => (
          <article key={i} className="rounded-md border p-3">
            {evidenceKind === "history" ? (
              <>
                <p>
                  Version {String(item.version)} · {String(item.created_at)}
                </p>
                <p>
                  {statusLabel(
                    String(
                      (item.snapshot as Record<string, unknown>)?.status ?? "",
                    ),
                  )}
                </p>
                <p className="whitespace-pre-wrap">
                  {String(
                    (item.snapshot as Record<string, unknown>)?.request_note ??
                      "",
                  )}
                </p>
                {item.action && (
                  <p className="whitespace-pre-wrap">
                    Review:{" "}
                    {String(
                      (item.action as Record<string, unknown>).review_note ??
                        "Request details saved",
                    )}
                  </p>
                )}
              </>
            ) : evidenceKind === "receipts" ? (
              <>
                <p>
                  {String(
                    (item.original as Record<string, unknown>)?.file_name ??
                      "Original",
                  )}{" "}
                  · version {String(item.document_version)}
                </p>
                <p>
                  {item.current_available
                    ? "Current original is available"
                    : "Historical receipt retained; current original unavailable"}
                </p>
                <p className="whitespace-pre-wrap">
                  {String(item.review_note)}
                </p>
              </>
            ) : (
              <>
                <p>
                  {sourceLabels[String(item.family) as SourceKind] ?? "Record"}{" "}
                  · {String(item.label)}
                </p>
                <p>{String(item.reason)}</p>
              </>
            )}
          </article>
        ))}
        {ledger.isError && (
          <p role="alert">
            Could not load evidence.{" "}
            <Button onClick={() => void ledger.refetch()}>
              Retry evidence
            </Button>
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={evidencePage === 0}
            onClick={() => setEvidencePage(Math.max(0, evidencePage - 50))}
          >
            Previous evidence
          </Button>
          <Button
            variant="outline"
            disabled={ledger.data?.next == null}
            onClick={() => setEvidencePage(ledger.data!.next!)}
          >
            Next evidence
          </Button>
        </div>
      </section>
    </div>
  );
}
function artifact(bundle: ReleaseBundle): ReleaseArtifact {
  return {
    preview: bundle.release,
    package_context: bundle.package_context,
    confirmed: {
      id: bundle.release.id,
      created_at: bundle.release.created_at,
      created_by: bundle.release.created_by,
      eligible: bundle.eligible,
      events: bundle.events,
      ineligibility_reason: bundle.ineligibility_reason,
    },
  };
}
interface PackageProps {
  id: string;
  data: z.infer<typeof detailSchema>;
  actorId: string;
  disabled: boolean;
  onDirty: (v: boolean) => void;
  onTransportDirty: (v: boolean) => void;
  onConfirmed: (v: unknown) => Promise<boolean>;
  refresh: () => Promise<void>;
}
function PackagePanel({
  id,
  data,
  actorId,
  disabled,
  onDirty,
  onTransportDirty,
  onConfirmed,
  refresh,
}: PackageProps) {
  const [reviewed, setReviewed] = useState(false),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState("");
  const review = useQuery({
    queryKey: ["request-package-review", actorId, id, data.request.version],
    queryFn: () => packageReview(data.request.id, id),
    retry: false,
  });
  const bundle = useQuery({
    queryKey: ["request-package-release", actorId, id, data.request.version],
    enabled: !!review.data?.confirmed,
    queryFn: async () => {
      const current = await readRelease(review.data!.release_id);
      renderRecordRelease(artifact(current));
      return current;
    },
    retry: false,
  });
  useEffect(() => {
    onDirty(reviewed || expanded);
  }, [reviewed, expanded, onDirty]);
  if (review.isPending) return <p role="status">Loading exact package…</p>;
  if (review.isError)
    return (
      <p role="alert">
        Could not load exact package.{" "}
        <Button onClick={() => void review.refetch()}>Retry review</Button>
      </p>
    );
  const p = review.data,
    r = data.request;
  if (!p) return null;
  const fresh = async () => {
    const current = await readRelease(p.release_id);
    await bundle.refetch();
    return artifact(current);
  };
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4"
      aria-label="Numbered package review"
    >
      <h3 className="font-display text-xl">
        Review package {p.package_context.ordinal} of{" "}
        {p.package_context.package_count}
      </h3>
      {error && <p role="alert">{error}</p>}
      {p.confirmed && bundle.isError && (
        <p role="alert">
          Could not refresh delivery eligibility.{" "}
          <Button onClick={() => void bundle.refetch()}>
            Retry eligibility
          </Button>
        </p>
      )}
      <RecordReleaseArtifact
        artifact={
          bundle.data
            ? artifact(bundle.data)
            : { preview: p.preview, package_context: p.package_context }
        }
        refreshConfirmed={bundle.data ? fresh : undefined}
      />
      <p>
        Review every listed original. This HTML review does not embed their
        bytes.
      </p>
      {p.preview.snapshot.attachments.map((d) => (
        <div key={d.id}>
          <span>{d.file_name}</span>
          <Button
            variant="outline"
            className="ml-2"
            disabled={disabled}
            onClick={() =>
              void (
                d.api_attachment_ref
                  ? downloadReviewedOriginal(
                      actorId,
                      r.pet_id,
                      d.api_attachment_ref.record_id,
                      d.api_attachment_ref.capture_hash,
                    ).then((file) => {
                      const url = URL.createObjectURL(file.blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = file.filename;
                      link.click();
                      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                  : openOriginal(d.id, r.pet_id, d.version)
              ).catch((e) => setError(e.message))
            }
          >
            Open original
          </Button>
        </div>
      ))}
      {!p.confirmed && (
        <>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={disabled}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed this entire numbered package, originals and exact
            recipient.
          </label>
          {p.scope_expansion && (
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={expanded}
                disabled={disabled}
                onChange={(e) => setExpanded(e.target.checked)}
              />
              I approve the additional required original and provenance
              disclosure.
            </label>
          )}
          <Button
            disabled={
              disabled ||
              !reviewed ||
              (p.scope_expansion && !expanded) ||
              ["blocked", "cancelled", "fulfilled"].includes(r.status) ||
              (r.recipient_kind === "third_party" &&
                (!data.authorization?.current ||
                  !data.disclosure_policy_accepted))
            }
            onClick={() =>
              void onConfirmed({
                package_id: p.id,
                manifest_hash: p.package_context.manifest_hash,
                attest_review: true,
                attest_scope_expansion: expanded,
              }).then((saved) => {
                if (saved) {
                  setReviewed(false);
                  setExpanded(false);
                  void review.refetch();
                }
              })
            }
          >
            Confirm package {p.package_context.ordinal}
          </Button>
        </>
      )}
      {p.confirmed && bundle.data && (
        <>
          {!bundle.data.eligible && (
            <p role="status">{bundle.data.ineligibility_reason}</p>
          )}
          {r.channel === "EMAIL" ? (
            <ReleaseEmailComposer
              bundle={bundle.data}
              onDirtyChange={onTransportDirty}
            />
          ) : (
            <DocumentSmsComposer
              family="record_release"
              sourceId={p.release_id}
              clientId={r.client_id}
              canPrepare={bundle.data.eligible}
              disabled={disabled}
              onDirtyChange={onTransportDirty}
            />
          )}
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => void Promise.all([bundle.refetch(), refresh()])}
          >
            Refresh delivery evidence
          </Button>
        </>
      )}
    </section>
  );
}
async function openOriginal(id: string, pet: string, version: number) {
  const { data, error } = await supabase
    .from("patient_documents")
    .select("file_path,file_name,version")
    .eq("id", id)
    .eq("pet_id", pet)
    .eq("version", version)
    .eq("status", "ready")
    .single();
  if (error) throw error;
  const signed = await supabase.storage
    .from("patient-documents")
    .createSignedUrl(data.file_path, 60, { download: data.file_name });
  if (signed.error) throw signed.error;
  const url = new URL(signed.data.signedUrl),
    origin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
  if (
    url.origin !== origin ||
    !url.pathname.startsWith("/storage/v1/object/sign/patient-documents/")
  )
    throw new Error("Unexpected original-document URL");
  const link = document.createElement("a");
  link.href = url.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.download = data.file_name;
  link.click();
}
