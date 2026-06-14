import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Admin analytics for the communications platform, adapted to Living Room Vet's
// schema. Source metrics come from response_metrics (auto-tracked on staff replies),
// conversations, messages, clients, and profiles. On-duty/business-hours metrics
// are intentionally omitted until the staff time-tracking feature lands.

export interface StaffMetric {
  staff_id: string;
  staff_name: string;
  avg_response_seconds: number;
  total_responses: number;
  sla_compliant: number; // percent 0-100
}

export interface ChannelMetric {
  channel: string;
  avg_response_seconds: number;
  count: number;
}

export interface MessageTrendPoint {
  day: string; // "MM-DD"
  CLIENT: number;
  STAFF: number;
}

export interface StaffWorkload {
  name: string;
  conversations: number;
}

export interface AdminTrends {
  avgResponse: number;
  sla: number;
  unread: number;
  messages: number;
  newClients: number;
}

export interface AdminMetrics {
  staffMetrics: StaffMetric[];
  channelMetrics: ChannelMetric[];
  messageTrend: MessageTrendPoint[];
  staffWorkload: StaffWorkload[];
  overallSla: number;
  overallAvg: number;
  unreadCount: number;
  totalStaffMessages: number;
  newClients: number;
  activeStaffCount: number;
  trends: AdminTrends;
}

export type DateRange = "7d" | "30d" | "90d" | "all";

const SLA_THRESHOLD_SECONDS = 900; // respond within 15 min
const OUTLIER_THRESHOLD_SECONDS = 28800; // skip > 8h (overnight) outliers

export const RANGE_DAYS: Record<DateRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

export const RANGE_LABELS: Record<DateRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

export function rangeBounds(range: DateRange): { start: string | null } {
  const days = RANGE_DAYS[range];
  if (days === null) return { start: null };
  return { start: new Date(Date.now() - days * 86_400_000).toISOString() };
}

function priorBounds(range: DateRange): { start: string; end: string } | null {
  const days = RANGE_DAYS[range];
  if (days === null) return null;
  const now = Date.now();
  return {
    start: new Date(now - days * 2 * 86_400_000).toISOString(),
    end: new Date(now - days * 86_400_000).toISOString(),
  };
}

function calcTrend(current: number, prior: number): number {
  if (prior === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - prior) / prior) * 100);
}

interface BatchResult {
  metrics: { staff_id: string; response_time_seconds: number | null; channel: string }[];
  profiles: { id: string; full_name: string }[];
  unreadCount: number;
  staffMessageCount: number;
  clientsCount: number;
  messages: { created_at: string; sender_type: string }[];
  workload: { assigned_to_id: string | null }[];
}

async function fetchBatch(start: string | null, end?: string): Promise<BatchResult> {
  let metricsQ = supabase.from("response_metrics").select("staff_id, response_time_seconds, channel");
  const profilesQ = supabase.from("profiles").select("id, full_name").eq("is_active", true);
  const unreadQ = supabase.from("conversations").select("*", { count: "exact", head: true }).eq("is_read", false);
  let staffMsgQ = supabase.from("messages").select("*", { count: "exact", head: true }).eq("sender_type", "STAFF").eq("is_internal", false);
  let clientsCountQ = supabase.from("clients").select("*", { count: "exact", head: true });
  let messagesQ = supabase.from("messages").select("created_at, sender_type").eq("is_internal", false);
  const workloadQ = supabase.from("conversations").select("assigned_to_id").eq("status", "ACTIVE").not("assigned_to_id", "is", null);

  if (start) {
    metricsQ = metricsQ.gte("created_at", start);
    clientsCountQ = clientsCountQ.gte("created_at", start);
    messagesQ = messagesQ.gte("created_at", start);
    staffMsgQ = staffMsgQ.gte("created_at", start);
    // unreadQ and workloadQ are intentionally point-in-time, not range-scoped.
  }
  if (end) {
    metricsQ = metricsQ.lt("created_at", end);
    clientsCountQ = clientsCountQ.lt("created_at", end);
    messagesQ = messagesQ.lt("created_at", end);
    staffMsgQ = staffMsgQ.lt("created_at", end);
  }

  const [mRes, pRes, uRes, smRes, ccRes, msgRes, wRes] = await Promise.all([
    metricsQ, profilesQ, unreadQ, staffMsgQ, clientsCountQ, messagesQ, workloadQ,
  ]);
  for (const r of [mRes, pRes, uRes, smRes, ccRes, msgRes, wRes]) {
    if (r.error) throw r.error;
  }
  return {
    metrics: (mRes.data ?? []) as BatchResult["metrics"],
    profiles: (pRes.data ?? []) as BatchResult["profiles"],
    unreadCount: uRes.count ?? 0,
    staffMessageCount: smRes.count ?? 0,
    clientsCount: ccRes.count ?? 0,
    messages: (msgRes.data ?? []) as BatchResult["messages"],
    workload: (wRes.data ?? []) as BatchResult["workload"],
  };
}

