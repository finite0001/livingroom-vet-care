import { EzyVetPrescriptionImports } from "./EzyVetPrescriptionImports";
import { EzyVetPrescriptionItemImports } from "./EzyVetPrescriptionItemImports";
import { EzyVetVaccinationImports } from "./EzyVetVaccinationImports";
import { EzyVetClinicalImports } from "./EzyVetClinicalImports";
import { EzyVetWeightImports } from "./EzyVetWeightImports";
import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  initialImportFields,
  fieldLabels,
  fieldOptions,
} from "./import-fields";
import type { ImportFields } from "./import-fields";
import type { Tables } from "@/integrations/supabase/types";

type Snapshot = Tables<"ezyvet_import_snapshots">;
interface SelectedTarget {
  id: string;
  version: number;
  label: string;
}
const resources = [
  "contact",
  "contactdetail",
  "address",
  "animal",
  "species",
  "breed",
  "sex",
  "animalcolour",
  "appointment",
  "consult",
  "history",
  "vaccination",
];
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const sourceLabel = (s: Snapshot) =>
  `${s.source_origin} · ${s.source_site_uid} · ${s.resource} #${s.external_id}`;
export function EzyVetImportPage() {
  const { session, profile, hasRole } = useAuth();
  const enabled = Boolean(
    session?.user.id && profile?.is_active && hasRole("ADMIN"),
  );
  const [clinicalDirty, setClinicalDirty] = useState(false);
  const [vaccinationDirty, setVaccinationDirty] = useState(false);
  const [prescriptionDirty, setPrescriptionDirty] = useState(false);
  const [prescriptionItemDirty, setPrescriptionItemDirty] = useState(false);
  const importDirty = enabled && (clinicalDirty || vaccinationDirty || prescriptionDirty || prescriptionItemDirty);
  const blocker = useBlocker(importDirty);
  useEffect(() => {
    if (!importDirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [importDirty]);
  const cache = useQueryClient();
  const [resource, setResource] = useState("contact");
  const [page, setPage] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Snapshot | null>(null);
  const [fields, setFields] = useState<ImportFields>({});
  const [mode, setMode] = useState("create");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<SelectedTarget | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const approvalId = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const snapshots = useQuery({
    queryKey: ["ezyvet-snapshots", resource, page],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_import_snapshots")
        .select("*")
        .eq("resource", resource)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return data;
    },
  });
  const runs = useQuery({
    queryKey: ["ezyvet-runs"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_import_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
  const head = useQuery({
    queryKey: ["ezyvet-head", selected?.id],
    enabled: enabled && Boolean(selected),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_identity_heads")
        .select("*")
        .eq("source_origin", selected.source_origin)
        .eq("source_site_uid", selected.source_site_uid)
        .eq("resource", selected.resource)
        .eq("external_id", selected.external_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const existingLink = useQuery({
    queryKey: ["ezyvet-link", selected?.id],
    enabled: enabled && Boolean(selected),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_record_links")
        .select("*")
        .eq("source_origin", selected.source_origin)
        .eq("source_site_uid", selected.source_site_uid)
        .eq("resource", selected.resource)
        .eq("external_id", selected.external_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const source = selected?.payload as Record<string, unknown> | undefined;
  const owner = useQuery({
    queryKey: ["ezyvet-owner", selected?.id],
    enabled: enabled && selected?.resource === "animal",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_record_links")
        .select("*")
        .eq("source_origin", selected.source_origin)
        .eq("source_site_uid", selected.source_site_uid)
        .eq("resource", "contact")
        .eq("external_id", String(source.contact_id || ""))
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const candidates = useQuery({
    queryKey: [
      "ezyvet-candidates",
      selected?.id,
      search,
      owner.data?.client_id,
    ],
    enabled:
      enabled &&
      mode === "link" &&
      Boolean(selected) &&
      (selected.resource === "contact"
        ? search.trim().length >= 2
        : Boolean(owner.data?.client_id)),
    queryFn: async () => {
      if (selected.resource === "contact") {
        const { data, error } = await supabase.rpc("search_clients", {
          p_search: search.trim(),
          p_limit: 20,
        });
        if (error) throw error;
        return data.map((row) => ({
          id: row.id,
          version: row.version,
          label: `${row.full_name} · ${row.primary_email || row.primary_phone || "No contact details"}`,
        }));
      }
      const { data, error } = await supabase
        .from("pets")
        .select("id,name,species,version")
        .eq("client_id", owner.data.client_id)
        .order("name")
        .limit(100);
      if (error) throw error;
      return data.map((row) => ({
        id: row.id,
        version: row.version,
        label: `${row.name} · ${row.species}`,
      }));
    },
  });
  const reviews = useQuery({
    queryKey: ["ezyvet-reviews", selected?.id],
    enabled: enabled && Boolean(selected),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ezyvet_import_reviews")
        .select("*")
        .eq("snapshot_id", selected.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  async function perform(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!enabled) throw new Error("Active administrator access required.");
      await work();
    } catch (failure) {
      setError(
        failure && typeof failure === "object" && "message" in failure
          ? String(failure.message)
          : "Request failed. Your review is retained.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["ezyvet-snapshots"] }),
      cache.invalidateQueries({ queryKey: ["ezyvet-runs"] }),
      cache.invalidateQueries({ queryKey: ["ezyvet-head"] }),
      cache.invalidateQueries({ queryKey: ["ezyvet-link"] }),
      cache.invalidateQueries({ queryKey: ["ezyvet-owner"] }),
      cache.invalidateQueries({ queryKey: ["ezyvet-reviews"] }),
    ]);
  }
  function choose(row: Snapshot) {
    setSelected(row);
    setFields(
      initialImportFields(row.resource, row.payload as Record<string, unknown>),
    );
    setMode("create");
    setTarget(null);
    setSearch("");
    setReason("");
    setConfirmed(false);
    approvalId.current = null;
    setError("");
    setNotice("");
  }
  async function stage() {
    if (["consult", "history", "vaccination"].includes(resource)) return;
    await perform(async () => {
      const id = runId || crypto.randomUUID();
      setRunId(id);
      const { data, error } = await supabase.functions.invoke("ezyvet-import", {
        body: { run_id: id, resource },
      });
      if (error) {
        let code = "Import request failed";
        if ("context" in error && error.context instanceof Response) {
          try {
            const result = await error.context.json();
            code = `${result.error || code}${result.retry_after_seconds ? ` · retry after ${result.retry_after_seconds} seconds` : ""}`;
          } catch {
            /* No raw server body is displayed. */
          }
        }
        throw new Error(code);
      }
      if (data?.error) throw new Error(String(data.error));
      setNotice(
        data.status === "review_ready"
          ? "Source pages staged for review. No local records changed."
          : data.status === "page_limit_reached"
            ? "Page safety limit reached. Additional source records may remain."
            : `Page staged. Next server page: ${data.next_page}.`,
      );
      await refresh();
    });
  }
  async function approve() {
    await perform(async () => {
      if (!selected || !head.data || !confirmed || !reason.trim())
        throw new Error("Complete the review and confirmation first.");
      approvalId.current ??= crypto.randomUUID();
      const { error } = await supabase.rpc("promote_ezyvet_identity", {
        p_request_id: approvalId.current,
        p_snapshot_id: selected.id,
        p_expected_hash: selected.payload_hash,
        p_head_version: head.data.version,
        p_action: mode,
        p_client_id:
          selected.resource === "contact"
            ? mode === "link"
              ? target?.id
              : null
            : owner.data?.client_id,
        p_pet_id:
          selected.resource === "animal" && mode === "link" ? target?.id : null,
        p_expected_local_version: mode === "link" ? target?.version : null,
        p_values: mode === "create" ? fields : {},
        p_reason: reason.trim(),
      });
      if (error) throw error;
      setNotice(
        mode === "create"
          ? "Reviewed local record created and linked."
          : "Existing local record linked; its fields were not changed.",
      );
      await refresh();
    });
  }
  async function recover() {
    await perform(async () => {
      const { data, error } = await supabase
        .from("ezyvet_record_links")
        .select("id")
        .eq("request_id", approvalId.current)
        .eq("approved_by", session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setNotice("The approval completed. Existing local record retained.");
        await refresh();
      } else {
        approvalId.current = null;
        setNotice("Approval has not completed. Review values and retry.");
      }
    });
  }
  const promotable =
    selected && ["contact", "animal"].includes(selected.resource);
  const stale = selected && head.data && head.data.snapshot_id !== selected.id;
  if (!enabled)
    return (
      <p role="alert" className="p-6">
        Active administrator access is required for ezyVet imports.
      </p>
    );
  return (
    <section className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <AlertDialog open={blocker.state === "blocked"}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {clinicalDirty && !vaccinationDirty && !prescriptionDirty && !prescriptionItemDirty
                  ? "Leave clinical import recovery?"
                  : vaccinationDirty && !clinicalDirty && !prescriptionDirty && !prescriptionItemDirty
                    ? "Leave vaccination import recovery?"
                    : "Leave import recovery?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                Original request references remain saved for recovery. Leaving
                does not cancel an in-flight scan or approve source records.
                Unsaved review fields may be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => blocker.state === "blocked" && blocker.reset()}
              >
                Stay with this run
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => blocker.state === "blocked" && blocker.proceed()}
              >
                Leave and retain recovery
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <EzyVetClinicalImports
          key={`clinical:${session.user.id}`}
          actor={session.user.id}
          onDirtyChange={setClinicalDirty}
        />
        <EzyVetVaccinationImports
          key={`vaccination:${session.user.id}`}
          actor={session.user.id}
          onDirtyChange={setVaccinationDirty}
        />
        <EzyVetPrescriptionImports
          key={`prescription:${session.user.id}`}
          actor={session.user.id}
          onDirtyChange={setPrescriptionDirty}
        />
        <EzyVetPrescriptionItemImports
          key={`prescriptionitem:${session.user.id}`}
          actor={session.user.id}
          onDirtyChange={setPrescriptionItemDirty}
        />
        <EzyVetWeightImports key={session.user.id} actor={session.user.id} />
        <header>
          <h1 className="text-2xl font-semibold">ezyVet import review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Living Room Vet is the primary record system. Source snapshots
            remain separate until an administrator explicitly creates or links a
            household or patient. Later imports never overwrite local edits.
          </p>
        </header>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <Card>
          <CardHeader>
            <CardTitle>Stage source records</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Requires server-side ezyVet configuration and staging mode.
              Provider credentials are never entered here. A request processes
              one page; wait for the stated retry interval after errors.
            </p>
            <Label htmlFor="ezyvet-resource">Source resource</Label>
            <select
              id="ezyvet-resource"
              className={selectClass}
              value={resource}
              disabled={busy}
              onChange={(event) => {
                setResource(event.target.value);
                setPage(0);
                setRunId(null);
                setSelected(null);
              }}
            >
              {resources.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              {["consult", "history", "vaccination"].includes(resource) && (
                <p>
                  Generic clinical observations are read-only. Use the mapped
                  patient clinical import above for new scans; legacy unscoped
                  runs cannot continue.
                </p>
              )}
              <Button
                disabled={
                  busy ||
                  ["consult", "history", "vaccination"].includes(resource)
                }
                onClick={() => void stage()}
              >
                {runId ? "Stage next source page" : "Start staged import"}
              </Button>
              {runId && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRunId(null)}
                >
                  Start a separate scan
                </Button>
              )}
            </div>
            {runId && <p className="break-all text-xs">Current run: {runId}</p>}
            {runs.isError && (
              <p role="alert">
                Import runs could not be loaded.{" "}
                <button
                  className="underline"
                  onClick={() => void runs.refetch()}
                >
                  Retry runs
                </button>
              </p>
            )}
            <ul className="space-y-2">
              {runs.data?.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span>
                    {run.resource} · {run.status} · next page {run.next_page}
                  </span>
                  {run.last_error_code && (
                    <Badge variant="outline">{run.last_error_code}</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy ||
                      ["consult", "history"].includes(run.resource) ||
                      run.requested_by !== session.user.id ||
                      run.status !== "running"
                    }
                    onClick={() => {
                      setResource(run.resource);
                      setRunId(run.id);
                      setPage(0);
                      setSelected(null);
                    }}
                  >
                    Resume {run.id.slice(0, 8)}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Staged snapshots</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {snapshots.isLoading && (
                <p role="status">Loading staged records…</p>
              )}
              {snapshots.isError && (
                <p role="alert">
                  Snapshots could not be loaded.{" "}
                  <button
                    className="underline"
                    onClick={() => void snapshots.refetch()}
                  >
                    Retry snapshots
                  </button>
                </p>
              )}
              {snapshots.data?.length === 0 && (
                <p>No staged {resource} records.</p>
              )}
              <ul className="space-y-2">
                {snapshots.data?.map((row) => (
                  <li key={row.id}>
                    <Button
                      className="h-auto w-full whitespace-normal justify-start text-left"
                      variant={
                        row.id === selected?.id ? "secondary" : "outline"
                      }
                      disabled={busy}
                      onClick={() => choose(row)}
                    >
                      Review {row.resource} #{row.external_id}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={busy || page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous snapshots
                </Button>
                <span>{page + 1}</span>
                <Button
                  variant="outline"
                  disabled={busy || snapshots.data?.length !== 20}
                  onClick={() => setPage(page + 1)}
                >
                  Next snapshots
                </Button>
              </div>
            </CardContent>
          </Card>
          {selected && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Review {selected.resource} #{selected.external_id}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="break-all text-xs text-muted-foreground">
                  {sourceLabel(selected)}
                </p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(source)
                    .filter(
                      ([key, value]) =>
                        [
                          "id",
                          "first_name",
                          "last_name",
                          "name",
                          "contact_id",
                          "species_id",
                          "breed_id",
                          "sex_id",
                          "animalcolour_id",
                          "date_of_birth",
                          "date_of_death",
                          "is_dead",
                          "microchip_number",
                        ].includes(key) &&
                        ["string", "number", "boolean"].includes(typeof value),
                    )
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-muted-foreground">
                          Source {key.replace(/_/g, " ")}
                        </dt>
                        <dd className="break-words">{String(value)}</dd>
                      </div>
                    ))}
                </dl>
                {[head, existingLink, owner, reviews].some(
                  (query) => query.isError,
                ) && (
                  <p role="alert">
                    Review context could not be loaded.{" "}
                    <Button variant="outline" onClick={() => void refresh()}>
                      Reload review context
                    </Button>
                  </p>
                )}
                {existingLink.data ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <Badge>Already linked</Badge>
                    <p>
                      Local fields remain authoritative. Source changes are
                      retained for review.
                    </p>
                    <Button asChild variant="outline">
                      <Link
                        to={
                          existingLink.data.pet_id
                            ? `/hub/patient/${existingLink.data.pet_id}`
                            : `/hub/client/${existingLink.data.client_id}`
                        }
                      >
                        Open local record
                      </Link>
                    </Button>
                    <p className="text-xs">
                      Approved by {existingLink.data.approved_by} · local
                      version {existingLink.data.local_version} ·{" "}
                      {existingLink.data.reason}
                    </p>
                  </div>
                ) : stale ? (
                  <p role="alert">
                    A newer source observation exists. Reload snapshots and
                    review the current version before approval.
                  </p>
                ) : promotable ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void approve();
                    }}
                    className="space-y-3"
                  >
                    {selected.resource === "animal" && !owner.data && (
                      <p role="alert">
                        Review and link source contact #
                        {String(source.contact_id || "unknown")} first. A
                        patient must belong to that linked household.
                      </p>
                    )}
                    <fieldset
                      disabled={busy || Boolean(approvalId.current)}
                      className="space-y-3"
                    >
                      <Label htmlFor="import-action">Reviewed action</Label>
                      <select
                        id="import-action"
                        className={selectClass}
                        value={mode}
                        onChange={(event) => {
                          setMode(event.target.value);
                          setTarget(null);
                          setConfirmed(false);
                        }}
                      >
                        <option value="create">
                          Create a reviewed{" "}
                          {selected.resource === "contact"
                            ? "household"
                            : "patient"}
                        </option>
                        <option value="link">
                          Link an existing local record
                        </option>
                      </select>
                      {mode === "create" ? (
                        <>
                          <p className="text-sm text-muted-foreground">
                            Confirm every value. Reference IDs do not establish
                            species, breed or sex. Birthdate suggestions use the
                            source epoch’s UTC date; correct them if needed.
                            Blank contact details are not inferred from
                            unrelated records. Check for existing records before
                            creating a duplicate.
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {Object.entries(fields).map(([key, value]) => (
                              <div key={key}>
                                <Label htmlFor={`import-${key}`}>
                                  {fieldLabels[key]}
                                </Label>
                                {fieldOptions[key] ? (
                                  <select
                                    id={`import-${key}`}
                                    className={selectClass}
                                    value={value}
                                    onChange={(event) =>
                                      setFields({
                                        ...fields,
                                        [key]: event.target.value,
                                      })
                                    }
                                  >
                                    {fieldOptions[key].map((option) => (
                                      <option key={option}>{option}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <Input
                                    id={`import-${key}`}
                                    value={value}
                                    type={
                                      ["dob", "deceased_at"].includes(key)
                                        ? "date"
                                        : "text"
                                    }
                                    onChange={(event) =>
                                      setFields({
                                        ...fields,
                                        [key]: event.target.value,
                                      })
                                    }
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2">
                          {selected.resource === "contact" && (
                            <>
                              <Label htmlFor="import-match-search">
                                Search existing household
                              </Label>
                              <Input
                                id="import-match-search"
                                value={search}
                                onChange={(event) => {
                                  setSearch(event.target.value);
                                  setTarget(null);
                                }}
                                placeholder="Name, email or phone (at least 2 characters)"
                              />
                            </>
                          )}
                          <Label htmlFor="import-match">
                            Existing local record
                          </Label>
                          <select
                            id="import-match"
                            className={selectClass}
                            value={target?.id || ""}
                            onChange={(event) => {
                              setTarget(
                                candidates.data?.find(
                                  (row) => row.id === event.target.value,
                                ) || null,
                              );
                              setConfirmed(false);
                            }}
                          >
                            <option value="">Choose a record</option>
                            {candidates.data?.map((row) => (
                              <option key={row.id} value={row.id}>
                                {row.label}
                              </option>
                            ))}
                          </select>
                          {candidates.isError && (
                            <p role="alert">
                              Matching records could not be loaded.{" "}
                              <button
                                type="button"
                                className="underline"
                                onClick={() => void candidates.refetch()}
                              >
                                Retry matches
                              </button>
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            Linking preserves all existing values and patient
                            ownership.
                          </p>
                        </div>
                      )}
                      <Label htmlFor="import-reason">Review reason</Label>
                      <Input
                        id="import-reason"
                        value={reason}
                        maxLength={2000}
                        onChange={(event) => setReason(event.target.value)}
                      />
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={confirmed}
                          onChange={(event) =>
                            setConfirmed(event.target.checked)
                          }
                        />
                        I reviewed the source, household and local values, and
                        checked for duplicates.
                      </label>
                    </fieldset>
                    <Button
                      disabled={
                        busy ||
                        !confirmed ||
                        !reason.trim() ||
                        !head.data ||
                        head.isError ||
                        existingLink.isLoading ||
                        existingLink.isError ||
                        (selected.resource === "animal" &&
                          (!owner.data || owner.isError)) ||
                        (mode === "link" && !target)
                      }
                      type="submit"
                    >
                      {approvalId.current
                        ? "Retry reviewed approval"
                        : "Approve reviewed import"}
                    </Button>
                    {approvalId.current && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void recover()}
                      >
                        Recheck approval status
                      </Button>
                    )}
                  </form>
                ) : (
                  <p className="text-sm">
                    This reference or clinical snapshot is retained for review.
                    Automatic chart creation from this resource is not
                    supported.
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer">
                    Earlier review decisions
                  </summary>
                  <ul>
                    {reviews.data?.map((review) => (
                      <li key={review.id} className="mt-2 text-sm">
                        {review.decision} · {review.reason} ·{" "}
                        {review.reviewed_by}
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
