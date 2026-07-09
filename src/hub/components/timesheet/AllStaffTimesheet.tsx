import { useMemo, useState } from "react";
import { Clock, CalendarIcon, Search, X, Download, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { EmptyState } from "@/hub/components/shared/EmptyState";
import {
  useAllShiftsRange, useAdminUpdateTimeEntry, useAdminDeleteTimeEntry,
  type StaffTimeEntry,
} from "@/hub/hooks/use-time-clock";

// NOTE: "Add a missed shift" is intentionally NOT built here. Direct INSERT
// into time_entries is blocked by RLS for everyone (clock_in/clock_out RPCs
// only), so creating an entry requires the upcoming admin_create_time_entry
// RPC (migration pending). Only corrections (update/delete) live here.

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

function formatHours(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function entryMs(e: StaffTimeEntry) {
  const start = new Date(e.clock_in_at).getTime();
  const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : Date.now();
  return Math.max(0, end - start);
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

// datetime-local wants local wall time ("YYYY-MM-DDTHH:mm"), no timezone.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// A datetime-local value parses as local time; convert back to ISO/UTC.
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface EditForm { clockIn: string; clockOut: string; note: string }

export function AllStaffTimesheet() {
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [search, setSearch] = useState("");

  const fromIso = fromDate ? startOfDay(fromDate).toISOString() : null;
  const toIso = toDate ? endOfDay(toDate).toISOString() : null;

  const { data, isLoading } = useAllShiftsRange(fromIso, toIso, true);
  const updateEntry = useAdminUpdateTimeEntry();
  const deleteEntry = useAdminDeleteTimeEntry();

  const [editing, setEditing] = useState<StaffTimeEntry | null>(null);
  const [form, setForm] = useState<EditForm>({ clockIn: "", clockOut: "", note: "" });
  const [pendingDelete, setPendingDelete] = useState<StaffTimeEntry | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter((e) => {
      const name = e.staff_name.toLowerCase();
      const note = (e.note ?? "").toLowerCase();
      const inDate = formatDateTime(e.clock_in_at).toLowerCase();
      const outDate = e.clock_out_at ? formatDateTime(e.clock_out_at).toLowerCase() : "on duty";
      return name.includes(term) || note.includes(term) || inDate.includes(term) || outDate.includes(term);
    });
  }, [data, search]);

  // Group by staff (sorted by name), with per-staff totals and a grand total.
  const groups = useMemo(() => {
    const byStaff = new Map<string, { name: string; entries: StaffTimeEntry[]; ms: number }>();
    for (const e of filtered) {
      const g = byStaff.get(e.staff_id) ?? { name: e.staff_name, entries: [], ms: 0 };
      g.entries.push(e);
      g.ms += entryMs(e);
      byStaff.set(e.staff_id, g);
    }
    return [...byStaff.entries()]
      .map(([staffId, g]) => ({ staffId, ...g }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const grandMs = useMemo(() => groups.reduce((sum, g) => sum + g.ms, 0), [groups]);

  const hasFilters = !!fromDate || !!toDate || search.trim().length > 0;
  const clearFilters = () => {
    setFromDate(undefined);
    setToDate(undefined);
    setSearch("");
  };

  const exportCsv = () => {
    const headers = ["Staff", "Clock In", "Clock Out", "Duration", "Note"];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = filtered.map((e) => [
      e.staff_name,
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
    a.download = `all-staff-time-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openEdit = (e: StaffTimeEntry) => {
    setForm({ clockIn: isoToLocalInput(e.clock_in_at), clockOut: isoToLocalInput(e.clock_out_at), note: e.note ?? "" });
    setEditing(e);
  };

  const handleSave = () => {
    if (!editing) return;
    const clockInIso = localInputToIso(form.clockIn);
    const clockOutIso = localInputToIso(form.clockOut);
    if (!clockInIso) { toast.error("Clock in time is required"); return; }
    if (form.clockOut && !clockOutIso) { toast.error("Clock out time is invalid"); return; }
    const wasOpen = !editing.clock_out_at;
    if (!wasOpen && !clockOutIso) { toast.error("Closed entries need a clock out time"); return; }
    if (clockOutIso && clockOutIso <= clockInIso) { toast.error("Clock out must be after clock in"); return; }
    const nowIso = new Date().toISOString();
    if (clockInIso > nowIso || (clockOutIso && clockOutIso > nowIso)) {
      toast.error("Times can't be in the future");
      return;
    }
    updateEntry.mutate(
      { id: editing.id, staff_id: editing.staff_id, clock_in_at: clockInIso, clock_out_at: clockOutIso, note: form.note.trim() || null, wasOpen },
      {
        onSuccess: () => { toast.success("Entry updated"); setEditing(null); },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update entry"),
      },
    );
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    deleteEntry.mutate({ id: pendingDelete.id, staff_id: pendingDelete.staff_id, wasOpen: !pendingDelete.clock_out_at }, {
      onSuccess: () => { toast.success("Entry deleted"); setPendingDelete(null); },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete entry"),
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">
              {hasFilters ? "Total hours (filtered)" : "Total hours"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? "—" : formatHours(grandMs)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Shifts shown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? "—" : filtered.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">All staff entries</CardTitle>
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
                placeholder="Search staff, notes or dates…"
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
                  : "Once staff clock in, their shifts will appear here."
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
                  <TableHead className="w-[80px]"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  [
                    <TableRow key={`staff-${g.staffId}`} className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={3} className="font-semibold">{g.name}</TableCell>
                      <TableCell colSpan={2} className="text-right font-semibold whitespace-nowrap">
                        {formatHours(g.ms)} · {g.entries.length} shift{g.entries.length === 1 ? "" : "s"}
                      </TableCell>
                    </TableRow>,
                    ...g.entries.map((e) => {
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
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="Edit entry" onClick={() => openEdit(e)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label="Delete entry" onClick={() => setPendingDelete(e)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ]
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit entry */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit entry{editing ? ` — ${editing.staff_name}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-clock-in">Clock in</Label>
              <Input
                id="edit-clock-in"
                type="datetime-local"
                value={form.clockIn}
                onChange={(e) => setForm((f) => ({ ...f, clockIn: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-clock-out">Clock out</Label>
              <Input
                id="edit-clock-out"
                type="datetime-local"
                value={form.clockOut}
                onChange={(e) => setForm((f) => ({ ...f, clockOut: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                {editing && !editing.clock_out_at
                  ? "Leave blank to keep the shift open, or set a time to clock them out."
                  : "Required — closed entries can't be reopened."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-note">Note</Label>
              <Textarea
                id="edit-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                rows={2}
                placeholder="Optional note…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateEntry.isPending}>
              {updateEntry.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete entry */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `This removes ${pendingDelete.staff_name}'s shift starting ${formatDateTime(pendingDelete.clock_in_at)}. This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
