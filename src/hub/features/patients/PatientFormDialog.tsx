import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/hub/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { practiceToday, validatePatient } from "./patient-details";
import type { PatientFormValues } from "./patient-details";

interface PatientFormDialogProps { clientId: string; patient?: Tables<"pets"> }
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PatientFormDialog({ clientId, patient }: PatientFormDialogProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [duplicates, setDuplicates] = useState<Array<{ id: string; name: string }>>([]);
  const [reviewedFingerprint, setReviewedFingerprint] = useState("");
  const initial = (): PatientFormValues => ({ name: patient?.name ?? "", species: patient?.species ?? "", breed: patient?.breed ?? "", dob: patient?.dob ?? "", birthDatePrecision: patient?.birth_date_precision ?? "unknown", color: patient?.color ?? "", sex: patient?.sex ?? "unknown", neuterStatus: patient?.neuter_status ?? "unknown", microchip: patient?.microchip_id ?? "", deceasedAt: patient?.deceased_at ?? "", archived: Boolean(patient?.archived_at) });
  const [values, setValues] = useState<PatientFormValues>(initial);
  const [baseline, setBaseline] = useState<PatientFormValues>(initial);
  const [version, setVersion] = useState(patient?.version ?? null);
  const [archivedAt, setArchivedAt] = useState(patient?.archived_at ?? null);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const changeOpen = (next: boolean) => {
    if (pendingRef.current) return;
    if (!next && dirty && !window.confirm("Discard unsaved patient details?")) return;
    if (next) { const current = initial(); setValues(current); setBaseline(current); setVersion(patient?.version ?? null); setArchivedAt(patient?.archived_at ?? null); setError(""); setConflict(false); setDuplicates([]); setReviewedFingerprint(""); }
    setOpen(next);
  };
  const update = (field: keyof PatientFormValues, value: string | boolean) => { setValues((previous) => ({ ...previous, [field]: value })); setDuplicates([]); setReviewedFingerprint(""); };
  const reload = async () => {
    if (!patient || !window.confirm("Replace your unsaved details with the latest saved patient?")) return;
    const { data, error: readError } = await supabase.from("pets").select("*").eq("id", patient.id).single();
    if (readError) { setError(readError.message); return; }
    const fresh: PatientFormValues = { name: data.name, species: data.species, breed: data.breed ?? "", dob: data.dob ?? "", birthDatePrecision: data.birth_date_precision, color: data.color ?? "", sex: data.sex, neuterStatus: data.neuter_status, microchip: data.microchip_id ?? "", deceasedAt: data.deceased_at ?? "", archived: Boolean(data.archived_at) };
    setValues(fresh); setBaseline(fresh); setVersion(data.version); setArchivedAt(data.archived_at); setConflict(false); setError("");
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pendingRef.current) return;
    const validation = validatePatient(values);
    if (validation) { setError(validation); return; }
    if (!session?.user.id) { setError("Sign in again to save patient details."); return; }
    pendingRef.current = true; setPending(true); setError("");
    try {
      const fingerprint = JSON.stringify(values);
      if (reviewedFingerprint !== fingerprint) {
        const nameQuery = supabase.from("pets").select("id,name").eq("client_id", clientId).ilike("name", values.name.trim().replace(/[\\%_]/g, "\\$&")).limit(10);
        const nameResult = await nameQuery;
        if (nameResult.error) throw nameResult.error;
        let matches = nameResult.data.filter((row) => row.id !== patient?.id);
        if (values.microchip.trim()) {
          const chipResult = await supabase.from("pets").select("id,name").eq("microchip_id", values.microchip.trim()).limit(10);
          if (chipResult.error) throw chipResult.error;
          matches = [...matches, ...chipResult.data.filter((row) => row.id !== patient?.id)];
        }
        const unique = [...new Map(matches.map((row) => [row.id, row])).values()];
        setReviewedFingerprint(fingerprint); setDuplicates(unique);
        if (unique.length) return;
      }
      // The RPC verifies auth.uid(), stamps the actor, and checks the expected version atomically.
      const { data, error: saveError } = await supabase.rpc("save_patient", {
        p_id: patient?.id ?? null, p_client_id: clientId, p_expected_version: version,
        p_name: values.name.trim(), p_species: values.species.trim(), p_breed: values.breed.trim() || null,
        p_dob: values.birthDatePrecision === "unknown" ? null : values.dob, p_birth_date_precision: values.birthDatePrecision,
        p_color: values.color.trim() || null, p_sex: values.sex, p_neuter_status: values.neuterStatus,
        p_microchip_id: values.microchip.trim() || null, p_archived_at: values.archived ? archivedAt ?? new Date().toISOString() : null,
        p_deceased_at: values.deceasedAt || null,
      });
      if (saveError) { if (saveError.code === "40001") setConflict(true); throw saveError; }
      if (!data) throw new Error("Patient could not be saved. Reload before retrying.");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["client", clientId] }), queryClient.invalidateQueries({ queryKey: ["clients"] }), queryClient.invalidateQueries({ queryKey: ["patient", data.id] })]);
      setOpen(false); toast.success("Patient details saved");
      if (!patient) navigate(`/hub/patient/${data.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : typeof cause === "object" && cause && "message" in cause ? String(cause.message) : "Patient could not be saved. Your entries are still here."); }
    finally { pendingRef.current = false; setPending(false); }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button variant={patient ? "outline" : "default"} size="sm">{patient ? "Edit patient" : "Add patient"}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{patient ? "Edit patient" : "Add patient"}</DialogTitle><DialogDescription>Keep identity details separate from visit notes. Microchip numbers retain leading zeros.</DialogDescription></DialogHeader>
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={pending} className="grid gap-4 md:grid-cols-2">
          <div><Label htmlFor="patient-name">Patient name</Label><Input id="patient-name" required maxLength={120} value={values.name} onChange={(e) => update("name", e.target.value)} /></div>
          <div><Label htmlFor="patient-species">Species</Label><Input id="patient-species" required maxLength={80} placeholder="Dog, cat, rabbit…" value={values.species} onChange={(e) => update("species", e.target.value)} /></div>
          <div><Label htmlFor="patient-breed">Breed</Label><Input id="patient-breed" maxLength={120} value={values.breed} onChange={(e) => update("breed", e.target.value)} /></div>
          <div><Label htmlFor="patient-color">Color / markings</Label><Input id="patient-color" maxLength={120} value={values.color} onChange={(e) => update("color", e.target.value)} /></div>
          <div><Label htmlFor="patient-dob-precision">Birthdate certainty</Label><select id="patient-dob-precision" className={selectClass} value={values.birthDatePrecision} onChange={(e) => update("birthDatePrecision", e.target.value)}><option value="unknown">Unknown</option><option value="exact">Exact</option><option value="estimated">Estimated</option></select></div>
          <div><Label htmlFor="patient-dob">Birthday</Label><Input id="patient-dob" type="date" max={practiceToday()} disabled={values.birthDatePrecision === "unknown"} required={values.birthDatePrecision !== "unknown"} value={values.dob} onChange={(e) => update("dob", e.target.value)} /></div>
          <div><Label htmlFor="patient-sex">Sex</Label><select id="patient-sex" className={selectClass} value={values.sex} onChange={(e) => update("sex", e.target.value)}><option value="unknown">Unknown</option><option value="female">Female</option><option value="male">Male</option></select></div>
          <div><Label htmlFor="patient-neuter">Neuter status</Label><select id="patient-neuter" className={selectClass} value={values.neuterStatus} onChange={(e) => update("neuterStatus", e.target.value)}><option value="unknown">Unknown</option><option value="intact">Intact</option><option value="neutered">Neutered / spayed</option></select></div>
          <div className="md:col-span-2"><Label htmlFor="patient-microchip">Microchip</Label><Input id="patient-microchip" maxLength={100} value={values.microchip} onChange={(e) => update("microchip", e.target.value)} /></div>
          <div><Label htmlFor="patient-deceased">Date of death (if applicable)</Label><Input id="patient-deceased" type="date" max={practiceToday()} value={values.deceasedAt} onChange={(e) => update("deceasedAt", e.target.value)} /></div>
          {patient && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.archived} onChange={(e) => update("archived", e.target.checked)} />Archived — retain all history</label>}
        </fieldset>
        {duplicates.length > 0 && <div role="status" className="space-y-2 rounded-md border p-3 text-sm"><p>Possible existing patients share this household name or microchip. Review these records before saving; nothing will be merged.</p><ul>{duplicates.map((row) => <li key={row.id}><a href={`/hub/patient/${row.id}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">{row.name} (opens in a new tab)</a></li>)}</ul></div>}
        {error && <p role="alert" className="text-sm text-destructive">{conflict ? "Another staff member changed this patient. Your entries are preserved; reload the latest details before saving." : error}</p>}
        {conflict && <Button type="button" variant="outline" disabled={pending} onClick={() => void reload()}>Reload latest patient</Button>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={pending || conflict}>{pending ? "Saving…" : duplicates.length ? patient ? "Save changes anyway" : "Save as separate patient record" : "Save patient"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
