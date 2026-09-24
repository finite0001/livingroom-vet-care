import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZodError } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createEstimateDraftApi,
  estimateLineCents,
  estimateTotalCents,
  dollarsToEstimateCents,
  type EstimateDraft,
  type EstimateFields,
  type EstimateLine,
  type EstimateRequest,
} from "./estimate-api";
import { useEstimateDraftOperation } from "./useEstimateDraftOperation";
import { EstimatePublicationWorkspace } from "./EstimatePublicationWorkspace";
import { EstimateDecisionWorkspace } from "./EstimateDecisionWorkspace";
const errorText = (error: unknown, fallback: string) => error instanceof ZodError
  ? "Estimate data could not be verified. Refresh and review the draft fields before continuing."
  : error instanceof Error ? error.message : fallback;
interface Props {
  clientId: string;
  onDirtyChange: (dirty: boolean) => void;
}
interface WorkspaceProps extends Props {
  actor: string;
}
interface DraftComparison {
  draft: EstimateDraft | null;
}
interface FieldsSummaryProps {
  fields: EstimateFields;
}
interface Product {
  id: string;
  name: string;
  kind: "service" | "medication" | "vaccine";
  unit: string;
  unit_price_cents: number | string;
  version: number;
  active: boolean;
}
interface Patient {
  id: string;
  name: string;
}
interface EditorLine {
  id: string;
  product_id: string;
  product_version: number;
  description: string;
  kind: Product["kind"];
  unit: string;
  quantity: string;
  pricingKind: "unit" | "allocated";
  dollars: string;
  pricing_reason: string;
}
interface Editor {
  estimateId: string;
  petId: string;
  expectedVersion: number | null;
  title: string;
  notes: string;
  terms: string;
  acceptBy: string;
  lines: EditorLine[];
}
const money = (cents: string | bigint) => {
  const c = BigInt(cents);
  return `$${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
};
const dollars = (cents: string | number) => {
  const c = BigInt(cents);
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
};
function editorFromRequest(r: EstimateRequest): Editor {
  return {
    estimateId: r.estimate_id,
    petId: r.pet_id,
    expectedVersion: r.expected_version,
    title: r.fields.title,
    notes: r.fields.notes,
    terms: r.fields.terms,
    acceptBy: r.fields.accept_by,
    lines: r.fields.lines.map((l) => ({
      id: l.id,
      product_id: l.product_id,
      product_version: l.product_version,
      description: l.description,
      kind: l.kind,
      unit: l.unit,
      quantity: l.quantity,
      pricingKind: l.pricing.kind,
      dollars: dollars(
        l.pricing.kind === "unit"
          ? l.pricing.unit_price_cents
          : l.pricing.amount_cents,
      ),
      pricing_reason: l.pricing_reason ?? "",
    })),
  };
}
function editorFromDraft(d: EstimateDraft) {
  return editorFromRequest({
    estimate_id: d.id,
    client_id: d.client_id,
    pet_id: d.pet_id,
    expected_version: d.version,
    fields: d.fields,
  });
}
function lineValue(l: EditorLine): EstimateLine {
  const cents = String(dollarsToEstimateCents(l.dollars));
  return {
    id: l.id,
    product_id: l.product_id,
    product_version: l.product_version,
    description: l.description.trim(),
    kind: l.kind,
    unit: l.unit,
    quantity: l.quantity,
    pricing:
      l.pricingKind === "unit"
        ? { kind: "unit", unit_price_cents: cents }
        : { kind: "allocated", amount_cents: cents },
    pricing_reason: l.pricing_reason.trim() || null,
  };
}
function fieldsValue(e: Editor): EstimateFields {
  return {
    title: e.title.trim(),
    notes: e.notes.trim(),
    terms: e.terms.trim(),
    accept_by: e.acceptBy,
    lines: e.lines.map(lineValue),
  };
}
function safeTotal(lines: EditorLine[]) {
  try {
    return money(String(estimateTotalCents(lines.map(lineValue))));
  } catch {
    return "Complete valid quantities and prices to calculate total";
  }
}
function safeLine(line: EditorLine) {
  try {
    return money(String(estimateLineCents(lineValue(line))));
  } catch {
    return "Invalid quantity or price";
  }
}
export function HouseholdEstimates(props: Props) {
  const { session } = useAuth();
  return session ? (
    <EstimateDraftWorkspace
      key={`${session.user.id}:${props.clientId}`}
      actor={session.user.id}
      {...props}
    />
  ) : null;
}
export function EstimateDraftWorkspace({
  actor,
  clientId,
  onDirtyChange,
}: WorkspaceProps) {
  const api = useMemo(
    () => createEstimateDraftApi(supabase, actor, clientId),
    [actor, clientId],
  );
  type Page = Awaited<ReturnType<typeof api.list>>;
  type History = Awaited<ReturnType<typeof api.history>>;
  const [page, setPage] = useState<Page | null>(null),
    [history, setHistory] = useState<History | null>(null),
    [historyRows, setHistoryRows] = useState<EstimateDraft[]>([]),
    [editor, setEditor] = useState<Editor | null>(null),
    [publicationDraft, setPublicationDraft] = useState<EstimateDraft | null>(null),
    [publicationDirty, setPublicationDirty] = useState(false),
    [decisionDirty, setDecisionDirty] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [patients, setPatients] = useState<Patient[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [catalogSearch, setCatalogSearch] = useState(""),
    [patientSearch, setPatientSearch] = useState(""),
    [catalogMore, setCatalogMore] = useState(false),
    [patientsMore, setPatientsMore] = useState(false),
    [selectedProduct, setSelectedProduct] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [compareRequired, setCompareRequired] = useState(false),
    [comparison, setComparison] = useState<DraftComparison | null>(null);
  const alive = useRef(true),
    actionLock = useRef(false),
    editorRef = useRef(editor);
  editorRef.current = editor;
  const loadList = useCallback(
    async (cursor: Parameters<typeof api.list>[0] = null) => {
      const value = await api.list(cursor);
      if (alive.current) setPage(value);
    },
    [api],
  );
  const loadChoices = useCallback(
    async (productTerm: string, patientTerm: string) => {
      const [p, c] = await Promise.all([
        supabase
          .from("pets")
          .select("id,name")
          .eq("client_id", clientId)
          .is("archived_at", null)
          .is("deceased_at", null)
          .ilike("name", `%${patientTerm}%`)
          .order("name")
          .order("id")
          .limit(101),
        supabase
          .from("catalog_products")
          .select("id,name,kind,unit,unit_price_cents,version,active")
          .eq("active", true)
          .ilike("name", `%${productTerm}%`)
          .order("name")
          .order("id")
          .limit(51),
      ]);
      if (p.error) throw p.error;
      if (c.error) throw c.error;
      if (alive.current) {
        setPatients((p.data ?? []).slice(0, 100));
        setPatientsMore((p.data ?? []).length > 100);
        setProducts((c.data ?? []).slice(0, 50) as Product[]);
        setCatalogMore((c.data ?? []).length > 50);
      }
    },
    [clientId],
  );
  const operation = useEstimateDraftOperation({
    actor,
    clientId,
    api,
    onSaved: (r) => {
      setEditor(editorFromDraft(r.result));
      setDirty(false);
      setReviewed(false);
      setCompareRequired(false);
      setComparison(null);
      setHistory(null);
      setHistoryRows([]);
      void loadList().catch(() =>
        setError("Saved revision confirmed, but draft list could not refresh."),
      );
    },
    onRejected: () => {
      setReviewed(false);
      setCompareRequired(true);
      setComparison(null);
    },
    onClosed: () => {
      setReviewed(false);
      setCompareRequired(true);
      setComparison(null);
    },
  });
  useEffect(() => {
    alive.current = true;
    setBusy(true);
    Promise.all([loadList(), loadChoices("", "")])
      .catch((e) => {
        if (alive.current)
          setError(errorText(e, "Estimate workspace could not load."));
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
    };
  }, [loadList, loadChoices]);
  useEffect(() => {
    if (operation.pending && !editorRef.current) {
      setEditor(editorFromRequest(operation.pending.payload));
      setDirty(true);
    }
  }, [operation.pending]);
  const unsaved = dirty || operation.locked || busy || publicationDirty || decisionDirty;
  useEffect(() => {
    onDirtyChange(unsaved);
    return () => onDirtyChange(false);
  }, [unsaved, onDirtyChange]);
  const locked = busy || operation.locked || publicationDraft !== null;
  async function run(action: () => Promise<void>) {
    if (actionLock.current || operation.locked || publicationDraft !== null) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(errorText(e, "Estimate request failed."));
    } finally {
      actionLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function edit(patch: Partial<Editor>) {
    if (!editor || locked) return;
    setEditor({ ...editor, ...patch });
    setDirty(true);
    setReviewed(false);
  }
  function editLine(index: number, patch: Partial<EditorLine>) {
    if (!editor) return;
    edit({
      lines: editor.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    });
  }
  function newDraft() {
    if (locked || dirty) return;
    setEditor({
      estimateId: crypto.randomUUID(),
      petId: "",
      expectedVersion: null,
      title: "",
      notes: "",
      terms: "",
      acceptBy: "",
      lines: [],
    });
    setDirty(true);
    setCompareRequired(false);
    setComparison(null);
    setHistory(null);
    setHistoryRows([]);
    setError("");
  }
  async function open(id: string) {
    await run(async () => {
      const r = await api.read(id);
      if (!r) throw new Error("Draft unavailable.");
      if (alive.current) {
        setEditor(editorFromDraft(r));
        setDirty(false);
        setReviewed(false);
        setCompareRequired(false);
        setComparison(null);
        setHistory(null);
        setHistoryRows([]);
      }
    });
  }
  async function openPublication() {
    if (!editor || locked || dirty || compareRequired || editor.expectedVersion === null) return;
    const estimateId = editor.estimateId;
    await run(async () => {
      const saved = await api.read(estimateId);
      if (!saved) throw new Error("Saved draft unavailable. Refresh the draft list before publication review.");
      if (!alive.current) return;
      // Mount locked until the child reports its restored recovery state. This
      // prevents closing over an unresolved publication before its first effect.
      setPublicationDirty(true);
      setDecisionDirty(true);
      setPublicationDraft(saved);
      setEditor(editorFromDraft(saved));
      setReviewed(false);
      setHistory(null);
      setHistoryRows([]);
    });
  }
  function closePublication() {
    if (publicationDirty || decisionDirty || busy || !publicationDraft) return;
    setPublicationDraft(null);
  }
  function addLine() {
    const p = products.find((p) => p.id === selectedProduct);
    if (!p || !editor || editor.lines.length >= 100) return;
    edit({
      lines: [
        ...editor.lines,
        {
          id: crypto.randomUUID(),
          product_id: p.id,
          product_version: p.version,
          description: p.name,
          kind: p.kind,
          unit: p.unit,
          quantity: "1",
          pricingKind: "unit",
          dollars: dollars(p.unit_price_cents),
          pricing_reason: "",
        },
      ],
    });
    setSelectedProduct("");
  }
  function request(): EstimateRequest {
    if (!editor) throw new Error("Open a draft first.");
    return {
      estimate_id: editor.estimateId,
      client_id: clientId,
      pet_id: editor.petId,
      expected_version: editor.expectedVersion,
      fields: fieldsValue(editor),
    };
  }
  async function compare() {
    if (!editor) return;
    await run(async () => {
      const [r] = await Promise.all([
        api.read(editor.estimateId),
        loadChoices(catalogSearch, patientSearch),
      ]);
      if (alive.current) setComparison({ draft: r });
    });
  }
  function useComparedVersion() {
    if (!editor || !comparison || locked) return;
    if (comparison.draft && comparison.draft.pet_id !== editor.petId) {
      setError("Patient identity differs. Open the current draft instead.");
      return;
    }
    setEditor({
      ...editor,
      expectedVersion: comparison.draft?.version ?? null,
    });
    setCompareRequired(false);
    setComparison(null);
    setReviewed(false);
    setDirty(true);
  }
  function validateReview() {
    if (locked) return;
    try {
      const q = request();
      api.parseOperation({
        id: crypto.randomUUID(),
        kind: "save_estimate_draft",
        payload: q,
      });
      for (const l of q.fields.lines) {
        const p = products.find((p) => p.id === l.product_id);
        if (p && p.version !== l.product_version)
          throw new Error(
            "A selected catalog version changed. Review and adopt its current unit and version explicitly.",
          );
        if (
          p &&
          l.pricing.kind === "unit" &&
          l.pricing.unit_price_cents !== String(p.unit_price_cents) &&
          !l.pricing_reason
        )
          throw new Error(
            "Explain the unit price change in the pricing reason before saving.",
          );
      }
      setReviewed(true);
      setError("");
    } catch (e) {
      setError(errorText(e, "Complete valid draft fields."));
    }
  }
  return (
    <section
      aria-label="Household estimates"
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Estimates</h2>
          <p className="text-sm text-muted-foreground">
            Draft planning only. Saving does not approve care, reserve stock,
            create charges or request payment.
          </p>
        </div>
        <Button disabled={locked || dirty} onClick={newDraft}>
          New estimate draft
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {operation.error && (
        <p role="alert" className="text-destructive">
          {operation.error}
        </p>
      )}
      {operation.notice && <p role="status">{operation.notice}</p>}
      <div className="space-y-2">
        <h3 className="font-medium">Saved drafts</h3>
        {page?.drafts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No estimate drafts saved.
          </p>
        )}
        {page?.drafts.map((d) => (
          <Button
            key={d.id}
            variant="outline"
            disabled={locked || dirty}
            onClick={() => void open(d.id)}
          >
            {d.fields.title} · revision {d.version} · {money(d.total_cents)}
          </Button>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={locked || dirty}
            onClick={() => void run(() => loadList())}
          >
            Refresh first draft page
          </Button>
          {page?.has_more && (
            <Button
              variant="outline"
              disabled={locked || dirty}
              onClick={() => void run(() => loadList(page.next_cursor))}
            >
              Older draft page
            </Button>
          )}
        </div>
      </div>
      {editor && (
        <div className="space-y-4 border-t pt-4">
          <h3 className="font-semibold">
            Draft estimate{" "}
            {editor.expectedVersion === null
              ? "· unsaved"
              : `· editing revision ${editor.expectedVersion}`}
          </h3>
          <p className="break-all text-xs text-muted-foreground">
            {editor.estimateId}
          </p>
          <fieldset disabled={locked} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label>
                Estimate title
                <Input
                  value={editor.title}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
              <label>
                Acceptance deadline
                <Input
                  type="date"
                  value={editor.acceptBy}
                  onChange={(e) => edit({ acceptBy: e.target.value })}
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              The deadline will apply through that date in Mountain Time. A past
              deadline can be retained in a draft.
            </p>
            {editor.expectedVersion === null ? (
              <>
                <label>
                  Find household patient
                  <Input
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  onClick={() =>
                    void run(() => loadChoices(catalogSearch, patientSearch))
                  }
                >
                  Search household patients
                </Button>
                <label className="block">
                  Patient
                  <select
                    className="block w-full rounded-md border bg-background p-2"
                    value={editor.petId}
                    onChange={(e) => edit({ petId: e.target.value })}
                  >
                    <option value="">Choose active household patient</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {editor.petId &&
                      !patients.some((p) => p.id === editor.petId) && (
                        <option value={editor.petId}>
                          Previously selected patient · {editor.petId}
                        </option>
                      )}
                  </select>
                </label>
                {patientsMore && (
                  <p>More than 100 matching patients; refine the search.</p>
                )}
              </>
            ) : (
              <p>
                Patient:{" "}
                {patients.find((p) => p.id === editor.petId)?.name ??
                  editor.petId}{" "}
                · fixed for this estimate
              </p>
            )}
            <label className="block">
              Draft notes
              <Textarea
                value={editor.notes}
                onChange={(e) => edit({ notes: e.target.value })}
              />
            </label>
            <label className="block">
              Estimate terms and exclusions
              <Textarea
                value={editor.terms}
                onChange={(e) => edit({ terms: e.target.value })}
              />
            </label>
            <div className="space-y-2">
              <label>
                Find active catalog product
                <Input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                onClick={() =>
                  void run(() => loadChoices(catalogSearch, patientSearch))
                }
              >
                Search catalog
              </Button>
              {catalogMore && (
                <p>
                  Showing the first 50 matches; refine the search to find
                  another product.
                </p>
              )}
              <label className="block">
                Catalog product
                <select
                  className="block w-full rounded-md border bg-background p-2"
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                >
                  <option value="">Choose product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.unit} · {money(String(p.unit_price_cents))}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={!selectedProduct || editor.lines.length >= 100}
                onClick={addLine}
              >
                Add estimate line
              </Button>
            </div>
            {editor.lines.map((l, index) => {
              const p = products.find((p) => p.id === l.product_id);
              return (
                <fieldset
                  key={l.id}
                  className="space-y-3 rounded-md border p-3"
                >
                  <legend className="px-1 font-medium">Line {index + 1}</legend>
                  <p className="text-sm text-muted-foreground">
                    {l.kind} · {l.unit} · catalog revision {l.product_version}
                  </p>
                  {p && p.version !== l.product_version && (
                    <div role="alert">
                      <p>
                        Current catalog revision is {p.version}, unit {p.unit},
                        unit price {money(String(p.unit_price_cents))}. Your
                        chosen description and price are retained.
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          editLine(index, {
                            product_version: p.version,
                            kind: p.kind,
                            unit: p.unit,
                          })
                        }
                      >
                        Use current catalog unit and revision for line{" "}
                        {index + 1}
                      </Button>
                    </div>
                  )}
                  <label className="block">
                    Description for line {index + 1}
                    <Input
                      value={l.description}
                      onChange={(e) =>
                        editLine(index, { description: e.target.value })
                      }
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label>
                      Quantity for line {index + 1}
                      <Input
                        inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) =>
                          editLine(index, { quantity: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Pricing for line {index + 1}
                      <select
                        className="block w-full rounded-md border bg-background p-2"
                        value={l.pricingKind}
                        onChange={(e) =>
                          editLine(index, {
                            pricingKind: e.target
                              .value as EditorLine["pricingKind"],
                          })
                        }
                      >
                        <option value="unit">Per unit</option>
                        <option value="allocated">
                          Whole-line allocated amount
                        </option>
                      </select>
                    </label>
                    <label>
                      {l.pricingKind === "unit"
                        ? "Unit price"
                        : "Whole-line amount"}{" "}
                      in dollars for line {index + 1}
                      <Input
                        inputMode="decimal"
                        value={l.dollars}
                        onChange={(e) =>
                          editLine(index, { dollars: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="block">
                    Pricing reason for line {index + 1}
                    <Textarea
                      value={l.pricing_reason}
                      onChange={(e) =>
                        editLine(index, { pricing_reason: e.target.value })
                      }
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    A reason is required for allocated pricing, zero amounts, or
                    a unit price different from the selected catalog price.
                    Allocated pricing preserves the actual quantity.
                  </p>
                  <p>Line total: {safeLine(l)}</p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      edit({
                        lines: editor.lines.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove line {index + 1}
                  </Button>
                </fieldset>
              );
            })}
            <p className="font-semibold">
              Draft total: {safeTotal(editor.lines)}
            </p>
          </fieldset>
          {compareRequired && (
            <div className="space-y-2 rounded-md border p-3">
              <p role="status">
                Review the current saved revision and catalog before another
                save. Your edits are retained.
              </p>
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => void compare()}
              >
                Load current revision for comparison
              </Button>
              {comparison && (
                <>
                  <p>
                    {comparison.draft
                      ? `Current saved revision ${comparison.draft.version}: ${comparison.draft.fields.title} · ${money(comparison.draft.total_cents)}`
                      : "No saved draft exists for this estimate ID."}
                  </p>
                  {comparison.draft && (
                    <EstimateFieldsSummary fields={comparison.draft.fields} />
                  )}
                  <Button disabled={locked} onClick={useComparedVersion}>
                    Keep my edits against this current revision
                  </Button>
                </>
              )}
            </div>
          )}
          {!operation.pending && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={locked || !dirty || compareRequired}
                onClick={validateReview}
              >
                Review draft save
              </Button>
              {reviewed && (
                <>
                  <p className="text-sm">
                    Save the displayed patient, terms and {editor.lines.length}{" "}
                    lines for {safeTotal(editor.lines)} as a new draft revision.
                  </p>
                  <Button
                    disabled={locked || compareRequired}
                    onClick={() => void operation.save(request())}
                  >
                    Save reviewed draft
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  if (
                    !dirty ||
                    window.confirm(
                      "Discard unsent estimate edits? Submitted recovery requests remain saved.",
                    )
                  ) {
                    setEditor(null);
                    setDirty(false);
                    setReviewed(false);
                    setHistory(null);
                    setHistoryRows([]);
                  }
                }}
              >
                Close draft editor
              </Button>
            </div>
          )}
          {operation.pending && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="break-all text-sm">
                Original save request {operation.pending.id}
              </p>
              <Button
                disabled={operation.busy || operation.blocked}
                onClick={() => void operation.recover()}
              >
                Recover original estimate save
              </Button>
              {operation.retryable && (
                <Button
                  variant="outline"
                  disabled={operation.busy || operation.blocked}
                  onClick={() => void operation.retry()}
                >
                  Retry identical estimate save
                </Button>
              )}
              <Button
                variant="outline"
                disabled={operation.busy || operation.blocked}
                onClick={() => void operation.close()}
              >
                Resolve or close original estimate save
              </Button>
            </div>
          )}
          {editor.expectedVersion !== null && !publicationDraft && (
            <Button
              variant="outline"
              disabled={locked || dirty || compareRequired}
              onClick={() => void openPublication()}
            >
              Review publication and history
            </Button>
          )}
          <div className="space-y-2">
            <h4 className="font-medium">Immutable revision history</h4>
            <Button
              variant="outline"
              disabled={locked || editor.expectedVersion === null}
              onClick={() =>
                void run(async () => {
                  const h = await api.history(editor.estimateId);
                  if (alive.current) {
                    setHistory(h);
                    setHistoryRows(h.revisions);
                  }
                })
              }
            >
              Load revision history
            </Button>
            {historyRows.map((d) => (
              <details key={d.version} className="rounded-md border p-3">
                <summary>
                  Revision {d.version} · {money(d.total_cents)} ·{" "}
                  {new Date(d.updated_at).toLocaleString()}
                </summary>
                <p className="text-xs">Recorded by {d.updated_by}</p>
                <EstimateFieldsSummary fields={d.fields} />
              </details>
            ))}
            {history?.has_more && (
              <Button
                variant="outline"
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    const h = await api.history(
                      editor.estimateId,
                      history.next_before_version,
                    );
                    if (alive.current) {
                      setHistory(h);
                      setHistoryRows((rows) => [...rows, ...h.revisions]);
                    }
                  })
                }
              >
                Older revisions
              </Button>
            )}
          </div>
        </div>
      )}
      {publicationDraft && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Draft editing and selection are paused while publication is open.
              Resolve saved publication requests and discard unpublished reviews before closing.
            </p>
            <Button
              variant="outline"
              disabled={publicationDirty || decisionDirty || busy}
              onClick={closePublication}
            >
              Close publication workspace
            </Button>
          </div>
          <EstimatePublicationWorkspace
            draft={publicationDraft}
            onDirtyChange={setPublicationDirty}
          />
          <EstimateDecisionWorkspace
            draft={publicationDraft}
            onDirtyChange={setDecisionDirty}
          />
        </div>
      )}
    </section>
  );
}

function EstimateFieldsSummary({ fields }: FieldsSummaryProps) {
  return (
    <div className="space-y-3 pt-3 text-sm">
      <h5 className="font-semibold">{fields.title}</h5>
      <dl className="space-y-2">
        <div>
          <dt className="font-medium">Acceptance deadline</dt>
          <dd>
            {fields.accept_by} · through the end of this date in Mountain Time
          </dd>
        </div>
        <div>
          <dt className="font-medium">Notes</dt>
          <dd className="whitespace-pre-wrap">
            {fields.notes || "No notes recorded."}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Terms and exclusions</dt>
          <dd className="whitespace-pre-wrap">{fields.terms}</dd>
        </div>
      </dl>
      <ol className="space-y-2">
        {fields.lines.map((line, index) => (
          <li key={line.id} className="rounded-md border p-3">
            <p className="font-medium">
              {index + 1}. {line.description}
            </p>
            <p>
              {line.kind} · {line.quantity} {line.unit}
            </p>
            <p>
              {line.pricing.kind === "unit"
                ? `Unit price: ${money(line.pricing.unit_price_cents)} per ${line.unit}`
                : `Allocated whole-line amount: ${money(line.pricing.amount_cents)}`}
            </p>
            <p>Line amount: {money(estimateLineCents(line))}</p>
            {line.pricing_reason && (
              <p className="whitespace-pre-wrap">
                Pricing reason: {line.pricing_reason}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="font-semibold">
        Draft total: {money(estimateTotalCents(fields.lines))}
      </p>
    </div>
  );
}
