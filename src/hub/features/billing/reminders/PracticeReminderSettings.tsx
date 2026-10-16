import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hub/contexts/auth-context";
import { ReminderPolicyFields } from "./ReminderPolicyFields";
import { defaultPolicy, policyFromDraft, practicePolicySchema } from "./model";
import {
  readPracticeReminders,
  recoverReminderAction,
  saveReminderAction,
  type ReminderAction,
} from "./api";

interface PracticeReminderSettingsProps {
  onDirtyChange: (dirty: boolean) => void;
}
export function PracticeReminderSettings({
  onDirtyChange,
}: PracticeReminderSettingsProps) {
  const { session, hasRole } = useAuth();
  return session && hasRole("ADMIN") ? (
    <PracticeSession
      key={session.user.id}
      actor={session.user.id}
      onDirtyChange={onDirtyChange}
    />
  ) : null;
}
interface PracticeSessionProps {
  actor: string;
  onDirtyChange: (dirty: boolean) => void;
}
function PracticeSession({ actor, onDirtyChange }: PracticeSessionProps) {
  const cache = useQueryClient();
  const data = useQuery({
    queryKey: ["invoice-reminder-practice", actor],
    queryFn: () => readPracticeReminders(actor),
  });
  const [policy, setPolicy] = useState(defaultPolicy),
    [days, setDays] = useState("7, 14, 30");
  const [base, setBase] = useState(""),
    [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<ReminderAction | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const initialized = useRef(false),
    active = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const edited = Boolean(base) && JSON.stringify({ policy, days }) !== base;
  const dirty = edited || busy || Boolean(pending);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  function load(value: z.infer<typeof practicePolicySchema>["policy"]) {
    const p = value?.definition ?? defaultPolicy,
      d = p.offset_days.join(", ");
    setPolicy(p);
    setDays(d);
    setVersion(value?.version ?? 0);
    setBase(JSON.stringify({ policy: p, days: d }));
  }
  useEffect(() => {
    if (data.data && !initialized.current) {
      load(data.data.policy);
      initialized.current = true;
    }
  }, [data.data]);
  async function reload() {
    if (locked.current || pending) return;
    locked.current = true;
    setBusy(true);
    try {
      const result = await data.refetch();
      if (result.error) throw result.error;
      if (result.data && active.current) {
        load(result.data.policy);
        setError("");
        setNotice("");
        initialized.current = true;
      }
    } catch {
      if (active.current)
        setError(
          "Saved settings could not be loaded. Your edits are retained.",
        );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function run(action: ReminderAction, recoverOnly = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const previouslyUnconfirmed = Boolean(pending);
    setPending(action);
    let writing = false;
    try {
      let saved = await recoverReminderAction(action);
      if (!active.current) return;
      if (!saved) {
        if (recoverOnly) {
          if (active.current)
            setNotice(
              "No saved receipt found. Retry this same request to finish saving.",
            );
          return;
        }
        writing = true;
        saved = await saveReminderAction(action);
      }
      if (!active.current) return;
      const confirmed = practicePolicySchema.shape.policy.unwrap().parse(saved);
      load(confirmed);
      setPending(null);
      setNotice("Practice reminder policy saved.");
      void cache.invalidateQueries({ queryKey: ["invoice-reminders"] });
      const result = await data.refetch();
      if (!active.current) return;
      if (result.error)
        setError(
          "The save was confirmed, but the current policy could not be refreshed. Reload saved settings.",
        );
      else if (result.data) load(result.data.policy);
    } catch (failure) {
      if (!active.current) return;
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? String(failure.code)
          : "";
      // A failed recovery never proves that an earlier write did not commit.
      if (
        writing &&
        !previouslyUnconfirmed &&
        ["23514", "23503", "42501", "PT409", "22P02"].includes(code)
      )
        setPending(null);
      setError(
        code === "PT409"
          ? "Practice reminder settings changed. Your edits are retained; reload and review the current policy."
          : failure && typeof failure === "object" && "message" in failure
            ? String(failure.message)
            : "The save could not be confirmed. Recover or retry the same request.",
      );
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function save() {
    try {
      void run({
        id: crypto.randomUUID(),
        actor,
        kind: "policy",
        request: {
          expected_version: version,
          definition: policyFromDraft(policy, days),
        },
      });
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
  return (
    <>
      <Card role="region" aria-label="Practice unpaid invoice reminders">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4 text-primary" />
            Unpaid invoice reminders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Configure the practice policy here before your first invoice. Due on
            receipt and email at 7, 14 and 30 days overdue are the starting
            defaults. Enroll individual issued invoices in the household Billing
            tab.
          </p>
          {data.isPending && (
            <p role="status">Loading practice reminder policy…</p>
          )}
          {data.data && (
            <p className="text-sm" role="status">
              {data.data.policy
                ? `Saved policy version ${data.data.policy.version}`
                : "No practice policy has been saved."}
              {" · "}
              {data.data.scheduler.cron_active
                ? "Automatic scheduling is enabled. Email delivery still needs a separate setup check."
                : "Automatic scheduling is not commissioned. Saving this policy does not start emails."}
            </p>
          )}
          {data.isError && (
            <p role="alert">
              Current policy unavailable. Your edits are retained.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {busy && <p role="status">Updating reminder settings…</p>}
          {pending && !busy && (
            <div className="space-y-2">
              <p>
                The save is unconfirmed. Recover its receipt or retry the same
                request before changing the policy.
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
          {(edited || data.isError || error) && (
            <Button
              variant="outline"
              disabled={busy || Boolean(pending)}
              onClick={() => void reload()}
            >
              Discard edits and reload saved policy
            </Button>
          )}
          <ReminderPolicyFields
            prefix="practice-invoice-reminder"
            policy={policy}
            days={days}
            disabled={
              busy || Boolean(pending) || data.isError || !initialized.current
            }
            canSave={edited || !data.data?.policy}
            onPolicyChange={setPolicy}
            onDaysChange={setDays}
            onSave={save}
          />
        </CardContent>
      </Card>
    </>
  );
}
