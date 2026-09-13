import { ReconciliationPanel } from "../payments/ReconciliationPanel";
import { PaymentCollectionPanel } from "../payments/PaymentCollectionPanel";
import { InvoicePayments } from "../payments/InvoicePayments";
import { DocumentSmsComposer } from "../document-links/DocumentSmsComposer";
import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tables, Database } from "@/integrations/supabase/types";
import { dollarsToCents, money } from "./money";
import { InvoiceEmailComposer } from "./InvoiceEmailComposer";
import { InvoiceDocumentPreview } from "./InvoiceDocumentPreview";

interface HouseholdInvoicesProps {
  clientId: string;
}
interface PendingOperation {
  run: () => Promise<void>;
  label: string;
}
type Invoice = Tables<"billing_invoices">;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const messageOf = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Request failed. Retry the same operation when connected.";
const knownRejection = (error: unknown) =>
  error &&
  typeof error === "object" &&
  "code" in error &&
  ["23514", "23503", "42501", "40001", "22P02", "22003"].includes(
    String(error.code),
  );

export function HouseholdInvoices({ clientId }: HouseholdInvoicesProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [childPending, setChildPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const createId = useRef<string | null>(null);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unconfirmed = busy || Boolean(createId.current) || childPending;
  const blocker = useBlocker(unconfirmed);
  useEffect(() => {
    if (!unconfirmed) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [unconfirmed]);
  const invoices = useQuery({
    queryKey: ["household-invoices", clientId, page],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_invoices")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return data;
    },
  });
  async function create() {
    if (locked.current || !session?.user.id) return;
    locked.current = true;
    setBusy(true);
    setError("");
    createId.current ??= crypto.randomUUID();
    try {
      const { data, error } = await supabase.rpc("create_billing_invoice", {
        p_id: createId.current,
        p_client_id: clientId,
      });
      if (error) throw error;
      createId.current = null;
      setSelected(data.id);
      setPage(0);
      await cache.invalidateQueries({
        queryKey: ["household-invoices", clientId],
      });
    } catch (failure) {
      if (knownRejection(failure)) createId.current = null;
      setError(messageOf(failure));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader className="flex flex-wrap gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Invoices</CardTitle>
        <Button disabled={busy || childPending} onClick={() => void create()}>
          {busy
            ? "Creating…"
            : createId.current
              ? "Retry creating invoice"
              : "New draft invoice"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <AlertDialog open={blocker.state === "blocked"}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Leave unfinished invoice work?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Unsaved email text will be discarded. A submitted request may
                already be recorded; recover the saved invoice email or review
                invoice history before submitting it again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => blocker.state === "blocked" && blocker.reset()}
              >
                Stay and reconcile
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => blocker.state === "blocked" && blocker.proceed()}
              >
                Leave and review later
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="text-sm text-muted-foreground">
          USD charges and accounting credits. Payment collection is not
          connected. Issued invoices can be prepared for reviewed email
          queueing; delivery is tracked separately.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {invoices.isPending ? (
          <p role="status">Loading invoices…</p>
        ) : invoices.isError ? (
          <p role="alert">
            Invoices unavailable.{" "}
            <Button variant="outline" onClick={() => void invoices.refetch()}>
              Retry invoices
            </Button>
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {invoices.data.map((invoice) => (
                <li key={invoice.id}>
                  <Button
                    disabled={unconfirmed}
                    variant={selected === invoice.id ? "secondary" : "outline"}
                    className="h-auto w-full justify-start whitespace-normal text-left"
                    onClick={() => setSelected(invoice.id)}
                  >
                    {new Date(invoice.created_at).toLocaleDateString("en-US", {
                      timeZone: "America/Denver",
                    })}{" "}
                    · {invoice.status} ·{" "}
                    {invoice.total_cents === null
                      ? "Draft charges"
                      : money(invoice.total_cents)}{" "}
                    · {invoice.id.slice(0, 8)}
                  </Button>
                </li>
              ))}
            </ul>
            {!invoices.data.length && <p>No invoices on this page.</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={unconfirmed || !page}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous invoices
              </Button>
              <Button
                variant="outline"
                disabled={unconfirmed || invoices.data.length < 20}
                onClick={() => setPage((value) => value + 1)}
              >
                More invoices
              </Button>
            </div>
          </>
        )}
        {selected && (
          <InvoiceEditor
            key={selected}
            invoiceId={selected}
            clientId={clientId}
            onPending={setChildPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

interface InvoiceEditorProps {
  invoiceId: string;
  clientId: string;
  onPending: (pending: boolean) => void;
}
function InvoiceEditor({ invoiceId, clientId, onPending }: InvoiceEditorProps) {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [petId, setPetId] = useState("");
  const [credit, setCredit] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<PendingOperation | null>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailDirty, setEmailDirty] = useState(false);
  const [smsDirty, setSmsDirty] = useState(false);
  const [paymentDirty, setPaymentDirty] = useState(false);
  const [collectionDirty, setCollectionDirty] = useState(false);
  const [reconciliationDirty, setReconciliationDirty] = useState(false);
  useEffect(() => {
    onPending(
      busy ||
        Boolean(pending) ||
        emailDirty ||
        smsDirty ||
        paymentDirty ||
        collectionDirty ||
        reconciliationDirty,
    );
    return () => onPending(false);
  }, [
    busy,
    pending,
    emailDirty,
    smsDirty,
    paymentDirty,
    collectionDirty,
    reconciliationDirty,
    onPending,
  ]);
  const invoice = useQuery({
    queryKey: ["invoice", invoiceId, clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_invoices")
        .select("*")
        .eq("id", invoiceId)
        .eq("client_id", clientId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const details = useQuery({
    queryKey: ["invoice-details", invoiceId],
    queryFn: async () => {
      const items: Tables<"billing_invoice_items">[] = [];
      const credits: Tables<"billing_credits">[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("billing_invoice_items")
          .select("*")
          .eq("invoice_id", invoiceId)
          .order("created_at")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        items.push(...data);
        if (data.length < 500) break;
      }
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("billing_credits")
          .select("*")
          .eq("invoice_id", invoiceId)
          .order("created_at")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        credits.push(...data);
        if (data.length < 500) break;
      }
      return { items, credits };
    },
  });
  const options = useQuery({
    queryKey: ["invoice-options", clientId, serviceSearch],
    queryFn: async () => {
      const [products, pets] = await Promise.all([
        supabase
          .from("catalog_products")
          .select("*")
          .eq("kind", "service")
          .eq("active", true)
          .ilike("name", `%${serviceSearch.replace(/[%_]/g, "")}%`)
          .order("name")
          .limit(50),
        supabase
          .from("pets")
          .select("id,name")
          .eq("client_id", clientId)
          .order("name"),
      ]);
      if (products.error) throw products.error;
      if (pets.error) throw pets.error;
      return { products: products.data, pets: pets.data };
    },
  });
  async function refresh() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["invoice", invoiceId] }),
      cache.invalidateQueries({ queryKey: ["invoice-details", invoiceId] }),
      cache.invalidateQueries({ queryKey: ["household-invoices", clientId] }),
    ]);
  }
  async function run(operation: PendingOperation) {
    if (lock.current || !session?.user.id) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPending(operation);
    try {
      await operation.run();
      setPending(null);
      setNotice(`${operation.label} recorded.`);
      await refresh();
    } catch (failure) {
      if (knownRejection(failure)) {
        setPending(null);
        await refresh();
      }
      setError(messageOf(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function rpc<N extends keyof Database["public"]["Functions"]>(
    name: N,
    args: Database["public"]["Functions"][N]["Args"],
  ): () => Promise<void> {
    return async () => {
      const { error } = await supabase.rpc(name, args);
      if (error) throw error;
    };
  }
  function addService() {
    if (
      !serviceId ||
      !Number.isFinite(Number(quantity)) ||
      Number(quantity) <= 0
    ) {
      setError("Choose a service and positive quantity.");
      return;
    }
    void run({
      label: "Service charge",
      run: rpc("add_invoice_service", {
        p_id: crypto.randomUUID(),
        p_invoice_id: invoiceId,
        p_pet_id: petId || null,
        p_product_id: serviceId,
        p_quantity: Number(quantity),
      }),
    });
  }
  function addCredit() {
    try {
      const amount = dollarsToCents(credit);
      if (!reason.trim()) throw new Error("A reason is required.");
      void run({
        label: "Accounting credit",
        run: rpc("credit_billing_invoice", {
          p_id: crypto.randomUUID(),
          p_invoice_id: invoiceId,
          p_amount_cents: amount,
          p_reason: reason.trim(),
        }),
      });
    } catch (failure) {
      setError(messageOf(failure));
    }
  }
  if (invoice.isPending || details.isPending)
    return <p role="status">Loading invoice details…</p>;
  if (!invoice.data || !details.data)
    return (
      <p role="alert">
        Invoice details unavailable.{" "}
        <Button onClick={() => void refresh()}>Retry invoice details</Button>
      </p>
    );
  const record: Invoice = invoice.data;
  const total =
    record.total_cents ??
    details.data.items.reduce((sum, item) => sum + item.amount_cents, 0);
  const credits = details.data.credits.reduce(
    (sum, item) => sum + item.amount_cents,
    0,
  );
  const readFailed = invoice.isError || details.isError;
  const disabled =
    busy ||
    Boolean(pending) ||
    emailDirty ||
    smsDirty ||
    paymentDirty ||
    collectionDirty ||
    reconciliationDirty ||
    readFailed;
  return (
    <section
      aria-label="Invoice details"
      className="space-y-4 rounded-md border p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Invoice {invoiceId.slice(0, 8)}</h3>
        <Badge variant="outline">{record.status}</Badge>
        <InvoiceDocumentPreview
          key={session?.user.id}
          invoiceId={invoiceId}
          clientId={clientId}
          disabled={disabled}
        />
      </div>
      <p className="text-xs text-muted-foreground break-all">
        Record ID: {invoiceId} · Revision {record.version}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {readFailed && (
        <p role="alert">
          Current invoice details could not be refreshed. Your open work is
          retained; reload current details before continuing.{" "}
          <Button variant="outline" onClick={() => void refresh()}>
            Retry current invoice details
          </Button>
        </p>
      )}
      {pending && (
        <div className="space-y-2">
          <p className="text-sm">
            The last request has not been confirmed. Retry the same request
            before starting another change.
          </p>
          <Button disabled={busy} onClick={() => void run(pending)}>
            Retry {pending.label.toLowerCase()}
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Invoice line items</caption>
          <thead>
            <tr>
              <th className="p-2">Description</th>
              <th className="p-2">Quantity</th>
              <th className="p-2">Unit price</th>
              <th className="p-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {details.data.items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="p-2">{item.description}</td>
                <td className="p-2">{item.quantity}</td>
                <td className="p-2">{money(item.unit_price_cents)}</td>
                <td className="p-2">{money(item.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt>Charges</dt>
          <dd className="font-semibold">{money(total)}</dd>
        </div>
        <div>
          <dt>Accounting credits</dt>
          <dd>{money(credits)}</dd>
        </div>
        <div>
          <dt>Net charges</dt>
          <dd>{money(record.status === "void" ? 0 : total - credits)}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        Net charges show billed services minus accounting credits. See the
        payment section for confirmed payments and refunds.
      </p>
      {record.status === "draft" && (
        <>
          {options.isPending ? (
            <p>Loading services…</p>
          ) : options.isError ? (
            <p role="alert">
              Services unavailable.{" "}
              <Button onClick={() => void options.refetch()}>
                Retry services
              </Button>
            </p>
          ) : (
            <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="invoice-service-search">Find service</Label>
                <Input
                  id="invoice-service-search"
                  value={serviceSearch}
                  onChange={(event) => {
                    setServiceSearch(event.target.value);
                    setServiceId("");
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Up to 50 matches.
                </p>
              </div>
              <div>
                <Label htmlFor="invoice-service">Service</Label>
                <select
                  id="invoice-service"
                  className={selectClass}
                  value={serviceId}
                  onChange={(event) => setServiceId(event.target.value)}
                >
                  <option value="">Choose service</option>
                  {options.data.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {money(product.unit_price_cents)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="invoice-patient">Patient for charge</Label>
                <select
                  id="invoice-patient"
                  className={selectClass}
                  value={petId}
                  onChange={(event) => setPetId(event.target.value)}
                >
                  <option value="">Household</option>
                  {options.data.pets.map((pet) => (
                    <option key={pet.id} value={pet.id}>
                      {pet.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="invoice-quantity">Service quantity</Label>
                <Input
                  id="invoice-quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
              <Button onClick={addService} disabled={!serviceId}>
                Add service charge
              </Button>
            </fieldset>
          )}
          <p className="text-sm text-muted-foreground">
            Medication and vaccine charges are added with their patient
            treatment. Issuing freezes these line items and their total.
          </p>
          <Button
            disabled={disabled || !details.data.items.length}
            onClick={() =>
              void run({
                label: "Invoice issuance",
                run: rpc("issue_billing_invoice", {
                  p_id: invoiceId,
                  p_expected_version: record.version,
                }),
              })
            }
          >
            Issue invoice for {money(total)}
          </Button>
        </>
      )}
      {record.status === "issued" && (
        <fieldset disabled={disabled} className="space-y-3">
          <div>
            <Label htmlFor="invoice-correction-reason">
              Credit or void reason
            </Label>
            <Input
              id="invoice-correction-reason"
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="invoice-credit">Accounting credit (USD)</Label>
            <Input
              id="invoice-credit"
              inputMode="decimal"
              value={credit}
              onChange={(event) => setCredit(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!reason.trim() || !credit || credits >= total}
              onClick={addCredit}
            >
              Record accounting credit
            </Button>
            <Button
              variant="outline"
              disabled={!reason.trim() || Boolean(credits)}
              onClick={() =>
                void run({
                  label: "Invoice void",
                  run: rpc("void_billing_invoice", {
                    p_id: invoiceId,
                    p_expected_version: record.version,
                    p_reason: reason.trim(),
                  }),
                })
              }
            >
              Void invoice and retain history
            </Button>
          </div>
        </fieldset>
      )}
      {(record.status === "issued" || record.status === "void") && (
        <InvoiceEmailComposer
          invoiceId={invoiceId}
          clientId={clientId}
          canPrepare={record.status === "issued"}
          disabled={
            busy ||
            Boolean(pending) ||
            smsDirty ||
            paymentDirty ||
            collectionDirty ||
            reconciliationDirty ||
            readFailed
          }
          onDirtyChange={setEmailDirty}
        />
      )}
      {(record.status === "issued" || record.status === "void") && (
        <DocumentSmsComposer
          family="invoice"
          sourceId={invoiceId}
          clientId={clientId}
          canPrepare={record.status === "issued"}
          disabled={
            busy ||
            Boolean(pending) ||
            emailDirty ||
            paymentDirty ||
            collectionDirty ||
            reconciliationDirty ||
            readFailed
          }
          onDirtyChange={setSmsDirty}
        />
      )}
      {(record.status === "issued" || record.status === "void") && (
        <InvoicePayments
          invoiceId={invoiceId}
          clientId={clientId}
          invoiceTotalCents={record.total_cents}
          canPrepare={record.status === "issued"}
          disabled={
            busy ||
            Boolean(pending) ||
            emailDirty ||
            smsDirty ||
            collectionDirty ||
            reconciliationDirty ||
            readFailed
          }
          onDirtyChange={setPaymentDirty}
        />
      )}
      {(record.status === "issued" || record.status === "void") && (
        <PaymentCollectionPanel
          invoiceId={invoiceId}
          clientId={clientId}
          canPrepare={record.status === "issued"}
          disabled={
            busy ||
            Boolean(pending) ||
            emailDirty ||
            smsDirty ||
            paymentDirty ||
            reconciliationDirty ||
            readFailed
          }
          onDirtyChange={setCollectionDirty}
        />
      )}
      {(record.status === "issued" || record.status === "void") && (
        <ReconciliationPanel
          invoiceId={invoiceId}
          clientId={clientId}
          disabled={
            busy ||
            Boolean(pending) ||
            emailDirty ||
            smsDirty ||
            paymentDirty ||
            collectionDirty ||
            readFailed
          }
          onDirtyChange={setReconciliationDirty}
        />
      )}
      {record.status === "void" && <p>Void reason: {record.void_reason}</p>}
      {Boolean(details.data.credits.length) && (
        <div>
          <h4 className="font-semibold">Credit history</h4>
          <ul className="space-y-2">
            {details.data.credits.map((item) => (
              <li key={item.id}>
                {money(item.amount_cents)} · {item.reason} ·{" "}
                {new Date(item.created_at).toLocaleDateString("en-US", {
                  timeZone: "America/Denver",
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
