import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { WorkforceForm } from "./WorkforceForm";
import { QuickTasksPanel } from "./QuickTasksPanel";
import { useTeam } from "./use-team";
import { denverInstant } from "../scheduling/time";
export default function TeamPage() {
  usePageTitle("Team");
  const { query, perform, pending, error, userId } = useTeam();
  const [tab, setTab] = useState("board");
  const [roster, setRoster] = useState<string[]>([]);
  const d = query.data;
  const stamp = (value: string) =>
    new Date(value).toLocaleString("en-US", { timeZone: "America/Denver" });
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="font-display text-2xl">Our team</h1>
        <p className="text-sm text-muted-foreground">
          Staff announcements, duties and time together.
        </p>
        <Link className="text-sm underline" to="/hub/team/time-off">
          Time & leave
        </Link>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Team sections">
        {[
          ["board", "Message board"],
          ["tasks", "Tasks & rotation"],
          ["events", "Events & parties"],
          ["milestones", "Milestones"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={key === tab ? "default" : "outline"}
            aria-pressed={key === tab}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {query.isPending ? (
        <p role="status">Loading team…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        d && (
          <>
            {tab === "board" && (
              <>
                <WorkforceForm
                  title="Post an announcement"
                  pending={pending}
                  fields={[
                    {
                      name: "body",
                      label: "Message to the team",
                      type: "textarea",
                    },
                  ]}
                  submit={(v, requestId) => perform("post", v, requestId)}
                />
                {d.posts.map((p) => (
                  <article
                    key={p.id}
                    className="space-y-3 rounded-xl border bg-card p-4"
                  >
                    <h2 className="text-sm font-medium">
                      {p.pinned && "Pinned · "}
                      {d.staff.find((s) => s.id === p.author)?.name ??
                        "Staff"}{" "}
                      · {stamp(p.created_at)}
                    </h2>
                    <p className="whitespace-pre-wrap">{p.body}</p>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending || p.acknowledged}
                        onClick={() => void perform("acknowledge", {}, p.id)}
                      >
                        {p.acknowledged ? "Acknowledged" : "Acknowledge"} (
                        {p.acknowledgments})
                      </Button>
                      {d.can_manage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            void perform(
                              "pin",
                              { version: p.version, pinned: !p.pinned },
                              p.id,
                            )
                          }
                        >
                          {p.pinned ? "Unpin" : "Pin"}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
                {d.posts.length === 100 && (
                  <p>Showing the latest 100 announcements.</p>
                )}
              </>
            )}
            {tab === "tasks" && (
              <>
                <QuickTasksPanel />
                {d.can_manage && (
                  <>
                    <fieldset className="rounded border p-4">
                      <legend className="px-2 font-medium">
                        Kennel-duty roster (rotation order)
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        {d.staff.map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={roster.includes(s.id)}
                              onChange={(e) =>
                                setRoster((old) =>
                                  e.target.checked
                                    ? [...old, s.id]
                                    : old.filter((x) => x !== s.id),
                                )
                              }
                            />
                            {s.name}
                            {roster.includes(s.id) &&
                              ` (${roster.indexOf(s.id) + 1})`}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <WorkforceForm
                      title="Set up rotating kennel duties"
                      description="Generates the next 31 days, skipping closures and approved absences. A manager can reassign coverage as needed."
                      pending={pending}
                      fields={[
                        {
                          name: "title",
                          label: "Duty name",
                          value: "Kennel cleaning and care",
                        },
                        { name: "starts_on", label: "First day", type: "date" },
                        { name: "ends_on", label: "Last day", type: "date" },
                        {
                          name: "local_time",
                          label: "Daily due time (HH:MM)",
                          value: "16:00",
                        },
                      ]}
                      submit={(v, requestId) =>
                        perform(
                          "rotation",
                          { ...v, staff_ids: roster },
                          requestId,
                        )
                      }
                    />
                    {d.rotations.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-3 rounded border p-3"
                      >
                        <span>
                          {r.title} · {r.starts_on} – {r.ends_on}
                        </span>
                        <Button
                          disabled={pending}
                          onClick={() =>
                            void perform("generate_rotation", {}, r.id)
                          }
                        >
                          Generate next duties
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
            {tab === "events" && (
              <>
                <WorkforceForm
                  title="Create an event or party"
                  pending={pending}
                  fields={[
                    { name: "title", label: "Event name" },
                    {
                      name: "description",
                      label: "Details",
                      type: "textarea",
                      optional: true,
                    },
                    {
                      name: "starts_at",
                      label: "Starts (Denver)",
                      type: "datetime-local",
                    },
                    {
                      name: "deadline",
                      label: "RSVP deadline (Denver)",
                      type: "datetime-local",
                    },
                    {
                      name: "capacity",
                      label: "Available places",
                      type: "number",
                    },
                  ]}
                  submit={(v, requestId) =>
                    perform(
                      "event",
                      {
                        ...v,
                        starts_at: denverInstant(String(v.starts_at)),
                        deadline: denverInstant(String(v.deadline)),
                        capacity: Number(v.capacity),
                      },
                      requestId,
                    )
                  }
                />
                {d.events.map((e) => (
                  <article
                    key={e.id}
                    className="space-y-2 rounded-xl border bg-card p-4"
                  >
                    <h2 className="font-display text-xl">
                      {e.title}
                      {e.cancelled && " · Cancelled"}
                    </h2>
                    <p>{stamp(e.starts_at)}</p>
                    <p>{e.description}</p>
                    <p className="text-sm">
                      {e.going} / {e.capacity} attending · {e.waiting}{" "}
                      waitlisted · Your response: {e.my_answer ?? "Not replied"}
                    </p>
                    {!e.cancelled && Date.parse(e.deadline) > Date.now() && (
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["YES", "Attend / join waitlist"],
                          ["MAYBE", "Maybe"],
                          ["NO", "Decline / cancel"],
                        ].map(([answer, label]) => (
                          <Button
                            key={answer}
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              void perform("rsvp", { answer }, e.id)
                            }
                          >
                            {label}
                          </Button>
                        ))}
                        {(d.can_manage || e.created_by === userId) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              void perform(
                                "cancel_event",
                                { version: e.version },
                                e.id,
                              )
                            }
                          >
                            Cancel event
                          </Button>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      RSVP by {stamp(e.deadline)}. The oldest waitlisted person
                      gets the next canceled place.
                    </p>
                  </article>
                ))}
              </>
            )}
            {tab === "milestones" && (
              <WorkforceForm
                key={JSON.stringify(d.my_milestones)}
                title="My birthday & work anniversary"
                description="Sharing is optional. Birthday year is never collected. These dates produce an annual team pop-up only when you opt in."
                pending={pending}
                fields={[
                  {
                    name: "birthday_month",
                    label: "Birthday month (1–12)",
                    type: "number",
                    optional: true,
                    value: d.my_milestones?.birthday_month,
                  },
                  {
                    name: "birthday_day",
                    label: "Birthday day",
                    type: "number",
                    optional: true,
                    value: d.my_milestones?.birthday_day,
                  },
                  {
                    name: "anniversary",
                    label: "Employment start date",
                    type: "date",
                    optional: true,
                    value: d.my_milestones?.anniversary,
                  },
                  {
                    name: "share_birthday",
                    label: "Share my birthday",
                    type: "checkbox",
                    value: d.my_milestones?.share_birthday,
                  },
                  {
                    name: "share_anniversary",
                    label: "Share my work anniversary",
                    type: "checkbox",
                    value: d.my_milestones?.share_anniversary,
                  },
                ]}
                submit={(v) =>
                  perform("milestones", {
                    ...v,
                    birthday_month: v.birthday_month
                      ? Number(v.birthday_month)
                      : null,
                    birthday_day: v.birthday_day
                      ? Number(v.birthday_day)
                      : null,
                    anniversary: v.anniversary || null,
                  })
                }
              />
            )}
          </>
        )
      )}
    </div>
  );
}
