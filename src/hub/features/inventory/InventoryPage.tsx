import { cloneElement, useId, useState, type ReactElement } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { products, lots, type Product, type LotBalance } from "./api";
import { useStockMutation } from "./useStockMutation";
import {
  centsValue,
  quantityValue,
  denverDate,
  errorMessage,
  practiceTimestamp,
} from "./stock-policy";
const selectClass =
  "h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm";
interface FieldProps {
  label: string;
  children: ReactElement<{ id?: string }>;
}
export function StockField({ label, children }: FieldProps) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
    </div>
  );
}
function MutationStatus({
  state,
}: {
  state: ReturnType<typeof useStockMutation>;
}) {
  return (
    <>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.success}
        </p>
      )}
    </>
  );
}
function CatalogForm({
  product,
  close,
}: {
  product: Product | null;
  close: () => void;
}) {
  const state = useStockMutation("catalog");
  const [validation, setValidation] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.uncertain) {
      const form = event.currentTarget;
      if (await state.retry()) form.reset();
      return;
    }
    setValidation("");
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const fields = {
        p_name: String(values.get("name")),
        p_kind: String(values.get("kind")),
        p_manufacturer: String(values.get("manufacturer")),
        p_unit: String(values.get("unit")),
        p_unit_price_cents: centsValue(String(values.get("price"))),
      };
      const args = product
        ? {
            ...fields,
            p_id: product.id,
            p_expected_version: product.version,
            p_active: values.get("active") === "on",
          }
        : { ...fields, p_id: crypto.randomUUID() };
      if (
        await state.run(
          product ? "save_catalog_product" : "create_inventory_product",
          args,
        )
      ) {
        form.reset();
        close();
      }
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={state.locked} className="grid min-w-0 gap-3 md:grid-cols-2">
        <StockField label="Product name">
          <Input
            name="name"
            required
            maxLength={200}
            defaultValue={product?.name}
          />
        </StockField>
        <StockField label="Product type">
          <select
            name="kind"
            className={selectClass}
            defaultValue={product?.kind ?? "medication"}
          >
            {["medication", "vaccine", "service"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </StockField>
        <StockField label="Manufacturer">
          <Input
            name="manufacturer"
            maxLength={200}
            defaultValue={product?.manufacturer}
          />
        </StockField>
        <StockField label="Stock unit (e.g. tablet, dose, mL)">
          <Input
            name="unit"
            required
            maxLength={50}
            defaultValue={product?.unit}
          />
        </StockField>
        <StockField label="Price per unit (USD)">
          <Input
            name="price"
            inputMode="decimal"
            required
            defaultValue={
              product ? (product.unit_price_cents / 100).toFixed(2) : ""
            }
          />
        </StockField>
        {product && (
          <label className="flex items-center gap-2">
            <input
              name="active"
              type="checkbox"
              defaultChecked={product.active}
            />
            Active product
          </label>
        )}
      </fieldset>
      {product && (
        <p className="text-xs text-muted-foreground">
          Type and stock unit cannot change after creation. Deactivate and
          create a new product when those change.
        </p>
      )}
      {validation && (
        <p role="alert" className="text-destructive">
          {validation}
        </p>
      )}
      <MutationStatus state={state} />
      <Button disabled={state.busy}>
        {state.uncertain
          ? "Retry same product request"
          : product
            ? "Save product"
            : "Create product"}
      </Button>
    </form>
  );
}
function ReceiveForm({ catalog }: { catalog: Product[] }) {
  const state = useStockMutation("receive");
  const [validation, setValidation] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.uncertain) {
      const form = event.currentTarget;
      if (await state.retry()) form.reset();
      return;
    }
    setValidation("");
    const form = event.currentTarget;
    const v = new FormData(form);
    try {
      const { data: existing, error } = await supabase
        .from("inventory_lots")
        .select("id")
        .eq("product_id", String(v.get("product")))
        .eq("lot_number", String(v.get("lot")))
        .eq("expires_on", String(v.get("expiry")))
        .eq("location", String(v.get("location")))
        .maybeSingle();
      if (error) throw error;
      if (
        await state.run("receive_inventory", {
          p_id: crypto.randomUUID(),
          p_lot_id: existing?.id ?? crypto.randomUUID(),
          p_product_id: String(v.get("product")),
          p_lot_number: String(v.get("lot")),
          p_expires_on: String(v.get("expiry")),
          p_location: String(v.get("location")),
          p_quantity: quantityValue(String(v.get("quantity"))),
          p_reason: String(v.get("reason")),
        })
      )
        form.reset();
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={state.locked} className="grid min-w-0 gap-3 md:grid-cols-2">
        <StockField label="Stock product">
          <select name="product" className={selectClass} required>
            <option value="">Select product</option>
            {catalog
              .filter((p) => p.active && p.kind !== "service")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.unit})
                </option>
              ))}
          </select>
        </StockField>
        <StockField label="Lot number">
          <Input name="lot" required maxLength={200} />
        </StockField>
        <StockField label="Expiration date">
          <Input name="expiry" type="date" required />
        </StockField>
        <StockField label="Stock location">
          <Input
            name="location"
            required
            maxLength={200}
            placeholder="Clinic or housecall kit"
          />
        </StockField>
        <StockField label="Quantity received">
          <Input name="quantity" inputMode="decimal" required />
        </StockField>
        <StockField label="Receipt reason">
          <Input
            name="reason"
            required
            maxLength={2000}
            placeholder="Supplier delivery / opening count"
          />
        </StockField>
      </fieldset>
      {validation && (
        <p role="alert" className="text-destructive">
          {validation}
        </p>
      )}
      <MutationStatus state={state} />
      <Button disabled={state.busy}>
        {state.uncertain ? "Retry same receipt" : "Receive stock"}
      </Button>
    </form>
  );
}
function AdjustmentForm({ lot }: { lot: LotBalance }) {
  const state = useStockMutation(`adjust:${lot.id}`);
  const [validation, setValidation] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.uncertain) {
      const form = event.currentTarget;
      if (await state.retry()) form.reset();
      return;
    }
    const form = event.currentTarget;
    const v = new FormData(form);
    setValidation("");
    try {
      if (
        await state.run("adjust_inventory", {
          p_id: crypto.randomUUID(),
          p_lot_id: lot.id,
          p_quantity: quantityValue(String(v.get("quantity")), true),
          p_reason: String(v.get("reason")),
        })
      )
        form.reset();
    } catch (error) {
      setValidation(errorMessage(error));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="font-medium">
        {lot.product_name} · {lot.lot_number} · {lot.location}
      </p>
      <p className="text-sm text-muted-foreground">
        Use a negative quantity for waste or loss. Positive adjustments require
        a verified physical count or return. Billing credits never return stock
        automatically.
      </p>
      <fieldset disabled={state.locked} className="grid min-w-0 gap-3 md:grid-cols-2">
        <StockField label="Signed stock adjustment">
          <Input
            name="quantity"
            required
            inputMode="decimal"
            placeholder="-1"
          />
        </StockField>
        <StockField label="Adjustment reason">
          <Input name="reason" required maxLength={2000} />
        </StockField>
      </fieldset>
      {validation && (
        <p role="alert" className="text-destructive">
          {validation}
        </p>
      )}
      <MutationStatus state={state} />
      <Button disabled={state.busy}>
        {state.uncertain ? "Retry same adjustment" : "Record adjustment"}
      </Button>
    </form>
  );
}
export function InventoryPage() {
  const [search, setSearch] = useState("");
  const [lotSearch, setLotSearch] = useState("");
  const [editing, setEditing] = useState<Product | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [selectedLot, setSelectedLot] = useState<LotBalance | null>(null);
  const catalog = useQuery({
    queryKey: ["inventory", "products", search],
    queryFn: () => products(search),
  });
  const stock = useQuery({
    queryKey: ["inventory", "lots", lotSearch],
    queryFn: () => lots(lotSearch),
  });
  const ledger = useQuery({
    queryKey: ["inventory", "ledger", selectedLot?.id],
    enabled: !!selectedLot,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("*")
        .eq("lot_id", selectedLot!.id)
        .order("created_at", { ascending: false })
        .limit(51);
      if (error) throw error;
      return data;
    },
  });
  const rows = catalog.data?.slice(0, 100) ?? [];
  const lotRows = stock.data?.slice(0, 100) ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-muted-foreground">
          Medication and vaccine stock by lot, expiry and location.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Product catalog</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Label htmlFor="catalog-search">Search products</Label>
          <Input
            id="catalog-search"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
          {catalog.isPending && <p role="status">Loading products…</p>}
          {catalog.error && (
            <p role="alert" className="text-destructive">
              {errorMessage(catalog.error)}
            </p>
          )}
          {(catalog.data?.length ?? 0) > 100 && (
            <p>Showing 100 results. Narrow your search.</p>
          )}
          <div className="grid min-w-0 gap-2 md:grid-cols-2">
            {rows.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <p className="font-medium">
                    {p.name}
                    {!p.active && " · inactive"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.kind} · ${(p.unit_price_cents / 100).toFixed(2)} /{" "}
                    {p.unit}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(p);
                    setFormKey((k) => k + 1);
                  }}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>
          <h2 className="font-semibold">
            {editing ? `Edit ${editing.name}` : "New product"}
          </h2>
          <CatalogForm
            key={formKey}
            product={editing}
            close={() => {
              setEditing(null);
              setFormKey((k) => k + 1);
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Receive stock</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Product options follow the catalog search above. For an existing
            lot, enter its exact number, expiration and location.
          </p>
          <ReceiveForm catalog={rows} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Lot balances</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Label htmlFor="lot-search">Search product, lot or location</Label>
          <Input
            id="lot-search"
            value={lotSearch}
            maxLength={200}
            onChange={(e) => setLotSearch(e.target.value)}
          />
          {stock.isPending && <p role="status">Loading balances…</p>}
          {stock.error && (
            <p role="alert" className="text-destructive">
              {errorMessage(stock.error)}
            </p>
          )}
          {(stock.data?.length ?? 0) > 100 && (
            <p>Showing 100 lots. Narrow your search.</p>
          )}
          {lotRows.map((l) => (
            <div
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <p className="font-medium">
                  {l.product_name} · lot {l.lot_number}
                </p>
                <p className="text-sm">
                  {l.balance} {l.unit} · {l.location} · expires {l.expires_on}
                </p>
                {l.expires_on < denverDate() && (
                  <p className="text-sm font-semibold text-destructive">
                    Expired — cannot dispense
                  </p>
                )}
              </div>
              <Button variant="outline" onClick={() => setSelectedLot(l)}>
                Adjust count
              </Button>
            </div>
          ))}
          {selectedLot && (
            <>
              <AdjustmentForm key={selectedLot.id} lot={selectedLot} />
              <h3 className="font-semibold">Recent lot movements</h3>
              {ledger.error && (
                <p role="alert" className="text-destructive">
                  {errorMessage(ledger.error)}
                </p>
              )}
              {ledger.data?.slice(0, 50).map((m) => (
                <p key={m.id} className="text-sm">
                  {practiceTimestamp(m.created_at)} ·{" "}
                  {m.quantity > 0 ? "+" : ""}
                  {m.quantity} · {m.kind === "native_return" ? "Reviewed return to stock" : m.kind} · {m.reason}
                </p>
              ))}
              {(ledger.data?.length ?? 0) > 50 && (
                <p className="text-sm text-muted-foreground">
                  Showing the 50 newest movements. Lot balance includes the
                  complete ledger.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
