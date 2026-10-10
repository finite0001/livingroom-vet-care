import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { errorMessage } from "../inventory/stock-policy";
import { exportWhogot, searchWhogot, searchWhogotProducts } from "./api";
import {
  emptyFilters,
  filtersSchema,
  sourceHref,
  whogotCsv,
  type WhogotFilters,
  type WhogotCursor,
} from "./model";
const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
interface PageCursor {
  cursor: WhogotCursor | null;
  asOf: string | null;
}
export default function WhogotPage() {
  usePageTitle("Whogot");
  const { session } = useAuth();
  const [params] = useSearchParams();
  const initial = filtersSchema.safeParse({
    ...emptyFilters,
    productId: params.get("product") || "",
  });
  const [draft, setDraft] = useState<WhogotFilters>(
    initial.success ? { ...emptyFilters, ...initial.data } : emptyFilters,
  );
  const [applied, setApplied] = useState<{
    filters: WhogotFilters;
    run: number;
  } | null>(null);
  const [needle, setNeedle] = useState(""),
    [debounced, setDebounced] = useState("");
  const [error, setError] = useState(""),
    [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false),
    alive = useRef(true),
    actor = useRef(session?.user.id);
  actor.current = session?.user.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(needle.trim()), 250);
    return () => clearTimeout(timer);
  }, [needle]);
  const products = useQuery({
    queryKey: ["whogot-products", session?.user.id, debounced],
    queryFn: () => searchWhogotProducts(debounced),
  });
  const results = useInfiniteQuery({
    queryKey: ["whogot", session?.user.id, applied],
    enabled: !!applied,
    initialPageParam: { cursor: null, asOf: null } as PageCursor,
    queryFn: ({ pageParam }) =>
      searchWhogot(applied!.filters, pageParam.cursor, pageParam.asOf),
    getNextPageParam: (last) =>
      last.next ? { cursor: last.next, asOf: last.as_of } : undefined,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const rows = results.data?.pages.flatMap((page) => page.rows) ?? [];
  const snapshot = results.data?.pages[0]?.as_of;
  const change = <K extends keyof WhogotFilters>(
    key: K,
    value: WhogotFilters[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const exportCsv = async () => {
    if (exportingRef.current || !applied || !snapshot || !session?.user.id)
      return;
    const userId = session.user.id;
    exportingRef.current = true;
    setExporting(true);
    setError("");
    try {
      const all = await exportWhogot(
        applied.filters,
        snapshot,
        () => alive.current && actor.current === userId,
      );
      if (!alive.current || actor.current !== userId) return;
      const url = URL.createObjectURL(
        new Blob([whogotCsv(all, snapshot)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "whogot.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (alive.current) setError(errorMessage(failure));
    } finally {
      exportingRef.current = false;
      if (alive.current) setExporting(false);
    }
  };
  return (
    <section
      className="mx-auto max-w-6xl space-y-5 p-4 md:p-6"
      aria-label="Whogot search"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Whogot</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find patients who received a vaccine, medication or service.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/hub/patients">Patients</Link>
        </Button>
      </header>
      <Card>
        <CardContent className="pt-5">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = filtersSchema.safeParse(draft);
              if (!parsed.success) {
                setError(parsed.error.issues[0].message);
                return;
              }
              setError("");
              setApplied({
                filters: { ...emptyFilters, ...parsed.data },
                run: Date.now(),
              });
            }}
          >
            <fieldset
              disabled={exporting}
              className="grid gap-4 md:grid-cols-3"
            >
              <legend className="sr-only">Search filters</legend>
              <div className="space-y-2">
                <Label htmlFor="who-product-search">Find a catalog item</Label>
                <Input
                  id="who-product-search"
                  value={needle}
                  maxLength={200}
                  placeholder="Name or previous name…"
                  onChange={(e) => setNeedle(e.target.value)}
                />
                {products.isPending && (
                  <p role="status" className="text-xs">
                    Loading catalog…
                  </p>
                )}
                {products.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    Catalog unavailable.{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void products.refetch()}
                    >
                      Retry
                    </button>
                  </p>
                )}
                {(products.data?.length ?? 0) > 100 && (
                  <p className="text-xs text-muted-foreground">
                    First 100 items. Refine the name.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-product">Product, vaccine or service</Label>
                <select
                  id="who-product"
                  className={selectClass}
                  value={draft.productId}
                  onChange={(e) => change("productId", e.target.value)}
                >
                  <option value="">All recorded items</option>
                  {draft.productId &&
                    !products.data
                      ?.slice(0, 100)
                      .some((p) => p.id === draft.productId) && (
                      <option value={draft.productId}>
                        Selected catalog item · {draft.productId}
                      </option>
                    )}
                  {products.data?.slice(0, 100).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.kind}
                      {p.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-event">Received as</Label>
                <select
                  id="who-event"
                  className={selectClass}
                  value={draft.eventType}
                  onChange={(e) =>
                    change(
                      "eventType",
                      e.target.value as WhogotFilters["eventType"],
                    )
                  }
                >
                  <option value="">All event types</option>
                  <option value="administered">Administered</option>
                  <option value="dispensed">Dispensed</option>
                  <option value="performed">Performed service</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-from">From (Denver date)</Label>
                <Input
                  id="who-from"
                  type="date"
                  value={draft.from}
                  onChange={(e) => change("from", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-to">Through (Denver date)</Label>
                <Input
                  id="who-to"
                  type="date"
                  value={draft.to}
                  onChange={(e) => change("to", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-lot">Exact lot number</Label>
                <Input
                  id="who-lot"
                  value={draft.lot}
                  maxLength={200}
                  onChange={(e) => change("lot", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-species">Species</Label>
                <select
                  id="who-species"
                  className={selectClass}
                  value={draft.species}
                  onChange={(e) => change("species", e.target.value)}
                >
                  <option value="">All species</option>
                  {["Dog", "Cat", "Other"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="who-clinician">
                  Clinician / dispensing staff name
                </Label>
                <Input
                  id="who-clinician"
                  value={draft.clinician}
                  maxLength={200}
                  onChange={(e) => change("clinician", e.target.value)}
                />
              </div>
            </fieldset>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={exporting}
                  checked={draft.includeHistorical}
                  onChange={(e) =>
                    change("includeHistorical", e.target.checked)
                  }
                />
                Include historical administration entries
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={exporting}
                  checked={draft.includeCorrected}
                  onChange={(e) => change("includeCorrected", e.target.checked)}
                />
                Include corrected originals
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Search covers practice events and manually entered historical
              administrations. Imported records remain in patient charts.
              Prescriptions and charges alone do not count. Unmapped historical
              entries appear under “All recorded items”; they are not guessed
              into a catalog item.
            </p>
            <Button type="submit" disabled={exporting}>
              <Search className="mr-2 h-4 w-4" />
              Search Whogot
            </Button>
          </form>
        </CardContent>
      </Card>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!applied && (
        <p className="text-muted-foreground">
          Choose filters and search to see received-care events.
        </p>
      )}
      {applied && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-sm">
              {results.isPending
                ? "Searching…"
                : `${rows.length} events loaded`}
              {snapshot && ` · as of ${dateTime(snapshot)} (Denver)`}
            </p>
            <Button
              variant="outline"
              disabled={
                !snapshot || !rows.length || exporting || results.isFetching
              }
              onClick={() => void exportCsv()}
            >
              <Download className="mr-2 h-4 w-4" />
              {exporting ? "Exporting…" : "Export all matches CSV"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Results reflect the last submitted filters. Each row is one event; a
            patient may appear more than once. Refresh the search to include
            later entries or corrections.
          </p>
          {results.isError && (
            <p role="alert" className="text-destructive">
              {errorMessage(results.error)}{" "}
              <button
                className="underline"
                onClick={() => void results.refetch()}
              >
                Retry search
              </button>
            </p>
          )}
          {results.isSuccess && !rows.length && (
            <p>
              No matching events recorded. This does not establish that care was
              never given.
            </p>
          )}
          <div className="grid gap-3">
            {rows.map((row) => (
              <article
                key={`${row.event_type}:${row.id}`}
                className="grid min-w-0 gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_1fr_auto]"
              >
                <div className="min-w-0">
                  <Link
                    to={`/hub/patient/${row.pet_id}`}
                    className="font-display text-lg text-primary hover:underline"
                  >
                    {row.patient_name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {row.species}
                    {row.deceased_at
                      ? " · Deceased"
                      : row.archived_at
                        ? " · Archived"
                        : ""}
                  </p>
                  <Link
                    to={`/hub/client/${row.client_id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {row.client_name}
                  </Link>
                  <p className="break-words text-sm">
                    {row.phone || "Phone not recorded"}
                    <br />
                    {row.email || "Email not recorded"}
                  </p>
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="break-words font-medium">{row.product_name}</p>
                  <p className="text-sm">
                    {dateTime(row.occurred_at)} ·{" "}
                    {row.clinician || "Staff not recorded"}
                  </p>
                  {row.lots && (
                    <p className="break-words text-sm">Lot: {row.lots}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{row.event_type}</Badge>
                    {row.historical && (
                      <Badge variant="outline">Historical entry</Badge>
                    )}
                    {row.correction_status !== "current" && (
                      <Badge variant="outline">
                        {row.correction_status === "corrected"
                          ? "Corrected original"
                          : "Has annotations"}
                      </Badge>
                    )}
                  </div>
                  {row.correction_reason && (
                    <p className="break-words text-sm">
                      Correction: {row.correction_reason}
                    </p>
                  )}
                  {row.source_note && (
                    <p className="break-words text-xs text-muted-foreground">
                      {row.source_note}
                    </p>
                  )}
                </div>
                <div className="min-w-0">
                  <Button asChild size="sm" variant="outline">
                    <Link to={sourceHref(row)}>Open source record</Link>
                  </Button>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    {row.id}
                  </p>
                </div>
              </article>
            ))}
          </div>
          {results.hasNextPage && (
            <Button
              variant="outline"
              disabled={results.isFetchingNextPage || exporting}
              onClick={() => void results.fetchNextPage()}
            >
              {results.isFetchingNextPage ? "Loading…" : "Load more events"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
