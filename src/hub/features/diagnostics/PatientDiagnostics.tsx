import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hub/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import * as api from "./api";
import {
  actionSchema,
  detailSchema,
  emptyValues,
  emptyObservation,
  type DiagnosticAction,
  type DiagnosticDetail,
  type DiagnosticValues,
  type Observation,
} from "./model";
import { NumericFindingInput } from "./NumericFindingInput";
import { DiagnosticTrends } from "./DiagnosticTrends";
import { DiagnosticPdfReview } from "./pdf-jobs/DiagnosticPdfReview";
interface Props {
  petId: string;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
const pendingSchema = z
  .object({ action_id: z.string().uuid(), action: actionSchema })
  .strict();
const sourceChoiceSchema = z.object({
  id: z.string().uuid(),
  pet_id: z.string().uuid(),
  version: z.number().int().positive(),
  file_name: z.string().optional(),
  test_name: z.string().optional(),
  visit_at: z.string().optional(),
});
const selectClass =
  "w-full rounded-md border border-input bg-background p-2 text-sm";
export function PatientDiagnostics(props: Props) {
  const { session, profile, hasRole } = useAuth();
  return session && profile?.is_active ? (
    <Workspace
      key={`${session.user.id}:${props.petId}`}
      {...props}
      actor={session.user.id}
      dvm={hasRole("DVM")}
    />
  ) : null;
}
interface WorkspaceProps extends Props {
  actor: string;
  dvm: boolean;
}
function Workspace({
  petId,
  disabled,
  onDirtyChange,
  actor,
  dvm,
}: WorkspaceProps) {
  const cache = useQueryClient();
  const [current, setCurrent] = useState<DiagnosticDetail | null>(null);
  const [draft, setDraft] = useState<DiagnosticValues | null>(null),
    [id, setId] = useState("");
  const [baseline, setBaseline] = useState("");
  const [review, setReview] = useState(""),
    [reason, setReason] = useState(""),
    [attest, setAttest] = useState(false);
  const [pending, setPending] = useState<z.infer<typeof pendingSchema> | null>(
      null,
    ),
    [corrupt, setCorrupt] = useState(false);
  const pendingRef = useRef<z.infer<typeof pendingSchema> | null>(null);
  const lock = useRef(false),
    alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [numericIssues, setNumericIssues] = useState<Record<string, boolean>>(
    {},
  );
  const [editorEpoch, setEditorEpoch] = useState(0);
  const invalidNumeric = Object.entries(numericIssues).some(
    ([key, v]) =>
      v && draft?.observations.some((o) => key.startsWith(o.id + ":")),
  );
  const [reviewedOriginal, setReviewedOriginal] = useState("");
  const originalUrls = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of originalUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const key = `lrv:diagnostic-action:${actor}:${petId}`;
  const dirty =
    invalidNumeric ||
    busy ||
    Boolean(pending) ||
    Boolean(
      draft &&
        (JSON.stringify(draft) !== baseline || review || reason || attest),
    );
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = pendingSchema.parse(JSON.parse(raw));
        if (saved.action.pet_id !== petId) throw new Error("Patient differs");
        pendingRef.current = saved;
        setPending(saved);
        setId(saved.action.id);
        setDraft(saved.action.values);
        setBaseline("");
        setReview(saved.action.review_note);
        setReason(saved.action.correction_reason);
        setError(
          "A diagnostic operation is unconfirmed. Recover the exact saved receipt before editing.",
        );
      }
    } catch {
      setCorrupt(true);
      setError(
        "Local recovery data could not be read. Preserve this browser session and contact support before saving more diagnostic work.",
      );
    }
    return () => {
      alive.current = false;
    };
  }, [key, petId]);
  const list = useInfiniteQuery({
    queryKey: ["diagnostic-panels", petId, actor],
    initialPageParam: null as { id: string; updated_at: string } | null,
    queryFn: ({ pageParam }) => api.list(petId, pageParam),
    getNextPageParam: (p) => p.next ?? undefined,
  });
  const [sourcePages, setSourcePages] = useState([0, 0, 0]);
  const choices = useQuery({
    queryKey: ["diagnostic-source-choices", petId, sourcePages],
    queryFn: async () => {
      const tables = [
        "patient_lab_orders",
        "clinical_encounters",
        "patient_documents",
      ] as const;
      const results = await Promise.all(
        tables.map(async (table, tableIndex) => {
          let query = supabase
            .from(table)
            .select(
              table === "patient_documents"
                ? "id,pet_id,version,file_name"
                : table === "patient_lab_orders"
                  ? "id,pet_id,version,test_name"
                  : "id,pet_id,version,visit_at",
            )
            .eq("pet_id", petId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(
              sourcePages[tableIndex] * 100,
              sourcePages[tableIndex] * 100 + 100,
            );
          if (table === "patient_documents")
            query = query.eq("status", "ready");
          const { data, error } = await query;
          if (error) throw error;
          return z.array(sourceChoiceSchema).parse(data);
        }),
      );
      if (results.some((rows) => rows.some((r) => r.pet_id !== petId)))
        throw new Error("Source choice patient differs");
      return results;
    },
  });
  const history = useInfiniteQuery({
    queryKey: ["diagnostic-history", petId, current?.panel.id],
    enabled: Boolean(current),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api.history(current!.panel.id, petId, pageParam),
    getNextPageParam: (p) => p.next ?? undefined,
  });
  async function invalidate() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["diagnostic-panels", petId] }),
      cache.invalidateQueries({ queryKey: ["diagnostic-trends", petId] }),
      cache.invalidateQueries({ queryKey: ["diagnostic-history", petId] }),
      cache.invalidateQueries({ queryKey: ["release-candidates-v13", petId] }),
    ]);
  }
  function apply(value: DiagnosticDetail) {
    setReviewedOriginal("");
    setNumericIssues({});
    setEditorEpoch((v) => v + 1);
    setCurrent(value);
    setId(value.panel.id);
    const values = value.panel.draft ?? value.current?.snapshot ?? null;
    setDraft(values ? structuredClone(values) : null);
    setBaseline(JSON.stringify(values));
    setReview("");
    setReason("");
    setAttest(false);
  }
  function clearPending() {
    sessionStorage.removeItem(key);
    pendingRef.current = null;
    setPending(null);
  }
  async function run(work: () => Promise<void>) {
    if (lock.current || disabled || corrupt) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(
          `${e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : "Operation failed or response is unconfirmed."} Your draft is retained.`,
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function change(values: DiagnosticValues) {
    if (
      values.document_id !== draft?.document_id ||
      values.document_version !== draft?.document_version
    )
      setReviewedOriginal("");
    setDraft(values);
    setAttest(false);
    setNotice("");
  }
  async function open(panelId: string) {
    if (disabled || busy || pending || corrupt) return;
    if (
      dirty &&
      !window.confirm(
        "Discard local diagnostic edits and open another saved panel?",
      )
    )
      return;
    await run(async () => {
      const value = await api.read(panelId, petId);
      if (!value) throw new Error("Diagnostic panel unavailable");
      if (alive.current) apply(value);
    });
  }
  function newPanel() {
    if (
      dirty &&
      !window.confirm("Discard local diagnostic edits and start a new panel?")
    )
      return;
    setNumericIssues({});
    setEditorEpoch((v) => v + 1);
    setCurrent(null);
    setId(crypto.randomUUID());
    setDraft(emptyValues());
    setBaseline("");
    setReview("");
    setReason("");
    setAttest(false);
    setError("");
    setNotice("");
  }
  async function openOriginal() {
    if (!draft?.document_id) return;
    await run(async () => {
      const { data, error } = await supabase
        .from("patient_documents")
        .select(
          "id,pet_id,version,file_name,file_path,file_size,mime_type,status",
        )
        .eq("id", draft.document_id!)
        .eq("pet_id", petId)
        .single();
      if (error) throw error;
      const doc = z
        .object({
          id: z.string().uuid(),
          pet_id: z.string().uuid(),
          version: z.number().int().positive(),
          file_name: z.string(),
          file_path: z.string(),
          file_size: z.number().int().positive(),
          mime_type: z.string(),
          status: z.literal("ready"),
        })
        .parse(data);
      if (doc.version !== draft.document_version)
        throw new Error(
          "Linked original changed; select its current version and save a fresh draft",
        );
      const bytes = await supabase.storage
        .from("patient-documents")
        .download(doc.file_path);
      if (bytes.error) throw bytes.error;
      if (bytes.data.size !== doc.file_size)
        throw new Error("Original size differs from the reviewed document");
      const refreshed = await supabase
        .from("patient_documents")
        .select("version,status,file_path,file_size")
        .eq("id", doc.id)
        .eq("pet_id", petId)
        .single();
      if (refreshed.error) throw refreshed.error;
      if (
        refreshed.data.version !== doc.version ||
        refreshed.data.status !== "ready" ||
        refreshed.data.file_path !== doc.file_path ||
        refreshed.data.file_size !== doc.file_size
      )
        throw new Error("Original changed during review");
      if (!alive.current) return;
      const url = URL.createObjectURL(bytes.data);
      originalUrls.current.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.file_name;
      link.rel = "noopener";
      link.click();
      setReviewedOriginal(`${doc.id}:${doc.version}`);
      setNotice(
        "Exact linked original downloaded for review. Read it before attesting the panel.",
      );
    });
  }
  async function submit(kind: "draft" | "finalize") {
    if (!draft || pending || corrupt || invalidNumeric) return;
    await run(async () => {
      if (
        kind === "finalize" &&
        (!attest ||
          !dvm ||
          (draft.document_id &&
            reviewedOriginal !==
              `${draft.document_id}:${draft.document_version}`))
      )
        throw new Error(
          "A veterinarian must review and attest the entire saved panel",
        );
      const action: DiagnosticAction = actionSchema.parse({
        id,
        pet_id: petId,
        expected_version: current?.panel.version ?? null,
        kind,
        values: draft,
        review_note: kind === "finalize" ? review : "",
        correction_reason:
          kind === "finalize" && current?.current ? reason : "",
      });
      const operation = { action_id: crypto.randomUUID(), action };
      sessionStorage.setItem(key, JSON.stringify(operation));
      pendingRef.current = operation;
      setPending(operation);
      try {
        const value = await api.save(operation.action_id, operation.action);
        if (!alive.current) return;
        clearPending();
        apply(value);
        setNotice(
          kind === "draft"
            ? "Diagnostic draft saved; clinical review pending."
            : "Reviewed diagnostic version saved. PDF and record sharing are pending.",
        );
        await invalidate();
      } catch (e) {
        if (
          typeof e === "object" &&
          e &&
          "code" in e &&
          ["PT409", "23514", "42501", "23505"].includes(String(e.code))
        ) {
          clearPending();
          setAttest(false);
        }
        throw e;
      }
    });
  }
  async function recover(retry = false) {
    const p = pendingRef.current;
    if (!p) return;
    await run(async () => {
      const result = retry
        ? await api.save(p.action_id, p.action)
        : await api.recover(p.action_id, p.action);
      if (!result) {
        setNotice(
          "No saved receipt found. Retry the unchanged submitted action; no changed request has been sent.",
        );
        return;
      }
      if (!alive.current) return;
      clearPending();
      apply(result);
      setNotice(
        "Original diagnostic receipt recovered. Reload current record before making another change.",
      );
      await invalidate();
    });
  }
  function updateFinding(i: number, values: Partial<Observation>) {
    if (!draft) return;
    if (values.kind) {
      const prefix = draft.observations[i].id + ":";
      setNumericIssues((p) =>
        Object.fromEntries(
          Object.entries(p).filter(([k]) => !k.startsWith(prefix)),
        ),
      );
    }
    change({
      ...draft,
      observations: draft.observations.map((o, index) =>
        index === i ? { ...o, ...values } : o,
      ),
    });
  }
  const editing = Boolean(current?.panel.draft) || !current;
  const frozen = disabled || busy || Boolean(pending) || corrupt;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>In-house diagnostics</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter documentary findings, save a draft and ask a veterinarian to
            review the exact panel. Corrected versions preserve earlier
            findings. Generated PDFs and record sharing are pending.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {pending && (
            <div className="space-y-2 rounded-md border p-3">
              <p>
                The original {pending.action.kind} action is unconfirmed.
                Editing is paused until recovery.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || disabled}
                  onClick={() => void recover()}
                >
                  Recover diagnostic receipt
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || disabled}
                  onClick={() => void recover(true)}
                >
                  Retry unchanged diagnostic action
                </Button>
              </div>
            </div>
          )}
          <Button disabled={frozen} onClick={newPanel}>
            New in-house panel
          </Button>
          {list.isPending && <p role="status">Loading diagnostic panels…</p>}
          {list.isError && (
            <p role="alert">
              Panels could not load.{" "}
              <Button variant="outline" onClick={() => void list.refetch()}>
                Retry panels
              </Button>
            </p>
          )}
          <ul className="space-y-2">
            {list.data?.pages
              .flatMap((p) => p.items)
              .map((d) => (
                <li
                  key={d.panel.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {d.panel.draft?.panel_name ??
                        d.current?.snapshot.panel_name}
                    </p>
                    <p className="text-sm">
                      {d.current
                        ? `Reviewed v${d.current.number}`
                        : "Draft — review pending"}
                      {d.current && d.panel.draft
                        ? " · Correction draft pending"
                        : ""}{" "}
                      · Open the report for PDF status
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={frozen}
                    onClick={() => void open(d.panel.id)}
                  >
                    Open diagnostic panel
                  </Button>
                </li>
              ))}
          </ul>
          {list.hasNextPage && (
            <Button
              variant="outline"
              disabled={frozen || list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Load more panels
            </Button>
          )}
          {draft && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">
                  {current?.current
                    ? `${draft.panel_name} · reviewed v${current.current.number}`
                    : "Diagnostic draft"}
                </h3>
                {current && (
                  <Button
                    variant="outline"
                    disabled={frozen}
                    onClick={() => void open(current.panel.id)}
                  >
                    Reload saved diagnostic panel
                  </Button>
                )}
                {current?.current && !current.panel.draft && (
                  <Button
                    variant="outline"
                    disabled={frozen}
                    onClick={() => {
                      setBaseline("");
                      setAttest(false);
                    }}
                  >
                    Start correction draft
                  </Button>
                )}
              </div>
              <fieldset
                disabled={
                  frozen || (!editing && JSON.stringify(draft) === baseline)
                }
                className="space-y-4 rounded-md border p-4"
              >
                <legend className="px-1 font-medium">
                  Exact panel findings
                </legend>
                <div className="grid gap-4 md:grid-cols-2">
                  {(
                    [
                      ["panel_name", "Panel name"],
                      ["specimen", "Specimen"],
                      ["method", "Method / device"],
                      ["source", "Manual source"],
                    ] as const
                  ).map(([k, label]) => (
                    <div key={k}>
                      <Label htmlFor={`diag-${k}`}>{label}</Label>
                      <Input
                        id={`diag-${k}`}
                        value={draft[k]}
                        maxLength={160}
                        onChange={(e) =>
                          change({ ...draft, [k]: e.target.value })
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <Label htmlFor="diag-category">Diagnostic category</Label>
                    <select
                      id="diag-category"
                      className={selectClass}
                      value={draft.category}
                      onChange={(e) =>
                        change({
                          ...draft,
                          category: e.target
                            .value as DiagnosticValues["category"],
                        })
                      }
                    >
                      <option value="laboratory">Laboratory</option>
                      <option value="other">Other diagnostic findings</option>
                    </select>
                  </div>
                  {(
                    [
                      ["collected_on", "Collection / observation date"],
                      ["reported_on", "Report date"],
                    ] as const
                  ).map(([k, label]) => (
                    <div key={k}>
                      <Label htmlFor={`diag-${k}`}>{label}</Label>
                      <Input
                        id={`diag-${k}`}
                        type="date"
                        value={draft[k]}
                        onChange={(e) =>
                          change({ ...draft, [k]: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </div>
                {choices.isError && (
                  <p role="alert">
                    Linked source choices could not load.{" "}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void choices.refetch()}
                    >
                      Retry source choices
                    </Button>
                  </p>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  {(
                    [
                      ["lab_order", "Lab order", 0],
                      ["encounter", "Encounter", 1],
                      ["document", "Original document", 2],
                    ] as const
                  ).map(([k, label, index]) => (
                    <div key={k}>
                      <Label htmlFor={`diag-source-${k}`}>
                        {label} (optional)
                      </Label>
                      <select
                        id={`diag-source-${k}`}
                        className={selectClass}
                        value={draft[`${k}_id`] ?? ""}
                        onChange={(e) => {
                          const row = choices.data?.[index].find(
                            (r) => r.id === e.target.value,
                          );
                          change({
                            ...draft,
                            [`${k}_id`]: row?.id ?? null,
                            [`${k}_version`]: row?.version ?? null,
                          });
                        }}
                      >
                        <option value="">No linked source</option>
                        {draft[`${k}_id`] &&
                          !choices.data?.[index].some(
                            (row) => row.id === draft[`${k}_id`],
                          ) && (
                            <option value={draft[`${k}_id`] ?? ""}>
                              Saved source {draft[`${k}_id`]} · v
                              {draft[`${k}_version`]}
                            </option>
                          )}
                        {choices.data?.[index].slice(0, 100).map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.file_name ?? r.test_name ?? r.visit_at} · v
                            {r.version}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            choices.isFetching || sourcePages[index] === 0
                          }
                          onClick={() =>
                            setSourcePages((p) =>
                              p.map((n, i) => (i === index ? n - 1 : n)),
                            )
                          }
                        >
                          Previous {label.toLowerCase()} choices
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            choices.isFetching ||
                            (choices.data?.[index].length ?? 0) <= 100
                          }
                          onClick={() =>
                            setSourcePages((p) =>
                              p.map((n, i) => (i === index ? n + 1 : n)),
                            )
                          }
                        >
                          More {label.toLowerCase()} choices
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-4">
                  {draft.observations.map((o, i) => (
                    <fieldset
                      key={o.id}
                      className="space-y-3 rounded-md border p-3"
                    >
                      <legend className="px-1 font-medium">
                        Finding {i + 1}
                      </legend>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor={`diag-key-${i}`}>
                            Analyte identity
                          </Label>
                          <Input
                            id={`diag-key-${i}`}
                            value={o.analyte_key}
                            maxLength={160}
                            onChange={(e) =>
                              updateFinding(i, { analyte_key: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`diag-label-${i}`}>
                            Original analyte label
                          </Label>
                          <Input
                            id={`diag-label-${i}`}
                            value={o.label}
                            maxLength={160}
                            onChange={(e) =>
                              updateFinding(i, { label: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`diag-kind-${i}`}>Finding type</Label>
                          <select
                            id={`diag-kind-${i}`}
                            className={selectClass}
                            value={o.kind}
                            onChange={(e) =>
                              updateFinding(i, {
                                kind: e.target.value as Observation["kind"],
                                value_number: null,
                                value_text: null,
                                unit: null,
                                reference_low: null,
                                reference_high: null,
                              })
                            }
                          >
                            <option value="numeric">Numeric</option>
                            <option value="qualitative">
                              Qualitative text
                            </option>
                          </select>
                        </div>
                        {o.kind === "numeric" ? (
                          <>
                            <NumericFindingInput
                              key={`${editorEpoch}:${o.id}:value`}
                              id={`diag-value-${i}`}
                              label="Numeric value"
                              initial={o.value_number}
                              onInvalid={(v) => {
                                setNumericIssues((p) => ({
                                  ...p,
                                  [`${o.id}:value`]: v,
                                }));
                                setAttest(false);
                              }}
                              onValue={(v) =>
                                updateFinding(i, { value_number: v })
                              }
                            />
                            <div>
                              <Label htmlFor={`diag-unit-${i}`}>
                                Original unit (use 1 for dimensionless)
                              </Label>
                              <Input
                                id={`diag-unit-${i}`}
                                value={o.unit ?? ""}
                                maxLength={40}
                                onChange={(e) =>
                                  updateFinding(i, {
                                    unit: e.target.value || null,
                                  })
                                }
                              />
                            </div>
                            {(
                              [
                                ["reference_low", "Reference lower bound"],
                                ["reference_high", "Reference upper bound"],
                              ] as const
                            ).map(([k, label]) => (
                              <NumericFindingInput
                                key={`${editorEpoch}:${o.id}:${k}`}
                                id={`diag-${k}-${i}`}
                                label={`${label} (optional)`}
                                initial={o[k]}
                                onInvalid={(v) => {
                                  setNumericIssues((p) => ({
                                    ...p,
                                    [`${o.id}:${k}`]: v,
                                  }));
                                  setAttest(false);
                                }}
                                onValue={(v) => updateFinding(i, { [k]: v })}
                              />
                            ))}
                          </>
                        ) : (
                          <div>
                            <Label htmlFor={`diag-text-${i}`}>
                              Qualitative result
                            </Label>
                            <Input
                              id={`diag-text-${i}`}
                              value={o.value_text ?? ""}
                              maxLength={1000}
                              onChange={(e) =>
                                updateFinding(i, {
                                  value_text: e.target.value || null,
                                })
                              }
                            />
                          </div>
                        )}
                        <div>
                          <Label htmlFor={`diag-ref-${i}`}>
                            Reference text as recorded
                          </Label>
                          <Input
                            id={`diag-ref-${i}`}
                            value={o.reference_text}
                            maxLength={1000}
                            onChange={(e) =>
                              updateFinding(i, {
                                reference_text: e.target.value,
                              })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`diag-flag-${i}`}>
                            Source flag as recorded
                          </Label>
                          <Input
                            id={`diag-flag-${i}`}
                            value={o.source_flag}
                            maxLength={1000}
                            onChange={(e) =>
                              updateFinding(i, { source_flag: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        disabled={draft.observations.length === 1}
                        onClick={() =>
                          change({
                            ...draft,
                            observations: draft.observations.filter(
                              (_, index) => index !== i,
                            ),
                          })
                        }
                      >
                        Remove finding {i + 1}
                      </Button>
                    </fieldset>
                  ))}
                </div>
                <Button
                  variant="outline"
                  disabled={draft.observations.length >= 100}
                  onClick={() =>
                    change({
                      ...draft,
                      observations: [...draft.observations, emptyObservation()],
                    })
                  }
                >
                  Add diagnostic finding
                </Button>
                <div>
                  <Label htmlFor="diag-interpretation">
                    Clinician interpretation / documentary notes
                  </Label>
                  <Textarea
                    id="diag-interpretation"
                    value={draft.interpretation}
                    maxLength={4000}
                    onChange={(e) =>
                      change({ ...draft, interpretation: e.target.value })
                    }
                  />
                </div>
                <Button
                  disabled={invalidNumeric}
                  onClick={() => void submit("draft")}
                >
                  Save diagnostic draft
                </Button>
              </fieldset>
              {current?.panel.draft && dvm && (
                <fieldset
                  disabled={
                    frozen ||
                    invalidNumeric ||
                    JSON.stringify(draft) !== baseline
                  }
                  className="space-y-3 rounded-md border p-4"
                >
                  <legend className="px-1 font-medium">
                    Veterinarian review
                  </legend>
                  {draft.document_id && (
                    <div className="space-y-2">
                      <p>
                        Review the exact linked original before clinical
                        attestation.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => void openOriginal()}
                      >
                        Download linked diagnostic original
                      </Button>
                    </div>
                  )}
                  <Label htmlFor="diag-review">Review note</Label>
                  <Textarea
                    id="diag-review"
                    value={review}
                    maxLength={2000}
                    onChange={(e) => {
                      setReview(e.target.value);
                      setAttest(false);
                    }}
                  />
                  {current.current && (
                    <>
                      <Label htmlFor="diag-correction">Correction reason</Label>
                      <Textarea
                        id="diag-correction"
                        value={reason}
                        maxLength={2000}
                        onChange={(e) => {
                          setReason(e.target.value);
                          setAttest(false);
                        }}
                      />
                    </>
                  )}
                  <Label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={attest}
                      disabled={
                        Boolean(draft.document_id) &&
                        reviewedOriginal !==
                          `${draft.document_id}:${draft.document_version}`
                      }
                      onChange={(e) => setAttest(e.target.checked)}
                    />
                    I reviewed every finding, original unit, reference context,
                    source and interpretation in this saved panel.
                  </Label>
                  <Button
                    disabled={
                      !attest ||
                      (Boolean(draft.document_id) &&
                        reviewedOriginal !==
                          `${draft.document_id}:${draft.document_version}`) ||
                      !review.trim() ||
                      (Boolean(current.current) && !reason.trim())
                    }
                    onClick={() => void submit("finalize")}
                  >
                    Finalize reviewed diagnostic version
                  </Button>
                </fieldset>
              )}
              {current?.panel.draft && !dvm && (
                <p>
                  Clinical finalization requires an active named veterinarian.
                </p>
              )}
              {current?.current && (
                <div className="space-y-2 rounded-md border p-3">
                  <h3 className="font-medium">
                    Reviewed version {current.current.number}
                  </h3>
                  <p>
                    Entered by {current.current.entered_by_name} · Reviewed by{" "}
                    {current.current.reviewer_name} ·{" "}
                    {current.current.reviewed_at}
                  </p>
                  <p>Review: {current.current.review_note}</p>
                  {current.current.correction_reason && (
                    <p>Correction: {current.current.correction_reason}</p>
                  )}
                  <DiagnosticPdfReview
                    jobId={current.current.id}
                    petId={petId}
                  />
                  {current.current.original_current_available === false && (
                    <p role="alert">
                      The original linked at review is no longer available at
                      that exact version. Historical review evidence is
                      retained.
                    </p>
                  )}
                </div>
              )}
              {current && (
                <div className="space-y-3">
                  <h3 className="font-medium">Finalized diagnostic history</h3>
                  {history.isError && (
                    <p role="alert">
                      History could not load.{" "}
                      <Button
                        variant="outline"
                        onClick={() => void history.refetch()}
                      >
                        Retry diagnostic history
                      </Button>
                    </p>
                  )}
                  {history.data?.pages
                    .flatMap((p) => p.items)
                    .map((v) => (
                      <details key={v.id} className="rounded-md border p-3">
                        <summary>
                          Version {v.number} · {v.snapshot.panel_name} ·{" "}
                          {v.reviewer_name}
                        </summary>
                        <p>
                          {v.reviewed_at} · {v.review_note}
                        </p>
                        {v.correction_reason && (
                          <p>Correction reason: {v.correction_reason}</p>
                        )}
                        <ul>
                          {v.snapshot.observations.map((o) => (
                            <li key={o.id}>
                              {o.label}:{" "}
                              {o.kind === "numeric"
                                ? `${o.value_number} ${o.unit}`
                                : o.value_text}{" "}
                              · {o.reference_text} · {o.source_flag}
                            </li>
                          ))}
                        </ul>
                        <p className="break-all text-xs">
                          Source fingerprint: {v.source_hash}
                        </p>
                        <DiagnosticPdfReview
                          jobId={v.id}
                          petId={petId}
                          loadOnDemand
                        />
                      </details>
                    ))}
                  {history.hasNextPage && (
                    <Button
                      variant="outline"
                      disabled={history.isFetchingNextPage}
                      onClick={() => void history.fetchNextPage()}
                    >
                      Load older finalized versions
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      <DiagnosticTrends
        petId={petId}
        disabled={frozen || dirty}
        onOpen={(panelId) => void open(panelId)}
      />
    </div>
  );
}
