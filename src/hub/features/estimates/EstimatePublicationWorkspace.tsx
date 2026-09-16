import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import type { PrescriptionRpc } from "../prescriptions/prescription-api";
import type { EstimateDraft } from "./estimate-api";
import {
  createEstimatePublicationApi,
  createEstimatePublicationEdge,
  publicationPrepareRequestSchema,
  type PublicationCurrent,
  type PublicationHistory,
  type PublicationPreparation,
  type PublicationPrepareOperation,
  type PublicationReceipt,
  type PublicationTarget,
} from "./publication-api";
import { useEstimatePublicationOperation } from "./useEstimatePublicationOperation";

interface EstimatePublicationWorkspaceProps {
  draft: EstimateDraft;
  onDirtyChange: (dirty: boolean) => void;
}
interface StaffWorkspaceProps extends EstimatePublicationWorkspaceProps {
  actorId: string;
}
interface DocumentView {
  url: string;
  filename: string;
  preparationId: string;
  hash: string;
  label: string;
}
const when = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  });
const money = (value: string) => {
  const cents = BigInt(value);
  return `$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")} USD`;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export function EstimatePublicationWorkspace(
  props: EstimatePublicationWorkspaceProps,
) {
  const { user, profile } = useAuth();
  if (!user || !profile?.is_active)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Sign in as active staff to review estimate publication.
      </p>
    );
  return (
    <StaffWorkspace
      key={`${user.id}:${props.draft.id}:${props.draft.client_id}:${props.draft.pet_id}`}
      {...props}
      actorId={user.id}
    />
  );
}

