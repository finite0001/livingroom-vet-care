import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hub/contexts/auth-context";
import { products } from "../api";
import {
  centsValue,
  errorMessage,
  isDefinitiveRejection,
} from "../stock-policy";
import {
  configureSourceItem,
  linkSourceProduct,
  searchSourceItems,
} from "./api";
import {
  configureSourceSchema,
  type ConfigureSource,
  type SourceItem,
} from "./model";

const selectClass =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const pendingSourceRequests = new Map<string, ConfigureSource>();

interface SourceFormProps {
  source: SourceItem;
  onSaved: () => void;
  onClose: () => void;
}
function SourceForm({ source, onSaved, onClose }: SourceFormProps) {
  const { session } = useAuth();
  const storageKey = `${session?.user.id}:${source.id}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(
    pendingSourceRequests.has(storageKey),
  );
  const [existingSearch, setExistingSearch] = useState("");
  const pending = useRef<ConfigureSource | null>(
    pendingSourceRequests.get(storageKey) ?? null,
  );
  const locked = useRef(false);
  useEffect(() => {
    if (!busy && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, uncertain]);
  const existing = useQuery({
    queryKey: ["inventory", "setup-existing", session?.user.id, existingSearch],
    queryFn: () => products(existingSearch),
    enabled: Boolean(existingSearch.trim()),
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || !session?.user.id) return;
    const form = event.currentTarget;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (pending.current && pending.current.p_actor_id !== session.user.id)
        throw new Error("Sign in with the account that started this product.");
      if (!pending.current) {
        const data = new FormData(form);
        pending.current = configureSourceSchema.parse({
          p_actor_id: session.user.id,
          p_source_id: source.id,
          p_id: crypto.randomUUID(),
          p_name: String(data.get("name")),
          p_kind: String(data.get("kind")),
          p_manufacturer: String(data.get("manufacturer")),
          p_unit: String(data.get("unit")),
          p_unit_price_cents: centsValue(String(data.get("price"))),
        });
        pendingSourceRequests.set(storageKey, pending.current);
      }
      await configureSourceItem(pending.current);
      pending.current = null;
      pendingSourceRequests.delete(storageKey);
      setUncertain(false);
      onSaved();
    } catch (failure) {
      const hasPending = Boolean(pending.current);
      const ambiguous = hasPending && !isDefinitiveRejection(failure);
      if (!ambiguous) {
        pending.current = null;
        pendingSourceRequests.delete(storageKey);
      }
      setUncertain(ambiguous);
      setError(
        errorMessage(failure) +
          (ambiguous
            ? " Outcome unconfirmed. Retry the same product; check this source row before re-entering it after leaving this page."
            : ""),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function link(productId: string) {
    if (locked.current || pending.current || !session?.user.id) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await linkSourceProduct(session.user.id, source.id, productId);
      onSaved();
    } catch (failure) {
      setError(
        errorMessage(failure) + " Linking the same product again is safe.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="font-medium">Set up {source.name}</h3>
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        {Object.entries(source.source_fields).map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Create a separate product for each exact strength and form you will
        stock. Set the unit before receiving stock; it cannot be changed later.
        Supply and retail rows can remain drafts while their catalog type is set
        up.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <fieldset
          disabled={busy || uncertain}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="source-product-name">
              Exact product name and strength
            </Label>
            <Input
              id="source-product-name"
              name="name"
              required
              maxLength={200}
              defaultValue={pending.current?.p_name ?? source.name}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="source-product-kind">Product type</Label>
            <select
              id="source-product-kind"
              name="kind"
              className={selectClass}
              defaultValue={
                pending.current?.p_kind ??
                (source.source_tab === "Vax" ? "vaccine" : "medication")
              }
            >
              <option value="medication">Medication</option>
              <option value="vaccine">Vaccine</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="source-product-manufacturer">Manufacturer</Label>
            <Input
              id="source-product-manufacturer"
              name="manufacturer"
              maxLength={200}
              defaultValue={pending.current?.p_manufacturer}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="source-product-unit">
              Stock unit (tablet, dose, mL)
            </Label>
            <Input
              id="source-product-unit"
              name="unit"
              required
              maxLength={50}
              defaultValue={pending.current?.p_unit}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="source-product-price">
              Price per stock unit (USD)
            </Label>
            <Input
              id="source-product-price"
              name="price"
              required
              inputMode="decimal"
              defaultValue={
                pending.current
                  ? (pending.current.p_unit_price_cents / 100).toFixed(2)
                  : ""
              }
            />
          </div>
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Creates an active catalog product. Receive its actual lot and quantity
          separately. No stock or treatment is recorded here.
        </p>
        <Button disabled={busy || !session?.user.id}>
          {busy
            ? "Saving…"
            : uncertain
              ? "Retry same product"
              : "Create exact product"}
        </Button>
      </form>
      <details>
        <summary className="cursor-pointer font-medium">
          Link an existing product instead
        </summary>
        <div className="mt-3 space-y-2">
          <Label htmlFor="source-existing-search">
            Search existing catalog
          </Label>
          <Input
            id="source-existing-search"
            maxLength={200}
            value={existingSearch}
            disabled={busy || uncertain}
            onChange={(e) => setExistingSearch(e.target.value)}
          />
          {existing.isFetching && <p role="status">Searching catalog…</p>}
          {existing.error && <p role="alert">{errorMessage(existing.error)}</p>}
          {existing.data?.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span>
                {p.name} · {p.unit}
                {!p.active && " · inactive"}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={busy || uncertain}
                onClick={() => void link(p.id)}
              >
                Link product
              </Button>
            </div>
          ))}
          {existing.data?.length === 0 && <p>No matching products.</p>}
          {(existing.data?.length ?? 0) > 100 && (
            <p>Showing the first 101 matches. Narrow your search.</p>
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy || uncertain}
        onClick={onClose}
      >
        Close setup
      </Button>
    </div>
  );
}

export function CatalogSetupPanel() {
  const { session } = useAuth();
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SourceItem | null>(null);
  const [message, setMessage] = useState("");
  const sources = useQuery({
    queryKey: ["inventory", "source-items", session?.user.id, search],
    queryFn: () => searchSourceItems(search),
  });
  const saved = () => {
    setSelected(null);
    setMessage(
      "Catalog product linked. Receive stock when its lot, expiration and quantity are known.",
    );
    void cache.invalidateQueries({ queryKey: ["inventory"] });
    void cache.invalidateQueries({ queryKey: ["whogot-products"] });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Susan’s inventory · catalog drafts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          217 source rows from November 10, 2026. Search a name, category or
          strength, then create exact products or link existing ones. A source
          row can have several variants.
        </p>
        <a
          className="text-sm underline"
          href="https://docs.google.com/spreadsheets/d/1O1FTZ8fjYHwyMt01I8DAyHjm-iCDfOtL7k44dSaDP6Q/edit"
          target="_blank"
          rel="noreferrer"
        >
          Open Susan’s source sheet
        </a>
        <div className="space-y-1">
          <Label htmlFor="catalog-source-search">Search catalog drafts</Label>
          <Input
            id="catalog-source-search"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {sources.isPending && <p role="status">Loading catalog drafts…</p>}
        {sources.error && (
          <p role="alert" className="text-destructive">
            {errorMessage(sources.error)}
          </p>
        )}
        {sources.isSuccess && (
          <p className="text-sm">
            {sources.data.length} matching source rows. Linked products appear
            below each draft.
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {selected && (
          <SourceForm
            key={`${session?.user.id}:${selected.id}`}
            source={selected}
            onSaved={saved}
            onClose={() => setSelected(null)}
          />
        )}
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {sources.data?.map((source) => (
            <div key={source.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{source.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {source.source_tab} · source row {source.source_row}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {source.products.length
                      ? `${source.products.length} linked product(s)`
                      : "Draft · unit and price needed"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={Boolean(selected)}
                  onClick={() => {
                    setSelected(source);
                    setMessage("");
                  }}
                >
                  Set up variants
                </Button>
              </div>
              {source.products.map((p) => (
                <p key={p.id} className="mt-2 text-sm">
                  {p.name}
                  {!p.active && " · inactive"} ·{" "}
                  <Link
                    className="underline"
                    to={`/hub/whogot?product=${p.id}`}
                  >
                    Find patients who received this
                  </Link>
                </p>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
