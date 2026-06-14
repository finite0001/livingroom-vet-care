import { useEffect, useState } from "react";
import { Clock, Play, Square, Users } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useCurrentShift, useClockIn, useClockOut, useMyShifts, useOnDutyStaff,
  durationSeconds, type TimeEntry,
} from "@/hub/hooks/use-time-clock";

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtHm(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function TimeClockPage() {
  usePageTitle("Time Clock");
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const { data: current, isLoading } = useCurrentShift();
  const { data: shifts = [] } = useMyShifts(30);
  const { data: onDuty = [] } = useOnDutyStaff(isAdmin);
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  // Live tick while clocked in so the timer and today's total update each second.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!current) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [current]);

  const elapsed = current ? durationSeconds(current, now) : 0;
  const isOpen = (s: TimeEntry) => !s.clock_out_at;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const todaySeconds = shifts
    .filter((s) => new Date(s.clock_in_at) >= startOfToday)
    .reduce((sum, s) => sum + durationSeconds(s, now), 0);
  const weekSeconds = shifts
    .filter((s) => new Date(s.clock_in_at).getTime() >= weekAgo)
    .reduce((sum, s) => sum + durationSeconds(s, now), 0);

  const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message || fallback;
  const handleClockIn = () => clockIn.mutate(undefined, {
    onSuccess: () => toast.success("Clocked in"),
    onError: (e) => toast.error(errMsg(e, "Failed to clock in")),
  });
  const handleClockOut = () => clockOut.mutate(undefined, {
    onSuccess: () => toast.success("Clocked out"),
    onError: (e) => toast.error(errMsg(e, "Failed to clock out")),
  });

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Time Clock</h1>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {/* Clock in/out */}
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6">
            {isLoading ? (
              <Skeleton className="h-12 w-48" />
            ) : (
              <>
                <div className="text-center">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {current ? "On the clock" : "Not clocked in"}
                  </p>
                  <p className={current ? "mt-1 font-mono text-4xl font-bold tabular-nums text-primary" : "mt-1 font-mono text-4xl font-bold tabular-nums text-muted-foreground"}>
                    {fmtClock(elapsed)}
                  </p>
                  {current && (
                    <p className="mt-1 text-xs text-muted-foreground">Since {format(new Date(current.clock_in_at), "h:mm a")}</p>
                  )}
                </div>
                {current ? (
                  <Button size="lg" variant="destructive" className="w-full max-w-xs gap-2" disabled={clockOut.isPending} onClick={handleClockOut}>
                    <Square className="h-4 w-4" /> {clockOut.isPending ? "Clocking out…" : "Clock out"}
                  </Button>
                ) : (
                  <Button size="lg" className="w-full max-w-xs gap-2" disabled={clockIn.isPending} onClick={handleClockIn}>
                    <Play className="h-4 w-4" /> {clockIn.isPending ? "Clocking in…" : "Clock in"}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Today</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmtHm(todaySeconds)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Past 7 days</p><p className="mt-1 text-2xl font-bold tabular-nums">{fmtHm(weekSeconds)}</p></CardContent></Card>
        </div>

        {/* Admin: on duty now */}
        {isAdmin && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> On duty now</CardTitle></CardHeader>
            <CardContent>
              {onDuty.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No staff clocked in.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {onDuty.map((s) => (
                    <Badge key={s.id} variant="secondary" className="gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />{s.full_name || "Staff"}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recent shifts */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Recent shifts</CardTitle></CardHeader>
          <CardContent className="p-0">
            {shifts.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No shifts in the last 30 days.</p>
            ) : (
              <div className="divide-y">
                {shifts.map((s) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{format(new Date(s.clock_in_at), "EEE, MMM d")}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(s.clock_in_at), "h:mm a")} – {s.clock_out_at ? format(new Date(s.clock_out_at), "h:mm a") : "now"}
                      </p>
                    </div>
                    {isOpen(s)
                      ? <Badge variant="secondary" className="gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />Active</Badge>
                      : <span className="tabular-nums text-muted-foreground">{fmtHm(durationSeconds(s, now))}</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
