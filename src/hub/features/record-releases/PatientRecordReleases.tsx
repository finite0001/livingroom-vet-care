import { ReleaseEmailComposer } from "./ReleaseEmailComposer";
import { mergeReleaseSelection } from "./selection";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { denverLocal } from "../scheduling/time";
import { RecordReleaseArtifact } from "./RecordReleaseArtifact";
import {
  releases,
  readRelease,
  sourceLabels,
  type SourceKind,
  type ReleaseConfirmArgs,
  type ReleasePreviewArgs,
} from "./api";
import type {
  ReleasePreview,
  ReleaseSelection,
  ReleaseBundle,
  ReleaseArtifact,
} from "./print";
interface PatientRecordReleasesProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
const kinds = Object.keys(sourceLabels) as SourceKind[];
function artifactFor(bundle: ReleaseBundle): ReleaseArtifact {
  return {
    preview: bundle.release,
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
export function PatientRecordReleases({
  petId,
  onDirtyChange,
}: PatientRecordReleasesProps) {
  const { user, profile } = useAuth();
  const cache = useQueryClient();
  const [emailDirty, setEmailDirty] = useState(false);
  const [selection, setSelection] = useState<ReleaseSelection>({});
  const [allSelectionNotice, setAllSelectionNotice] = useState("");
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [sourcePage, setSourcePage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [opened, setOpened] = useState<ReleaseBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ReleaseConfirmArgs | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const pendingRef = useRef<ReleaseConfirmArgs | null>(null);
  const previewArgsRef = useRef<ReleasePreviewArgs | null>(null);
  const withdrawalRef = useRef<{
    p_id: string;
    p_release_id: string;
    p_reason: string;
  } | null>(null);
  const selectedCount = kinds.reduce(
    (sum, k) => sum + (selection[k]?.length || 0),
    0,
  );
  const dirty =
    emailDirty ||
    selectedCount > 0 ||
    !!preview ||
    !!pending ||
    !!withdrawReason ||
    busy;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const candidates = useQuery({
    queryKey: ["release-candidates", petId, sourcePage],
    queryFn: async () => {
      const { data, error } = await releases.rpc(
        "list_record_release_sources",
        { p_pet_id: petId, p_offset: sourcePage * 100 },
      );
      if (error) throw error;
      if (
        !data ||
        Array.isArray(data) ||
        data.pet_id !== petId ||
        typeof data.client_id !== "string" ||
        typeof data.client_name !== "string" ||
        typeof data.policy_accepted !== "boolean" ||
        !kinds.every(
          (kind) =>
            Array.isArray(data[kind]) &&
            data[kind].every(
              (item) =>
                item &&
                typeof item.id === "string" &&
                typeof item.label === "string",
            ),
        )
      ) {
        throw new Error(
          "Release source response is incomplete. Retry loading this patient’s sources.",
        );
      }
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["patient-record-releases", petId, historyPage],
    queryFn: async () => {
      const { data, error } = await releases
        .from("record_releases")
        .select("id")
        .eq("pet_id", petId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(historyPage * 20, historyPage * 20 + 19);
      if (error) throw error;
      return Promise.all((data || []).map((r) => readRelease(r.id)));
    },
  });
  const recipient =
    channel === "EMAIL" ? candidates.data?.email : candidates.data?.phone;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        (e as { message?: string })?.message ||
          "Request failed. Preserve the request and retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = () => {
    if (pending) return;
    setPreview(null);
    setAllSelectionNotice("");
    setReviewed(false);
    previewArgsRef.current = null;
  };
  const setChosen = (kind: SourceKind, id: string, checked: boolean) => {
    const existing = selection[kind] || [];
    if (checked && existing.length >= 100) {
      setError(
        "Use a separate package for more than 100 records in one source family.",
      );
      return;
    }
    edit();
    setSelection((current) => ({
      ...current,
      [kind]: checked
        ? [...new Set([...(current[kind] || []), id])]
        : (current[kind] || []).filter((value) => value !== id),
    }));
  };
  const selectShown = (kind: SourceKind) => {
    try {
      const ids = mergeReleaseSelection(
        selection[kind] || [],
        (candidates.data?.[kind] || []).map((item) => item.id),
      );
      edit();
      setSelection((current) => ({ ...current, [kind]: ids }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const selectAllEligible = () =>
    run(async () => {
      const { data, error } = await releases.rpc(
        "select_all_record_release_sources",
        { p_pet_id: petId },
      );
      if (error) throw error;
      if (!data)
        throw new Error(
          "No all-record selection returned; selections were not changed.",
        );
      edit();
      setSelection(data.selection);
      setAllSelectionNotice(
        `${data.scope} Excluded unavailable originals: ${data.excluded_unavailable_originals}. Resulted labs without a shareable original: ${data.excluded_labs_without_shareable_original}.`,
      );
    });
  const loadPreview = () =>
    run(async () => {
      if (!candidates.data || !recipient)
        throw new Error("Choose a configured primary household contact.");
      const args: ReleasePreviewArgs = {
        p_pet_id: petId,
        p_client_id: candidates.data.client_id,
        p_channel: channel,
        p_recipient: recipient,
        p_selection: structuredClone(selection),
      };
      const { data, error } = await releases.rpc(
        "preview_record_release",
        args,
      );
      if (error) throw error;
      previewArgsRef.current = args;
      setPreview(data);
      setReviewed(false);
    });
  const confirm = () =>
    run(async () => {
      if (
        !user ||
        !profile?.is_active ||
        !preview ||
        !previewArgsRef.current ||
        !reviewed
      )
        throw new Error(
          "Review the complete package and recipient before confirming.",
        );
      const args = pendingRef.current ?? {
        ...previewArgsRef.current,
        p_id: crypto.randomUUID(),
        p_reviewed_snapshot: preview.snapshot,
        p_reviewed_hash: preview.source_hash,
        p_attest_review: true,
      };
      pendingRef.current = args;
      setPending(args);
      const { data, error } = await releases.rpc(
        "confirm_record_release",
        args,
      );
      if (error) {
        if (["40001", "23514", "42501"].includes(error.code)) {
          pendingRef.current = null;
          setPending(null);
          setPreview(null);
          setReviewed(false);
          previewArgsRef.current = null;
        }
        throw error;
      }
      pendingRef.current = null;
      setPending(null);
      setPreview(null);
      setReviewed(false);
      previewArgsRef.current = null;
      setSelection({});
      await cache.invalidateQueries({
        queryKey: ["patient-record-releases", petId],
      });
      setOpened(await readRelease(data.id));
    });
  const open = (id: string) =>
    run(async () => {
      setOpened(null);
      setWithdrawReason("");
      setOpened(await readRelease(id));
    });
  const freshArtifact = async () => {
    if (!opened) throw new Error("Open a release first.");
    const current = await readRelease(opened.release.id);
    setOpened(current);
    return artifactFor(current);
  };
  const withdraw = () =>
    run(async () => {
      if (!user || !opened) throw new Error("Open a release first.");
      const args = withdrawalRef.current ?? {
        p_id: crypto.randomUUID(),
        p_release_id: opened.release.id,
        p_reason: withdrawReason,
      };
      withdrawalRef.current = args;
      const { error } = await releases.rpc("withdraw_record_release", args);
      if (error) throw error;
      withdrawalRef.current = null;
      setWithdrawReason("");
      setOpened(await readRelease(args.p_release_id));
      await cache.invalidateQueries({
        queryKey: ["patient-record-releases", petId],
      });
    });
  const original = (id: string) =>
    run(async () => {
      const { data: row, error } = await supabase
        .from("patient_documents")
        .select("file_path,file_name,version")
        .eq("id", id)
        .eq("pet_id", petId)
        .eq("status", "ready")
        .eq("visibility", "client_shareable")
        .single();
      if (error) throw error;
      const { data, error: urlError } = await supabase.storage
        .from("patient-documents")
        .createSignedUrl(row.file_path, 60, { download: row.file_name });
      if (urlError) throw urlError;
      const url = new URL(data.signedUrl);
      const configured = new URL(import.meta.env.VITE_SUPABASE_URL);
      if (
        url.origin !== configured.origin ||
        !url.pathname.startsWith("/storage/v1/object/sign/patient-documents/")
      )
        throw new Error("Unexpected original-document URL.");
      const link = document.createElement("a");
      link.href = url.href;
      link.download = row.file_name;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    });
  return (
    <section
      aria-label="Patient medical-record releases"
      className="space-y-4 rounded-xl border bg-card p-4"
    >
      <h3 className="font-serif text-xl">Medical-record release packages</h3>
      <p className="text-sm text-muted-foreground">
        Choose records explicitly, review their complete contents and the
        household recipient, then confirm an immutable package. This screen does
        not send email or texts.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {(candidates.isError || history.isError) && (
        <p role="alert">
          Release data could not be loaded.{" "}
          <Button
            variant="outline"
            onClick={() => {
              void candidates.refetch();
              void history.refetch();
            }}
          >
            Retry release data
          </Button>
        </p>
      )}
      <h4 className="font-semibold">Confirmed package history</h4>
      {history.isLoading ? (
        <p role="status">Loading package history…</p>
      ) : history.data?.length === 0 ? (
        <p>No packages on this page.</p>
      ) : (
        history.data?.map((b) => (
          <div
            key={b.release.id}
            className="flex flex-wrap justify-between gap-2 rounded-md border p-3"
          >
            <div>
              <p>
                {denverLocal(b.release.created_at).replace("T", " ")}{" "}
                America/Denver · {b.release.channel} · {b.release.recipient}
              </p>
              <p className="text-xs text-muted-foreground">{b.release.id}</p>
              <p>
                {b.eligible
                  ? "Source checks passed at last refresh"
                  : "Invalidated or withdrawn — historical package"}
              </p>
              {b.events.map((e) => (
                <p key={e.id} className="text-sm">
                  {e.reason}
                </p>
              ))}
            </div>
            <Button
              variant="outline"
              disabled={busy || emailDirty || !!withdrawalRef.current}
              onClick={() => void open(b.release.id)}
            >
              Open release package
            </Button>
          </div>
        ))
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          disabled={historyPage === 0 || busy || history.isFetching}
          onClick={() => setHistoryPage((v) => v - 1)}
        >
          Newer packages
        </Button>
        <span>Page {historyPage + 1}</span>
        <Button
          variant="outline"
          disabled={history.data?.length !== 20 || busy || history.isFetching}
          onClick={() => setHistoryPage((v) => v + 1)}
        >
          Older packages
        </Button>
      </div>
      {opened && (
        <div className="space-y-3 rounded-md border p-3">
          <h4 className="font-semibold">Opened release {opened.release.id}</h4>
          <RecordReleaseArtifact
            artifact={artifactFor(opened)}
            refreshConfirmed={freshArtifact}
          />
          <ReleaseEmailComposer
            key={opened.release.id}
            bundle={opened}
            onDirtyChange={setEmailDirty}
          />
          <Label htmlFor={`withdraw-${petId}`}>Withdrawal reason</Label>
          <Input
            id={`withdraw-${petId}`}
            maxLength={2000}
            value={withdrawReason}
            disabled={busy || emailDirty || !!withdrawalRef.current}
            onChange={(e) => setWithdrawReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || !!pending || !withdrawReason.trim()}
            onClick={() => void withdraw()}
          >
            {withdrawalRef.current
              ? "Retry same withdrawal"
              : "Withdraw release package"}
          </Button>
        </div>
      )}
      <div className="space-y-3 border-t pt-4">
        <h4 className="font-semibold">Prepare a reviewed package</h4>
        {candidates.isLoading ? (
          <p role="status">Loading eligible sources…</p>
        ) : (
          candidates.data && (
            <>
              <p>Household: {candidates.data.client_name}</p>
              <Label htmlFor={`release-channel-${petId}`}>
                Household delivery contact
              </Label>
              <select
                id={`release-channel-${petId}`}
                className="w-full rounded-md border bg-background p-2"
                value={channel}
                disabled={busy || !!preview || !!pending}
                onChange={(e) => {
                  edit();
                  setChannel(e.target.value as "EMAIL" | "SMS");
                }}
              >
                <option value="EMAIL">
                  Email · {candidates.data.email || "not configured"}
                </option>
                <option value="SMS">
                  Text · {candidates.data.phone || "not configured"}
                </option>
              </select>
              <p className="text-sm">
                This contact binds the package to the household. It does not
                authorize messaging or replace consent checks.
              </p>
              {!candidates.data.policy_accepted && (
                <p className="rounded-md bg-muted p-3 text-sm">
                  Preview is available. Confirmation requires recorded clinical
                  acceptance of release form version 3 by the practice operator.
                </p>
              )}
              <fieldset
                disabled={busy || !!preview || !!pending}
                className="space-y-4"
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void selectAllEligible()}
                >
                  Select all eligible records across every page
                </Button>
                {allSelectionNotice && (
                  <p role="status" className="text-sm">
                    {allSelectionNotice}
                  </p>
                )}
                <p className="text-sm">
                  Review all selected clinical notes and provenance for
                  disclosure. No automatic redaction is performed.
                </p>
                {kinds.map((kind) => (
                  <div key={kind} className="space-y-2 rounded-md border p-3">
                    <h5 className="font-medium">
                      {sourceLabels[kind]} · {selection[kind]?.length || 0}{" "}
                      selected
                    </h5>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!(candidates.data![kind] || []).length}
                      onClick={() => selectShown(kind)}
                    >
                      Select all shown: {sourceLabels[kind]}
                    </Button>
                    {(candidates.data![kind] || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No eligible records on this source page.
                      </p>
                    ) : (
                      (candidates.data![kind] || []).map((item) => (
                        <div key={item.id} className="space-y-1">
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={
                                selection[kind]?.includes(item.id) || false
                              }
                              onChange={(e) =>
                                setChosen(kind, item.id, e.target.checked)
                              }
                            />
                            <span
                              className={
                                item.importance === "high"
                                  ? "text-clinical-alert"
                                  : undefined
                              }
                            >
                              {item.label} ·{" "}
                              {/^\d{4}-\d{2}-\d{2}$/.test(item.recorded_at)
                                ? item.recorded_at
                                : denverLocal(item.recorded_at).replace(
                                    "T",
                                    " ",
                                  )}{" "}
                              America/Denver · Version {item.version}
                            </span>
                          </label>
                          {kind === "lab_order_ids" && (
                            <p className="text-xs text-muted-foreground">
                              {item.required_document_id
                                ? "Select this original report separately: " +
                                  item.required_document_id
                                : "No original report is linked; this result cannot yet be packaged."}
                            </p>
                          )}
                          {kind === "document_ids" && (
                            <div className="flex items-center gap-2 text-sm">
                              <span>
                                {item.mime_type} · {item.file_size} bytes
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void original(item.id)}
                              >
                                Review original: {item.label}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </fieldset>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={sourcePage === 0 || busy || !!preview || !!pending}
                  onClick={() => setSourcePage((v) => v - 1)}
                >
                  Newer source records
                </Button>
                <span>Source page {sourcePage + 1} · up to 100 per family</span>
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    !!preview ||
                    !!pending ||
                    !kinds.some(
                      (k) => (candidates.data![k] || []).length === 100,
                    )
                  }
                  onClick={() => setSourcePage((v) => v + 1)}
                >
                  Older source records
                </Button>
              </div>
              <p className="text-sm">
                Select all shown applies to this source page. A package supports
                at most 100 records per family; use another package for
                additional history. Body maps include every observation and
                correction, not a signed diagnosis.
              </p>
              {!preview ? (
                <Button
                  disabled={
                    busy || !!pending || selectedCount === 0 || !recipient
                  }
                  onClick={() => void loadPreview()}
                >
                  Review selected package
                </Button>
              ) : (
                <>
                  <RecordReleaseArtifact artifact={{ preview }} />
                  {preview.snapshot.attachments.map((a) => (
                    <Button
                      key={a.id}
                      variant="outline"
                      disabled={busy}
                      onClick={() => void original(a.id)}
                    >
                      Review selected original: {a.file_name}
                    </Button>
                  ))}
                  <p className="break-all text-xs text-muted-foreground">
                    Reviewed fingerprint: {preview.source_hash}
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy || !!pending}
                    onClick={edit}
                  >
                    Edit selection and review again
                  </Button>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy || !!pending}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I reviewed the complete selected records, original
                    attachments and household recipient.
                  </label>
                  <Button
                    disabled={
                      busy ||
                      emailDirty ||
                      !candidates.data.policy_accepted ||
                      !reviewed
                    }
                    onClick={() => void confirm()}
                  >
                    {pending
                      ? "Retry same package confirmation"
                      : "Confirm reviewed package"}
                  </Button>
                  {pending && (
                    <p role="status">
                      The result is uncertain. Keep this page open and retry the
                      identical package request.
                    </p>
                  )}
                </>
              )}
              <Button
                variant="outline"
                disabled={busy || !!pending}
                onClick={() => {
                  edit();
                  setSelection({});
                }}
              >
                Clear package selection
              </Button>
            </>
          )
        )}
      </div>
    </section>
  );
}
