import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/hub/components/shared/StatusChip";
import { useAuth } from "@/hub/contexts/auth-context";
import type { Tables } from "@/integrations/supabase/types";
import { errorText } from "../editor-state";
import { appointmentDictationBlocked, type AppointmentDictationContext } from "./model";
import { prepareAppointmentDictation, readAppointmentDictation } from "./api";
interface AppointmentDictationProps {
  petId: string; appointmentId: string; blocked: boolean;
  encounters: Tables<"clinical_encounters">[];
  onBusyChange: (busy: boolean) => void;
  onPrepared: (row: Tables<"clinical_encounters">, context: AppointmentDictationContext) => void;
}
const dateTime = (at: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
export function AppointmentDictation({ petId, appointmentId, encounters, blocked, onBusyChange, onPrepared }: AppointmentDictationProps) {
  const { session } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const query = useQuery({
    queryKey: ["appointment-dictation", session?.user.id, petId, appointmentId],
    enabled: !!session, refetchOnWindowFocus: false, retry: false,
    queryFn: () => readAppointmentDictation(session!.user.id, petId, appointmentId),
  });
  const context = query.data;
  const reason = context ? appointmentDictationBlocked(context) : null;
  async function prepare() {
    if (!session || !context || !confirmed || blocked || busy || locked.current || reason) return;
    locked.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      const row = await prepareAppointmentDictation(session.user.id, petId, appointmentId, context.version, context.encounter_id ?? (existing || null));
      if (row.status !== "draft") throw Error("This encounter was signed. Refresh the appointment context and review it from Medical.");
      onPrepared(row, context);
      void query.refetch();
    } catch (e) { setError(errorText(e)); }
    finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }
  return <Card role="region" aria-label="Appointment dictation"><CardHeader><CardTitle className="font-display text-xl">Confirm this visit for dictation</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">Open the appointment’s saved encounter, then enter recording permission and press Start dictation recording. Your microphone stays off until you start it.</p>
    {query.isPending && <p role="status">Loading appointment…</p>}
    {query.isError && <p role="alert" className="text-destructive">{errorText(query.error)}</p>}
    {context && <>
      <div className="space-y-1 text-sm"><p className="font-semibold">{context.patient_name} · {context.species}</p><p>Household: {context.household_name}</p><p>Scheduled clinician: {context.assigned_dvm_name?.trim() || (context.assigned_dvm_id ? "Assigned clinician name unavailable" : "Unassigned")}</p><p>{dateTime(context.scheduled_at)} (America/Denver) · {context.appointment_type}</p><p>{context.visit_type === "housecall" ? "Housecall" : "Clinic"} · {context.location || "Location not recorded"}</p><StatusChip status={context.status} /></div>
      {reason && <p role="alert" className="text-sm text-destructive">{reason}</p>}
      {!reason && <>
        {!context.encounter_id && <div className="space-y-2"><Label htmlFor="appointment-encounter">Encounter for this appointment</Label><select id="appointment-encounter" className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={existing} disabled={blocked || busy} onChange={e => { setExisting(e.target.value); setConfirmed(false); }}><option value="">Create a new blank encounter at the current visit time</option>{encounters.filter(e => e.status === "draft").map(e => <option key={e.id} value={e.id}>{dateTime(e.visit_at)} · {e.visit_type} · existing draft</option>)}</select><p className="text-xs text-muted-foreground">Linking an existing draft preserves its date, location and SOAP text.</p></div>}
        {context.encounter_id && <p className="text-sm">This appointment already has a linked draft. It will reopen without changing saved clinical text.</p>}
        <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} disabled={blocked || busy} onChange={e => setConfirmed(e.target.checked)} />I confirm the patient, household and appointment shown above are correct.</label>
        <Button className="min-h-11 w-full sm:w-auto" disabled={blocked || busy || query.isFetching || !confirmed} onClick={() => void prepare()}>{busy ? "Opening encounter…" : "Confirm patient and open dictation"}</Button>
      </>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error} If the response was lost, refresh and confirm again to recover the same linked encounter.</p>}
    <Button variant="outline" className="min-h-11" disabled={busy || blocked || query.isFetching} onClick={() => { setConfirmed(false); setError(""); void query.refetch(); }}>Refresh appointment context</Button>
  </CardContent></Card>;
}
