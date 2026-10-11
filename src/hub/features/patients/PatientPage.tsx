import { PatientImportedPrescriptions } from "@/hub/features/imports/PatientImportedPrescriptions";
import { PatientImportedVaccinations } from "@/hub/features/imports/PatientImportedVaccinations";
import { PatientImportedHistory } from "@/hub/features/imports/PatientImportedHistory";
import { PatientCarePlans } from "@/hub/features/care-plans/PatientCarePlans";
import { PatientVaccineDuePlans } from "@/hub/features/care-reminders/PatientVaccineDuePlans";
import { PatientRecordReleases } from "@/hub/features/record-releases/PatientRecordReleases";
import { PatientAnesthesiaRecords } from "@/hub/features/anesthesia/PatientAnesthesiaRecords";
import { PatientCertificates } from "@/hub/features/certificates/PatientCertificates";
import { PatientExternalRecords } from "@/hub/features/external-records/PatientExternalRecords";
import { PatientLabWork } from "@/hub/features/lab-work/PatientLabWork";
import { useMemo, useRef, useState } from "react";
import { PatientPrescriptions } from "@/hub/features/prescriptions/PatientPrescriptions";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import { PatientFormDialog } from "./PatientFormDialog";
import { WeightHistory } from "./WeightHistory";
import { patientAge } from "./patient-details";
import { PatientCareCharts } from "@/hub/features/care-charts/PatientCareCharts";
import { PatientTreatments } from "@/hub/features/treatments/PatientTreatments";
import { PatientApiAttachments } from "@/hub/features/imports/PatientApiAttachments";
import { PatientPhoto } from "@/hub/features/patient-photos/PatientPhoto";
import { PatientDocuments } from "@/hub/features/documents/PatientDocuments";
import { PatientDentalChart } from "@/hub/features/dental/PatientDentalChart";
import { ClinicalWorkspace } from "@/hub/features/clinical/ClinicalWorkspace";
import { useUnsavedChanges } from "@/hub/features/clinical/use-unsaved-changes";
import { PatientAlerts } from "@/hub/features/clinical/PatientAlerts";
import { PatientVaccineStatus } from "@/hub/features/vaccines/PatientVaccineStatus";
import { usePatient360 } from "@/hub/features/patient-360/api";
import { Header360, QuickActions360 } from "@/hub/features/patient-360/Header360";
import { NextSteps360 } from "@/hub/features/patient-360/NextSteps360";
import { Timeline360 } from "@/hub/features/patient-360/Timeline360";
import { Section360 } from "@/hub/features/patient-360/Section360";
import { useScrollToSection } from "@/hub/features/patient-360/use-scroll-to-section";
import {
  deriveNextSteps, formatCents, formatDateTime, householdHref, resolvePatientTab, scheduleHref, conversationHref,
  type PatientTab,
} from "@/hub/features/patient-360/model";

export default function PatientPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <PatientWorkspace key={id} petId={id} /> : <p role="alert">Patient not found.</p>;
}

const TAB_LABELS: Record<PatientTab, string> = {
  overview: "Overview",
  medical: "Medical",
  communication: "Communication",
  billing: "Billing",
  schedule: "Schedule",
  documents: "Documents",
};

/**
 * Patient 360: one workspace for everything connected to this pet and its
 * household. Tabs mount on first visit and then stay mounted (hidden) so an
 * unsaved clinical draft survives switching tabs; leaving the record still
 * asks for confirmation.
 */
