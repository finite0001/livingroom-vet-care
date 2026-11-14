import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import { denverInstant, denverLocal, shiftDay } from "../scheduling/time";
import {
  readWorkforce,
  runWorkforceJobs,
  toggleWorkforceJobs,
  workforceCommand,
} from "./api";
import { attendance, timeTotals } from "./model";
import { WorkforceForm, type FormField } from "./WorkforceForm";
const kindOptions = [
  { value: "PTO", label: "PTO" },
  { value: "SICK", label: "Sick leave" },
];
const dateFields: FormField[] = [
  { name: "starts_on", label: "First day", type: "date" },
  { name: "ends_on", label: "Last day", type: "date" },
];
const instantFields: FormField[] = [
  { name: "starts_at", label: "Start (Denver)", type: "datetime-local" },
  { name: "ends_at", label: "End (Denver)", type: "datetime-local" },
];
const str = (v: Record<string, string | boolean>, key: string) =>
  String(v[key] ?? "");
const number = (v: Record<string, string | boolean>, key: string) =>
  str(v, key) === "" ? null : Number(v[key]);
export default function WorkforcePage() {
  usePageTitle("Time & leave");
  const { session } = useAuth();
  const client = useQueryClient();
  const today = denverLocal(new Date()).slice(0, 10);
  const [from, setFrom] = useState(shiftDay(today, -31));
  const [until, setUntil] = useState(shiftDay(today, 60));
  const [tab, setTab] = useState("leave");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["workforce", session?.user.id, from, until],
    queryFn: () => readWorkforce(from, until),
    enabled: Boolean(session?.user.id),
  });
  async function perform(action: string, values: unknown, id?: string) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await workforceCommand(action, values, id);
      await client.invalidateQueries({ queryKey: ["workforce"] });
      await client.invalidateQueries({ queryKey: ["time-clock"] });
      setNotice("Saved.");
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save. Please retry.",
      );
      return false;
    } finally {
      setPending(false);
    }
  }
  const d = query.data;
  const name = (id: string) =>
    d?.staff.find((s) => s.id === id)?.name ?? "Staff";
  const staffField: FormField = {
    name: "staff_id",
    label: "Employee",
    options: d?.staff.map((s) => ({ value: s.id, label: s.name })) ?? [],
  };
  const action = (label: string, act: string, values: unknown, id: string) => (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => void perform(act, values, id)}
    >
      {label}
    </Button>
  );
  const stamp = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="font-display text-2xl">Time & leave</h1>
        <p className="text-sm text-muted-foreground">
          Your hours, time off and team availability. All scheduled times use
          Denver time.
        </p>
        <div className="mt-3 flex gap-4 text-sm underline">
          <Link to="/hub/time">Clock in / out</Link>
          <Link to="/hub/timesheet">Timesheets</Link>
        </div>
      </header>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          From
          <input
            aria-label="Range start"
            type="date"
            className="ml-2 rounded border bg-background p-2"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Through
          <input
            aria-label="Range end"
            type="date"
            className="ml-2 rounded border bg-background p-2"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded border border-destructive p-3 text-destructive"
        >
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {query.isPending ? (
        <p role="status">Loading time and leave…</p>
      ) : query.isError ? (
        <div role="alert" className="rounded border p-4">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        d && (
          <>
            <nav
              aria-label="Time and leave sections"
              className="flex flex-wrap gap-2"
            >
              {[
                ["leave", "My leave"],
                ["calendar", "Who's off & shifts"],
                ["time", "Time review"],
                ...(d.can_manage ? [["manage", "Policies & setup"]] : []),
                ...(d.can_assign ? [["access", "Approvers"]] : []),
              ].map(([key, label]) => (
                <Button
                  key={key}
                  variant={tab === key ? "default" : "outline"}
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </Button>
              ))}
            </nav>
            {tab === "leave" && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {kindOptions.map((k) => (
                    <div
                      key={k.value}
                      className="rounded-xl border bg-card p-4"
                    >
                      <h2>{k.label}</h2>
                      <p className="font-display text-2xl">
                        {d.balances.find(
                          (b) =>
                            b.staff_id === session?.user.id &&
                            b.kind === k.value,
                        )?.hours ?? "Needs setup"}
                        {d.balances.some(
                          (b) =>
                            b.staff_id === session?.user.id &&
                            b.kind === k.value,
                        )
                          ? " hours"
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
                <WorkforceForm
                  title="Request time off"
                  pending={pending}
                  fields={[
                    { name: "kind", label: "Leave type", options: kindOptions },
                    ...dateFields,
                    {
                      name: "hours",
                      label: "Total hours requested",
                      type: "number",
                    },
                    {
                      name: "reason",
                      label: "Private note to approvers",
                      type: "textarea",
                      optional: true,
                    },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "request_leave",
                      { ...v, hours: Number(v.hours) },
                      requestId,
                    )
                  }
                />
                <section className="space-y-3">
                  <h2 className="font-display text-xl">
                    {d.can_manage ? "Leave requests to review" : "My requests"}
                  </h2>
                  {d.requests.length === 0 && (
                    <p>No requests in this date range.</p>
                  )}
                  {d.requests.map((r) => (
                    <article
                      key={r.id}
                      className="space-y-2 rounded-xl border bg-card p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <h3 className="font-medium">
                          {name(r.staff_id)} · {r.kind} · {r.hours} hours
                        </h3>
                        <Badge variant="secondary">{r.status}</Badge>
                      </div>
                      <p>
                        {r.starts_on} – {r.ends_on}
                      </p>
                      {r.reason && (
                        <p className="text-sm text-muted-foreground">
                          {r.reason}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {d.can_manage && r.status === "PENDING" && (
                          <>
                            {action(
                              "Approve",
                              "decide_leave",
                              { version: r.version, decision: "APPROVED" },
                              r.id,
                            )}
                            {action(
                              "Deny",
                              "decide_leave",
                              { version: r.version, decision: "DENIED" },
                              r.id,
                            )}
                          </>
                        )}
                        {["PENDING", "APPROVED"].includes(r.status) &&
                          action(
                            "Cancel request",
                            "decide_leave",
                            { version: r.version, decision: "CANCELLED" },
                            r.id,
                          )}
                      </div>
                    </article>
                  ))}
                </section>
              </>
            )}
            {tab === "calendar" && (
              <>
                <section className="space-y-2">
                  <h2 className="font-display text-xl">Who's off</h2>
                  {d.off.length === 0 && (
                    <p>No approved time off in this range.</p>
                  )}
                  {d.off.map((o) => (
                    <p key={o.id} className="rounded border bg-card p-3">
                      {name(o.staff_id)} · {o.starts_on} – {o.ends_on}
                    </p>
                  ))}
                </section>
                <section>
                  <h2 className="font-display text-xl">Holidays</h2>
                  {d.holidays.map((h) => (
                    <p key={h.day}>
                      {h.day} · {h.label} ·{" "}
                      {h.closed ? "Clinic closed" : "Clinic open"}
                    </p>
                  ))}
                </section>
                <section className="space-y-2">
                  <h2 className="font-display text-xl">Staff shifts</h2>
                  {d.shifts
                    .filter((s) => !s.cancelled)
                    .map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border bg-card p-3"
                      >
                        <p>
                          {name(s.staff_id)} · {stamp(s.starts_at)} –{" "}
                          {stamp(s.ends_at)} {s.note}
                        </p>
                        {d.can_manage &&
                          action(
                            "Cancel shift",
                            "cancel_shift",
                            { version: s.version },
                            s.id,
                          )}
                      </div>
                    ))}
                </section>
                {d.can_manage && (
                  <WorkforceForm
                    title="Schedule a staff shift"
                    pending={pending}
                    fields={[
                      staffField,
                      ...instantFields,
                      { name: "note", label: "Coverage note", optional: true },
                    ]}
                    submit={(v, requestId) =>
                      perform(
                        "shift",
                        {
                          ...v,
                          starts_at: denverInstant(str(v, "starts_at")),
                          ends_at: denverInstant(str(v, "ends_at")),
                        },
                        requestId,
                      )
                    }
                  />
                )}
              </>
            )}
            {tab === "time" && (
              <>
                <section className="space-y-2">
                  <h2 className="font-display text-xl">Pay periods</h2>
                  {d.periods.map((p) => (
                    <article
                      key={p.id}
                      className="space-y-2 rounded-xl border bg-card p-4"
                    >
                      <h3>
                        {p.starts_on} – {p.ends_on} · {p.state}
                      </h3>
                      {p.time_changed && (
                        <p role="status" className="text-sm text-destructive">
                          Live time entries changed after finalization. The
                          approved payroll snapshot is preserved; reconcile the
                          difference as an adjustment.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {p.state === "OPEN" &&
                          action("Submit my time", "submit_time", {}, p.id)}
                        {d.can_manage &&
                          p.state === "OPEN" &&
                          action("Finalize period", "close_period", {}, p.id)}
                      </div>
                      {d.approvals
                        .filter((a) => a.period_id === p.id)
                        .map((a) => (
                          <div
                            key={a.staff_id}
                            className="flex flex-wrap gap-3"
                          >
                            <span>
                              {name(a.staff_id)} ·{" "}
                              {a.approved_at ? "Approved" : "Submitted"}
                            </span>
                            {d.can_manage &&
                              p.state === "OPEN" &&
                              action(
                                "Approve current time",
                                "approve_time",
                                { staff_id: a.staff_id },
                                p.id,
                              )}
                          </div>
                        ))}
                    </article>
                  ))}
                </section>
                {d.can_manage && (
                  <WorkforceForm
                    title="Create pay period"
                    pending={pending}
                    fields={dateFields}
                    submit={(v, requestId) => perform("period", v, requestId)}
                  />
                )}
                <WorkforceForm
                  title="Request a missed shift or correction"
                  pending={pending}
                  description="For a missed shift, leave the existing entry empty. An approver must review every request."
                  fields={[
                    {
                      name: "entry_id",
                      label: "Existing entry",
                      optional: true,
                      options: d.entries
                        .filter(
                          (e) =>
                            e.staff_id === session?.user.id && e.clock_out_at,
                        )
                        .map((e) => ({
                          value: e.id,
                          label: stamp(e.clock_in_at),
                        })),
                    },
                    ...instantFields,
                    { name: "reason", label: "What needs correcting?" },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "correction",
                      {
                        ...v,
                        entry_id: v.entry_id || null,
                        starts_at: denverInstant(str(v, "starts_at")),
                        ends_at: denverInstant(str(v, "ends_at")),
                      },
                      requestId,
                    )
                  }
                />
                {d.corrections.map((c) => (
                  <article
                    key={c.id}
                    className="space-y-2 rounded border bg-card p-3"
                  >
                    <h3>
                      {name(c.staff_id)} · {c.status}
                    </h3>
                    <p>
                      {stamp(c.starts_at)} – {stamp(c.ends_at)}
                    </p>
                    <p>{c.reason}</p>
                    {d.can_manage && c.status === "PENDING" && (
                      <div className="flex gap-2">
                        {action(
                          "Approve correction",
                          "resolve_correction",
                          { decision: "APPROVED" },
                          c.id,
                        )}
                        {action(
                          "Deny correction",
                          "resolve_correction",
                          { decision: "DENIED" },
                          c.id,
                        )}
                      </div>
                    )}
                  </article>
                ))}
                {d.flags
                  .filter((f) => !f.reviewed_at)
                  .map((f) => (
                    <div
                      key={f.entry_id}
                      className="space-y-2 rounded border p-3"
                    >
                      <p>
                        Estimated clock-out:{" "}
                        {name(
                          d.entries.find((e) => e.id === f.entry_id)
                            ?.staff_id ?? "",
                        )}{" "}
                        · {stamp(f.estimated_at)}
                      </p>
                      <p className="text-sm">
                        Confirm actual worked time; request a correction if this
                        estimate is wrong.
                      </p>
                      {d.can_manage &&
                        action("Mark reviewed", "review_clock", {}, f.entry_id)}
                    </div>
                  ))}
                <section className="space-y-2">
                  <h2 className="font-display text-xl">Attendance</h2>
                  {d.settings.late_grace_minutes === null && (
                    <p>Lateness rules need setup.</p>
                  )}
                  {attendance(d, Date.now()).map((r) => (
                    <p key={r.shiftId}>
                      {name(r.staffId)} · {stamp(r.scheduled)} ·{" "}
                      {r.excused
                        ? "Approved absence / closure"
                        : r.actual
                          ? r.lateMinutes === null
                            ? "Grace rule not set"
                            : `${r.lateMinutes} minutes late after grace`
                          : "No matching punch — review"}
                    </p>
                  ))}
                </section>
                <section className="space-y-2">
                  <h2 className="font-display text-xl">
                    Hours in selected range
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Preview only. Use complete workweeks when checking weekly
                    overtime; open shifts are excluded.
                  </p>
                  {d.settings.weekly_hours === null ||
                  d.settings.workweek_start === null ? (
                    <p>Workweek and overtime rules need setup.</p>
                  ) : (
                    timeTotals(d.entries, d.settings, from, until).map((t) => (
                      <p key={t.staffId}>
                        {name(t.staffId)} · {t.regular.toFixed(2)} regular hours
                        ·{" "}
                        <strong
                          className={t.overtime > 0 ? "text-destructive" : ""}
                        >
                          {t.overtime.toFixed(2)} overtime hours
                        </strong>
                        {t.open && " · Open shift needs review"}
                      </p>
                    ))
                  )}
                </section>
              </>
            )}
            {tab === "manage" && d.can_manage && (
              <div className="grid items-start gap-4 md:grid-cols-2">
                <WorkforceForm
                  key={d.settings.version}
                  title="Attendance rules"
                  description="Leave a value blank until the clinic approves its policy. Blank auto clock-out keeps automation off."
                  pending={pending}
                  fields={[
                    {
                      name: "workweek_start",
                      label: "Workweek starts",
                      optional: true,
                      value: d.settings.workweek_start,
                      options: [
                        "Sunday",
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                        "Saturday",
                      ].map((label, n) => ({ value: String(n), label })),
                    },
                    ...(
                      [
                        ["weekly_hours", "Weekly regular-hour limit"],
                        ["daily_hours", "Daily regular-hour limit (optional)"],
                        ["auto_close_hours", "Estimate clock-out after hours"],
                        ["late_grace_minutes", "Late-arrival grace (minutes)"],
                      ] as const
                    ).map(([key, label]) => ({
                      name: key,
                      label,
                      type: "number" as const,
                      optional: true,
                      value: d.settings[key],
                    })),
                    {
                      name: "payroll_provider",
                      label: "Payroll provider",
                      optional: true,
                      value: d.settings.payroll_provider,
                    },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "settings",
                      {
                        version: d.settings.version,
                        workweek_start: number(v, "workweek_start"),
                        weekly_hours: number(v, "weekly_hours"),
                        daily_hours: number(v, "daily_hours"),
                        auto_close_hours: number(v, "auto_close_hours"),
                        late_grace_minutes: number(v, "late_grace_minutes"),
                        payroll_provider: str(v, "payroll_provider") || null,
                      },
                      requestId,
                    )
                  }
                />
                <WorkforceForm
                  title="Monthly leave policy"
                  description="Accrues completed full months. Prorated amounts use opening balances/adjustments. Set a future first-of-month date for policy changes."
                  pending={pending}
                  fields={[
                    { name: "kind", label: "Type", options: kindOptions },
                    {
                      name: "monthly_hours",
                      label: "Hours per completed month",
                      type: "number",
                    },
                    {
                      name: "cap_hours",
                      label: "Balance cap (blank = none)",
                      type: "number",
                      optional: true,
                    },
                    {
                      name: "effective_from",
                      label: "Effective first of month",
                      type: "date",
                    },
                    {
                      name: "allow_negative",
                      label: "Allow negative balances",
                      type: "checkbox",
                    },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "policy",
                      {
                        ...v,
                        monthly_hours: Number(v.monthly_hours),
                        cap_hours: number(v, "cap_hours"),
                      },
                      requestId,
                    )
                  }
                />
                <WorkforceForm
                  title="Enroll employee & opening balance"
                  pending={pending}
                  fields={[
                    staffField,
                    { name: "kind", label: "Type", options: kindOptions },
                    {
                      name: "enrolled_on",
                      label: "Accrual eligibility starts",
                      type: "date",
                    },
                    { name: "hours", label: "Opening hours", type: "number" },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "enroll",
                      { ...v, hours: Number(v.hours) },
                      requestId,
                    )
                  }
                />
                <WorkforceForm
                  title="Leave balance adjustment"
                  pending={pending}
                  fields={[
                    staffField,
                    { name: "kind", label: "Type", options: kindOptions },
                    {
                      name: "hours",
                      label: "Hours to add (negative subtracts)",
                      type: "number",
                    },
                    { name: "reason", label: "Reason" },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "adjust_balance",
                      { ...v, hours: Number(v.hours) },
                      requestId,
                    )
                  }
                />
                <WorkforceForm
                  title="Holiday / closure"
                  pending={pending}
                  description="Paid hours are a policy setting, not an automatic employee entitlement."
                  fields={[
                    { name: "day", label: "Date", type: "date" },
                    { name: "label", label: "Holiday name" },
                    {
                      name: "closed",
                      label: "Clinic closed",
                      type: "checkbox",
                    },
                    {
                      name: "paid_hours",
                      label: "Policy paid hours",
                      type: "number",
                    },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "holiday",
                      {
                        ...v,
                        paid_hours: Number(v.paid_hours),
                      },
                      requestId,
                    )
                  }
                />
                <section className="space-y-3 rounded-xl border bg-card p-4">
                  <h2 className="font-display text-lg">
                    Accrual & clock-out jobs
                  </h2>
                  <p className="text-sm">
                    Automatic schedule:{" "}
                    {d.job_active === null
                      ? "Needs backend setup"
                      : d.job_active
                        ? "Enabled"
                        : "Paused"}
                  </p>
                  <Button
                    disabled={pending || d.job_active === null}
                    variant="outline"
                    onClick={async () => {
                      setPending(true);
                      try {
                        await toggleWorkforceJobs(!d.job_active);
                        await client.invalidateQueries({
                          queryKey: ["workforce"],
                        });
                        setNotice("Schedule updated.");
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not change schedule",
                        );
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    {d.job_active
                      ? "Pause automatic jobs"
                      : "Enable configured automatic jobs"}
                  </Button>
                  <p className="text-sm">
                    Runs only configured rules. Repeated runs do not duplicate
                    accruals.
                  </p>
                  <Button
                    disabled={pending}
                    onClick={async () => {
                      setPending(true);
                      try {
                        await runWorkforceJobs();
                        await client.invalidateQueries({
                          queryKey: ["workforce"],
                        });
                        setNotice("Jobs completed.");
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "Jobs failed",
                        );
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    Run configured jobs now
                  </Button>
                  {d.policies.map((p) => (
                    <p key={p.kind}>
                      {p.kind}: {p.monthly_hours} hours/month · cap{" "}
                      {p.cap_hours ?? "none"} · from {p.effective_from}
                    </p>
                  ))}
                </section>
              </div>
            )}
            {tab === "access" && d.can_assign && (
              <>
                <p className="text-sm text-muted-foreground">
                  Assign Dave and Susan using their existing staff accounts.
                  Time approval and private pay access are separate permissions.
                </p>
                <WorkforceForm
                  title="Assign approver permissions"
                  pending={pending}
                  fields={[
                    staffField,
                    {
                      name: "time_manager",
                      label: "Approve time and leave",
                      type: "checkbox",
                    },
                    {
                      name: "pay_manager",
                      label: "Manage private pay and benefits",
                      type: "checkbox",
                    },
                  ]}
                  submit={(v) =>
                    perform(
                      "access",
                      {
                        time_manager: Boolean(v.time_manager),
                        pay_manager: Boolean(v.pay_manager),
                      },
                      str(v, "staff_id"),
                    )
                  }
                />
                {d.access.map((a) => (
                  <p key={a.staff_id}>
                    {name(a.staff_id)} · time {a.time_manager ? "yes" : "no"} ·
                    pay {a.pay_manager ? "yes" : "no"}
                  </p>
                ))}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
