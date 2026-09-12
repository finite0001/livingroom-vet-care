import { alertAcknowledgmentMatches } from "../clinical/alert-review-policy";
import { usePatientAlertReview } from "../clinical/alert-review";
import { useState } from "react";
import { Link } from "react-router-dom";
import { denverInstant } from "../scheduling/time";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StockField } from "../inventory/InventoryPage";
import { lots } from "../inventory/api";
import { useStockMutation } from "../inventory/useStockMutation";
import {
  currentVaccinations,
  denverDate,
  errorMessage,
  quantityValue,
  practiceTimestamp,
} from "../inventory/stock-policy";
interface PatientTreatmentsProps {
  petId: string;
  clientId: string;
}
const selectClass =
  "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm";
function CorrectionForm({ record }: { record: Tables<"patient_treatments"> }) {
  const state = useStockMutation(`correction:${record.id}`);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.uncertain) {
      const form = e.currentTarget;
      if (await state.retry()) form.reset();
      return;
    }
    const v = new FormData(e.currentTarget);
    await state.run("correct_patient_treatment", {
      p_id: crypto.randomUUID(),
      p_treatment_id: record.id,
      p_reason: String(v.get("reason")),
      p_replacement_id: String(v.get("replacement") ?? "").trim() || null,
    });
  }
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium">
        Mark record as corrected / entered in error
      </summary>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <p className="text-sm text-muted-foreground">
          The original remains in history. This does not return stock or credit
          an invoice.
        </p>
        <fieldset
          disabled={state.locked}
          className="grid min-w-0 gap-2 md:grid-cols-2"
        >
          <StockField label="Correction reason">
            <Input name="reason" required maxLength={2000} />
          </StockField>
          <StockField label="Replacement record ID (optional)">
            <Input name="replacement" />
          </StockField>
        </fieldset>
        {state.error && (
          <p role="alert" className="text-clinical-alert">
            {state.error}
          </p>
        )}
        <Button variant="outline" disabled={state.busy}>
          {state.uncertain ? "Retry same correction" : "Record correction"}
        </Button>
      </form>
    </details>
  );
}
export function PatientTreatments({ petId, clientId }: PatientTreatmentsProps) {
  const [historical, setHistorical] = useState(false);
  const [lotSearch, setLotSearch] = useState("");
  const [page, setPage] = useState(0);
  const [validation, setValidation] = useState("");
  const state = useStockMutation(`treatment:${petId}`);
  const alerts = usePatientAlertReview(petId);
  const [acknowledgedHash, setAcknowledgedHash] = useState<string | null>(null);
  const hasAlerts = Boolean(
    alerts.data?.snapshot.important_problems.length ||
    alerts.data?.snapshot.legacy_allergies.text?.trim(),
  );
  const alertsUnavailable =
    alerts.isPending ||
    alerts.isFetching ||
    Boolean(alerts.error) ||
    !alerts.data;
  const acknowledged = alertAcknowledgmentMatches(
    alerts.data,
    acknowledgedHash,
  );
  const stock = useQuery({
    queryKey: ["inventory", "treatment-lots", lotSearch],
    queryFn: () => lots(lotSearch),
  });
  const invoices = useQuery({
    queryKey: ["billing", "drafts", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_invoices")
        .select("id,created_at")
        .eq("client_id", clientId)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(101);
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["treatments", "history", petId, page],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_treatments")
        .select("*")
        .eq("pet_id", petId)
        .order("administered_at", { ascending: false })
        .order("id")
        .range(page * 50, page * 50 + 50);
      if (error) throw error;
      const records = data.slice(0, 50);
      const corrections = records.length
        ? await supabase
            .from("patient_treatment_corrections")
            .select("*")
            .in(
              "treatment_id",
              records.map((r) => r.id),
            )
        : { data: [], error: null };
      if (corrections.error) throw corrections.error;
      return {
        records,
        more: data.length > 50,
        corrections: corrections.data ?? [],
      };
    },
  });
  const correctedIds = new Set(
    history.data?.corrections.map((c) => c.treatment_id) ?? [],
  );
  const dueRecords = currentVaccinations(
    history.data?.records ?? [],
    correctedIds,
  ).filter((r) => r.next_due_on);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidation("");
    if (state.uncertain) {
      const form = e.currentTarget;
      if (await state.retry()) {
        form.reset();
        setAcknowledgedHash(null);
      }
      return;
    }
    const form = e.currentTarget;
    const v = new FormData(form);
    try {
      if (!historical && (alertsUnavailable || !acknowledged))
        throw new Error(
          "Review the patient's important alerts before recording treatment. Reload if alerts could not load.",
        );
      const administered = String(v.get("administered"));
      const at = denverInstant(administered);
      const request = {
        pet_id: petId,
        historical,
        quantity: quantityValue(String(v.get("quantity"))),
        dose: String(v.get("dose")),
        route: String(v.get("route")),
        site: String(v.get("site")),
        veterinarian: String(v.get("veterinarian")),
        veterinarian_license: String(v.get("license")),
        administered_at: at,
        next_due_on: String(v.get("due")) || null,
        ...(historical
          ? {
              kind: String(v.get("kind")),
              product_name: String(v.get("product_name")),
              manufacturer: String(v.get("manufacturer")),
              lot_number: String(v.get("lot_number")),
              expires_on: String(v.get("expires")) || null,
              source: String(v.get("source")),
            }
          : {
              alert_review: {
                source_hash: alerts.data!.source_hash,
                acknowledged: true,
              },
              lot_id: String(v.get("lot_id")),
              invoice_id: String(v.get("invoice_id")),
            }),
      };
      if (
        await state.run("record_patient_treatment", {
          p_id: crypto.randomUUID(),
          p_request: request,
        })
      ) {
        form.reset();
        setAcknowledgedHash(null);
      } else if (!historical) {
        setAcknowledgedHash(null);
        void alerts.refetch();
      }
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Vaccinations & medications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {alerts.isPending && <p role="status">Loading important alerts…</p>}
          {!alerts.error && (
            <Button
              type="button"
              variant="outline"
              disabled={alerts.isFetching}
              onClick={() => void alerts.refetch()}
            >
              Refresh patient alerts
            </Button>
          )}
          {alerts.error && (
            <div role="alert" className="text-clinical-alert">
              <p>
                Important alerts could not load: {errorMessage(alerts.error)}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void alerts.refetch()}
              >
                Reload patient alerts
              </Button>
            </div>
          )}
          {alerts.data?.snapshot.legacy_allergies.text?.trim() && (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 p-3 text-clinical-alert"
            >
              <h3 className="font-semibold">Existing allergy information</h3>
              <p className="text-sm">
                {alerts.data?.snapshot.legacy_allergies.text}
              </p>
              <p className="text-sm">
                {alerts.data?.snapshot.legacy_allergies.provenance}
              </p>
            </div>
          )}
          {!!alerts.data?.snapshot.important_problems.length && (
            <div
              role="alert"
              className="rounded-md border border-destructive bg-destructive/10 p-3"
            >
              <h3 className="font-semibold text-clinical-alert">
                Important patient alerts
              </h3>
              {alerts.data!.snapshot.important_problems.map((a) => (
                <p key={a.id} className="text-sm text-clinical-alert">
                  <strong>
                    {a.title}
                    {a.status === "resolved" && " (historical)"}
                  </strong>
                  {a.notes && ` — ${a.notes}`}
                </p>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={historical}
              disabled={state.locked}
              onChange={(e) => setHistorical(e.target.checked)}
            />
            Import a historical record (no stock or invoice charge)
          </label>
          {!historical && (
            <>
              <StockField label="Find stock by product, lot or location">
                <Input
                  value={lotSearch}
                  maxLength={200}
                  disabled={state.locked}
                  onChange={(e) => setLotSearch(e.target.value)}
                />
              </StockField>
              {stock.error && (
                <p role="alert" className="text-clinical-alert">
                  {errorMessage(stock.error)}
                </p>
              )}
              {invoices.error && (
                <p role="alert" className="text-clinical-alert">
                  {errorMessage(invoices.error)}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Create a draft invoice in{" "}
                <Link className="underline" to={`/hub/client/${clientId}`}>
                  this client’s billing panel
                </Link>{" "}
                first. Recording treatment debits stock and adds one charge
                atomically.
              </p>
            </>
          )}
          <form onSubmit={submit} className="space-y-3">
            <fieldset
              disabled={state.locked}
              className="grid min-w-0 gap-3 md:grid-cols-2"
            >
              {historical ? (
                <>
                  <StockField label="Historical record type">
                    <select className={selectClass} name="kind">
                      <option value="vaccine">Vaccine</option>
                      <option value="medication">Medication</option>
                    </select>
                  </StockField>
                  <StockField label="Product name from source">
                    <Input name="product_name" required maxLength={200} />
                  </StockField>
                  <StockField label="Manufacturer from source">
                    <Input name="manufacturer" maxLength={200} />
                  </StockField>
                  <StockField label="Historical lot number">
                    <Input name="lot_number" maxLength={200} />
                  </StockField>
                  <StockField label="Historical lot expiry (if known)">
                    <Input name="expires" type="date" />
                  </StockField>
                  <StockField label="Source medical record">
                    <Input name="source" required maxLength={500} />
                  </StockField>
                </>
              ) : (
                <>
                  <StockField label="Lot to dispense">
                    <select name="lot_id" className={selectClass} required>
                      <option value="">Choose available stock</option>
                      {stock.data
                        ?.slice(0, 100)
                        .filter(
                          (l) =>
                            l.active &&
                            l.balance > 0 &&
                            l.expires_on >= denverDate(),
                        )
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.product_name} · {l.lot_number} · {l.location} ·{" "}
                            {l.balance} {l.unit}
                          </option>
                        ))}
                    </select>
                  </StockField>
                  <StockField label="Draft invoice">
                    <select name="invoice_id" className={selectClass} required>
                      <option value="">Choose draft invoice</option>
                      {invoices.data?.slice(0, 100).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.id} · {practiceTimestamp(i.created_at)}
                        </option>
                      ))}
                    </select>
                  </StockField>
                </>
              )}
              <StockField label="Stock quantity">
                <Input name="quantity" inputMode="decimal" required />
              </StockField>
              <StockField label="Clinical dose">
                <Input
                  name="dose"
                  required
                  maxLength={200}
                  placeholder="e.g. 1 mL"
                />
              </StockField>
              <StockField label="Route">
                <Input name="route" required maxLength={100} />
              </StockField>
              <StockField label="Administration site">
                <Input name="site" maxLength={200} />
              </StockField>
              <StockField label="Veterinarian">
                <Input name="veterinarian" required maxLength={200} />
              </StockField>
              <StockField label="Veterinarian license">
                <Input name="license" maxLength={100} />
              </StockField>
              <StockField label="Administration date/time (America/Denver)">
                <Input name="administered" type="datetime-local" required />
              </StockField>
              <StockField label="Next due date (clinician chosen, optional)">
                <Input name="due" type="date" />
              </StockField>
              {!historical && (
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input
                    type="checkbox"
                    required
                    checked={acknowledged}
                    disabled={alertsUnavailable}
                    onChange={(event) =>
                      setAcknowledgedHash(
                        event.target.checked ? alerts.data!.source_hash : null,
                      )
                    }
                  />
                  {hasAlerts
                    ? "I reviewed the important patient history and recorded allergy information before recording this treatment."
                    : "I reviewed the current patient alert summary. No important problems or allergy text are recorded; this does not establish absence of allergies."}
                </label>
              )}
            </fieldset>
            {validation && (
              <p role="alert" className="text-clinical-alert">
                {validation}
              </p>
            )}
            {state.error && (
              <p role="alert" className="text-clinical-alert">
                {state.error}
              </p>
            )}
            {state.success && <p role="status">Treatment saved.</p>}
            <Button
              disabled={
                state.busy ||
                (!historical && !state.uncertain && alertsUnavailable)
              }
            >
              {state.uncertain
                ? "Retry same treatment"
                : historical
                  ? "Save historical record"
                  : "Record treatment & charge"}
            </Button>
          </form>
          {(stock.data?.length ?? 0) > 100 && (
            <p className="text-sm">
              Stock results are limited to 100. Narrow the stock search.
            </p>
          )}
          {(invoices.data?.length ?? 0) > 100 && (
            <p className="text-sm">Showing the 100 newest draft invoices.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recorded history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.isPending && <p role="status">Loading treatment history…</p>}
          {history.error && (
            <p role="alert" className="text-clinical-alert">
              {errorMessage(history.error)}
            </p>
          )}
          {!!dueRecords.length && (
            <div className="rounded-md border p-3">
              <h3 className="font-medium">Due dates on these records</h3>
              <p className="text-xs text-muted-foreground">
                Clinician-entered dates; corrected records excluded. Review the
                full history before determining the current vaccine schedule.
              </p>
              {dueRecords.map((r) => (
                <p key={r.id} className="text-sm">
                  {r.product_name}: {r.next_due_on}
                  {r.next_due_on! < denverDate()
                    ? " · recorded due date has passed"
                    : ""}
                </p>
              ))}
            </div>
          )}
          {history.data?.records.length === 0 && (
            <p className="text-muted-foreground">
              No treatment records on this page.
            </p>
          )}
          {history.data?.records.map((r) => {
            const correction = history.data.corrections.find(
              (c) => c.treatment_id === r.id,
            );
            return (
              <article key={r.id} className="rounded-md border p-4">
                <h3 className="font-semibold">
                  {r.product_name} · {r.kind}
                  {r.historical && " · historical"}
                </h3>
                <p className="text-sm">
                  {practiceTimestamp(r.administered_at)} · {r.dose} · {r.route}{" "}
                  {r.site}
                </p>
                <p className="text-sm text-muted-foreground">
                  {r.manufacturer || "Manufacturer not recorded"} · lot{" "}
                  {r.lot_number || "not recorded"} · expiry{" "}
                  {r.expires_on || "not recorded"}
                </p>
                <p className="text-sm">
                  Veterinarian: {r.veterinarian}
                  {r.veterinarian_license && ` (${r.veterinarian_license})`} ·
                  due {r.next_due_on || "not specified"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Source: {r.source} · Record ID: {r.id}
                </p>
                {correction ? (
                  <p className="mt-2 text-sm font-medium text-clinical-alert">
                    Corrected: {correction.reason}
                    {correction.replacement_id &&
                      ` · replacement ${correction.replacement_id}`}
                  </p>
                ) : (
                  <CorrectionForm record={r} />
                )}
              </article>
            );
          })}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 0 || history.isFetching}
              onClick={() => setPage((p) => p - 1)}
            >
              Newer records
            </Button>
            <span className="text-sm">Page {page + 1}</span>
            <Button
              variant="outline"
              disabled={!history.data?.more || history.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Older records
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
