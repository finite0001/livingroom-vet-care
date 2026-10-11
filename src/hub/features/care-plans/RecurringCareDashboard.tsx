import { useState } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { duePage } from "./api";
import { dueCursorSchema, kindLabels, statusLabels } from "./model";
import { patientHref } from "@/hub/features/patient-360/model";
import type { z } from "zod";
export function RecurringCareDashboard() {
  const { session } = useAuth();
  const [filter, setFilter] = useState("upcoming");
  const query = useInfiniteQuery({
    queryKey: ["recurring-care-due", session?.user.id, filter], enabled: !!session?.user.id,
    initialPageParam: null as z.infer<typeof dueCursorSchema> | null,
    queryFn: ({ pageParam }) => duePage(filter, pageParam), getNextPageParam: page => page.next ?? undefined, retry: 1,
  });
  const rows = query.data?.pages.flatMap(page => page.rows) ?? [];
  return <section aria-label="Recurring care due" className="space-y-3">
    <h2 className="font-display text-xl">Recurring care due</h2>
    <div className="flex flex-wrap gap-2">{[
      ["upcoming", "Next 30 days"], ["overdue", "Overdue care"], ["all", "All current care"], ["review", "Awaiting vet review"],
    ].map(([value, label]) => <Button key={value} variant={filter === value ? "default" : "outline"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div>
    {query.isPending && <p role="status">Loading recurring care…</p>}
    {query.isError && <div role="alert"><p>Could not load recurring care due.</p><Button variant="outline" onClick={() => void query.refetch()}>Reload recurring care</Button></div>}
    {!query.isPending && !query.isError && !rows.length && <p className="text-sm text-muted-foreground">No recurring care plans in this view.</p>}
    <div className="grid gap-3 md:grid-cols-2">{rows.map(row => <Card key={row.plan.id}><CardContent className="space-y-2 p-4">
      <Badge variant="outline">{statusLabels[row.plan.status]}</Badge>
      <h3 className="font-semibold">{row.patient_name} · {row.plan.name}</h3>
      <p className="text-sm">{kindLabels[row.plan.care_kind]} · due {row.plan.due_on}</p>
      <p className="text-xs text-muted-foreground">{row.reminder_reason}</p>
      {row.next_send_at && <p className="text-sm">Scheduled for next send window: {new Date(row.next_send_at).toLocaleString("en-US", { timeZone: "America/Denver" })} (Denver)</p>}
      <Button asChild variant="outline" size="sm"><Link to={patientHref(row.plan.pet_id, "medical", "care-plans")}>Open care plan</Link></Button>
    </CardContent></Card>)}</div>
    {query.hasNextPage && <Button variant="outline" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>Load more recurring care</Button>}
    {query.isFetchNextPageError && <p role="alert">Could not load the next page. Loaded results are retained.</p>}
  </section>;
}
