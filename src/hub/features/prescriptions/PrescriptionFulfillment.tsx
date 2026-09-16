import { useQueryClient } from "@tanstack/react-query";
import { refreshPatientReleases } from "../record-releases/refresh";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { lots } from "../inventory/api";
import type { LotBalance } from "../inventory/api";
import { createNativeRefillApi } from "../refills/refill-api";
import {
  createFulfillmentApi,
  dispenseTargetSchema,
  dispenseRequestSchema,
  closeSlotRequestSchema,
  pickupRequestSchema,
} from "./fulfillment-api";
import type {
  FulfillmentApi,
  FulfillmentCursor,
  NativeDispense,
  NativeFillSlot,
  NativeSlotClosure,
  NativePickup,
} from "./fulfillment-api";
import type {
  PrescriptionAuthorization,
  PrescriptionRpc,
} from "./prescription-api";
import { usePrescriptionOperation } from "./usePrescriptionOperation";
import { PrescriptionOperationControls } from "./PrescriptionOperationControls";
import { renderReviewedPrescriptionCopy } from "./prescription-print";
interface Props {
  evidenceRevision: number;
  onEvidenceChanged: () => void;
  actor: string;
  authorization: PrescriptionAuthorization;
  disabled: boolean;
  inactive: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
interface Allocation {
  lotId: string;
  quantity: string;
}
interface History {
  dispenses: NativeDispense[];
  closures: NativeSlotClosure[];
  pickups: NativePickup[];
}
interface Invoices {
  id: string;
  created_at: string;
}
type Mode = "dispense" | "close_slot" | "pickup";
type Preview =
  | Awaited<ReturnType<FulfillmentApi["previewDispense"]>>
  | Awaited<ReturnType<FulfillmentApi["previewClose"]>>
  | Awaited<ReturnType<FulfillmentApi["previewPickup"]>>;
const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const emptyHistory = (): History => ({
  dispenses: [],
  closures: [],
  pickups: [],
});
function cents(value: string) {
  const amount = BigInt(value);
  return `$${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}
export function PrescriptionFulfillment(props: Props) {
  return (
    <FulfillmentWorkspace
      key={`${props.actor}:${props.authorization.pet_id}:${props.authorization.id}`}
      {...props}
    />
  );
}
function FulfillmentWorkspace({
  evidenceRevision,
  onEvidenceChanged,
  actor,
  authorization,
  disabled,
  inactive,
  onDirtyChange,
}: Props) {
  const petId = authorization.pet_id;
  const releaseCache = useQueryClient();
  const api = useMemo(
    () =>
      createFulfillmentApi(
        supabase as unknown as PrescriptionRpc,
        actor,
        authorization,
      ),
    [actor, authorization],
  );
  const refillApi = useMemo(
    () => createNativeRefillApi(supabase as unknown as PrescriptionRpc, actor),
    [actor],
  );
  const alive = useRef(true),
    reading = useRef(false),
    popup = useRef<Window | null>(null);
  const attemptedRevision = useRef(-1);
  const [observedRevision, setObservedRevision] = useState(-1);
  const [current, setCurrent] =
      useState<Awaited<ReturnType<FulfillmentApi["read"]>>>(null),
    [history, setHistory] = useState(emptyHistory),
    [slots, setSlots] = useState<NativeFillSlot[]>([]),
    [slotCursor, setSlotCursor] = useState<number | null>(null);
  const [cursors, setCursors] = useState<
    Record<keyof History, FulfillmentCursor | null>
  >({ dispenses: null, closures: null, pickups: null });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [mode, setMode] = useState<Mode | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [ack, setAck] = useState(false),
    [printHtml, setPrintHtml] = useState("");
  const [reason, setReason] = useState(""),
    [quantity, setQuantity] = useState(""),
    [invoiceId, setInvoiceId] = useState(""),
    [allocations, setAllocations] = useState<Allocation[]>([
      { lotId: "", quantity: "" },
    ]),
    [refillId, setRefillId] = useState(""),
    [search, setSearch] = useState(""),
    [availableLots, setAvailableLots] = useState<LotBalance[]>([]),
    [knownLots, setKnownLots] = useState<Record<string, LotBalance>>({}),
    [invoices, setInvoices] = useState<Invoices[]>([]),
    [invoicePage, setInvoicePage] = useState(0),
    [moreInvoices, setMoreInvoices] = useState(false);
  const [selected, setSelected] = useState<NativeDispense | null>(null),
    [recipient, setRecipient] = useState(""),
    [relationship, setRelationship] = useState(""),
    [closeRefill, setCloseRefill] = useState(false),
    [closeReason, setCloseReason] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      popup.current?.close();
    };
  }, []);
  const operation = usePrescriptionOperation({
    actor,
    patientId: petId,
    execute: api.execute,
    recover: api.recover,
    onConfirmed: () => {
      void refreshPatientReleases(releaseCache, petId);
      onEvidenceChanged();
      setMode(null);
      setPreview(null);
      setAck(false);
      setPrintHtml("");
      setCurrent(null);
      setLoaded(false);
    },
  });
  const dirty = mode !== null || operation.dirty;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  async function read(action: () => Promise<void>) {
    if (reading.current) return;
    reading.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (alive.current)
        setError(
          "Fulfillment evidence could not be confirmed. Your entered values and any uncertain request are retained. Retry the review or refresh when ready.",
        );
    } finally {
      reading.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function refresh() {
    setLoaded(false);
    setCurrent(null);
    setPrintHtml("");
    await read(async () => {
      const [status, slotPage, d, c, p] = await Promise.all([
        api.read(),
        api.slots(),
        api.history("dispenses"),
        api.history("closures"),
        api.history("pickups"),
      ]);
      if (!alive.current) return;
      if (!status) throw new Error("Unavailable authorization");
      setCurrent(status);
      setSlots(slotPage.slots);
      setSlotCursor(slotPage.next_index);
      setHistory({
        dispenses: d.dispenses as NativeDispense[],
        closures: c.closures as NativeSlotClosure[],
        pickups: p.pickups as NativePickup[],
      });
      setCursors({
        dispenses: d.next_cursor as FulfillmentCursor | null,
        closures: c.next_cursor as FulfillmentCursor | null,
        pickups: p.next_cursor as FulfillmentCursor | null,
      });
      setLoaded(true);
      setObservedRevision(evidenceRevision);
    });
  }
  const evidenceStale = observedRevision !== evidenceRevision;
  useEffect(() => {
    if (
      !dirty &&
      !busy &&
      evidenceStale &&
      attemptedRevision.current !== evidenceRevision
    ) {
      attemptedRevision.current = evidenceRevision;
      void refresh();
    }
    // Refresh only idle evidence; never remount or replace an uncertain operation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, evidenceRevision, observedRevision]);
  async function loadChoices(page = 0) {
    const [stock, draftInvoices] = await Promise.all([
      lots(search, authorization.context.draft.fields.product_id ?? undefined),
      supabase
        .from("billing_invoices")
        .select("id,created_at")
        .eq("client_id", authorization.client_id)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 50, page * 50 + 50),
    ]);
    if (draftInvoices.error) throw draftInvoices.error;
    if (!alive.current) return;
    setAvailableLots(stock);
    setKnownLots((previous) => ({
      ...previous,
      ...Object.fromEntries(stock.map((l) => [l.id, l])),
    }));
    setInvoices(draftInvoices.data.slice(0, 50));
    setInvoicePage(page);
    setMoreInvoices(draftInvoices.data.length > 50);
  }
  async function begin(next: Mode, dispense: NativeDispense | null = null) {
    operation.discard();
    setMode(next);
    setSelected(dispense);
    setPreview(null);
    setAck(false);
    setReason("");
    setQuantity("");
    setInvoiceId("");
    setAllocations([{ lotId: "", quantity: "" }]);
    setRefillId("");
    setRecipient("");
    setRelationship("");
    setCloseRefill(false);
    setCloseReason("");
    setPrintHtml("");
    if (next === "dispense") await read(() => loadChoices());
  }
  const locked = disabled || busy || operation.dirty;
  async function review() {
    await read(async () => {
      if (!mode) throw new Error("Choose fulfillment action");
      const freshCurrent = await api.read();
      if (!freshCurrent) throw new Error("Refresh required");
      if (!alive.current) return;
      setCurrent(freshCurrent);
      setObservedRevision(evidenceRevision);
      const base = { authorization_id: authorization.id, pet_id: petId };
      let evidence: Preview;
      let payload: Record<string, unknown>;
      if (mode === "dispense") {
        const refill = refillId.trim()
          ? await refillApi.read(refillId.trim(), petId)
          : null;
        if (refillId.trim() && !refill) throw new Error("Refill unavailable");
        const target = dispenseTargetSchema.parse({
          ...base,
          slot_index:
            freshCurrent.open_slot?.index ?? freshCurrent.usage.used_fill_slots,
          expected_slot_version: freshCurrent.open_slot?.version ?? null,
          invoice_id: invoiceId,
          quantity,
          allocations: allocations
            .map((a) => ({ lot_id: a.lotId, quantity: a.quantity }))
            .sort((a, b) => a.lot_id.localeCompare(b.lot_id)),
          refill: refill
            ? { id: refill.refill.id, expected_version: refill.refill.version }
            : null,
        });
        evidence = await api.previewDispense(target);
        payload = dispenseRequestSchema.parse({
          ...target,
          expected_context_hash: evidence.context_hash,
          reason,
          attest_alert_review: true,
          attest_dispense_review: true,
        });
      } else if (mode === "close_slot") {
        if (!freshCurrent.open_slot) throw new Error("No open slot");
        evidence = await api.previewClose(freshCurrent.open_slot.index);
        payload = closeSlotRequestSchema.parse({
          ...base,
          slot_index: freshCurrent.open_slot.index,
          expected_slot_version: freshCurrent.open_slot.version,
          expected_context_hash: evidence.context_hash,
          reason,
          attest_forfeit: true,
        });
      } else {
        if (!selected) throw new Error("Select saved dispense");
        const refill =
          closeRefill && selected.refill_id
            ? await refillApi.read(selected.refill_id, petId)
            : null;
        if (closeRefill && !refill)
          throw new Error("Original refill unavailable");
        const refillClose = refill
          ? {
              id: refill.refill.id,
              expected_version: refill.refill.version,
              reason: closeReason,
            }
          : null;
        evidence = await api.previewPickup(selected.id, refillClose);
        payload = pickupRequestSchema.parse({
          ...base,
          dispense_id: selected.id,
          expected_context_hash: evidence.context_hash,
          recipient_name: recipient,
          recipient_relationship: relationship,
          reason,
          attest_handoff: true,
          refill_close: refillClose,
        });
      }
      if (!alive.current) return;
      setPreview(evidence);
      setAck(false);
      operation.review({ id: crypto.randomUUID(), kind: mode, payload });
    });
  }
  async function more(kind: keyof History) {
    await read(async () => {
      const page = await api.history(kind, cursors[kind]);
      if (!alive.current) return;
      setHistory((previous) => ({
        ...previous,
        [kind]: [
          ...previous[kind],
          ...(page[kind] as Array<
            NativeDispense | NativeSlotClosure | NativePickup
          >),
        ],
      }));
      setCursors((previous) => ({
        ...previous,
        [kind]: page.next_cursor as FulfillmentCursor | null,
      }));
    });
  }
  async function print(d: NativeDispense, openWindow: boolean) {
    const win = openWindow ? window.open("", "_blank") : null;
    if (win) {
      win.opener = null;
      popup.current = win;
    } else if (openWindow) {
      setError("Allow popups to print a freshly checked label.");
      return;
    }
    await read(async () => {
      try {
        const { data, error } = await (
          supabase as unknown as PrescriptionRpc
        ).rpc("read_native_prescription_print", {
          p_authorization_id: authorization.id,
          p_dispense_id: d.id,
        });
        if (error) throw error;
        if (!alive.current) {
          win?.close();
          return;
        }
        const bundle = data as { prescription?: unknown; dispense?: unknown };
        const canonical = (value: unknown): string =>
          JSON.stringify(
            value && typeof value === "object"
              ? Array.isArray(value)
                ? value.map((v) => JSON.parse(canonical(v)))
                : Object.fromEntries(
                    Object.entries(value)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => [k, JSON.parse(canonical(v))]),
                  )
              : value,
          );
        if (
          canonical(bundle.prescription) !==
            canonical(authorization.artifact) ||
          canonical(bundle.dispense) !== canonical(d.artifact)
        )
          throw new Error("Print differs from selected immutable dispense");
        const html = renderReviewedPrescriptionCopy(data, {
          patientId: petId,
          authorizationId: authorization.id,
          dispenseId: d.id,
        });
        setPrintHtml(html);
        if (win) {
          win.document.open();
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
      } catch (failure) {
        win?.close();
        throw failure;
      }
    });
  }
  const status = current?.authorization.state;
  const eligible =
    loaded &&
    !evidenceStale &&
    status === "active" &&
    !inactive &&
    authorization.artifact.fulfillment_mode === "practice_stock" &&
    current?.usage.unopened_fill_slots !== null &&
    (current?.open_slot !== null ||
      (current?.usage.unopened_fill_slots ?? 0) > 0);
  return (
    <section
      className="space-y-4 rounded-md border p-4"
      aria-label="Prescription fulfillment"
    >
      <h3 className="font-semibold">Dispensing and pickup</h3>
      {evidenceStale && (
        <p role="status">
          Fulfillment evidence needs refresh after a saved change. Displayed
          status and quantities may be stale; pending requests are retained.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Each recorded dispense uses stock and adds one draft invoice charge.
        Pickup records physical handoff only. Signed directions and allowance
        cannot be changed here.
      </p>
      {busy && <p role="status">Loading fulfillment evidence…</p>}
      {error && (
        <p role="alert" className="text-clinical-alert">
          {error}
        </p>
      )}
      {current && (
        <div className="space-y-1 text-sm">
          <p>
            Current order status: <strong>{status?.toUpperCase()}</strong>
          </p>
          {status !== "active" && (
            <p className="text-clinical-alert">
              This order does not permit new dispensing. Historical pickup and
              remainder forfeiture may still be recorded after review.
            </p>
          )}
          <p>
            Native quantity dispensed: {current.usage.dispensed_quantity}{" "}
            {authorization.artifact.unit} · forfeited:{" "}
            {current.usage.forfeited_quantity} · slots used:{" "}
            {current.usage.used_fill_slots}
          </p>
          {current.usage.allowance_basis === "external_unknown" ? (
            <p>External pharmacy use and remaining allowance are unknown.</p>
          ) : (
            <p>
              Unopened slots: {current.usage.unopened_fill_slots} · remaining
              mathematical allowance: {current.usage.remaining_quantity}{" "}
              {authorization.artifact.unit}. Current order status controls
              whether it may be used.
            </p>
          )}
          {current.open_slot && (
            <p>
              Open fill {current.open_slot.index + 1}:{" "}
              {current.open_slot.remaining_quantity}{" "}
              {authorization.artifact.unit} remains.
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={dirty || disabled || busy}
          onClick={() => void refresh()}
        >
          Refresh fulfillment history
        </Button>
        <Button
          disabled={dirty || disabled || busy || !eligible}
          onClick={() => void begin("dispense")}
        >
          Record a dispense
        </Button>
        <Button
          variant="outline"
          disabled={
            dirty || disabled || busy || !current?.open_slot || evidenceStale
          }
          onClick={() => void begin("close_slot")}
        >
          Forfeit open fill remainder
        </Button>
      </div>
      {mode && (
        <section
          className="space-y-3 rounded border p-3"
          aria-label="Fulfillment editor"
        >
          <h4 className="font-medium">
            {mode === "dispense"
              ? "Prepare a dispense"
              : mode === "close_slot"
                ? "Close this fill and forfeit its remainder"
                : "Record physical pickup"}
          </h4>
          <fieldset disabled={locked} className="space-y-3">
            {mode === "dispense" && (
              <>
                <p className="text-sm">
                  Choose the exact draft invoice and lots. Quantities must be
                  explicitly entered; the review will confirm current stock,
                  prices and patient alerts.
                </p>
                <Label htmlFor="fill-invoice">Draft household invoice</Label>
                <select
                  id="fill-invoice"
                  className={selectClass}
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                >
                  <option value="">Select a draft invoice</option>
                  {invoiceId && !invoices.some((i) => i.id === invoiceId) && (
                    <option value={invoiceId}>
                      Selected invoice · {invoiceId}
                    </option>
                  )}
                  {invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.created_at} · {i.id}
                    </option>
                  ))}
                </select>
                {!invoices.length && (
                  <p>
                    No draft invoices found. Create a household draft invoice
                    before dispensing.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={invoicePage === 0}
                    onClick={() =>
                      void read(() => loadChoices(invoicePage - 1))
                    }
                  >
                    Previous invoices
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!moreInvoices}
                    onClick={() =>
                      void read(() => loadChoices(invoicePage + 1))
                    }
                  >
                    Next invoices
                  </Button>
                </div>
                <Label htmlFor="fill-quantity">
                  Total quantity to dispense
                </Label>
                <Input
                  id="fill-quantity"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <Label htmlFor="fill-lot-search">
                  Find lots for this signed product
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="fill-lot-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void read(() => loadChoices(invoicePage))}
                  >
                    Search lots
                  </Button>
                </div>
                {availableLots.length > 100 && (
                  <p role="status">
                    Showing the first 100 matching lots. Refine the search to
                    find another lot.
                  </p>
                )}
                {allocations.map((allocation, i) => (
                  <div
                    key={i}
                    className="grid gap-2 md:grid-cols-[2fr_1fr_auto]"
                  >
                    <div>
                      <Label htmlFor={`fill-lot-${i}`}>Lot {i + 1}</Label>
                      <select
                        id={`fill-lot-${i}`}
                        className={selectClass}
                        value={allocation.lotId}
                        onChange={(e) =>
                          setAllocations((previous) =>
                            previous.map((a, n) =>
                              n === i ? { ...a, lotId: e.target.value } : a,
                            ),
                          )
                        }
                      >
                        <option value="">Select a lot</option>
                        {allocation.lotId &&
                          !availableLots
                            .slice(0, 100)
                            .some((l) => l.id === allocation.lotId) && (
                            <option value={allocation.lotId}>
                              {knownLots[allocation.lotId]?.lot_number ??
                                "Selected lot"}{" "}
                              · {allocation.lotId}
                            </option>
                          )}
                        {availableLots.slice(0, 100).map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.lot_number} · expires {l.expires_on} ·{" "}
                            {l.location}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`fill-lot-quantity-${i}`}>
                        Quantity from lot {i + 1}
                      </Label>
                      <Input
                        id={`fill-lot-quantity-${i}`}
                        inputMode="decimal"
                        value={allocation.quantity}
                        onChange={(e) =>
                          setAllocations((previous) =>
                            previous.map((a, n) =>
                              n === i ? { ...a, quantity: e.target.value } : a,
                            ),
                          )
                        }
                      />
                    </div>
                    <Button
                      variant="outline"
                      disabled={allocations.length === 1}
                      onClick={() =>
                        setAllocations((previous) =>
                          previous.filter((_, n) => n !== i),
                        )
                      }
                    >
                      Remove lot {i + 1}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={allocations.length >= 100}
                  onClick={() =>
                    setAllocations((previous) => [
                      ...previous,
                      { lotId: "", quantity: "" },
                    ])
                  }
                >
                  Add another lot
                </Button>
                <Label htmlFor="fill-refill">
                  Linked refill request reference (optional)
                </Label>
                <Input
                  id="fill-refill"
                  value={refillId}
                  onChange={(e) => setRefillId(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  An existing request must already link to this exact order.
                  Recording a dispense leaves that request open.
                </p>
              </>
            )}
            {mode === "close_slot" && (
              <p className="text-sm text-clinical-alert">
                The remaining {current?.open_slot?.remaining_quantity}{" "}
                {authorization.artifact.unit} in fill{" "}
                {(current?.open_slot?.index ?? 0) + 1} will be forfeited. It
                cannot be reopened or carried into another fill. Stock and
                billing are unchanged.
              </p>
            )}
            {mode === "pickup" && (
              <>
                <p>
                  {selected?.quantity} {selected?.unit} dispensed on{" "}
                  {selected?.dispensed_at}
                </p>
                <Label htmlFor="pickup-recipient">Recipient name</Label>
                <Input
                  id="pickup-recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
                <Label htmlFor="pickup-relationship">
                  Recipient relationship
                </Label>
                <Input
                  id="pickup-relationship"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                />
                <p className="text-sm">
                  Recipient details are manually recorded, not independently
                  verified. This does not dispense, debit stock or bill again.
                </p>
                {selected?.refill_id && (
                  <>
                    <label className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={closeRefill}
                        onChange={(e) => setCloseRefill(e.target.checked)}
                      />
                      Close the originally linked refill request
                    </label>
                    {closeRefill && (
                      <>
                        <Label htmlFor="pickup-refill-reason">
                          Reason to close refill request
                        </Label>
                        <Textarea
                          id="pickup-refill-reason"
                          value={closeReason}
                          onChange={(e) => setCloseReason(e.target.value)}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <Label htmlFor="fill-reason">
              Reason for this fulfillment record
            </Label>
            <Textarea
              id="fill-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </fieldset>
          {!operation.dirty && (
            <div className="flex gap-2">
              <Button disabled={disabled || busy} onClick={() => void review()}>
                Review fulfillment evidence
              </Button>
              <Button
                variant="outline"
                disabled={disabled || busy}
                onClick={() => {
                  setMode(null);
                  setPreview(null);
                  setAck(false);
                }}
              >
                Discard fulfillment edits
              </Button>
            </div>
          )}
        </section>
      )}
      {preview && (
        <section
          className="space-y-3 rounded border p-3"
          aria-label="Frozen fulfillment review"
        >
          <h4 className="font-medium">Review exact fulfillment evidence</h4>
          <p>
            {authorization.artifact.patient.name} ·{" "}
            {authorization.artifact.household.name} ·{" "}
            {authorization.artifact.medication.name}
          </p>
          <p className="whitespace-pre-wrap">
            Signed directions: {authorization.artifact.medication.directions}
          </p>
          <p>
            Current reviewed order status:{" "}
            <strong>{preview.context.authorization.state.toUpperCase()}</strong>
          </p>
          {preview.context.authorization.state !== "active" && (
            <p className="text-clinical-alert">
              This order is not active. Confirm that this records historical
              handoff or forfeiture only.
            </p>
          )}
          {"charge" in preview.context && (
            <>
              <p>
                {preview.context.charge.quantity} {preview.context.product.unit}{" "}
                · charge {cents(preview.context.charge.amount_cents)} · draft
                invoice total after charge{" "}
                {cents(preview.context.charge.projected_invoice_total_cents)}
              </p>
              <p>
                Invoice {preview.context.invoice.id} · stock product{" "}
                {preview.context.product.name}
              </p>
              {preview.context.lots.map((l) => (
                <p key={l.id}>
                  Lot {l.lot_number} · {l.quantity} of {l.balance} available ·
                  expires {l.expires_on} · {l.location}
                </p>
              ))}
              <h5 className="font-medium text-clinical-alert">
                Important patient alerts
              </h5>
              {preview.context.alerts.snapshot.important_problems.map((p) => (
                <p
                  key={p.id}
                  className="whitespace-pre-wrap text-clinical-alert"
                >
                  {p.title}: {p.notes}
                </p>
              ))}
              <p>
                Existing allergy text:{" "}
                {preview.context.alerts.snapshot.legacy_allergies.text ||
                  "None recorded"}
              </p>
              {preview.context.refill && (
                <p>
                  Refill request:{" "}
                  {preview.context.refill.refill.medication_requested} · remains
                  open
                </p>
              )}
            </>
          )}
          {"slot" in preview.context && !("charge" in preview.context) && (
            <p>
              Forfeit {preview.context.slot.remaining_quantity}{" "}
              {authorization.artifact.unit} from fill{" "}
              {preview.context.slot.index + 1}.
            </p>
          )}
          {"dispense" in preview.context && (
            <p>
              Pickup for {preview.context.dispense.quantity}{" "}
              {preview.context.dispense.unit}, dispensed{" "}
              {preview.context.dispense.dispensed_at}. Recipient: {recipient} (
              {relationship}).{" "}
              {closeRefill
                ? `Close original refill: ${closeReason}`
                : "Refill request remains unchanged."}
            </p>
          )}
          <p className="whitespace-pre-wrap">Reason: {reason}</p>
          {operation.state.phase === "review" && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ack}
                disabled={disabled}
                onChange={(e) => setAck(e.target.checked)}
              />
              {mode === "dispense"
                ? "I reviewed patient identity, signed directions, alerts, exact lots, quantities and invoice charge."
                : mode === "close_slot"
                  ? "I reviewed this exact fill and confirm permanently forfeiting its remainder."
                  : "I reviewed the current order warning and confirm the actual handoff and recipient details."}
            </label>
          )}
        </section>
      )}
      <fieldset disabled={disabled}>
        <PrescriptionOperationControls
          state={operation.state}
          error={operation.error}
          notice={operation.notice}
          commitLabel={
            mode === "dispense"
              ? "Confirm reviewed dispense"
              : mode === "close_slot"
                ? "Confirm remainder forfeiture"
                : "Confirm physical pickup"
          }
          reviewConfirmed={ack && !disabled && !busy}
          onCommit={operation.commit}
          onRecover={operation.recoverOriginal}
          onDiscard={() => {
            operation.discard();
            setPreview(null);
            setAck(false);
          }}
        />
      </fieldset>
      <section className="space-y-3" aria-label="Fulfillment history">
        <h4 className="font-medium">Saved dispensing history</h4>
        {loaded && !history.dispenses.length && <p>No dispensing records.</p>}
        {history.dispenses.map((d) => (
          <article key={d.id} className="space-y-2 rounded border p-3">
            <p>
              {d.quantity} {d.unit} · fill {d.slot_index + 1} · {d.dispensed_at}{" "}
              · {cents(d.amount_cents)}
            </p>
            {d.artifact.lots.map((l) => (
              <p key={l.id} className="text-sm">
                Lot {l.number} · {l.quantity} · expiry {l.expires_on}
              </p>
            ))}
            <p className="text-sm whitespace-pre-wrap">{d.reason}</p>
            <p className="break-all text-xs text-muted-foreground">
              Dispense {d.id} · invoice {d.invoice_id}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  dirty ||
                  disabled ||
                  busy ||
                  !loaded ||
                  history.pickups.some((p) => p.dispense_id === d.id)
                }
                onClick={() => void begin("pickup", d)}
              >
                Record pickup
              </Button>
              <Button
                variant="outline"
                disabled={dirty || disabled || busy}
                onClick={() => void print(d, false)}
              >
                Preview this dispense label
              </Button>
              <Button
                variant="outline"
                disabled={dirty || disabled || busy}
                onClick={() => void print(d, true)}
              >
                Print this dispense label
              </Button>
            </div>
          </article>
        ))}
        {cursors.dispenses && (
          <Button
            variant="outline"
            disabled={dirty || disabled || busy}
            onClick={() => void more("dispenses")}
          >
            Load more dispensing records
          </Button>
        )}
        <h4 className="font-medium">Fill slots</h4>
        {slots.map((s) => (
          <p key={s.id}>
            Fill {s.index + 1}: {s.state}
            {s.closure_kind ? ` (${s.closure_kind})` : ""} · dispensed{" "}
            {s.dispensed_quantity} · usable remainder {s.remaining_quantity}
          </p>
        ))}
        {slotCursor !== null && (
          <Button
            variant="outline"
            disabled={dirty || disabled || busy}
            onClick={() =>
              void read(async () => {
                const page = await api.slots(slotCursor);
                if (!alive.current) return;
                setSlots((previous) => [...previous, ...page.slots]);
                setSlotCursor(page.next_index);
              })
            }
          >
            Load more fill slots
          </Button>
        )}
        <h4 className="font-medium">Forfeiture records</h4>
        {history.closures.map((c) => (
          <p key={c.id} className="whitespace-pre-wrap">
            Fill {c.before.index + 1}: {c.forfeited_quantity} forfeited on{" "}
            {c.created_at} · {c.reason}
          </p>
        ))}
        {cursors.closures && (
          <Button
            variant="outline"
            disabled={dirty || disabled || busy}
            onClick={() => void more("closures")}
          >
            Load more forfeitures
          </Button>
        )}
        <h4 className="font-medium">Pickup acknowledgements</h4>
        {history.pickups.map((p) => (
          <div key={p.id}>
            <p>
              {p.recipient_name} ({p.recipient_relationship}) · {p.picked_up_at}
            </p>
            <p className="whitespace-pre-wrap text-sm">{p.reason}</p>
            <p className="break-all text-xs text-muted-foreground">
              Dispense {p.dispense_id}
              {p.refill_id ? ` · closed refill ${p.refill_id}` : ""}
            </p>
          </div>
        ))}
        {cursors.pickups && (
          <Button
            variant="outline"
            disabled={dirty || disabled || busy}
            onClick={() => void more("pickups")}
          >
            Load more pickups
          </Button>
        )}
      </section>
      {printHtml && (
        <section aria-label="Dispensing label copy">
          <p className="text-sm">
            This immutable dispense copy includes status at its displayed check
            time. Printing fetches status again.
          </p>
          <iframe
            title="Native dispensing label"
            sandbox=""
            srcDoc={printHtml}
            className="h-[36rem] w-full rounded border bg-background"
          />
        </section>
      )}
    </section>
  );
}
