import { BackupHealth } from "./BackupHealth";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hub/contexts/auth-context";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  peopleCommand,
  readPeople,
  uploadBenefit,
  benefitDownload,
} from "./people-api";
import { payrollCsv, dollarsToCents, type Payroll } from "./people-model";
import { WorkforceForm, type FormField } from "./WorkforceForm";
import { denverInstant } from "../scheduling/time";
export default function PeoplePage() {
  usePageTitle("Pay, benefits & reviews");
  const { session } = useAuth();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ["staff-people", session?.user.id],
    queryFn: readPeople,
    enabled: Boolean(session?.user.id),
  });
  const [tab, setTab] = useState("benefits");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [download, setDownload] = useState<{ id: string; url: string } | null>(
    null,
  );
  const d = query.data;
  const name = (id: string) =>
    d?.staff.find((s) => s.id === id)?.name ?? "Staff";
  const staffField: FormField = {
    name: "staff_id",
    label: "Employee",
    options: d?.staff.map((s) => ({ value: s.id, label: s.name })) ?? [],
  };
  async function perform(action: string, data: unknown, id?: string) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const r = await peopleCommand(action, data, id);
      if (r.snapshot) setPayroll(r.snapshot);
      await cache.invalidateQueries({ queryKey: ["staff-people"] });
      setNotice("Saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setPending(false);
    }
  }
  async function upload(id: string, path: string, file: File) {
    setPending(true);
    setError("");
    try {
      await uploadBenefit(path, file);
      await peopleCommand("complete_benefit", {}, id);
      await cache.invalidateQueries({ queryKey: ["staff-people"] });
      setNotice("Completed PDF saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="font-display text-2xl">Pay, benefits & reviews</h1>
        <p className="text-sm text-muted-foreground">
          Private employee documents and assigned management tools.
        </p>
      </header>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {query.isPending ? (
        <p>Loading private staff records…</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : (
        d && (
          <>
            <nav aria-label="People sections" className="flex flex-wrap gap-2">
              {[
                ["benefits", "SIMPLE IRA & benefits"],
                ["pay", "Pay & payroll"],
                ["reviews", "Peer reviews"],
                ...(d.can_pay ? [["recovery", "Backup health"]] : []),
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
            {tab === "benefits" && (
              <>
                {d.can_pay && (
                  <WorkforceForm
                    title="Assign a SIMPLE IRA / benefits form"
                    description="Use the provider's approved current form. No form or contribution policy is assumed."
                    pending={pending}
                    fields={[
                      staffField,
                      {
                        name: "title",
                        label: "Form name",
                        value: "SIMPLE IRA enrollment",
                      },
                      { name: "provider", label: "Provider" },
                      {
                        name: "form_version",
                        label: "Form version / plan year",
                      },
                      { name: "form_url", label: "Official form URL (HTTPS)" },
                      { name: "due_on", label: "Due date", type: "date" },
                    ]}
                    submit={(v, requestId) => perform("benefit", v, requestId)}
                  />
                )}
                {d.benefits.length === 0 && <p>No benefits forms assigned.</p>}
                {d.benefits.map((b) => (
                  <article
                    key={b.id}
                    className="space-y-3 rounded-xl border bg-card p-4"
                  >
                    <h2 className="font-display text-lg">{b.title}</h2>
                    <p>
                      {name(b.staff_id)} · {b.provider} · {b.form_version} · due{" "}
                      {b.due_on}
                    </p>
                    <a
                      className="text-sm underline"
                      href={b.form_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open approved form
                    </a>
                    <p>
                      {b.completed_at
                        ? "Completed PDF uploaded"
                        : "Awaiting completed PDF"}
                    </p>
                    {!b.completed_at && (
                      <label className="block text-sm">
                        Upload completed PDF (10 MB maximum)
                        <input
                          type="file"
                          accept="application/pdf"
                          disabled={pending}
                          className="mt-2 block"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void upload(b.id, b.object_path, file);
                          }}
                        />
                      </label>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={async () => {
                          try {
                            setDownload({
                              id: b.id,
                              url: await benefitDownload(b.object_path),
                            });
                          } catch (e) {
                            setError(
                              e instanceof Error
                                ? e.message
                                : "Download failed",
                            );
                          }
                        }}
                      >
                        Prepare private download
                      </Button>
                      {!b.completed_at && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            void perform("complete_benefit", {}, b.id)
                          }
                        >
                          Confirm previously uploaded PDF
                        </Button>
                      )}
                      {download?.id === b.id && (
                        <a
                          className="text-sm underline"
                          href={download.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download PDF (link expires in 60 seconds)
                        </a>
                      )}
                    </div>
                  </article>
                ))}
              </>
            )}
            {tab === "pay" && (
              <>
                <section className="space-y-2">
                  <h2 className="font-display text-xl">Pay history</h2>
                  {d.rates.map((r) => (
                    <p key={r.id}>
                      {name(r.staff_id)} · {money(r.amount_cents)}{" "}
                      {r.basis === "HOURLY" ? "/ hour" : "/ year"} · from{" "}
                      {r.effective_on} · {r.reason}
                    </p>
                  ))}
                  {d.bonuses.map((b) => (
                    <p key={b.id}>
                      {name(b.staff_id)} · bonus {money(b.amount_cents)} ·{" "}
                      {b.reason}
                    </p>
                  ))}
                </section>
                {d.can_pay && (
                  <>
                    <div className="grid items-start gap-4 md:grid-cols-2">
                      <WorkforceForm
                        title="Record a pay rate or raise"
                        pending={pending}
                        fields={[
                          staffField,
                          {
                            name: "effective_on",
                            label: "Effective date",
                            type: "date",
                          },
                          {
                            name: "amount",
                            label: "Amount (USD)",
                            type: "number",
                          },
                          {
                            name: "basis",
                            label: "Basis",
                            options: [
                              { value: "HOURLY", label: "Hourly" },
                              {
                                value: "ANNUAL_SALARY",
                                label: "Annual salary",
                              },
                            ],
                          },
                          { name: "reason", label: "Reason / approval" },
                        ]}
                        submit={(v, requestId) =>
                          perform(
                            "rate",
                            {
                              staff_id: v.staff_id,
                              effective_on: v.effective_on,
                              amount_cents: dollarsToCents(v.amount),
                              basis: v.basis,
                              reason: v.reason,
                            },
                            requestId,
                          )
                        }
                      />
                      <WorkforceForm
                        title="Record an approved bonus"
                        pending={pending}
                        fields={[
                          staffField,
                          {
                            name: "period_id",
                            label: "Pay period",
                            options: d.periods
                              .filter((p) => !p.exported)
                              .map((p) => ({
                                value: p.id,
                                label: `${p.starts_on} – ${p.ends_on}`,
                              })),
                          },
                          {
                            name: "amount",
                            label: "Bonus (USD)",
                            type: "number",
                          },
                          { name: "reason", label: "Reason / approval" },
                        ]}
                        submit={(v, requestId) =>
                          perform(
                            "bonus",
                            {
                              staff_id: v.staff_id,
                              period_id: v.period_id,
                              amount_cents: dollarsToCents(v.amount),
                              reason: v.reason,
                            },
                            requestId,
                          )
                        }
                      />
                    </div>
                    <section className="space-y-3 rounded-xl border bg-card p-4">
                      <h2 className="font-display text-xl">
                        Payroll summaries
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Finalized approved hours, effective rates, leave and
                        bonuses. Your payroll provider calculates wages,
                        deductions and taxes. The first export freezes a
                        reproducible snapshot.
                      </p>
                      {d.periods
                        .filter((p) => p.state === "CLOSED")
                        .map((p) => (
                          <div
                            key={p.id}
                            className="flex flex-wrap items-center gap-3"
                          >
                            <span>
                              {p.starts_on} – {p.ends_on}
                            </span>
                            <Button
                              disabled={pending}
                              onClick={() => void perform("payroll", {}, p.id)}
                            >
                              {p.exported
                                ? "Open frozen summary"
                                : "Freeze & open summary"}
                            </Button>
                          </div>
                        ))}
                      {payroll && (
                        <>
                          <p>
                            {payroll.time.length} worked-day lines ·{" "}
                            {payroll.leave.length} leave entries ·{" "}
                            {payroll.bonuses.length} bonuses
                          </p>
                          <Button
                            onClick={() => {
                              const csv = payrollCsv(payroll);
                              const url = URL.createObjectURL(
                                new Blob([csv], {
                                  type: "text/csv;charset=utf-8",
                                }),
                              );
                              const link = document.createElement("a");
                              link.href = url;
                              link.download = `payroll-${payroll.period.starts_on}-${payroll.period.ends_on}.csv`;
                              link.click();
                              setTimeout(() => URL.revokeObjectURL(url), 1000);
                            }}
                          >
                            Download payroll CSV
                          </Button>
                        </>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
            {tab === "recovery" && d.can_pay && <BackupHealth />}
            {tab === "reviews" && (
              <>
                <p className="rounded border p-3 text-sm">
                  Responses are released as grouped results after the cycle ends
                  and its minimum response count is met. Comments can identify
                  you in a small team; avoid identifying details. Technical
                  administrators may have access to infrastructure logs.
                </p>
                {d.cycles.map((c) => (
                  <section
                    key={c.id}
                    className="space-y-3 rounded-xl border bg-card p-4"
                  >
                    <h2 className="font-display text-xl">
                      {c.title} · {name(c.target_id)}
                    </h2>
                    <p>
                      Ends{" "}
                      {new Date(c.ends_at).toLocaleString("en-US", {
                        timeZone: "America/Denver",
                      })}{" "}
                      · minimum {c.min_responses} responses
                    </p>
                    {c.closed ? (
                      <p>Closed</p>
                    ) : c.submitted ? (
                      <p>Your response was submitted.</p>
                    ) : c.eligible && Date.parse(c.ends_at) > Date.now() ? (
                      <WorkforceForm
                        title="Your anonymous feedback"
                        pending={pending}
                        fields={[
                          {
                            name: "score",
                            label: "Overall collaboration (1–5)",
                            type: "number",
                          },
                          {
                            name: "comment",
                            label: "Feedback",
                            optional: true,
                          },
                        ]}
                        button="Submit response"
                        submit={(v) =>
                          perform(
                            "submit_review",
                            { score: Number(v.score), comment: v.comment },
                            c.id,
                          )
                        }
                      />
                    ) : null}
                    {d.can_pay &&
                      !c.closed &&
                      Date.parse(c.ends_at) <= Date.now() && (
                        <Button
                          disabled={pending}
                          onClick={() => void perform("close_review", {}, c.id)}
                        >
                          Close & release eligible results
                        </Button>
                      )}
                    {d.results
                      .filter((r) => r.cycle_id === c.id)
                      .map((r) => (
                        <div key={r.cycle_id}>
                          {r.average === null ? (
                            <p>
                              Results withheld: minimum response count not met.
                            </p>
                          ) : (
                            <>
                              <p>
                                Average {r.average} / 5 · {r.count} responses
                              </p>
                              {r.comments.filter(Boolean).map((comment, i) => (
                                <p key={i} className="mt-2 rounded border p-3">
                                  {comment}
                                </p>
                              ))}
                            </>
                          )}
                        </div>
                      ))}
                  </section>
                ))}
                {d.can_pay && (
                  <>
                    <fieldset className="rounded border p-4">
                      <legend className="px-2">
                        Eligible reviewers (exclude the subject)
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        {d.staff.map((s) => (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={reviewers.includes(s.id)}
                              onChange={(e) =>
                                setReviewers((old) =>
                                  e.target.checked
                                    ? [...old, s.id]
                                    : old.filter((x) => x !== s.id),
                                )
                              }
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <WorkforceForm
                      title="Create a peer-review cycle"
                      pending={pending}
                      fields={[
                        {
                          ...staffField,
                          name: "target_id",
                          label: "Employee receiving feedback",
                        },
                        { name: "title", label: "Cycle name" },
                        {
                          name: "ends_at",
                          label: "Deadline (Denver)",
                          type: "datetime-local",
                        },
                        {
                          name: "min_responses",
                          label: "Minimum responses (at least 3)",
                          type: "number",
                          value: 3,
                        },
                      ]}
                      submit={(v, requestId) =>
                        perform(
                          "review_cycle",
                          {
                            ...v,
                            ends_at: denverInstant(String(v.ends_at)),
                            min_responses: Number(v.min_responses),
                            reviewers,
                          },
                          requestId,
                        )
                      }
                    />
                  </>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}