function StaffWorkspace({
  draft,
  actorId,
  onDirtyChange,
}: StaffWorkspaceProps) {
  const target = useMemo<PublicationTarget>(
    () => ({
      estimate_id: draft.id,
      client_id: draft.client_id,
      pet_id: draft.pet_id,
    }),
    [draft.id, draft.client_id, draft.pet_id],
  );
  const identity = `${actorId}:${target.estimate_id}:${target.client_id}:${target.pet_id}`;
  const preparationKey = `lrv:estimate-publication:preparation:v1:${identity}`;
  const api = useMemo(
    () =>
      createEstimatePublicationApi(
        supabase as unknown as PrescriptionRpc,
        actorId,
        target,
        createEstimatePublicationEdge(
          import.meta.env.VITE_SUPABASE_URL,
          async () => {
            const { data, error } = await supabase.auth.getSession();
            if (error) throw error;
            if (data.session?.user.id !== actorId)
              throw new Error(
                "The staff session changed. Return to the original account to recover its request.",
              );
            return data.session.access_token;
          },
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        ),
      ),
    [actorId, target],
  );
  function parsePreparation(value: unknown): PublicationPrepareOperation {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "id,request"
    )
      throw new Error("Invalid preparation recovery record.");
    const v = value as { id: unknown; request: unknown };
    if (
      typeof v.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        v.id,
      )
    )
      throw new Error("Invalid preparation identity.");
    const request = publicationPrepareRequestSchema.parse(v.request);
    if (
      request.target.estimate_id !== target.estimate_id ||
      request.target.client_id !== target.client_id ||
      request.target.pet_id !== target.pet_id
    )
      throw new Error(
        "Preparation belongs to a different patient or household.",
      );
    return { id: v.id, request } as PublicationPrepareOperation;
  }
  function readPreparation(): PublicationPrepareOperation | null {
    const raw = sessionStorage.getItem(preparationKey);
    if (raw === null) return null;
    const saved = JSON.parse(raw);
    if (
      !saved ||
      Object.keys(saved).sort().join(",") !==
        "actorId,identity,operation,version" ||
      saved.version !== 1 ||
      saved.actorId !== actorId ||
      saved.identity !== identity
    )
      throw new Error("Preparation recovery record cannot be verified.");
    return parsePreparation(saved.operation);
  }
  const [initial] = useState(() => {
    try {
      return { operation: readPreparation(), blocked: false };
    } catch {
      return { operation: null, blocked: true };
    }
  });
  const [savedPreparation, setSavedPreparation] =
    useState<PublicationPrepareOperation | null>(initial.operation);
  const [preparationBlocked, setPreparationBlocked] = useState(initial.blocked);
  const [preparation, setPreparation] = useState<PublicationPreparation | null>(
    null,
  );
  const [current, setCurrent] = useState<PublicationCurrent | null>(null);
  const [history, setHistory] = useState<PublicationHistory | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    initial.blocked
      ? "The saved document preparation could not be verified. Keep this session for recovery before preparing another document."
      : "",
  );
  const [notice, setNotice] = useState(
    initial.operation
      ? "A saved document preparation is available. Recover it or discard this unpublished preview before preparing another."
      : "",
  );
  const [view, setView] = useState<DocumentView | null>(null);
  const [documentReviewed, setDocumentReviewed] = useState(false),
    [pricingReviewed, setPricingReviewed] = useState(false),
    [termsReviewed, setTermsReviewed] = useState(false);
  const [withdrawalReason, setWithdrawalReason] = useState(""),
    [withdrawalReviewed, setWithdrawalReviewed] = useState(false);
  const alive = useRef(true),
    lock = useRef(false),
    generation = useRef(0),
    objectUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrls.current;
    alive.current = true;
    return () => {
      alive.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);
  const clearAttestations = () => {
    setDocumentReviewed(false);
    setPricingReviewed(false);
    setTermsReviewed(false);
  };
  const refresh = useCallback(async () => {
    const n = ++generation.current;
    setLoading(true);
    try {
      const [state, page] = await Promise.all([api.read(), api.history()]);
      if (!alive.current || n !== generation.current) return;
      if (!same(state.head, page.head))
        throw new Error(
          "Publication history changed while loading. Refresh to review one current version.",
        );
      setCurrent(state);
      setHistory(page);
    } catch (failure) {
      if (alive.current && n === generation.current) {
        setCurrent(null);
        setError(
          failure instanceof Error
            ? failure.message
            : "Publication history could not be verified.",
        );
      }
    } finally {
      if (alive.current && n === generation.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh, draft.version]);
  useEffect(() => {
    clearAttestations();
  }, [draft.version]);
  function clearSavedPreparation(expected: PublicationPrepareOperation) {
    const saved = readPreparation();
    if (saved && !same(saved, expected))
      throw new Error(
        "A different preparation request is saved. Recover that request first.",
      );
    sessionStorage.removeItem(preparationKey);
    if (sessionStorage.getItem(preparationKey) !== null)
      throw new Error("Preparation recovery storage could not be cleared.");
    setSavedPreparation(null);
    setPreparation(null);
    clearAttestations();
  }
  const operation = useEstimatePublicationOperation({
    identity,
    actorId,
    parseOperation: api.parseOperation,
    execute: api.execute,
    recover: api.recover,
    close: api.close,
    onResolved: (receipt: PublicationReceipt | null) => {
      clearAttestations();
      setWithdrawalReviewed(false);
      if (
        receipt?.mutation.kind === "publish" &&
        savedPreparation?.id === receipt.mutation.request.preparation_id
      ) {
        try {
          clearSavedPreparation(savedPreparation);
        } catch {
          setPreparationBlocked(true);
          setError(
            "Publication is recorded, but its document recovery entry could not be cleared. Preserve this session and reload history.",
          );
        }
      }
      if (receipt?.mutation.kind === "withdraw") setWithdrawalReason("");
      void refresh();
    },
  });
  const dirty =
    operation.locked ||
    preparationBlocked ||
    savedPreparation !== null ||
    busy ||
    withdrawalReason.length > 0;
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const disabled = busy || loading || operation.locked || preparationBlocked;
  const stale =
    !!preparation &&
    (preparation.request.draft_version !== draft.version ||
      !current ||
      !same(preparation.request.expected_publication_head, current.head));
  const ownDocumentVisible =
    !!preparation?.artifact &&
    view?.preparationId === preparation.id &&
    view.hash === preparation.artifact.sha256;
  function showDocument(
    blob: Blob,
    prepId: string,
    filename: string,
    hash: string,
    label: string,
  ) {
    if (!alive.current) return;
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);
    setView((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.url);
        objectUrls.current.delete(previous.url);
      }
      return { url, filename, hash, preparationId: prepId, label };
    });
    clearAttestations();
  }
  async function run(task: () => Promise<void>) {
    if (!alive.current || lock.current || operation.busy) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "This publication request could not be verified. Recover its saved values before trying again.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadPreparedDocument(p: PublicationPreparation) {
    if (!p.artifact)
      throw new Error(
        "The document has not been captured yet. Recover the preparation.",
      );
    const blob = await api.download(p.id, p.artifact);
    if (alive.current)
      showDocument(
        blob,
        p.id,
        p.artifact.filename,
        p.artifact.sha256,
        `Prepared draft ${p.request.draft_version}`,
      );
  }
  async function prepareNew() {
    if (disabled || savedPreparation || withdrawalReason) return;
    await run(async () => {
      const preview = await api.preview(draft.version);
      if (!alive.current) return;
      const op: PublicationPrepareOperation = {
        id: crypto.randomUUID(),
        request: {
          target,
          draft_version: draft.version,
          expected_source_hash: preview.source_hash,
          expected_publication_head: preview.context.publication_head,
          replaces_publication_id: preview.context.current_publication_id,
        },
      };
      if (readPreparation())
        throw new Error("Recover the earlier document preparation first.");
      sessionStorage.setItem(
        preparationKey,
        JSON.stringify({ version: 1, actorId, identity, operation: op }),
      );
      if (!same(readPreparation(), op))
        throw new Error(
          "Preparation could not be saved for recovery; no preparation was submitted.",
        );
      setSavedPreparation(op);
      const p = await api.prepare(op);
      if (!alive.current) return;
      setPreparation(p);
      await loadPreparedDocument(p);
    });
  }
  async function recoverPreparation(retry = false) {
    if (!savedPreparation || disabled) return;
    await run(async () => {
      const p = retry
        ? await api.prepare(savedPreparation)
        : await api.recoverPreparation(
            savedPreparation.id,
            savedPreparation.request,
          );
      if (!alive.current) return;
      if (!p) {
        setNotice(
          "No preparation is recorded yet. Retry the identical preparation, or discard this unpublished preview. Preparation alone cannot publish anything.",
        );
        return;
      }
      setPreparation(p);
      await loadPreparedDocument(p);
    });
  }
  function discardPreparation() {
    if (disabled || !savedPreparation) return;
    try {
      clearSavedPreparation(savedPreparation);
      setNotice(
        "Unpublished preview discarded. Any delayed capture cannot publish the estimate.",
      );
    } catch (failure) {
      setPreparationBlocked(true);
      setError(
        failure instanceof Error
          ? failure.message
          : "Preparation recovery remains locked.",
      );
    }
  }
  async function publish() {
    if (
      disabled ||
      stale ||
      !preparation?.artifact ||
      !ownDocumentVisible ||
      !documentReviewed ||
      !pricingReviewed ||
      !termsReviewed
    )
      return;
    await operation.execute({
      id: crypto.randomUUID(),
      kind: "record_estimate_publication",
      payload: {
        kind: "publish",
        request: {
          target,
          preparation_id: preparation.id,
          expected_draft_version: preparation.request.draft_version,
          expected_publication_head:
            preparation.request.expected_publication_head,
          expected_content_hash: preparation.content_hash,
          expected_artifact_hash: preparation.artifact.sha256,
          replaces_publication_id: preparation.request.replaces_publication_id,
          attest_document_review: true,
          attest_pricing_review: true,
          attest_terms_review: true,
        },
      },
    });
  }
  async function withdraw() {
    if (
      disabled ||
      savedPreparation ||
      !current?.current ||
      !withdrawalReviewed ||
      !withdrawalReason.trim() ||
      Array.from(withdrawalReason.trim()).length > 2000
    )
      return;
    await operation.execute({
      id: crypto.randomUUID(),
      kind: "record_estimate_publication",
      payload: {
        kind: "withdraw",
        request: {
          target,
          publication_id: current.current.id,
          expected_publication_head: current.head,
          reason: withdrawalReason.trim(),
          attest_review: true,
        },
      },
    });
  }
  async function viewHistorical(publicationId: string) {
    await run(async () => {
      const historical = await api.published(publicationId);
      const blob = await api.download(
        historical.publication.preparation_id,
        historical.publication.artifact,
      );
      if (alive.current)
        showDocument(
          blob,
          historical.publication.preparation_id,
          historical.publication.artifact.filename,
          historical.publication.artifact.sha256,
          `Historical draft ${historical.publication.draft_version} · ${historical.status}`,
        );
    });
  }
  async function moreHistory() {
    if (!history?.has_more || !history.next_before_version) return;
    await run(async () => {
      const page = await api.history(history.next_before_version);
      if (!alive.current) return;
      if (!same(history.head, page.head))
        throw new Error(
          "Publication history changed. Refresh before loading more.",
        );
      setHistory({ ...page, events: [...history.events, ...page.events] });
    });
  }
  const currentLabel = current
    ? {
        none: "Not published",
        open: "Open for future client review",
        expired: "Acceptance deadline passed",
        withdrawn: "Withdrawn",
      }[current.current_status]
    : "Publication status unavailable";
  return (
    <section
      className="space-y-5 rounded-lg border bg-card p-4 text-card-foreground md:p-6"
      aria-label="Estimate publication"
    >
      <header className="space-y-1">
        <h3 className="text-lg font-semibold">Publish estimate document</h3>
        <p className="text-sm text-muted-foreground">
          Review and preserve an exact document for this household and patient.
          Client approval and delivery are not available in this workspace.
        </p>
      </header>
      {(error || operation.error) && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {operation.error || error}
        </p>
      )}
      {(notice || operation.notice) && (
        <p role="status" className="text-sm">
          {operation.notice || notice}
        </p>
      )}
      <div className="space-y-1 text-sm">
        <p>
          <span className="font-medium">{currentLabel}</span> · saved draft{" "}
          {draft.version}
        </p>
        {current?.current && (
          <>
            <p>
              Published draft {current.current.draft_version} ·{" "}
              {when(current.current.published_at)} Mountain Time
            </p>
            <p>
              Accept by {current.current.accept_by}, through the end of that day
              in Denver.
            </p>
            <p className="break-all text-xs text-muted-foreground">
              Publication {current.current.id}
            </p>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || operation.busy || loading}
          onClick={() => void refresh()}
        >
          Refresh publication history
        </Button>
      </div>
      {operation.pending && (
        <div
          className="space-y-3 rounded-md border p-3"
          aria-label="Unresolved publication request"
        >
          <p className="font-medium">
            Resolve original{" "}
            {operation.pending.payload.kind === "publish"
              ? "publication"
              : "withdrawal"}{" "}
            request
          </p>
          <p className="break-all text-xs">Request {operation.pending.id}</p>
          <p className="text-sm text-muted-foreground">
            Recovery may find a completed operation. Resolve permanently closes
            an unrecorded request, so a delayed write cannot commit later. It
            does not undo an existing publication.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={operation.busy || busy}
              onClick={() => void operation.recover()}
            >
              Recover original request
            </Button>
            <Button
              variant="outline"
              disabled={operation.busy || busy}
              onClick={() => void operation.retry()}
            >
              Retry identical request
            </Button>
            <Button
              variant="outline"
              disabled={operation.busy || busy}
              onClick={() => void operation.resolve()}
            >
              Resolve or close original request
            </Button>
          </div>
        </div>
      )}
      {!savedPreparation && (
        <Button
          disabled={disabled || !current || !!withdrawalReason}
          onClick={() => void prepareNew()}
        >
          Prepare saved draft {draft.version} for review
        </Button>
      )}
      {savedPreparation && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="font-medium">
            Saved document preparation · draft{" "}
            {savedPreparation.request.draft_version}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            Preparation {savedPreparation.id}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void recoverPreparation()}
            >
              Recover prepared document
            </Button>
            {!preparation && (
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => void recoverPreparation(true)}
              >
                Retry original preparation
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={discardPreparation}
            >
              Discard unpublished preview
            </Button>
          </div>
          {stale && (
            <p role="status" className="text-sm text-destructive">
              The draft or publication history changed. Discard this preview and
              prepare the current saved draft before publishing.
            </p>
          )}
        </div>
      )}
      {view && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-medium">{view.label}</h4>
            <a
              className="text-sm font-medium text-primary underline underline-offset-4"
              href={view.url}
              download={view.filename}
            >
              Download exact HTML
            </a>
          </div>
          <iframe
            title={view.label}
            src={view.url}
            sandbox=""
            referrerPolicy="no-referrer"
            className="h-[32rem] w-full rounded-md border bg-background"
          />
          <p className="break-all text-xs text-muted-foreground">
            Document SHA-256: {view.hash}
          </p>
        </div>
      )}
      {preparation && (
        <div className="space-y-3">
          <p className="font-medium">
            Review total: {money(preparation.snapshot.total_cents)}
          </p>
          <p className="text-sm">
            Acceptance deadline: {preparation.snapshot.acceptance.accept_by},
            Denver time. This limits acceptance, not completion of already
            accepted quantities.
          </p>
          {preparation.request.replaces_publication_id && (
            <p className="rounded-md border p-3 text-sm">
              Publishing will replace publication{" "}
              <span className="break-all">
                {preparation.request.replaces_publication_id}
              </span>
              . Its document and prior history remain preserved. This does not
              transfer accepted work or reverse charges.
            </p>
          )}
          {!ownDocumentVisible && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void run(() => loadPreparedDocument(preparation))}
            >
              Open this prepared document
            </Button>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              disabled={disabled || stale || !ownDocumentVisible}
              checked={documentReviewed}
              onChange={(event) => setDocumentReviewed(event.target.checked)}
            />
            I reviewed the exact document shown above for this patient and
            household.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              disabled={disabled || stale || !ownDocumentVisible}
              checked={pricingReviewed}
              onChange={(event) => setPricingReviewed(event.target.checked)}
            />
            I reviewed quantities, prices, zero amounts and any allocation or
            override reasons.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              disabled={disabled || stale || !ownDocumentVisible}
              checked={termsReviewed}
              onChange={(event) => setTermsReviewed(event.target.checked)}
            />
            I reviewed the terms and acceptance deadline. This does not record
            clinical consent or payment.
          </label>
          <Button
            disabled={
              disabled ||
              stale ||
              !ownDocumentVisible ||
              !documentReviewed ||
              !pricingReviewed ||
              !termsReviewed
            }
            onClick={() => void publish()}
          >
            {preparation.request.replaces_publication_id
              ? "Publish replacement document"
              : "Publish reviewed document"}
          </Button>
        </div>
      )}
      {!!withdrawalReason && !operation.pending && (
        <Button
          variant="ghost"
          disabled={busy || operation.busy}
          onClick={() => {
            setWithdrawalReason("");
            setWithdrawalReviewed(false);
          }}
        >
          Discard unsent withdrawal draft
        </Button>
      )}
      {current?.current && (
        <div className="space-y-3 border-t pt-4">
          <h4 className="font-medium">Withdraw current publication</h4>
          <p className="text-sm text-muted-foreground">
            Stops new use of this proposal. Its history remains; no clinical
            work, charge or payment is reversed.
          </p>
          <label className="block space-y-1 text-sm">
            <span>Withdrawal reason</span>
            <Textarea
              value={withdrawalReason}
              maxLength={2000}
              disabled={disabled || !!savedPreparation}
              onChange={(event) => {
                setWithdrawalReason(event.target.value);
                setWithdrawalReviewed(false);
              }}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              checked={withdrawalReviewed}
              disabled={
                disabled || !!savedPreparation || !withdrawalReason.trim()
              }
              onChange={(event) => setWithdrawalReviewed(event.target.checked)}
            />
            I reviewed the current publication and this withdrawal reason.
          </label>
          <Button
            variant="outline"
            disabled={
              disabled ||
              !!savedPreparation ||
              !withdrawalReviewed ||
              !withdrawalReason.trim()
            }
            onClick={() => void withdraw()}
          >
            Withdraw current publication
          </Button>
        </div>
      )}
      <div className="space-y-3 border-t pt-4">
        <h4 className="font-medium">Publication history</h4>
        {!history?.events.length && (
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading publication history…"
              : "No publication events are shown."}
          </p>
        )}
        <ol className="space-y-3">
          {history?.events.map((event) => (
            <li
              key={event.id}
              className="space-y-1 rounded-md border p-3 text-sm"
            >
              <p className="font-medium">
                {event.kind === "published"
                  ? `Published draft ${event.publication!.draft_version}${event.publication!.replaces_publication_id ? " as a replacement" : ""}`
                  : "Withdrew publication"}
              </p>
              <p className="text-muted-foreground">
                {when(event.created_at)} Mountain Time · history revision{" "}
                {event.version}
              </p>
              {event.reason && (
                <p className="whitespace-pre-wrap">{event.reason}</p>
              )}
              <p className="break-all text-xs text-muted-foreground">
                Publication {event.publication_id}
              </p>
              {event.kind === "published" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || operation.busy}
                  onClick={() => void viewHistorical(event.publication_id)}
                >
                  View stored document
                </Button>
              )}
            </li>
          ))}
        </ol>
        {history?.has_more && (
          <Button
            variant="outline"
            disabled={busy || operation.busy}
            onClick={() => void moreHistory()}
          >
            Load earlier publication history
          </Button>
        )}
      </div>
      {(busy || operation.busy || loading) && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking the exact saved publication evidence…
        </p>
      )}
    </section>
  );
}
