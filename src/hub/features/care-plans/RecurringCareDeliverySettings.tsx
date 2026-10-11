import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hub/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { careDb, selectClass } from "@/hub/features/care-reminders/model";
import { deliveryWindows } from "./api";
import { minutesTime, timeMinutes } from "./calendar";
import { policySchema, policyValuesSchema, windowSchema, type DeliveryPolicyValues } from "./model";
import { useCareAction } from "./use-care-action";

interface RecurringCareDeliverySettingsProps { onDirtyChange: (dirty: boolean) => void }
interface PolicyForm { id: string; original: z.infer<typeof policySchema> | null; channel: "EMAIL" | "SMS"; templateId: string; subject: string; enabled: boolean; start: string; end: string; review: string }
interface PolicySessionProps extends RecurringCareDeliverySettingsProps { actorId: string }
export function RecurringCareDeliverySettings(props: RecurringCareDeliverySettingsProps) {
  const { session, hasRole } = useAuth();
  return hasRole("ADMIN") ? <PolicySession key={session?.user.id ?? ""} actorId={session?.user.id ?? ""} {...props} /> : null;
}
function PolicySession({ actorId, onDirtyChange }: PolicySessionProps) {
  const cache = useQueryClient(), action = useCareAction(actorId);
  const [form, setForm] = useState<PolicyForm | null>(null), [notice, setNotice] = useState("");
  const [reloading, setReloading] = useState(false);
  const dirty = !!form || action.busy || action.unconfirmed || reloading;
  useEffect(() => { onDirtyChange(dirty);return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const query = useQuery({ queryKey: ["recurring-care-delivery", actorId], enabled: !!actorId && !dirty, retry: 1, refetchOnWindowFocus: !dirty, queryFn: async () => {
    const [policies, windows] = await Promise.all([supabase.from("reminder_automation_policies").select("*").eq("source_kind", "care_plan").limit(3), deliveryWindows()]);
    if (policies.error) throw policies.error;
    return { policies: z.array(policySchema).max(2).parse(policies.data), windows };
  } });
  const wording = useQuery({ queryKey: ["care-message-templates", actorId], enabled: !!actorId, refetchOnWindowFocus: !dirty, queryFn: async () => {
    const { data, error } = await careDb.from("care_message_templates").select("*").order("name");if (error) throw error;return data;
  } });
  function open(channel: "EMAIL" | "SMS", row: z.infer<typeof policySchema> | null, window: z.infer<typeof windowSchema> | null) {
    if (action.busy || action.unconfirmed || reloading || dirty && !globalThis.confirm("Discard this delivery-policy draft?")) return;
    setForm({ id: row?.id ?? crypto.randomUUID(), original: row, channel, templateId: row?.message_template_id ?? "",
      subject: row?.subject ?? "", enabled: row?.enabled ?? false, start: minutesTime(window?.start_minute ?? 480),
      end: minutesTime(window?.end_minute ?? 1200), review: "" });action.clear();setNotice("");
  }
  const stopping = !!form?.original && !form.enabled;
  const template = wording.data?.find(row => row.id === form?.templateId);
  async function saved(receipt: unknown) {
    if (!receipt) return;
    setForm(null);setNotice("Recurring care delivery policy saved. No message is sent by this review.");
    await Promise.all(["recurring-care-delivery", "reminder-delivery-policies", "patient-care-plans", "recurring-care-due", "daily-communications"]
      .map(key => cache.invalidateQueries({ queryKey: [key] })));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (action.unconfirmed) { await saved(await action.retry());return; }
    if (!form) return;
    let values: DeliveryPolicyValues;
    try {
      if (!stopping && (!template?.active || template.channel.toUpperCase() !== form.channel)) throw new Error("Choose active reviewed wording for this channel.");
      if (!stopping && form.channel === "EMAIL" && !form.subject.trim()) throw new Error("Enter the reminder email subject.");
      values = policyValuesSchema.parse({ channel: form.channel, message_template_id: stopping ? form.original!.message_template_id : template!.id,
        message_template_version: stopping ? form.original!.message_template_version : template!.version,
        subject: stopping ? form.original!.subject : form.channel === "EMAIL" ? form.subject : "", enabled: form.enabled,
        review_note: form.review, start_minute: timeMinutes(form.start), end_minute: timeMinutes(form.end, true) });
    } catch (error) { action.setError(error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "Review delivery settings.");return; }
    await saved(await action.save({ kind: "delivery_policy", entityId: form.id, petId: null, expectedVersion: form.original?.version ?? null, values }));
  }
  async function reload() {
    if (!form || action.busy || action.unconfirmed || reloading || !globalThis.confirm("Replace this draft after loading the saved policy?")) return;
    setReloading(true);
    try {
      const latest = await query.refetch();if (latest.error || !latest.data) throw latest.error;
      const row = latest.data.policies.find(row => row.channel === form.channel) ?? null;
      const window = latest.data.windows.find(window => window.policy_id === row?.id);
      setForm({ ...form, id: row?.id ?? form.id, original: row, templateId: row?.message_template_id ?? "", subject: row?.subject ?? "",
        enabled: row?.enabled ?? false, start: minutesTime(window?.start_minute ?? 480), end: minutesTime(window?.end_minute ?? 1200), review: "" });action.clear();
    } catch { action.setError("Could not load saved delivery settings. Your draft is retained."); }
    finally { setReloading(false); }
  }
  return <section aria-label="Recurring care delivery policies" className="space-y-4 rounded-xl border bg-card p-4">
    <h2 className="font-display text-xl">Recurring care delivery policies</h2>
    <p className="text-sm text-muted-foreground">Set reviewed email and text wording with send hours in Denver time. Policies start off; patient approval and consent are also required. Saving settings does not send a message.</p>
    {query.isPending && <p role="status">Loading recurring delivery policies…</p>}
    {(query.isError || wording.isError) && <div role="alert"><p>Could not load recurring delivery settings.</p><Button variant="outline" disabled={dirty} onClick={() => void Promise.all([query.refetch(), wording.refetch()])}>Retry recurring delivery settings</Button></div>}
    <div className="grid gap-3 md:grid-cols-2">{(["EMAIL", "SMS"] as const).map(channel => {
      const row = query.data?.policies.find(row => row.channel === channel) ?? null;
      const window = query.data?.windows.find(window => window.policy_id === row?.id) ?? null;
      return <div key={channel} className="space-y-2 rounded-md border p-3"><h3 className="font-semibold">Recurring care · {channel === "EMAIL" ? "Email" : "Text"}</h3>
        <p className="text-sm">{query.isPending ? "Loading policy…" : query.isError ? "Policy status unavailable" : row ? `${row.enabled ? "Enabled" : "Off"} · revision ${row.version}` : "Off · not configured"}</p>
        {window && <p className="text-sm">Send hours: {minutesTime(window.start_minute)}–{minutesTime(window.end_minute)} (Denver)</p>}
        <Button variant="outline" disabled={action.busy || action.unconfirmed || reloading || query.isPending || query.isError} onClick={() => open(channel, row, window)}>Review recurring care {channel.toLowerCase()} delivery</Button></div>;
    })}</div>
    {form && <form onSubmit={event => void submit(event)} className="space-y-4 rounded-md border p-4">
      <h3 className="font-semibold">Review recurring care {form.channel === "EMAIL" ? "email" : "text"} delivery</h3>
      <fieldset disabled={action.busy || action.unconfirmed || reloading} className="space-y-3">
        <label className="flex items-start gap-2"><Checkbox checked={form.enabled} onCheckedChange={value => setForm({ ...form, enabled: value === true })} /><span>Enable this reviewed recurring care policy</span></label>
        {stopping && <p className="text-sm">This turns delivery off and retains the previously reviewed wording. A message already accepted by a provider cannot be recalled.</p>}
        <div><Label htmlFor="recurring-delivery-wording">Recurring care message wording</Label><select id="recurring-delivery-wording" className={selectClass} value={form.templateId} disabled={stopping || wording.isPending || wording.isError} onChange={e => setForm({ ...form, templateId: e.target.value })}>
          <option value="">Choose reviewed wording</option>{wording.data?.filter(row => row.channel.toUpperCase() === form.channel && (row.active || row.id === form.templateId))
            .map(row => <option key={row.id} value={row.id} disabled={!row.active}>{row.name} · revision {row.version}{row.active ? "" : " · retired"}</option>)}</select></div>
        {template && <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{template.body}<span className="mt-2 block text-xs text-muted-foreground">{template.days_before} days before the due date.</span></p>}
        {form.channel === "EMAIL" && <div><Label htmlFor="recurring-delivery-subject">Recurring care email subject</Label><Input id="recurring-delivery-subject" value={form.subject} disabled={stopping} maxLength={300} onChange={e => setForm({ ...form, subject: e.target.value })} /></div>}
        <div className="grid gap-3 md:grid-cols-2"><div><Label htmlFor="recurring-send-start">Denver send-window start</Label><Input id="recurring-send-start" type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></div>
          <div><Label htmlFor="recurring-send-end">Denver send-window end (HH:MM)</Label><Input id="recurring-send-end" inputMode="numeric" value={form.end} placeholder="20:00" onChange={e => setForm({ ...form, end: e.target.value })} /></div></div>
        <p className="text-xs text-muted-foreground">Same-day window; use 24:00 for midnight at the end of the day. Outside these hours, a routine reminder waits for the next window.</p>
        <div><Label htmlFor="recurring-delivery-review">Recurring delivery review reason</Label><Textarea id="recurring-delivery-review" value={form.review} maxLength={2000} onChange={e => setForm({ ...form, review: e.target.value })} /></div>
      </fieldset>
      {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={action.busy || reloading}>{action.unconfirmed ? "Retry unchanged delivery review" : "Save recurring delivery policy"}</Button>
        {action.unconfirmed && <Button type="button" variant="outline" disabled={action.busy} onClick={() => void action.checkSaved().then(saved)}>Check saved action</Button>}
        {!action.unconfirmed && <Button type="button" variant="outline" disabled={action.busy || reloading} onClick={() => void reload()}>Reload recurring delivery policy</Button>}
        <Button type="button" variant="ghost" disabled={action.busy || action.unconfirmed || reloading} onClick={() => { if (globalThis.confirm("Discard this delivery-policy draft?")) { setForm(null);action.clear(); } }}>Close delivery editor</Button></div>
    </form>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
