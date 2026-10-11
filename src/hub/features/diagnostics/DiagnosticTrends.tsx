import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import * as api from "./api";
import { comparableSeries, plotPoints } from "./trends";
interface Props {
  petId: string;
  disabled: boolean;
  onOpen: (id: string) => void;
}
export function DiagnosticTrends({ petId, disabled, onOpen }: Props) {
  const [selected, setSelected] = useState("");
  const result = useInfiniteQuery({
    queryKey: ["diagnostic-trends", petId],
    initialPageParam: null as { after: string; hash: string } | null,
    queryFn: ({ pageParam }) => api.trends(petId, pageParam),
    getNextPageParam: (p) =>
      p.next ? { after: p.next, hash: p.census_hash } : undefined,
  });
  let error = "",
    series: ReturnType<typeof comparableSeries> = [];
  try {
    series = comparableSeries(result.data?.pages.flatMap((p) => p.items) ?? []);
  } catch {
    error = "Diagnostic census changed. Reload the trend history.";
  }
  const current = series.find((s) => s.key === selected) ?? series[0];
  const plotted = current ? plotPoints(current) : [];
  const numbers = plotted.map((p) => p.finding.value_number!);
  const minimum = numbers.length ? Math.min(...numbers) : 0,
    maximum = numbers.length ? Math.max(...numbers) : 0;
  const tick = (n: number) =>
    new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 3,
      notation:
        n !== 0 && (Math.abs(n) >= 1000 || Math.abs(n) < 0.01)
          ? "scientific"
          : "standard",
    }).format(n);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagnostic trends</CardTitle>
        <p className="text-sm text-muted-foreground">
          Reviewed values are grouped by exact analyte, specimen, method/device,
          source and original unit. Reference ranges and flags are shown as
          entered.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.isPending && <p role="status">Loading diagnostic trends…</p>}
        {(result.isError || error) && (
          <p role="alert">
            {error || "Diagnostic trends could not load."}{" "}
            <Button variant="outline" onClick={() => void result.refetch()}>
              Reload trends
            </Button>
          </p>
        )}
        {result.hasNextPage && (
          <div role="status" className="space-y-2">
            <p>
              Showing loaded results only. More results are available; load the
              complete history before comparing the full series.
            </p>
            <Button
              variant="outline"
              disabled={result.isFetchingNextPage}
              onClick={() => void result.fetchNextPage()}
            >
              Load more diagnostic results
            </Button>
          </div>
        )}
        {!!series.length && (
          <>
            <label
              className="block text-sm font-medium"
              htmlFor={`diagnostic-series-${petId}`}
            >
              Compatible series
            </label>
            <select
              id={`diagnostic-series-${petId}`}
              className="w-full rounded-md border border-input bg-background p-2"
              value={current?.key}
              onChange={(e) => setSelected(e.target.value)}
            >
              {series.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} · {s.specimen} · {s.method} · {s.source} ·{" "}
                  {s.unit ?? "text findings"}
                </option>
              ))}
            </select>
          </>
        )}
        {current && (
          <>
            <p className="text-sm">
              Analyte identity: {current.analyteKey} ·{" "}
              {current.unit ?? "Qualitative findings"}
            </p>
            {plotted.length > 0 && (
              <figure>
                <svg
                  viewBox="0 0 600 180"
                  role="img"
                  aria-label={`${current.label} reviewed values over collection dates`}
                  className="w-full text-primary"
                >
                  <line
                    x1="40"
                    x2="580"
                    y1="140"
                    y2="140"
                    stroke="currentColor"
                  />
                  {minimum === maximum ? (
                    <text
                      x="38"
                      y="89"
                      textAnchor="end"
                      fill="currentColor"
                      fontSize="12"
                    >
                      {tick(minimum)}
                    </text>
                  ) : (
                    <>
                      <text
                        x="38"
                        y="36"
                        textAnchor="end"
                        fill="currentColor"
                        fontSize="12"
                      >
                        {tick(maximum)}
                      </text>
                      <text
                        x="38"
                        y="144"
                        textAnchor="end"
                        fill="currentColor"
                        fontSize="12"
                      >
                        {tick(minimum)}
                      </text>
                    </>
                  )}
                  <polyline
                    points={plotted.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  {plotted.map((p) => (
                    <circle
                      key={`${p.panel.id}:${p.finding.id}`}
                      cx={p.x}
                      cy={p.y}
                      r="4"
                      fill="currentColor"
                    >
                      <title>
                        {p.day}: {p.finding.value_number} {p.finding.unit} ·
                        reviewed version {p.panel.number}
                      </title>
                    </circle>
                  ))}
                  <text x="40" y="170" fill="currentColor" fontSize="12">
                    {plotted[0].day}
                  </text>
                  <text
                    x="580"
                    y="170"
                    textAnchor="end"
                    fill="currentColor"
                    fontSize="12"
                  >
                    {plotted[plotted.length - 1].day}
                  </text>
                </svg>
                <figcaption className="text-xs text-muted-foreground">
                  The table gives exact values and each result’s reference
                  context. Lines show recorded history and do not interpret
                  changes.
                </figcaption>
              </figure>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  Exact reviewed diagnostic values and their source records
                </caption>
                <thead>
                  <tr>
                    {[
                      "Collected",
                      "Value",
                      "Reference / source flag",
                      "Reviewed record",
                    ].map((h) => (
                      <th key={h} className="p-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {current.points.map((p) => (
                    <tr
                      key={`${p.panel.id}:${p.finding.id}`}
                      className="border-t"
                    >
                      <td className="p-2">{p.day}</td>
                      <td className="p-2">
                        {p.finding.kind === "numeric"
                          ? `${p.finding.value_number} ${p.finding.unit}`
                          : p.finding.value_text}
                      </td>
                      <td className="p-2">
                        {p.finding.reference_low ?? "not entered"} –{" "}
                        {p.finding.reference_high ?? "not entered"}{" "}
                        {p.finding.reference_text} ·{" "}
                        {p.finding.source_flag || "no source flag entered"}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="link"
                          disabled={disabled}
                          onClick={() => onOpen(p.panel.panel_id)}
                        >
                          {p.panel.snapshot.panel_name} · v{p.panel.number}
                        </Button>
                        <p>{p.panel.reviewer_name}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!result.isPending && !result.isError && !series.length && (
          <p>No finalized diagnostic findings are recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}
