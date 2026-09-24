import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClinicalHistoryReview } from "./ClinicalHistoryReview";
import { ClinicalProblemFields } from "./ClinicalProblemFields";
import { ImportedHistoryEvidence } from "./ImportedHistoryEvidence";
import { emptyClinicalProblem, reviewedProblem } from "./history-fields";
import { extractionPayload } from "./history-state";
import type {
  HistoryCursor,
  ImportedHistory,
  ProblemRow,
  ProblemExtraction,
} from "./history-state";
import {
  listImportedHistories,
  searchHistoryProblems,
  readProblemProvenance,
} from "./history-api";
import { patientProblemsKey } from "../clinical/alert-review";
import { refreshPatientReleases } from "../record-releases/refresh";
interface Props {
  petId: string;
  patientVersion: number;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function PatientImportedHistory(props: Props) {
  const { user, profile, hasRole } = useAuth();
  return user && profile?.is_active ? (
    <ImportedHistoryPanel
      key={`${user.id}:${props.petId}`}
      {...props}
      actor={user.id}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
interface InnerProps extends Props {
  actor: string;
  dvm: boolean;
}
function ImportedHistoryPanel({
  petId,
  patientVersion,
  disabled,
  onDirtyChange,
  actor,
  dvm,
}: InnerProps) {
  const cache = useQueryClient();
  const [cursor, setCursor] = useState<HistoryCursor | null>(null),
    [opened, setOpened] = useState<ImportedHistory | null>(null),
    [selected, setSelected] = useState<Record<string, ImportedHistory>>({});
  const [draft, setDraft] = useState(emptyClinicalProblem),
    [action, setAction] = useState<"create" | "link">("create"),
    [target, setTarget] = useState<ProblemRow | null>(null),
    [search, setSearch] = useState(""),
    [reason, setReason] = useState(""),
    [duplicates, setDuplicates] = useState(false);
  const [discrepancySearch, setDiscrepancySearch] = useState(""),
    [discrepancyTarget, setDiscrepancyTarget] = useState<ProblemRow | null>(
      null,
    );
  const [extractDirty, setExtractDirty] = useState(false),
    [discrepancyDirty, setDiscrepancyDirty] = useState(false),
    [extraction, setExtraction] = useState<ProblemExtraction | null>(null);
  useEffect(() => {
    onDirtyChange(extractDirty || discrepancyDirty);
    return () => onDirtyChange(false);
  }, [extractDirty, discrepancyDirty, onDirtyChange]);
  const histories = useQuery({
    queryKey: ["patient-imported-history", actor, petId, cursor],
    queryFn: () => listImportedHistories(petId, cursor),
    retry: false,
  });
  const problems = useQuery({
    queryKey: ["import-problem-search", actor, petId, search],
    queryFn: () => searchHistoryProblems(petId, search),
    enabled: dvm && search.trim().length >= 2,
    retry: false,
  });
  const discrepancyProblems = useQuery({
    queryKey: ["import-problem-search", actor, petId, discrepancySearch],
    queryFn: () => searchHistoryProblems(petId, discrepancySearch),
    enabled: dvm && discrepancySearch.trim().length >= 2,
    retry: false,
  });
  const provenance = useQuery({
    queryKey: [
      "problem-import-provenance",
      actor,
      petId,
      discrepancyTarget?.id,
    ],
    queryFn: () => readProblemProvenance(petId, [discrepancyTarget!.id]),
    enabled: dvm && !!discrepancyTarget,
    retry: false,
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: patientProblemsKey(petId) });
    void cache.invalidateQueries({ queryKey: ["problem-import-provenance"] });
    void cache.invalidateQueries({ queryKey: ["patient-imported-history"] });
    void cache.invalidateQueries({ queryKey: ["import-problem-search"] });
    void refreshPatientReleases(cache, petId);
  };
  const reset = () => {
    setSelected({});
    setDraft(emptyClinicalProblem());
    setAction("create");
    setTarget(null);
    setReason("");
    setDuplicates(false);
  };
  const fields = () =>
    action === "link" && target
      ? {
          title: target.title,
          notes: target.notes,
          onset_date: target.onset_date,
          status: target.status,
          importance: target.importance,
        }
      : reviewedProblem(draft);
  const selectedRows = Object.values(selected);
  if (
    !dvm &&
    !histories.isLoading &&
    !histories.isError &&
    cursor === null &&
    (histories.data?.histories.length ?? 0) === 0
  )
    return null;
  return (
    <section
      aria-label="Approved imported clinical history"
      className="space-y-4 rounded-md border p-4"
    >
      <h2 className="text-lg font-semibold">
        Approved ezyVet clinical history
      </h2>
      <p>
        Outside source narratives retain their original references.
        Administrator approval makes them readable here; it does not create a
        locally signed SOAP note or a veterinarian finding.
      </p>
      {histories.isError && <p role="alert">Approved history unavailable.</p>}
      {histories.data?.histories.length === 0 && (
        <p>No approved histories on this page.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {histories.data?.histories.map((h) => (
          <Button variant="outline" key={h.id} onClick={() => setOpened(h)}>
            Read approved history {h.source.history_id} version {h.version}
          </Button>
        ))}
      </div>
      {opened && <ImportedHistoryEvidence history={opened} />}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={histories.isFetching}
          onClick={() => void histories.refetch()}
        >
          Refresh approved history
        </Button>
        <Button
          variant="outline"
          disabled={!cursor || histories.isFetching}
          onClick={() => setCursor(null)}
        >
          Newest approved histories
        </Button>
        <Button
          variant="outline"
          disabled={!histories.data?.next_cursor || histories.isFetching}
          onClick={() => setCursor(histories.data!.next_cursor)}
        >
          Older approved histories
        </Button>
      </div>
      {dvm && (
        <>
          <ClinicalHistoryReview
            actor={actor}
            petId={petId}
            kind="problem_extraction"
            disabled={disabled || discrepancyDirty}
            draftDirty={
              selectedRows.length > 0 ||
              !!draft.title ||
              !!draft.notes ||
              !!draft.onset ||
              !!draft.status ||
              !!draft.importance ||
              !!reason ||
              !!target
            }
            canPrepare={
              selectedRows.length > 0 &&
              selectedRows.length <= 20 &&
              selectedRows.every((h) => h.current.is_current) &&
              duplicates &&
              reason.trim().length >= 5 &&
              (action === "create"
                ? !!draft.title.trim() && !!draft.status && !!draft.importance
                : !!target)
            }
            payload={() =>
              extractionPayload.parse({
                sources: selectedRows.map((h) => ({
                  id: h.id,
                  version_hash: h.version_hash,
                })),
                patient_version: patientVersion,
                action,
                problem_id: action === "link" ? target!.id : null,
                problem_version: action === "link" ? target!.version : null,
                fields: fields(),
                duplicate_decision:
                  action === "link" ? "link_existing" : "distinct_finding",
                reason,
              })
            }
            onDirtyChange={setExtractDirty}
            onReset={reset}
            onCommitted={refresh}
          >
            <p>
              Select up to 20 exact approved source versions; selection is
              retained across pages.
            </p>
            {histories.data?.histories.map((h) => (
              <label key={h.id} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[h.id]}
                  disabled={
                    (!h.current.is_current && !selected[h.id]) ||
                    (selectedRows.length >= 20 && !selected[h.id]) ||
                    selectedRows.some(
                      (chosen) =>
                        chosen.id !== h.id &&
                        chosen.source.origin === h.source.origin &&
                        chosen.source.site_uid === h.source.site_uid &&
                        chosen.source.animal_id === h.source.animal_id &&
                        chosen.source.history_id === h.source.history_id,
                    )
                  }
                  onChange={(e) => {
                    setSelected((v) => {
                      const next = { ...v };
                      if (e.target.checked) next[h.id] = h;
                      else delete next[h.id];
                      return next;
                    });
                    setDuplicates(false);
                  }}
                />
                Use history {h.source.history_id} version {h.version}
                {!h.current.is_current ? " — source review needed" : ""}
              </label>
            ))}
            <p>
              {selectedRows.length} source versions selected. Choose one version
              per outside history.
            </p>
            {selectedRows.map((h) => (
              <div key={h.id} className="flex gap-2">
                <span>
                  {h.source.history_id} · version {h.version}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setSelected((v) => {
                      const next = { ...v };
                      delete next[h.id];
                      return next;
                    })
                  }
                >
                  Remove history {h.source.history_id} version {h.version}
                </Button>
              </div>
            ))}
            <label className="block">
              Compare existing patient problems
              <Input
                value={search}
                maxLength={200}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setDuplicates(false);
                }}
              />
            </label>
            {problems.isError && (
              <p role="alert">Problem comparison unavailable.</p>
            )}
            {problems.data?.map((p) => (
              <div key={p.id} className="rounded border p-2">
                <p>
                  {p.title} · {p.status} · {p.importance}
                </p>
                <p className="whitespace-pre-wrap">{p.notes}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setTarget(p);
                    setAction("link");
                    setDuplicates(false);
                  }}
                >
                  Link existing problem {p.title}
                </Button>
              </div>
            ))}
            <label className="block">
              Local finding action
              <select
                className="block w-full rounded border bg-background p-2"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value as "create" | "link");
                  setDuplicates(false);
                }}
              >
                <option value="create">
                  Create a distinct locally authored finding
                </option>
                <option value="link">
                  Link to a selected existing problem
                </option>
              </select>
            </label>
            {action === "create" ? (
              <ClinicalProblemFields
                value={draft}
                onChange={(value) => {
                  setDraft(value);
                  if (value.title !== draft.title) setDuplicates(false);
                }}
                disabled={false}
              />
            ) : target ? (
              <div>
                <p>
                  Existing problem: {target.title} · version {target.version}
                </p>
                <p className="whitespace-pre-wrap">{target.notes}</p>
                <p>
                  {target.status} · {target.importance} · onset{" "}
                  {target.onset_date ?? "unknown"}. All local fields remain
                  unchanged.
                </p>
              </div>
            ) : (
              <p>Select an existing patient problem above.</p>
            )}
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={duplicates}
                disabled={
                  search.trim().length < 2 ||
                  !problems.data ||
                  problems.isFetching ||
                  problems.isError
                }
                onChange={(e) => setDuplicates(e.target.checked)}
              />
              I compared the existing patient problems and chose a distinct
              finding or an exact existing link.
            </label>
            <label className="block">
              Clinical extraction reason (5–2,000 characters)
              <Textarea
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </ClinicalHistoryReview>
          <section className="space-y-3">
            <h3 className="font-semibold">Source discrepancy review</h3>
            <p>
              Find an existing problem to inspect its imported sources. Review
              never changes local clinical fields.
            </p>
            <label className="block">
              Find problem for source discrepancy review
              <Input
                value={discrepancySearch}
                maxLength={200}
                disabled={extractDirty || discrepancyDirty}
                onChange={(e) => setDiscrepancySearch(e.target.value)}
              />
            </label>
            {discrepancyProblems.isError && (
              <p role="alert">Problem lookup unavailable.</p>
            )}
            {discrepancyProblems.data?.map((p) => (
              <Button
                key={p.id}
                variant="outline"
                disabled={extractDirty || discrepancyDirty}
                onClick={() => setDiscrepancyTarget(p)}
              >
                Inspect imported sources for {p.title}
              </Button>
            ))}
            {provenance.isError && (
              <p role="alert">Problem source history unavailable.</p>
            )}
            {provenance.data
              ?.flatMap((p) => p.extractions)
              .map((e) => (
                <div key={e.id}>
                  <p>
                    {e.discrepancy.required
                      ? "Source review required"
                      : e.discrepancy.reviewed
                        ? "Source discrepancy reviewed"
                        : "Original source state retained"}{" "}
                    · local version {e.current_problem_version}
                    {e.locally_edited
                      ? " · local fields edited since extraction"
                      : ""}
                  </p>
                  <Button
                    variant="outline"
                    disabled={extractDirty || discrepancyDirty}
                    onClick={() => setExtraction(e)}
                  >
                    Review source changes {e.id.slice(0, 8)}
                  </Button>
                </div>
              ))}
          </section>
          <HistoryDiscrepancy
            actor={actor}
            petId={petId}
            extraction={extraction}
            histories={histories.data?.histories ?? []}
            disabled={disabled || extractDirty}
            onDirtyChange={setDiscrepancyDirty}
            onReset={() => setExtraction(null)}
            onCommitted={refresh}
          />
        </>
      )}
    </section>
  );
}
interface DiscrepancyProps {
  actor: string;
  petId: string;
  extraction: ProblemExtraction | null;
  histories: ImportedHistory[];
  disabled: boolean;
  onDirtyChange: (v: boolean) => void;
  onReset: () => void;
  onCommitted: () => void;
}
function HistoryDiscrepancy({
  actor,
  petId,
  extraction,
  histories,
  disabled,
  onDirtyChange,
  onReset,
  onCommitted,
}: DiscrepancyProps) {
  const [selected, setSelected] = useState<Record<string, ImportedHistory>>({}),
    [reason, setReason] = useState("");
  const original = extraction?.sources ?? [];
  const same = (a: ImportedHistory, b: (typeof original)[number]) =>
    a.source.origin === b.source.origin &&
    a.source.site_uid === b.source.site_uid &&
    a.source.animal_id === b.source.animal_id &&
    a.source.history_id === b.source.history_id;
  return (
    <ClinicalHistoryReview
      actor={actor}
      petId={petId}
      kind="discrepancy_review"
      disabled={disabled}
      draftDirty={!!extraction || !!reason || Object.keys(selected).length > 0}
      canPrepare={
        !!extraction &&
        reason.trim().length >= 5 &&
        original.every((h) => selected[h.id]?.current.is_current)
      }
      payload={() => ({
        extraction_id: extraction!.id,
        reviewed_sources: original.map((h) => ({
          original_history_id: h.id,
          reviewed_history_id: selected[h.id].id,
          version_hash: selected[h.id].version_hash,
        })),
        reason,
      })}
      onDirtyChange={onDirtyChange}
      onReset={() => {
        setSelected({});
        setReason("");
        onReset();
      }}
      onCommitted={onCommitted}
    >
      {original.map((h) => (
        <label key={h.id} className="block">
          Replacement reviewed evidence for history {h.source.history_id}
          <select
            className="block w-full rounded border bg-background p-2"
            value={selected[h.id]?.id ?? ""}
            onChange={(e) => {
              const found = histories.find((v) => v.id === e.target.value);
              setSelected((v) => {
                const next = { ...v };
                if (found) next[h.id] = found;
                else delete next[h.id];
                return next;
              });
            }}
          >
            <option value="">Select exact current approved version</option>
            {[
              ...new Map(
                [...histories, ...Object.values(selected)].map((v) => [
                  v.id,
                  v,
                ]),
              ).values(),
            ]
              .filter((v) => v.current.is_current && same(v, h))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  History {v.source.history_id} version {v.version}
                </option>
              ))}
          </select>
        </label>
      ))}
      <label className="block">
        Source discrepancy review reason (5–2,000 characters)
        <Textarea
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </ClinicalHistoryReview>
  );
}