function PatientWorkspace({ petId }: { petId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolvePatientTab(searchParams.get("tab"));
  const section = searchParams.get("section");
  const [visited, setVisited] = useState<Set<PatientTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
  const [photoDirty, setPhotoDirty] = useState(false);
  const [nativePrescriptionDirty, setNativePrescriptionDirty] = useState(false);
  const [importedPrescriptionDirty, setImportedPrescriptionDirty] = useState(false);
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
  const [carePlanDirty, setCarePlanDirty] = useState(false);
  const dirty = photoDirty || nativePrescriptionDirty || importedPrescriptionDirty || importedVaccinationDirty || importedHistoryDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty;
  const medicalDirty = nativePrescriptionDirty || importedPrescriptionDirty || importedVaccinationDirty || importedHistoryDirty || clinicalDirty || careDirty || dentalDirty || labDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty;
  const documentsDirty = externalDirty || releaseDirty || certificateDirty;
  const navigationGuard = useUnsavedChanges(dirty);
  useScrollToSection(tab, section);
  const query = useQuery({ queryKey: ["patient", petId], enabled: !nativePrescriptionDirty, refetchOnWindowFocus: !dirty, refetchOnReconnect: !dirty, queryFn: async () => {
    const { data, error } = await supabase.from("pets").select("*").eq("id", petId).maybeSingle();
    if (error) throw error;
    return data;
  } });
  const summary = usePatient360(petId, { paused: dirty });
  // Household name for the fallback header while the 360 summary is loading or unavailable.
  const clientQuery = useQuery({ queryKey: ["patient-household", query.data?.client_id], enabled: Boolean(query.data?.client_id) && !summary.data, queryFn: async () => {
    const { data, error } = await supabase.from("clients").select("id,full_name,housecall_address").eq("id", query.data!.client_id).single();
    if (error) throw error;
    return data;
  } });
  const steps = useMemo(() => (summary.data ? deriveNextSteps(summary.data) : undefined), [summary.data]);
  // A background read must not unmount an uncertain prescription operation.
  const retainedPatient = useRef(query.data);
  if (!nativePrescriptionDirty || !retainedPatient.current) retainedPatient.current = query.data;
  const patient = nativePrescriptionDirty ? retainedPatient.current : query.data;
  usePageTitle(patient ? `${patient.name} · Patient record` : "Patient record");
  if (query.isLoading) return <div role="status" className="p-6">Loading patient record…</div>;
  if (query.isError && !patient) return <div className="space-y-3 p-6" role="alert"><p>Patient record could not be loaded.</p><Button variant="outline" onClick={() => void query.refetch()}>Retry patient</Button></div>;
  if (!patient) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">Patient not found</h1><Button asChild variant="outline"><Link to="/hub/patients">Back to patients</Link></Button></div>;
  const inactive = Boolean(patient.archived_at || patient.deceased_at);
  const details = [
    ["Species", patient.species], ["Breed", patient.breed || "Not recorded"], ["Birthday", patient.dob ? `${patient.dob}${patient.birth_date_precision === "estimated" ? " (estimated)" : ""}` : "Unknown"], ["Age", patientAge(patient.dob, patient.birth_date_precision, patient.deceased_at ?? undefined)],
    ["Color / markings", patient.color || "Not recorded"], ["Sex", patient.sex], ["Neuter status", patient.neuter_status], ["Microchip", patient.microchip_id || "Not recorded"],
  ];
  const setTab = (next: PatientTab) => setSearchParams((previous) => {
    const params = new URLSearchParams(previous);
    if (next === "overview") params.delete("tab"); else params.set("tab", next);
    params.delete("section");
    return params;
  });
  const shown = (value: PatientTab) => cn("mt-0 space-y-5", tab !== value && "hidden");
  const read = summary.data;
  const clientId = patient.client_id;
  return <section aria-label="Patient workspace" className="h-full overflow-y-auto">
    {navigationGuard}
    {read ? <Header360 read={read} photo={<PatientPhoto petId={petId} name={patient.name} disabled={dirty && !photoDirty} onDirtyChange={setPhotoDirty} />} manage={<PatientFormDialog clientId={patient.client_id} patient={patient} />} /> : (
      <header className="border-b bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6"><div><Link to={householdHref(clientId)} className="text-sm text-primary hover:underline">{clientQuery.data?.full_name || "Back to household"}</Link><h1 className="font-display text-xl md:text-2xl">{patient.name}</h1><p className="text-sm text-muted-foreground">Patient record · {patient.species}{patient.breed ? ` · ${patient.breed}` : ""}</p>{summary.isError && <p role="alert" className="text-sm">Summary could not be loaded. <Button variant="link" className="h-auto p-0" onClick={() => void summary.refetch()}>Retry summary</Button></p>}</div><PatientFormDialog clientId={patient.client_id} patient={patient} /></div></header>
    )}
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      {read && <QuickActions360 read={read} />}
      {inactive && <div className="flex flex-wrap items-center gap-2 rounded-md border p-3"><Badge variant="secondary">{patient.deceased_at ? `Deceased ${patient.deceased_at}` : "Archived"}</Badge><p className="text-sm">History is retained. New visits and weights are disabled.</p></div>}
      <Tabs value={tab} onValueChange={(value) => setTab(value as PatientTab)}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto md:w-auto" aria-label="Patient record sections">
          {(Object.keys(TAB_LABELS) as PatientTab[]).map((value) => (
            <TabsTrigger key={value} value={value} className="shrink-0">
              {TAB_LABELS[value]}
              {((value === "medical" && medicalDirty) || (value === "documents" && documentsDirty)) && <><span className="ml-1.5 h-2 w-2 rounded-full bg-warning" aria-hidden="true" /><span className="sr-only"> (unsaved changes)</span></>}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" forceMount className={shown("overview")}>
          {visited.has("overview") && <>
            <NextSteps360 steps={steps} loading={summary.isPending} error={summary.isError} onRetry={() => void summary.refetch()} />
            <Section360 id="vaccines"><PatientVaccineStatus key={`vaccine-status-${petId}`} petId={petId} /></Section360>
            <div className="grid items-start gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-lg">Patient details</CardTitle></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4">{details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}{label === "Age" && patient.deceased_at ? " at death" : ""}</dt><dd className="break-words text-sm">{value}</dd></div>)}</dl></CardContent></Card><WeightHistory petId={petId} legacyWeight={patient.weight_lbs} disabled={inactive} /></div>
            <Timeline360 scope="patient" id={petId} clientId={clientId} title="Timeline" />
          </>}
        </TabsContent>

        <TabsContent value="medical" forceMount className={shown("medical")}>
          {visited.has("medical") && <>
            <PatientAlerts petId={petId} />
            {patient.allergies?.trim() && <div role="note" className="flex gap-3 rounded-md border border-destructive bg-destructive/10 p-4 text-clinical-alert"><AlertTriangle className="h-5 w-5 shrink-0" /><div><h2 className="font-semibold">Allergy information from existing record</h2><p className="whitespace-pre-wrap text-sm">{patient.allergies}</p><p className="mt-1 text-xs">Review alongside the structured problem list below.</p></div></div>}
            <Section360 id="soap"><ClinicalWorkspace petId={petId} disabled={inactive || nativePrescriptionDirty || importedPrescriptionDirty || importedVaccinationDirty || importedHistoryDirty || carePlanDirty} onDirtyChange={setClinicalDirty} /></Section360>
            <Section360 id="prescriptions"><PatientPrescriptions petId={petId} clientId={patient.client_id} inactive={inactive} disabled={importedPrescriptionDirty || importedVaccinationDirty || importedHistoryDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty} onDirtyChange={setNativePrescriptionDirty} /></Section360>
            <Section360 id="treatments"><PatientTreatments petId={petId} clientId={patient.client_id} /></Section360>
            <Section360 id="care-plans"><PatientCarePlans petId={petId} inactive={inactive} disabled={dirty && !carePlanDirty} onDirtyChange={setCarePlanDirty} /></Section360>
            <Section360 id="vaccine-plans"><PatientVaccineDuePlans key={`vaccine-due-${petId}`} petId={petId} onDirtyChange={setVaccineDueDirty} /></Section360>
            <Section360 id="labs"><PatientLabWork key={`lab-${petId}`} petId={petId} onDirtyChange={setLabDirty} /></Section360>
            <Section360 id="care-charts"><PatientCareCharts petId={petId} onDirtyChange={setCareDirty} /></Section360>
            <Section360 id="dental"><PatientDentalChart key={`dental-${petId}`} petId={petId} species={patient.species} onDirtyChange={setDentalDirty} /></Section360>
            <Section360 id="anesthesia"><PatientAnesthesiaRecords key={`anesthesia-${petId}`} petId={petId} clientId={patient.client_id} onDirtyChange={setAnesthesiaDirty} /></Section360>
            <Section360 id="imported" className="space-y-5">
              <PatientImportedVaccinations petId={petId} patientVersion={patient.version} disabled={nativePrescriptionDirty || importedPrescriptionDirty || importedHistoryDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty} onDirtyChange={setImportedVaccinationDirty} />
              <PatientImportedPrescriptions petId={petId} patientVersion={patient.version} disabled={nativePrescriptionDirty || importedVaccinationDirty || importedHistoryDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty} onDirtyChange={setImportedPrescriptionDirty} />
              <PatientImportedHistory petId={petId} patientVersion={patient.version} disabled={nativePrescriptionDirty || importedPrescriptionDirty || importedVaccinationDirty || externalDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty} onDirtyChange={setImportedHistoryDirty} />
            </Section360>
          </>}
        </TabsContent>

        <TabsContent value="communication" forceMount className={shown("communication")}>
          {visited.has("communication") && <>
            {read && <CommunicationSummary read={read} />}
            <Timeline360 scope="patient" id={petId} clientId={clientId} filters={["communication"]} title="Messages, calls and reminders" />
          </>}
        </TabsContent>

        <TabsContent value="billing" forceMount className={shown("billing")}>
          {visited.has("billing") && <>
            {read && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-card"><div><h2 className="font-display text-lg">Household balance</h2><p className="text-sm text-muted-foreground">{Number(read.balance.outstanding_cents) > 0 ? `${formatCents(read.balance.outstanding_cents)} due across ${read.balance.open_invoice_count} invoice${read.balance.open_invoice_count === 1 ? "" : "s"}.` : "No balance due."} Invoices, estimates and payment links are managed on the household.</p></div><Button asChild><Link to={householdHref(clientId, "billing", "invoices")}>Open household billing</Link></Button></div>}
            <Timeline360 scope="patient" id={petId} clientId={clientId} filters={["billing"]} title="Billing history for this patient" />
          </>}
        </TabsContent>

        <TabsContent value="schedule" forceMount className={shown("schedule")}>
          {visited.has("schedule") && <>
            {read && <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-card"><div><h2 className="font-display text-lg">Next visit</h2><p className="text-sm text-muted-foreground">{read.signals.upcoming_appointment ? `${formatDateTime(read.signals.upcoming_appointment.scheduled_at)} · ${read.signals.upcoming_appointment.appointment_type ?? "Appointment"}` : "No upcoming visit booked."}</p></div>{!inactive && <Button asChild><Link to={scheduleHref({ book: true, clientId, petId })}>Book visit</Link></Button>}</div>}
            <Timeline360 scope="patient" id={petId} clientId={clientId} filters={["schedule"]} title="Appointments" />
          </>}
        </TabsContent>

        <TabsContent value="documents" forceMount className={shown("documents")}>
          {visited.has("documents") && <>
            <Section360 id="documents"><PatientDocuments petId={petId} /></Section360>
            <Section360 id="attachments"><PatientApiAttachments petId={petId} disabled={dirty} /></Section360>
            <Section360 id="certificates"><PatientCertificates key={`certificates-${petId}`} petId={petId} onDirtyChange={setCertificateDirty} /></Section360>
            <Section360 id="releases"><PatientRecordReleases key={`release-${petId}`} petId={petId} onDirtyChange={setReleaseDirty} /></Section360>
            <Section360 id="external-records"><PatientExternalRecords petId={petId} disabled={nativePrescriptionDirty || importedPrescriptionDirty || importedVaccinationDirty || importedHistoryDirty || releaseDirty || clinicalDirty || careDirty || dentalDirty || labDirty || certificateDirty || anesthesiaDirty || vaccineDueDirty || carePlanDirty} onDirtyChange={setExternalDirty} /></Section360>
          </>}
        </TabsContent>
      </Tabs>
    </div>
  </section>;
}

function CommunicationSummary({ read }: { read: NonNullable<ReturnType<typeof usePatient360>["data"]> }) {
  const c = read.signals.communication;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-card">
    <div className="min-w-0">
      <h2 className="font-display text-lg">Household conversation</h2>
      <p className="text-sm text-muted-foreground">
        {c.awaiting_reply ? "Waiting on a reply from the practice." : c.unread ? "Unread activity in the thread." : "Up to date."}
        {c.missed_calls > 0 && ` ${c.missed_calls} missed call${c.missed_calls === 1 ? "" : "s"}.`}
        {c.voicemails > 0 && ` ${c.voicemails} voicemail${c.voicemails === 1 ? "" : "s"}.`}
        {" "}Messages are shared by the whole household.
      </p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button asChild><Link to={conversationHref(c.conversation_id, read.household.id)}>Open thread</Link></Button>
      <Button asChild variant="outline"><Link to={householdHref(read.household.id, "communication", "consent")}>Consent &amp; notes</Link></Button>
    </div>
  </div>;
}
