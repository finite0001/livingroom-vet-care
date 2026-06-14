import { useMemo, useState } from "react";
import { Clock, CalendarIcon, Search, X, Download } from "lucide-react";
import { format } from "date-fns";
import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import { useMyShiftsRange } from "@/hub/hooks/use-time-clock";

function formatDuration(start: string, end: string | null) {
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, endMs - new Date(start).getTime());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export default function MyTimePage() {
  usePageTitle("Timesheet");

  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [search, setSearch] = useState("");

  const fromIso = fromDate ? startOfDay(fromDate).toISOString() : null;
  const toIso = toDate ? endOfDay(toDate).toISOString() : null;

  const { data, isLoading } = useMyShiftsRange(fromIso, toIso);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((e) => {
      const note = (e.note ?? "").toLowerCase();
      const inDate = formatDateTime(e.clock_in_at).toLowerCase();
      const outDate = e.clock_out_at ? formatDateTime(e.clock_out_at).toLowerCase() : "on duty";
      return note.includes(term) || inDate.includes(term) || outDate.includes(term);
    });
  }, [data, search]);

  const totals = useMemo(() => {
    if (!filtered.length) return { label: "0h 00m", count: 0 };
    let ms = 0;
    for (const e of filtered) {
      const start = new Date(e.clock_in_at).getTime();
      const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : Date.now();
      ms += Math.max(0, end - start);
    }
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return { label: `${h}h ${m.toString().padStart(2, "0")}m`, count: filtered.length };
  }, [filtered]);

  const hasFilters = !!fromDate || !!toDate || search.trim().length > 0;
  const clearFilters = () => {
    setFromDate(undefined);
    setToDate(undefined);
    setSearch("");
  };

  const exportCsv = () => {
    const headers = ["Clock In", "Clock Out", "Duration", "Note"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = filtered.map((e) => [
      new Date(e.clock_in_at).toISOString(),
      e.clock_out_at ? new Date(e.clock_out_at).toISOString() : "",
      formatDuration(e.clock_in_at, e.clock_out_at),
      e.note ?? "",
    ].map(escape).join(","));
    const csv = [headers.map(escape).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = format(new Date(), "yyyy-MM-dd");
    a.href = url;
    a.download = `my-time-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Timesheet</h1>
        <p className="text-sm text-muted-foreground">Your clock-in/out history.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">
              {hasFilters ? "Hours (filtered)" : "Hours (recent)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? "—" : totals.label}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Shifts shown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? "—" : totals.count}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Entries</CardTitle>
            <div className="flex gap-2 self-start sm:self-auto">
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
                  <X className="h-3.5 w-3.5" /> Clear filters
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={isLoading || filtered.length === 0}
                className="h-8"
              >
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("justify-start text-left font-normal sm:w-[180px]", !fromDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {fromDate ? format(fromDate, "PPP") : "From date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={fromDate}
                  onSelect={setFromDate}
                  disabled={(d) => (toDate ? d > toDate : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("justify-start text-left font-normal sm:w-[180px]", !toDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {toDate ? format(toDate, "PPP") : "To date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={toDate}
                  onSelect={setToDate}
                  disabled={(d) => (fromDate ? d < fromDate : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes or dates…"
                className="pl-8 h-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={hasFilters ? "No matching entries" : "No time entries yet"}
              description={
                hasFilters
                  ? "Try a wider date range or a different search term."
                  : "Once you clock in, your shifts will appear here."
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clock In</TableHead>
                  <TableHead>Clock Out</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => {
                  const open = !e.clock_out_at;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(e.clock_in_at)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {open ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
                            On duty
                          </Badge>
                        ) : (
                          formatDateTime(e.clock_out_at!)
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">
                        {formatDuration(e.clock_in_at, e.clock_out_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{e.note ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
