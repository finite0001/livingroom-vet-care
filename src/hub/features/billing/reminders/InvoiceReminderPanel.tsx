import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReminderPolicyFields } from "./ReminderPolicyFields";
import { money } from "../money";
import {
  defaultPolicy,
  policyFromDraft,
  proposedDueDate,
  reminderReason,
  termsSchema,
} from "./model";
import {
  readReminders,
  recoverReminderAction,
  saveReminderAction,
  type ReminderAction,
} from "./api";
interface InvoiceReminderPanelProps {
  invoiceId: string;
  clientId: string;
  issuedAt: string | null;
  canEdit: boolean;
  disabled?: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
export function InvoiceReminderPanel(props: InvoiceReminderPanelProps) {
  const { session, hasRole } = useAuth();
  return session ? (
    <ReminderSession
      key={`${session.user.id}:${props.invoiceId}:${props.clientId}`}
      {...props}
      actor={session.user.id}
      admin={hasRole("ADMIN")}
    />
  ) : null;
}
interface ReminderSessionProps extends InvoiceReminderPanelProps {
  actor: string;
  admin: boolean;
}
function ReminderSession({
  actor,
  admin,
  invoiceId,
  clientId,
  issuedAt,
  canEdit,
  disabled,
  onDirtyChange,
}: ReminderSessionProps) {
  const data = useQuery({
    queryKey: ["invoice-reminders", actor, invoiceId, clientId],
    queryFn: () => readReminders(actor, invoiceId, clientId),
  });
  const initialTerms = {
    due_on: proposedDueDate(issuedAt, 0),
    enabled: false,
    channel: "EMAIL" as const,
    hold_kind: "none" as const,
    hold_reason: "",
  };
  const [terms, setTerms] = useState<z.infer<typeof termsSchema>>(initialTerms);
  const [policy, setPolicy] = useState(defaultPolicy);
  const [days, setDays] = useState("7, 14, 30");
  const [base, setBase] = useState({ terms: "", policy: "", days: "" });
  const [versions, setVersions] = useState({ terms: 0, policy: 0 });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<ReminderAction | null>(null);
  const initialized = useRef(false),
    locked = useRef(false),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const termsDirty =
    Boolean(base.terms) && JSON.stringify(terms) !== base.terms;
  const policyDirty =
    Boolean(base.policy) &&
    (JSON.stringify(policy) !== base.policy || days !== base.days);
  const dirty = busy || Boolean(pending) || termsDirty || policyDirty;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  function load(value: Awaited<ReturnType<typeof readReminders>>) {
    const p = value.policy?.definition ?? defaultPolicy;
    const t = value.terms
      ? termsSchema.parse({
          due_on: value.terms.due_on,
          enabled: value.terms.enabled,
          channel: value.terms.channel,
          hold_kind: value.terms.hold_kind,
          hold_reason: value.terms.hold_reason,
        })
      : {
          ...initialTerms,
          due_on: proposedDueDate(issuedAt, p.default_due_days),
        };
    setPolicy(p);
    setTerms(t);
    setDays(p.offset_days.join(", "));
    setBase({
      terms: JSON.stringify(t),
      policy: JSON.stringify(p),
      days: p.offset_days.join(", "),
    });
    setVersions({
      terms: value.terms?.version ?? 0,
      policy: value.policy?.version ?? 0,
    });
  }
  useEffect(() => {
    if (data.data && !initialized.current) {
      load(data.data);
      initialized.current = true;
    }
    // Initial loading only. Background refresh must preserve edited wording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);
  async function run(action: ReminderAction, recoverOnly = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPending(action);
    try {
      const receipt = await recoverReminderAction(action);
      if (!receipt) {
        if (recoverOnly) {
          setNotice(
            "No saved receipt found. Retry this same request to finish saving.",
          );
          return;
        }
        await saveReminderAction(action);
      }
      if (!active.current) return;
      setPending(null);
      setNotice("Reminder settings saved.");
      const result = await data.refetch();
      if (result.data && !result.error && active.current) load(result.data);
    } catch (failure) {
      if (!active.current) return;
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? String(failure.code)
          : "";
      if (
        [
          "23514",
          "23503",
          "42501",
          "PT409",
          "22P02",
          "22007",
          "22008",
        ].includes(code)
      )
        setPending(null);
      setError(
        failure && typeof failure === "object" && "message" in failure
          ? String(failure.message)
          : "The save could not be confirmed. Recover or retry the same request.",
      );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function save(kind: "policy" | "terms") {
    try {
      let request: Record<string, unknown>;
      if (kind === "policy") {
        request = {
          expected_version: versions.policy,
          definition: policyFromDraft(policy, days),
        };
      } else
        request = {
          invoice_id: invoiceId,
          client_id: clientId,
          expected_version: versions.terms,
          values: termsSchema.parse(terms),
        };
      void run({ id: crypto.randomUUID(), actor, kind, request });
    } catch (failure) {
      setError(
        failure instanceof z.ZodError
          ? failure.issues[0].message
          : failure instanceof Error
            ? failure.message
            : "Review the reminder settings.",
      );
    }
  }
  const unavailable = Boolean(
    disabled || busy || pending || data.isError || !initialized.current,
  );
  const prefix = `invoice-reminder-${invoiceId}`;
  return (
    <section
      aria-label="Unpaid invoice reminders"
      className="space-y-4 rounded-md border p-4"
    >
      <h4 className="font-semibold">Unpaid invoice reminders</h4>
      <p className="text-sm text-muted-foreground">
        Due on receipt; email reminders at 7, 14 and 30 days overdue are the
        practice starting defaults. Save a due date and enrollment for this
        invoice. Affirm manages its own financing installments.
      </p>
      {data.isPending && <p role="status">Loading reminder settings…</p>}
      {data.data && !data.data.scheduler.cron_active && (
        <p className="text-sm text-warning">
          Automatic scheduling is not commissioned yet. Saved settings do not
          send reminders until the worker and scheduler are enabled.
        </p>
      )}
      {data.isError && (
        <p role="alert">
          Current reminder settings unavailable. Your edits are retained.{" "}
          <Button variant="outline" onClick={() => void data.refetch()}>
            Reload reminder settings
          </Button>
        </p>
      )}
      {(termsDirty || policyDirty || data.isError) && (
        <Button
          variant="outline"
          disabled={busy || Boolean(pending)}
          onClick={() => {
            void data.refetch().then((r) => {
              if (r.data && !r.error && active.current) {
                load(r.data);
                setError("");
              }
            });
          }}
        >
          Discard edits and reload saved settings
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="space-y-2">
          <p>
            The save is unconfirmed. Recover its receipt or retry the same
            request before changing settings.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(pending, true)}>
              Recover reminder save
            </Button>
            <Button disabled={busy} onClick={() => void run(pending)}>
              Retry reminder save
            </Button>
          </div>
        </div>
      )}
      {data.data && (
        <p role="status" className="text-sm">
          Clinic balance: {money(Number(data.data.context.amount_cents))} ·{" "}
          {data.data.context.reason
            ? (reminderReason[data.data.context.reason] ??
              "Review reminder eligibility")
            : `Reached ${data.data.context.offset_days}-day stage; scheduler checks delivery history before queueing`}
        </p>
      )}
      <fieldset
        disabled={unavailable || !canEdit || policyDirty}
        className="space-y-3"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor={`${prefix}-due`}>Invoice due date (Denver)</Label>
            <Input
              id={`${prefix}-due`}
              type="date"
              value={terms.due_on}
              onChange={(e) => setTerms({ ...terms, due_on: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`${prefix}-channel`}>Reminder channel</Label>
            <select
              id={`${prefix}-channel`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={terms.channel}
              onChange={(e) =>
                setTerms({
                  ...terms,
                  channel: e.target.value as "EMAIL" | "SMS",
                })
              }
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">Text (requires recorded consent)</option>
            </select>
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={terms.enabled}
            onChange={(e) => setTerms({ ...terms, enabled: e.target.checked })}
          />
          Enable reminders for this invoice
        </label>
        <div>
          <Label htmlFor={`${prefix}-hold`}>Reminder hold</Label>
          <select
            id={`${prefix}-hold`}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={terms.hold_kind}
            onChange={(e) =>
              setTerms({
                ...terms,
                hold_kind: e.target.value as typeof terms.hold_kind,
                hold_reason: e.target.value === "none" ? "" : terms.hold_reason,
              })
            }
          >
            <option value="none">No hold</option>
            <option value="paused">Paused</option>
            <option value="disputed">Disputed invoice</option>
            <option value="bereavement">Bereavement</option>
          </select>
        </div>
        {terms.hold_kind !== "none" && (
          <div>
            <Label htmlFor={`${prefix}-reason`}>Hold reason</Label>
            <Input
              id={`${prefix}-reason`}
              value={terms.hold_reason}
              maxLength={1000}
              onChange={(e) =>
                setTerms({ ...terms, hold_reason: e.target.value })
              }
            />
          </div>
        )}
        <Button
          onClick={() => save("terms")}
          disabled={!termsDirty && Boolean(data.data?.terms)}
        >
          Save invoice reminder settings
        </Button>
      </fieldset>
      {admin && (
        <details>
          <summary className="cursor-pointer py-3 font-medium">
            Practice reminder defaults and wording
          </summary>
          <ReminderPolicyFields
            prefix={prefix}
            policy={policy}
            days={days}
            disabled={unavailable || termsDirty}
            canSave={policyDirty || !data.data?.policy}
            onPolicyChange={setPolicy}
            onDaysChange={setDays}
            onSave={() => save("policy")}
          />
        </details>
      )}
      {data.data && (
        <div className="space-y-2">
          <h5 className="font-medium">Reminder delivery history</h5>
          {!data.data.history.length && (
            <p className="text-sm text-muted-foreground">
              No reminder has been queued for this invoice.
            </p>
          )}
          <ul className="space-y-2">
            {data.data.history.map((j) => (
              <li key={j.id} className="rounded-md border p-3 text-sm">
                <p>
                  {j.offset_days}-day reminder · {money(Number(j.amount_cents))}{" "}
                  ·{" "}
                  {j.state === "accepted"
                    ? "Provider accepted; delivery unconfirmed"
                    : j.state === "failed" &&
                        j.last_error?.startsWith("invoice_reminder_")
                      ? "Suppressed before sending"
                      : j.state}
                </p>
                <p className="text-muted-foreground">
                  {new Date(j.created_at).toLocaleString("en-US", {
                    timeZone: "America/Denver",
                  })}{" "}
                  (Denver) · Attempts: {j.attempt_count}
                </p>
                {j.last_error && (
                  <p>
                    {j.last_error.startsWith("invoice_reminder_")
                      ? "Invoice balance or reminder eligibility changed."
                      : "Review the message in Daily communications before retrying."}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {data.data.has_more && (
            <p className="text-sm text-muted-foreground">
              Latest 20 reminders shown. Earlier delivery history remains in
              Daily communications.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
