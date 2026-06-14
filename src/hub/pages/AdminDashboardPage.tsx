import { TrendingUp, TrendingDown, Minus, Clock, Gauge, Inbox, Send, UserPlus } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAdminMetrics, RANGE_LABELS, type DateRange } from "@/hub/hooks/use-admin-metrics";

function formatSeconds(s: number): string {
  if (!s || s <= 0) return "—";
  const sec = Math.round(s);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// For most KPIs higher is better; for response time lower is better (invert color).
function Trend({ value, lowerIsBetter = false }: { value: number; lowerIsBetter?: boolean }) {
  if (value === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
  const good = lowerIsBetter ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-green-600" : "text-destructive")}>
      <Icon className="h-3 w-3" />{Math.abs(value)}%
    </span>
  );
}

function StatTile({ icon: Icon, label, value, trend, lowerIsBetter }: {
  icon: React.ElementType; label: string; value: string; trend: number; lowerIsBetter?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <Trend value={trend} lowerIsBetter={lowerIsBetter} />
        </div>
        <p className="mt-3 text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

const STAFF_COLOR = "hsl(var(--primary))";
const CLIENT_COLOR = "hsl(var(--muted-foreground))";

export default function AdminDashboardPage() {
  usePageTitle("Admin Dashboard");
  const [range, setRange] = useState<DateRange>("30d");
  const { data, isLoading } = useAdminMetrics(range);

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Admin Dashboard</h1>
        <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
          <SelectTrigger className="h-8 w-[150px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(RANGE_LABELS) as DateRange[]).map((r) => (
              <SelectItem key={r} value={r}>{RANGE_LABELS[r]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="p-4 space-y-4">
        {isLoading || !data ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
            </div>
            <Skeleton className="h-72 w-full rounded-lg" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-64 w-full rounded-lg" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          </>
        ) : (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatTile icon={Clock} label="Avg response time" value={formatSeconds(data.overallAvg)} trend={data.trends.avgResponse} lowerIsBetter />
              <StatTile icon={Gauge} label="SLA compliance" value={`${data.overallSla}%`} trend={data.trends.sla} />
              <StatTile icon={Inbox} label="Unread now" value={String(data.unreadCount)} trend={data.trends.unread} lowerIsBetter />
              <StatTile icon={Send} label="Staff messages" value={String(data.totalStaffMessages)} trend={data.trends.messages} />
              <StatTile icon={UserPlus} label="New clients" value={String(data.newClients)} trend={data.trends.newClients} />
            </div>

            {/* Message volume */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Message volume</CardTitle></CardHeader>
              <CardContent>
                {data.messageTrend.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No messages in this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={data.messageTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="CLIENT" name="Inbound" stackId="1" stroke={CLIENT_COLOR} fill={CLIENT_COLOR} fillOpacity={0.25} />
                      <Area type="monotone" dataKey="STAFF" name="Staff" stackId="1" stroke={STAFF_COLOR} fill={STAFF_COLOR} fillOpacity={0.35} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Avg response by channel */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Avg response by channel</CardTitle></CardHeader>
                <CardContent>
                  {data.channelMetrics.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">No tracked responses yet.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data.channelMetrics} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                        <XAxis dataKey="channel" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${Math.round(v / 60)}m`} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => [formatSeconds(v), "Avg response"]} />
                        <Bar dataKey="avg_response_seconds" name="Avg response" fill={STAFF_COLOR} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              {/* Staff workload */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Open workload by staff</CardTitle></CardHeader>
                <CardContent>
                  {data.staffWorkload.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">No assigned conversations.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart layout="vertical" data={data.staffWorkload.slice(0, 8)} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                        <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="name" fontSize={11} width={90} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Bar dataKey="conversations" name="Open conversations" fill={STAFF_COLOR} radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Staff response leaderboard */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Staff response performance</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data.staffMetrics.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No response data in this period.</p>
                ) : (
                  <div className="divide-y">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Staff</span><span className="text-right">Replies</span><span className="text-right">Avg</span><span className="text-right">SLA</span>
                    </div>
                    {data.staffMetrics.map((s) => (
                      <div key={s.staff_id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 text-sm">
                        <span className="truncate font-medium">{s.staff_name}</span>
                        <span className="text-right tabular-nums">{s.total_responses}</span>
                        <span className="text-right tabular-nums text-muted-foreground">{formatSeconds(s.avg_response_seconds)}</span>
                        <span className={cn("text-right tabular-nums font-medium", s.sla_compliant >= 80 ? "text-green-600" : s.sla_compliant >= 50 ? "text-amber-600" : "text-destructive")}>{s.sla_compliant}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
