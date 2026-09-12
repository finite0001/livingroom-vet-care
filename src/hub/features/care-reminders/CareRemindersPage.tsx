import { useEffect, useState } from "react";
import { Link, useBlocker } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { careDb, selectClass } from "./model";
import { CareReminderSettings } from "./CareReminderSettings";
import { denverCalendarDay, addCareDays } from "./date-tools";
interface DueItem {
  id: string;
  kind: string;
  petId: string | null;
  name: string;
  due: string;
  detail: string;
}
export function CareRemindersPage() {
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker(dirty);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const guard = (
    <AlertDialog open={blocker.state === "blocked"}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave with unsaved settings?</AlertDialogTitle>
          <AlertDialogDescription>
            Your unsaved practice settings will be lost. Save your review before
            leaving to keep it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => blocker.state === "blocked" && blocker.reset()}
          >
            Keep editing
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => blocker.state === "blocked" && blocker.proceed()}
          >
            Discard and leave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const [filter, setFilter] = useState("upcoming");
  const [page, setPage] = useState(0);
  const today = denverCalendarDay();
  const data = useQuery({
    queryKey: ["care-due-dashboard", filter, page, today],
    queryFn: async () => {
      let vaccines = careDb
        .from("patient_vaccine_due_plans")
        .select("*")
        .eq("status", "current")
        .order("current_due_on")
        .order("id");
      let labs = supabase
        .from("patient_lab_orders")
        .select("id,pet_id,test_name,due_date,status")
        .in("status", ["planned", "ordered"])
        .not("due_date", "is", null)
        .order("due_date")
        .order("id");
      if (filter === "overdue") {
        vaccines = vaccines.lt("current_due_on", today);
        labs = labs.lt("due_date", today);
      } else if (filter === "upcoming") {
        vaccines = vaccines
          .gte("current_due_on", today)
          .lte("current_due_on", addCareDays(today, 30));
        labs = labs
          .gte("due_date", today)
          .lte("due_date", addCareDays(today, 30));
      }
      const results = await Promise.all([
        vaccines.range(page * 20, page * 20 + 20),
        labs.range(page * 20, page * 20 + 20),
      ]);
      for (const result of results) {
        if (result.error) throw result.error;
      }
      const vaccineRows = results[0].data;
      const labRows = results[1].data;
      const rows: DueItem[] = [
        ...(vaccineRows ?? []).slice(0, 20).map((v) => ({
          id: v.id,
          kind: "Vaccine",
          petId: v.pet_id,
          name: v.group_key,
          due: v.current_due_on,
          detail: `Reviewed current plan · reminders ${v.reminders_enabled ? "eligible" : "disabled"}`,
        })),
        ...(labRows ?? []).slice(0, 20).map((l) => ({
          id: l.id,
          kind: "Lab",
          petId: l.pet_id,
          name: l.test_name,
          due: l.due_date!,
          detail: `Native lab order · ${l.status}`,
        })),
      ];
      const petIds = [
        ...new Set(
          rows
            .map((row) => row.petId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (petIds.length) {
        const { data: pets, error } = await supabase
          .from("pets")
          .select("id,name,archived_at,deceased_at")
          .in("id", petIds);
        if (error) throw error;
        return {
          rows: rows
            .filter((row) =>
              pets.some(
                (p) => p.id === row.petId && !p.archived_at && !p.deceased_at,
              ),
            )
            .map((row) => ({
              ...row,
              detail: `${pets.find((p) => p.id === row.petId)?.name} · ${row.detail}`,
            })),
          more: (vaccineRows?.length ?? 0) > 20 || (labRows?.length ?? 0) > 20,
        };
      }
      return { rows, more: false };
    },
  });
  const jobs = useQuery({
    queryKey: ["care-reminder-jobs"],
    queryFn: async () => {
      const { data, error } = await careDb
        .from("care_reminder_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });
  const appointments = useQuery({
    queryKey: ["care-appointment-reminders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointment_reminders")
        .select(
          "id,appointment_id,appointment_version,remind_at,channel,status",
        )
        .eq("status", "PENDING")
        .order("remind_at")
        .limit(30);
      if (error) throw error;
      return data;
    },
  });
  return (
    <section className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
        {guard}
        <header>
          <h1 className="text-2xl font-semibold">
            Care due dates and reminders
          </h1>
          <p className="text-sm text-muted-foreground">
            Reviewed vaccine plans and native lab due orders. Queue entries are
            unsent; provider dispatch is not configured. Appointment reminders
            remain in their existing queue.
          </p>
        </header>
        <div className="max-w-sm">
          <Label htmlFor="care-filter">Due date view (Denver)</Label>
          <select
            id="care-filter"
            className={selectClass}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="upcoming">Upcoming 30 days</option>
            <option value="overdue">Overdue</option>
            <option value="all">All current due dates</option>
          </select>
        </div>
        {data.isLoading && <p role="status">Loading current due dates…</p>}
        {data.isError && (
          <p role="alert">
            Due dates could not load.{" "}
            <Button onClick={() => void data.refetch()}>
              Retry care due dates
            </Button>
          </p>
        )}
        <ul className="space-y-2">
          {data.data?.rows.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="rounded-md border p-3">
              <p className="font-medium">
                {row.kind}: {row.name} · due {row.due}
              </p>
              <p className="text-sm">{row.detail}</p>
              <Link
                className="text-sm text-primary underline"
                to={`/hub/patient/${row.petId}`}
              >
                Open patient due plan
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            Previous due dates
          </Button>
          <Button
            variant="outline"
            disabled={!data.data?.more}
            onClick={() => setPage(page + 1)}
          >
            Next due dates
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Each page reads up to 20 vaccine plans and 20 lab orders. Archived or
          deceased patients are excluded.
        </p>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Latest care reminder jobs</h2>
          <p className="text-sm text-muted-foreground">
            Most recent 30 jobs. Pending means prepared and unsent. Invalidated
            snapshots remain as history and cannot be reused.
          </p>
          {jobs.isError && (
            <p role="alert">
              Reminder jobs could not load.{" "}
              <Button onClick={() => void jobs.refetch()}>
                Retry care jobs
              </Button>
            </p>
          )}
          {jobs.data?.map((job) => (
            <div key={job.id} className="rounded-md border p-3">
              <p>
                {job.source_kind} · {job.channel} · {job.status} · scheduled{" "}
                {job.scheduled_on} · due {job.due_on}
              </p>
              <p className="whitespace-pre-wrap text-sm">{job.rendered_body}</p>
              {job.invalidation_reason && (
                <p className="text-sm">{job.invalidation_reason}</p>
              )}
            </div>
          ))}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Existing appointment reminder queue
          </h2>
          <p className="text-sm text-muted-foreground">
            Earliest 30 pending appointment reminders, shown independently of
            the care due-date filter. No duplicate appointment jobs are
            generated here.
          </p>
          {appointments.isError && (
            <p role="alert">
              Appointment reminders could not load.{" "}
              <Button onClick={() => void appointments.refetch()}>
                Retry appointment queue
              </Button>
            </p>
          )}
          {appointments.data?.map((a) => (
            <p key={a.id} className="rounded-md border p-3 text-sm">
              {denverCalendarDay(a.remind_at)} · {a.channel} · {a.status} ·
              appointment version {a.appointment_version}
            </p>
          ))}
          <Link className="text-primary underline" to="/hub/schedule">
            Open schedule
          </Link>
        </section>
        <CareReminderSettings onDirtyChange={setDirty} />
      </div>
    </section>
  );
}
