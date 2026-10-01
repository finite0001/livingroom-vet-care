import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StockField } from "../inventory/InventoryPage";
import { lots } from "../inventory/api";
import {
  denverDate,
  errorMessage,
  isDefinitiveRejection,
  practiceTimestamp,
} from "../inventory/stock-policy";
import { usePatientAlertReview } from "../clinical/alert-review";
import { alertAcknowledgmentMatches } from "../clinical/alert-review-policy";
import type { AnesthesiaRecord } from "./model";
import {
  anesthesiaDrugLots,
  anesthesiaDrugRequest,
  anesthesiaDrugsLocked,
  SIGNED_RECORD_DRUG_POLICY,
  type AnesthesiaDrugRequest,
} from "./drug-administration";
const db = supabase;
interface AnesthesiaDrugAdministrationsProps {
  petId: string;
  clientId: string;
  record: AnesthesiaRecord;
  onPendingChange?: (pending: boolean) => void;
}
interface PendingDrug {
  actor: string;
  id: string;
  request: AnesthesiaDrugRequest;
}
const selectClass =
  "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm";
const anesthesiaDrugsKey = (recordId: string) =>
  ["anesthesia-drugs", recordId] as const;
export function AnesthesiaDrugAdministrations({
  petId,
  clientId,
  record,
  onPendingChange,
}: AnesthesiaDrugAdministrationsProps) {
  const { user } = useAuth();
  const cache = useQueryClient();
  const locked = anesthesiaDrugsLocked(record);
  const [lotSearch, setLotSearch] = useState("");
  const [acknowledgedHash, setAcknowledgedHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pending = useRef<PendingDrug | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const alerts = usePatientAlertReview(petId);
  const alertsUnavailable =
    alerts.isPending ||
    alerts.isFetching ||
    Boolean(alerts.error) ||
    !alerts.data;
  const acknowledged = alertAcknowledgmentMatches(
    alerts.data,
    acknowledgedHash,
  );
  useEffect(() => {
    onPendingChange?.(busy || uncertain);
    return () => onPendingChange?.(false);
  }, [busy, uncertain, onPendingChange]);
  const stock = useQuery({
    queryKey: ["inventory", "anesthesia-drug-lots", lotSearch],
    enabled: !locked,
    queryFn: () => lots(lotSearch),
  });
  const invoices = useQuery({
    queryKey: ["billing", "drafts", clientId],
    enabled: !locked,
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
  const entries = useQuery({
    queryKey: anesthesiaDrugsKey(record.id),
    queryFn: async () => {
      const { data: links, error } = await db
        .from("anesthesia_drug_administrations")
        .select("*")
        .eq("record_id", record.id)
        .eq("pet_id", petId)
        .order("created_at")
        .order("id")
        .limit(1000);
      if (error) throw error;
      if (!links.length) return [];
      const ids = links.map((l) => l.id);
      const [treatments, corrections] = await Promise.all([
        supabase.from("patient_treatments").select("*").in("id", ids),
        supabase
          .from("patient_treatment_corrections")
          .select("treatment_id,reason")
          .in("treatment_id", ids),
      ]);
      if (treatments.error) throw treatments.error;
      if (corrections.error) throw corrections.error;
      return (treatments.data ?? [])
        .map((t) => ({
          treatment: t,
          correction: corrections.data?.find((c) => c.treatment_id === t.id),
        }))
        .sort((a, b) =>
          a.treatment.administered_at.localeCompare(
            b.treatment.administered_at,
          ),
        );
    },
  });
  async function send(operation: PendingDrug, form: HTMLFormElement) {
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error } = await db.rpc("record_anesthesia_drug_administration", {
        p_id: operation.id,
        p_record_id: record.id,
        p_pet_id: petId,
        p_request: operation.request as unknown as Json,
      });
      if (error) throw error;
      pending.current = null;
      setUncertain(false);
      setAcknowledgedHash(null);
      form.reset();
      setMessage("Drug recorded, stock debited and invoice line added.");
      void cache.invalidateQueries({ queryKey: anesthesiaDrugsKey(record.id) });
      for (const prefix of [
        "inventory",
        "treatments",
        "billing",
        "household-invoices",
        "invoice",
        "invoice-details",
      ])
        void cache.invalidateQueries({ queryKey: [prefix] });
    } catch (failure) {
      const definitive = isDefinitiveRejection(failure);
      if (definitive) {
        pending.current = null;
        setAcknowledgedHash(null);
        void alerts.refetch();
      }
      setUncertain(!definitive);
      setError(
        errorMessage(failure) +
          (definitive
            ? ""
            : " Outcome unconfirmed. Retry sends the same entry; do not enter it again elsewhere."),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const form = event.currentTarget;
    if (!user) {
      setError("Sign in before recording anesthesia drugs.");
      return;
    }
    if (pending.current) {
      if (pending.current.actor !== user.id) {
        setError("Sign in with the staff account that started this entry.");
        return;
      }
      await send(pending.current, form);
      return;
    }
    const v = new FormData(form);
    try {
      if (alertsUnavailable || !acknowledged)
        throw new Error(
          "Review the patient's important alerts before recording a drug. Reload if alerts could not load.",
        );
      const request = anesthesiaDrugRequest(
        {
          lot_id: String(v.get("lot_id") ?? ""),
          invoice_id: String(v.get("invoice_id") ?? ""),
          quantity: String(v.get("quantity") ?? ""),
          dose: String(v.get("dose") ?? ""),
          route: String(v.get("route") ?? ""),
          site: String(v.get("site") ?? ""),
          veterinarian: String(v.get("veterinarian") ?? ""),
          veterinarian_license: String(v.get("license") ?? ""),
          administered: String(v.get("administered") ?? ""),
        },
        record,
        acknowledgedHash,
      );
      pending.current = { actor: user.id, id: crypto.randomUUID(), request };
      await send(pending.current, form);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }
  const available = anesthesiaDrugLots(
    stock.data?.slice(0, 100) ?? [],
    denverDate(),
  );
  return (
    <section
      aria-labelledby={`anesthesia-drugs-${record.id}`}
      className="space-y-3 rounded-md border p-3"
    >
      <h3 id={`anesthesia-drugs-${record.id}`} className="font-medium">
        Anesthesia drugs from stock
      </h3>
      <p className="text-sm text-muted-foreground">
        Each entry debits the chosen lot and adds one line to the household’s
        draft invoice in a single step. No drug list, dose or quantity is
        suggested. Controlled-substance (DEA) logs are not kept here.
      </p>
      {entries.isPending && <p role="status">Loading anesthesia drugs…</p>}
      {entries.error && (
        <p role="alert" className="text-clinical-alert">
          Anesthesia drugs could not load: {errorMessage(entries.error)}{" "}
          <Button variant="outline" onClick={() => void entries.refetch()}>
            Retry anesthesia drugs
          </Button>
        </p>
      )}
      {entries.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No stock drugs recorded on this anesthesia record.
        </p>
      )}
      <ul className="space-y-2">
        {entries.data?.map(({ treatment: t, correction }) => (
          <li key={t.id} className="rounded-md border p-3 text-sm">
            <p className="font-medium">
              {t.product_name} · {t.quantity} · lot {t.lot_number} · expiry{" "}
              {t.expires_on}
            </p>
            <p>
              {practiceTimestamp(t.administered_at)} · {t.dose} · {t.route}
              {t.site && ` · ${t.site}`} · {t.veterinarian}
            </p>
            <p className="text-xs text-muted-foreground">
              Treatment record ID: {t.id}
            </p>
            {correction && (
              <p className="font-medium text-clinical-alert">
                Corrected in Treatments: {correction.reason}
              </p>
            )}
          </li>
        ))}
      </ul>
      {locked ? (
        <p role="note" className="text-sm">
          {SIGNED_RECORD_DRUG_POLICY}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {alerts.error && (
            <p role="alert" className="text-clinical-alert">
              Important alerts could not load: {errorMessage(alerts.error)}{" "}
              <Button
                type="button"
                variant="outline"
                onClick={() => void alerts.refetch()}
              >
                Reload patient alerts
              </Button>
            </p>
          )}
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
          {invoices.data?.length === 0 && (
            <p className="text-sm">
              This household has no draft invoice. Create one in the client’s
              billing panel first.
            </p>
          )}
          <fieldset
            disabled={busy || uncertain}
            className="grid min-w-0 gap-3 md:grid-cols-2"
          >
            <StockField label="Find drug stock by product, lot or location">
              <Input
                value={lotSearch}
                maxLength={200}
                onChange={(e) => setLotSearch(e.target.value)}
              />
            </StockField>
            <StockField label="Drug lot administered">
              <select name="lot_id" className={selectClass} required>
                <option value="">Choose unexpired medication stock</option>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.product_name} · {l.lot_number} · {l.location} ·{" "}
                    {l.balance} {l.unit}
                  </option>
                ))}
              </select>
            </StockField>
            <StockField label="Household draft invoice">
              <select name="invoice_id" className={selectClass} required>
                <option value="">Choose draft invoice</option>
                {invoices.data?.slice(0, 100).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.id} · {practiceTimestamp(i.created_at)}
                  </option>
                ))}
              </select>
            </StockField>
            <StockField label="Stock quantity used">
              <Input name="quantity" inputMode="decimal" required />
            </StockField>
            <StockField label="Clinical dose (as documented)">
              <Input name="dose" required maxLength={200} />
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
            <StockField label="Administered at (America/Denver)">
              <Input name="administered" type="datetime-local" required />
            </StockField>
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input
                type="checkbox"
                required
                checked={acknowledged}
                disabled={alertsUnavailable}
                onChange={(e) =>
                  setAcknowledgedHash(
                    e.target.checked ? alerts.data!.source_hash : null,
                  )
                }
              />
              I reviewed the patient’s important alerts and recorded allergy
              information before recording this drug.
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-clinical-alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <Button disabled={busy || (!uncertain && alertsUnavailable)}>
            {uncertain
              ? "Retry same anesthesia drug"
              : "Record anesthesia drug & charge"}
          </Button>
          {(stock.data?.length ?? 0) > 100 && (
            <p className="text-sm">
              Stock results are limited to 100. Narrow the stock search.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
