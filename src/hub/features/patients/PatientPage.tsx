import { PatientImportedPrescriptions } from "@/hub/features/imports/PatientImportedPrescriptions";
import { PatientImportedVaccinations } from "@/hub/features/imports/PatientImportedVaccinations";
import { PatientImportedHistory } from "@/hub/features/imports/PatientImportedHistory";
import { PatientVaccineDuePlans } from "@/hub/features/care-reminders/PatientVaccineDuePlans";
import { PatientRecordReleases } from "@/hub/features/record-releases/PatientRecordReleases";
import { PatientAnesthesiaRecords } from "@/hub/features/anesthesia/PatientAnesthesiaRecords";
import { PatientCertificates } from "@/hub/features/certificates/PatientCertificates";
import { PatientExternalRecords } from "@/hub/features/external-records/PatientExternalRecords";
import { PatientLabWork } from "@/hub/features/lab-work/PatientLabWork";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, PawPrint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/hooks/use-page-title";
import { PatientFormDialog } from "./PatientFormDialog";
import { WeightHistory } from "./WeightHistory";
import { patientAge } from "./patient-details";
import { PatientCareCharts } from "@/hub/features/care-charts/PatientCareCharts";
import { PatientTreatments } from "@/hub/features/treatments/PatientTreatments";
import { PatientDocuments } from "@/hub/features/documents/PatientDocuments";
import { PatientDentalChart } from "@/hub/features/dental/PatientDentalChart";
import { ClinicalWorkspace } from "@/hub/features/clinical/ClinicalWorkspace";
import { useUnsavedChanges } from "@/hub/features/clinical/use-unsaved-changes";
import { PatientAlerts } from "@/hub/features/clinical/PatientAlerts";

