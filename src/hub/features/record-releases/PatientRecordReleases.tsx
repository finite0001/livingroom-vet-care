import { DocumentSmsComposer } from "../document-links/DocumentSmsComposer";
import { ReleaseEmailComposer } from "./ReleaseEmailComposer";
import { mergeReleaseSelection, releaseFamilyLimit } from "./selection";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { denverLocal } from "../scheduling/time";
import { ApiOriginalPreviewDownloads } from "./ApiOriginalPreviewDownloads";
import { RecordReleaseArtifact } from "./RecordReleaseArtifact";
import {
  releases,
  readRelease,
  sourceLabels,
  type SourceKind,
  type ReleaseConfirmArgs,
  type ReleaseSelection,
  type ReleaseCandidate,
  type ReleasePreviewArgs,
} from "./api";
import { renderRecordRelease, type ReleasePreview, type ReleaseBundle, type ReleaseArtifact } from "./print";
interface PatientRecordReleasesProps {
  petId: string;
  onDirtyChange?: (dirty: boolean) => void;
}
const kinds = Object.keys(sourceLabels) as SourceKind[];
function canonicalReleaseValue(value: unknown): string {
  return JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(item => JSON.parse(canonicalReleaseValue(item))) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonicalReleaseValue(item))])) : value);
}
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
export function PatientRecordReleases(props: PatientRecordReleasesProps) {
  const { user } = useAuth();
  return user ? <ReleaseWorkspace key={`${user.id}:${props.petId}`} {...props} /> : null;
}
function ReleaseWorkspace({ petId, onDirtyChange }: PatientRecordReleasesProps) {
  const { user, profile } = useAuth();
  const cache = useQueryClient();
  const [sourceEvidenceStale, setSourceEvidenceStale] = useState(false);
  useEffect(() => cache.getQueryCache().subscribe(event => {
    const key = event.query.queryKey;
    if (key[0] === "release-candidates-v12" && key[1] === petId && key[2] === user?.id && event.query.state.isInvalidated) { setSourceEvidenceStale(true); if (!pendingRef.current) setReviewed(false); }
  }), [cache, petId, user?.id]);
  const [emailDirty, setEmailDirty] = useState(false);
  const [smsDirty, setSmsDirty] = useState(false);
  const [selection, setSelection] = useState<ReleaseSelection>({});
  const [allSelectionNotice, setAllSelectionNotice] = useState("");
  const [knownSources, setKnownSources] = useState<
    Partial<Record<SourceKind, Record<string, ReleaseCandidate>>>
  >({});
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [sourcePage, setSourcePage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [preview, setPreview] = useState<ReleasePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [opened, setOpened] = useState<ReleaseBundle | null>(null);
  const [operationBusy, setBusy] = useState(false);
  const [apiDownloadBusy, setApiDownloadBusy] = useState(false);
  const busy = operationBusy || apiDownloadBusy;
  const onApiDownloadBusy = useCallback((value: boolean) => {
    setApiDownloadBusy(value);
    if (value) setReviewed(false);
  }, []);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ReleaseConfirmArgs | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const pendingRef = useRef<ReleaseConfirmArgs | null>(null);
  const pendingUncertain = useRef(false);
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
    smsDirty ||
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
    queryKey: ["release-candidates-v12", petId, user?.id, sourcePage],
    enabled: !!user && !!profile?.is_active && !preview && !pending,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async () => {
      const { data, error } = await releases.rpc(
        "list_record_release_sources_v12",
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
        typeof data.policy_v12_accepted !== "boolean" ||
        !data.has_more ||
        !kinds.every((kind) => typeof data.has_more[kind] === "boolean") ||
        !kinds.every(
          (kind) =>
            Array.isArray(data[kind]) &&
            data[kind].length <= 100 &&
            data[kind].every(
              (item) =>
                item &&
                typeof item.id === "string" &&
                typeof item.label === "string" &&
                ((kind !== "lab_report_ids" &&
                  kind !== "external_record_ids") ||
                  (typeof item.required_document_id === "string" &&
                    Number.isSafeInteger(item.required_document_version) &&
                    item.required_document_version! > 0 &&
                    (kind === "lab_report_ids"
                      ? ["original", "corrected"]
                      : ["original", "replacement"]
                    ).includes(item.kind || "") &&
                    typeof item.historical === "boolean" &&
                    typeof item.source_label === "string" &&
                    Number.isSafeInteger(item.acknowledgment_count) &&
                    item.acknowledgment_count! >= 0)) &&
                ((kind !== "imported_history_ids" && kind !== "imported_vaccination_ids" && kind !== "imported_prescription_ids") ||
                  (Number.isSafeInteger(item.version) &&
                    item.version > 0 &&
                    typeof item.source_label === "string")) &&
                ((kind !== "native_prescription_ids" && kind !== "native_dispense_ids") ||
                  (item.version === 1 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) &&
                    typeof item.recorded_at === "string" && Number.isFinite(Date.parse(item.recorded_at)) &&
                    item.source_label === (kind === "native_prescription_ids" ? "Living Room Vet · Signed prescription" : "Living Room Vet · Recorded dispense"))) &&
                (kind !== "imported_prescription_ids" ||
                  (typeof item.version_hash === "string" &&
                    /^[a-f0-9]{64}$/.test(item.version_hash) &&
                    (item.completeness === "complete" || item.completeness === "partial") &&
                    (item.completeness === "partial"
                      ? typeof item.partial_disclosure === "string" && item.partial_disclosure.trim().length > 0
                      : item.partial_disclosure === null))) &&
                (kind !== "api_attachment_ids" ||
                  (Number.isSafeInteger(item.version) && item.version > 0 &&
                    typeof item.source_label === "string" &&
                    /^[a-f0-9]{64}$/.test(item.record_hash || "") &&
                    /^[a-f0-9]{64}$/.test(item.capture_hash || "") &&
                    Number.isSafeInteger(item.file_size) && item.file_size! > 0 && item.file_size! <= 20971520 &&
                    ["application/pdf", "image/jpeg", "image/png"].includes(item.mime_type || ""))) &&
                (kind !== "document_ids" ||
                  (Array.isArray(item.required_lab_report_ids) &&
                    item.required_lab_report_ids.every(
                      (id) => typeof id === "string",
                    ) &&
                    Array.isArray(item.required_external_record_ids) &&
                    item.required_external_record_ids.every(
                      (id) => typeof id === "string",
                    ))),
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
  useEffect(() => {
    if (!candidates.data) return;
    setKnownSources((previous) => {
      const next = { ...previous };
      for (const kind of kinds)
        next[kind] = {
          ...previous[kind],
          ...Object.fromEntries(
            candidates.data![kind].map((item) => [item.id, item]),
          ),
        };
      return next;
    });
  }, [candidates.data]);
  const dependencyWarnings: string[] = [];
  for (const kind of ["lab_report_ids", "external_record_ids"] as const) {
    for (const id of selection[kind] || []) {
      const source = knownSources[kind]?.[id];
      if (
        source?.required_document_id &&
        !selection.document_ids?.includes(source.required_document_id)
      )
        dependencyWarnings.push(
          `${source.label}: also select its matching original document, version ${source.required_document_version}.`,
        );
    }
  }
  for (const original of Object.values(knownSources.document_ids || {})) {
    if (
      !selection.document_ids?.includes(original.id) &&
      (original.required_lab_report_ids?.some((id) =>
        selection.lab_report_ids?.includes(id),
      ) ||
        original.required_external_record_ids?.some((id) =>
          selection.external_record_ids?.includes(id),
        ))
    )
      dependencyWarnings.push(
        `${original.label}: keep this matching original selected with its approved provenance, or remove both.`,
      );
  }
  for (const id of selection.document_ids || []) {
    const original = knownSources.document_ids?.[id];
    for (const [kind, required] of [
      ["lab_report_ids", original?.required_lab_report_ids],
      ["external_record_ids", original?.required_external_record_ids],
    ] as const) {
      if (required?.some((sourceId) => !selection[kind]?.includes(sourceId)))
        dependencyWarnings.push(
          `${original!.label}: also select every associated approved report or imported record version.`,
        );
    }
  }
  const history = useQuery({
    queryKey: ["patient-record-releases", petId, user?.id, historyPage],
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
  const configuredRecipient = channel === "EMAIL" ? candidates.data?.email : candidates.data?.phone;
  const recipient = configuredRecipient ? channel === "EMAIL" ? configuredRecipient.trim().toLowerCase() : configuredRecipient.trim().replace(/[ ().-]/g, "") : null;
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
    const limit = releaseFamilyLimit(kind);
    if (checked && existing.length >= limit) {
      setError(
        `Use a separate package for more than ${limit} records in this source family.`,
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
        releaseFamilyLimit(kind),
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
        "select_all_record_release_sources_v12",
        { p_pet_id: petId },
      );
      if (error) throw error;
      if (
        !data ||
        !data.selection ||
        !kinds.every(
          (kind) =>
            Array.isArray(data.selection[kind]) &&
            data.selection[kind]!.length <= (releaseFamilyLimit(kind)) &&
            data.selection[kind]!.every((id) => typeof id === "string"),
        )
      )
        throw new Error(
          "All-record selection is incomplete or exceeds a family limit; selections were not changed.",
        );
      edit();
      setSelection(data.selection);
      setAllSelectionNotice(
        `${data.scope} Excluded unavailable originals: ${data.excluded_unavailable_originals}. Resulted labs without a shareable original: ${data.excluded_labs_without_shareable_original}.`,
      );
    });
  const loadPreview = () =>
    run(async () => {
      if (dependencyWarnings.length)
        throw new Error(
          "Select each approved source and its matching original together, or remove both from this package.",
        );
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
        "preview_record_release_v12",
        args,
      );
      if (error) throw error;
      if (!data || data.snapshot.schema_version !== 12)
        throw new Error(
          "Current source-aware release preview is unavailable. Preserve selections and retry.",
        );
      if (data.snapshot.patient.id !== args.p_pet_id || data.snapshot.recipient.client_id !== args.p_client_id || data.snapshot.recipient.channel !== args.p_channel || data.snapshot.recipient.address !== args.p_recipient || !kinds.every(kind => JSON.stringify([...(data.snapshot.selection?.[kind] ?? [])].sort()) === JSON.stringify([...(args.p_selection[kind] ?? [])].sort()))) throw new Error("Release preview does not match this patient, recipient and explicit selection.");
      renderRecordRelease({ preview: data }); // Validate before displaying an untrusted artifact in React.
      previewArgsRef.current = args;
      setPreview(data);
      setSourceEvidenceStale(false);
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
        if (!pendingUncertain.current && ["40001", "23514", "42501"].includes(error.code)) {
          pendingRef.current = null;
          setPending(null);
          setPreview(null);
          setReviewed(false);
          previewArgsRef.current = null;
        }
        pendingUncertain.current = pendingRef.current !== null;
        throw error;
      }
      pendingUncertain.current = true; // A malformed success cannot establish whether the write committed.
      if (!data || data.id !== args.p_id || data.created_by !== user.id || data.pet_id !== args.p_pet_id || data.client_id !== args.p_client_id || data.channel !== args.p_channel || data.recipient !== args.p_recipient || data.source_hash !== args.p_reviewed_hash || canonicalReleaseValue(data.snapshot) !== canonicalReleaseValue(args.p_reviewed_snapshot) || canonicalReleaseValue(data.selection) !== canonicalReleaseValue(args.p_selection)) throw new Error("Saved release could not be matched to this exact reviewed request. Preserve the original confirmation and retry it.");
      renderRecordRelease({ preview: data });
      pendingUncertain.current = false;
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
      <Button
        variant="outline"
        disabled={
          busy ||
          !!pending ||
          !!preview ||
          emailDirty ||
          smsDirty ||
          candidates.isFetching ||
          history.isFetching
        }
        onClick={() =>
          void run(async () => {
            await Promise.all([candidates.refetch(), history.refetch()]);
          })
        }
      >
        Refresh source list
      </Button>
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
              disabled={
                busy || emailDirty || smsDirty || !!withdrawalRef.current
              }
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
          {opened.release.channel === "SMS" && (
            <DocumentSmsComposer
              family="record_release"
              sourceId={opened.release.id}
              clientId={opened.release.client_id}
              canPrepare={opened.eligible}
              disabled={busy || emailDirty || !!pending}
              onDirtyChange={setSmsDirty}
            />
          )}
          <Label htmlFor={`withdraw-${petId}`}>Withdrawal reason</Label>
          <Input
            id={`withdraw-${petId}`}
            maxLength={2000}
            value={withdrawReason}
            disabled={busy || emailDirty || smsDirty || !!withdrawalRef.current}
            onChange={(e) => setWithdrawReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || smsDirty || !!pending || !withdrawReason.trim()}
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
        {sourceEvidenceStale && (selectedCount > 0 || !!preview || !!pending) && <p role="status">Patient sources changed. Your selection and original request are retained. Review a fresh package before a new confirmation; recover any uncertain confirmation first.</p>}
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
                disabled={busy || candidates.isError || !!preview || !!pending}
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
              {!candidates.data.policy_v12_accepted && (
                <p className="rounded-md bg-muted p-3 text-sm">
                  Preview is available. Confirmation requires recorded clinical
                  acceptance of the applicable release form by the practice
                  operator (version 12, including physical returns and disposition, dispensing annotations and pickup amendments, signed practice prescriptions, recorded dispensing, reviewed API originals, outside prescriptions, vaccinations, imported clinical narratives,
                  locally reviewed source findings, verified laboratory and
                  imported-record provenance).
                </p>
              )}
              <fieldset
                disabled={busy || candidates.isError || !!preview || !!pending}
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
                          {(kind === "lab_report_ids" ||
                            kind === "external_record_ids") && (
                            <div className="space-y-1 text-sm">
                              <p>
                                {item.kind} ·{" "}
                                {item.historical
                                  ? "Historical version"
                                  : "Current version"}{" "}
                                · {item.source_label}
                              </p>
                              <p>
                                Required original: {item.required_document_id} ·
                                document version{" "}
                                {item.required_document_version}
                              </p>
                              <p>
                                {item.acknowledgment_count
                                  ? `${item.acknowledgment_count} exact-version DVM acknowledgment(s)`
                                  : "No DVM acknowledgment recorded for this exact version"}
                                . Byte verification and staff approval are
                                separate from clinical acknowledgment.
                              </p>
                            </div>
                          )}
                          {kind === "api_attachment_ids" && (
                            <p className="text-sm">{item.source_label}. Staff-reviewed original, version {item.version}. Includes the original file; source review does not imply clinical interpretation. Select at most 20 API originals per package.</p>
                          )}
                          {(kind === "native_prescription_ids" || kind === "native_dispense_ids") && <p className="text-sm">{item.source_label}. {kind === "native_prescription_ids" ? "Signed instructions are not proof of dispensing or administration. Selecting an order does not include every dispense." : "An actual dispense includes its required signed prescription context, not invoice details. A dispense is not proof of administration or physical pickup."} Current status, native allowance, correction summaries, selected dispense annotations and any included original or amended pickup acknowledgment are checked in the complete preview. Select at most 20 per package.</p>}
                          {kind === "imported_prescription_ids" && (
                            <div className="space-y-1 text-sm">
                              <p>{item.source_label}. Reviewed outside prescription history; no local prescription, dispensing or medication reconciliation is inferred. Select at most 20 prescription versions per package.</p>
                              <p>{item.completeness === "partial" ? "Partial source history" : "Complete reviewed source"}{item.partial_disclosure ? ` · ${item.partial_disclosure}` : ""}</p>
                            </div>
                          )}
                          {kind === "imported_vaccination_ids" && (
                            <p className="text-sm">{item.source_label}. Reviewed outside history; no local administration or active due plan is inferred. Select at most 20 vaccination versions per package.</p>
                          )}
                          {kind === "imported_history_ids" && (
                            <p className="text-sm">
                              {item.source_label}. Full source narrative is
                              included only when explicitly selected. Selected
                              native problems carry their reviewed source
                              references automatically.
                            </p>
                          )}
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
                              {!!(
                                item.required_lab_report_ids?.length ||
                                item.required_external_record_ids?.length
                              ) && (
                                <p>
                                  This original requires its associated approved
                                  provenance selections:{" "}
                                  {item.required_lab_report_ids?.length || 0}{" "}
                                  laboratory report(s),{" "}
                                  {item.required_external_record_ids?.length ||
                                    0}{" "}
                                  imported record(s).
                                </p>
                              )}
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
                    !kinds.some((k) => candidates.data!.has_more[k])
                  }
                  onClick={() => setSourcePage((v) => v + 1)}
                >
                  Older source records
                </Button>
              </div>
              {dependencyWarnings.length > 0 && (
                <div role="alert" className="space-y-1 text-destructive">
                  {dependencyWarnings.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
              )}
              <p className="text-sm">
                Select all shown applies to this source page. A package supports
                at most 20 API originals, 20 outside vaccinations and 20 outside
                prescriptions, 20 signed practice prescriptions and 20 recorded dispenses, and 100 records per other family. The complete snapshot must fit within 1 MiB; oversized selections must be split. Delivery also
                limits the combined original files to 24; use another package
                for additional history. Body maps include every observation and
                correction, not a signed diagnosis.
              </p>
              {!preview ? (
                <Button
                  disabled={
                    busy ||
                    !!pending ||
                    candidates.isError ||
                    candidates.isFetching ||
                    selectedCount === 0 ||
                    !recipient ||
                    dependencyWarnings.length > 0
                  }
                  onClick={() => void loadPreview()}
                >
                  Review selected package
                </Button>
              ) : (
                <>
                  <RecordReleaseArtifact artifact={{ preview }} />
                  {!!preview.snapshot.api_attachments?.length && (
                    user && profile?.is_active ? (
                      <ApiOriginalPreviewDownloads
                        key={`${user.id}:${petId}:${preview.source_hash}`}
                        originals={preview.snapshot.api_attachments}
                        actor={user.id}
                        petId={petId}
                        disabled={operationBusy || !!pending}
                        onBusyChange={onApiDownloadBusy}
                      />
                    ) : (
                      <p role="status">Active staff access is required to download selected API originals. Review the exact files before attesting to this package.</p>
                    )
                  )}
                  {preview.snapshot.attachments.filter(a => !a.api_attachment_ref && a.bucket !== "ezyvet-attachment-originals").map((a) => (
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
                      smsDirty ||
                      !candidates.data.policy_v12_accepted ||
                      (sourceEvidenceStale && !pending) ||
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
