import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/hub/components/shared/EmptyState";

type TimeEntry = {
  id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  note: string | null;
  created_at: string;
};

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

export default function MyTimePage() {
  usePageTitle("My Time");
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["time-entries", "mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("time_entries")
        .select("id, clock_in_at, clock_out_at, note, created_at")
        .eq("staff_id", user!.id)
        .order("clock_in_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as TimeEntry[];
    },
  });

  const totals = useMemo(() => {
    if (!data) return { week: 0, count: 0 };
    const weekAgo = Date.now() - 7 * 24 * 3_600_000;
    let weekMs = 0;
    for (const e of data) {
      const start = new Date(e.clock_in_at).getTime();
      const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : Date.now();
      if (end < weekAgo) continue;
      weekMs += Math.max(0, end - Math.max(start, weekAgo));
    }
    const h = Math.floor(weekMs / 3_600_000);
    const m = Math.floor((weekMs % 3_600_000) / 60_000);
    return { week: weekMs, weekLabel: `${h}h ${m.toString().padStart(2, "0")}m`, count: data.length };
  }, [data]);

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Time</h1>
        <p className="text-sm text-muted-foreground">Your recent clock-in/out history.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Hours this week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? "—" : totals.weekLabel ?? "0h 00m"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Recent shifts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? "—" : totals.count}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent entries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No time entries yet"
              description="Once you clock in, your shifts will appear here."
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
                {data.map((e) => {
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