export default function PatientPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <PatientWorkspace key={id} petId={id} /> : <p role="alert">Patient not found.</p>;
}
function PatientWorkspace({ petId }: { petId: string }) {
  const [importedVaccinationDirty, setImportedVaccinationDirty] = useState(false);
  const [importedHistoryDirty, setImportedHistoryDirty] = useState(false);
  const [externalDirty, setExternalDirty] = useState(false);
  const [releaseDirty, setReleaseDirty] = useState(false);
  const [clinicalDirty, setClinicalDirty] = useState(false);
  const [careDirty, setCareDirty] = useState(false);
  const [dentalDirty, setDentalDirty] = useState(false);
  const [labDirty, setLabDirty] = useState(false);
  const [certificateDirty, setCertificateDirty] = useState(false);
  const [anesthesiaDirty, setAnesthesiaDirty] = useState(false);
  const [vaccineDueDirty, setVaccineDueDirty] = useState(false);
  const navigationGuard = useUnsavedChanges(importedVaccinationDirty || importedHistoryDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty);
  const query = useQuery({ queryKey: ["patient", petId], queryFn: async () => {
    const { data, error } = await supabase.from("pets").select("*").eq("id", petId).maybeSingle();
    if (error) throw error;
    return data;
  } });
  const clientQuery = useQuery({ queryKey: ["patient-household", query.data?.client_id], enabled: Boolean(query.data?.client_id), queryFn: async () => {
    const { data, error } = await supabase.from("clients").select("id,full_name,housecall_address").eq("id", query.data!.client_id).single();
    if (error) throw error;
    return data;
  } });
  const patient = query.data;
  usePageTitle(patient ? `${patient.name} · Patient record` : "Patient record");
  if (query.isLoading) return <div role="status" className="p-6">Loading patient record…</div>;
  if (query.isError) return <div className="space-y-3 p-6" role="alert"><p>Patient record could not be loaded.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry patient</Button></div>;
  if (!patient) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">Patient not found</h1><Button asChild variant="outline"><Link to="/hub/clients">Back to clients</Link></Button></div>;
  const inactive = Boolean(patient.archived_at || patient.deceased_at);
  const details = [
    ["Species", patient.species], ["Breed", patient.breed || "Not recorded"], ["Birthday", patient.dob ? `${patient.dob}${patient.birth_date_precision === "estimated" ? " (estimated)" : ""}` : "Unknown"], ["Age", patientAge(patient.dob, patient.birth_date_precision, patient.deceased_at ?? undefined)],
    ["Color / markings", patient.color || "Not recorded"], ["Sex", patient.sex], ["Neuter status", patient.neuter_status], ["Microchip", patient.microchip_id || "Not recorded"],
  ];
  return <section aria-label="Patient workspace" className="h-full overflow-y-auto"><div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    {navigationGuard}
    <header className="flex flex-wrap items-center justify-between gap-3"><div><Link to={`/hub/client/${patient.client_id}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="h-4 w-4" />{clientQuery.data?.full_name || "Back to household"}</Link><h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold"><PawPrint className="h-6 w-6 text-primary" />{patient.name}</h1><p className="text-sm text-muted-foreground">Patient record · {patient.species}{patient.breed ? ` · ${patient.breed}` : ""}</p></div><PatientFormDialog clientId={patient.client_id} patient={patient} /></header>
    {inactive && <div className="flex flex-wrap items-center gap-2 rounded-md border p-3"><Badge variant="secondary">{patient.deceased_at ? `Deceased ${patient.deceased_at}` : "Archived"}</Badge><p className="text-sm">History is retained. New visits and weights are disabled.</p></div>}
    <PatientAlerts petId={petId} />
    {patient.allergies?.trim() && <div role="note" className="flex gap-3 rounded-md border border-destructive bg-destructive/10 p-4 text-clinical-alert"><AlertTriangle className="h-5 w-5 shrink-0" /><div><h2 className="font-semibold">Allergy information from existing record</h2><p className="whitespace-pre-wrap text-sm">{patient.allergies}</p><p className="mt-1 text-xs">Review alongside the structured problem list below.</p></div></div>}
    <div className="grid items-start gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-lg">Patient details</CardTitle></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4">{details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}{label === "Age" && patient.deceased_at ? " at death" : ""}</dt><dd className="break-words text-sm">{value}</dd></div>)}</dl></CardContent></Card><WeightHistory petId={petId} legacyWeight={patient.weight_lbs} disabled={inactive} /></div>
    <PatientTreatments petId={petId} clientId={patient.client_id} />
    <PatientVaccineDuePlans key={`vaccine-due-${petId}`} petId={petId} onDirtyChange={setVaccineDueDirty} />
    <PatientCareCharts petId={petId} onDirtyChange={setCareDirty} />
    <PatientDocuments petId={petId} />
    <PatientImportedVaccinations petId={petId} patientVersion={patient.version} disabled={importedHistoryDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty} onDirtyChange={setImportedVaccinationDirty} />
    <PatientImportedPrescriptions petId={petId} />
    <PatientImportedHistory petId={petId} patientVersion={patient.version} disabled={importedVaccinationDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty} onDirtyChange={setImportedHistoryDirty} />
    <PatientExternalRecords petId={petId} disabled={importedVaccinationDirty || importedHistoryDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty} onDirtyChange={setExternalDirty} />
    <PatientCertificates key={`certificates-${petId}`} petId={petId} onDirtyChange={setCertificateDirty} />
    <PatientLabWork key={`lab-${petId}`} petId={petId} onDirtyChange={setLabDirty} />
    <PatientDentalChart key={`dental-${petId}`} petId={petId} species={patient.species} onDirtyChange={setDentalDirty} />
    <PatientAnesthesiaRecords key={`anesthesia-${petId}`} petId={petId} onDirtyChange={setAnesthesiaDirty} />
    <PatientRecordReleases key={`release-${petId}`} petId={petId} onDirtyChange={setReleaseDirty} />
    <ClinicalWorkspace petId={petId} disabled={inactive || importedVaccinationDirty || importedHistoryDirty} onDirtyChange={setClinicalDirty} />
  </div></section>;
}