function aggregate(batch: BatchResult) {
  const profileMap = new Map(batch.profiles.map((p) => [p.id, p.full_name]));

  const staffMap = new Map<string, { total: number; sum: number; compliant: number }>();
  const channelMap = new Map<string, { sum: number; count: number }>();
  for (const m of batch.metrics) {
    const secs = m.response_time_seconds ?? 0;
    if (secs > OUTLIER_THRESHOLD_SECONDS) continue;
    const s = staffMap.get(m.staff_id) ?? { total: 0, sum: 0, compliant: 0 };
    s.total++; s.sum += secs; if (secs <= SLA_THRESHOLD_SECONDS) s.compliant++;
    staffMap.set(m.staff_id, s);
    const c = channelMap.get(m.channel) ?? { sum: 0, count: 0 };
    c.sum += secs; c.count++; channelMap.set(m.channel, c);
  }

  const staffMetrics: StaffMetric[] = Array.from(staffMap.entries())
    .map(([id, d]) => ({
      staff_id: id,
      staff_name: profileMap.get(id) ?? "Unknown",
      avg_response_seconds: d.total ? d.sum / d.total : 0,
      total_responses: d.total,
      sla_compliant: d.total ? Math.round((d.compliant / d.total) * 100) : 0,
    }))
    .sort((a, b) => b.total_responses - a.total_responses);

  const channelMetrics: ChannelMetric[] = Array.from(channelMap.entries())
    .map(([channel, d]) => ({ channel, avg_response_seconds: d.count ? d.sum / d.count : 0, count: d.count }))
    .sort((a, b) => b.count - a.count);

  const dayMap = new Map<string, { CLIENT: number; STAFF: number }>();
  for (const m of batch.messages) {
    const day = m.created_at?.slice(0, 10) ?? "";
    if (!day) continue;
    const e = dayMap.get(day) ?? { CLIENT: 0, STAFF: 0 };
    if (m.sender_type === "CLIENT") e.CLIENT++;
    else if (m.sender_type === "STAFF") e.STAFF++;
    dayMap.set(day, e);
  }
  const messageTrend: MessageTrendPoint[] = Array.from(dayMap.entries())
    .map(([day, c]) => ({ day: day.slice(5), ...c }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const workMap = new Map<string, number>();
  for (const c of batch.workload) {
    if (!c.assigned_to_id) continue;
    workMap.set(c.assigned_to_id, (workMap.get(c.assigned_to_id) ?? 0) + 1);
  }
  const staffWorkload: StaffWorkload[] = Array.from(workMap.entries())
    .map(([id, n]) => ({ name: profileMap.get(id) ?? "Unknown", conversations: n }))
    .sort((a, b) => b.conversations - a.conversations);

  const overallSla = staffMetrics.length
    ? Math.round(staffMetrics.reduce((s, m) => s + m.sla_compliant, 0) / staffMetrics.length)
    : 0;
  const overallAvg = staffMetrics.length
    ? staffMetrics.reduce((s, m) => s + m.avg_response_seconds, 0) / staffMetrics.length
    : 0;

  return { staffMetrics, channelMetrics, messageTrend, staffWorkload, overallSla, overallAvg };
}

export function useAdminMetrics(dateRange: DateRange = "30d") {
  return useQuery<AdminMetrics>({
    queryKey: ["admin-metrics", dateRange],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AdminMetrics> => {
      const { start } = rangeBounds(dateRange);
      const prior = priorBounds(dateRange);
      const [currentBatch, priorBatch] = await Promise.all([
        fetchBatch(start),
        prior ? fetchBatch(prior.start, prior.end) : Promise.resolve(null),
      ]);
      const current = aggregate(currentBatch);
      const priorAgg = priorBatch ? aggregate(priorBatch) : null;

      const trends: AdminTrends = {
        avgResponse: priorAgg ? calcTrend(current.overallAvg, priorAgg.overallAvg) : 0,
        sla: priorAgg ? calcTrend(current.overallSla, priorAgg.overallSla) : 0,
        unread: priorBatch ? calcTrend(currentBatch.unreadCount, priorBatch.unreadCount) : 0,
        messages: priorBatch ? calcTrend(currentBatch.staffMessageCount, priorBatch.staffMessageCount) : 0,
        newClients: priorBatch ? calcTrend(currentBatch.clientsCount, priorBatch.clientsCount) : 0,
      };

      return {
        staffMetrics: current.staffMetrics,
        channelMetrics: current.channelMetrics,
        messageTrend: current.messageTrend,
        staffWorkload: current.staffWorkload,
        overallSla: current.overallSla,
        overallAvg: current.overallAvg,
        unreadCount: currentBatch.unreadCount,
        totalStaffMessages: currentBatch.staffMessageCount,
        newClients: currentBatch.clientsCount,
        activeStaffCount: currentBatch.profiles.length,
        trends,
      };
    },
  });
}
