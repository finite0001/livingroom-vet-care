import { useEffect, useMemo, useState } from "react";
import { useBlocker, useSearchParams, Link, useParams, useNavigate } from "react-router-dom";
import { HouseholdEstimates } from "@/hub/features/estimates/HouseholdEstimates";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { SmsConsentPanel } from "@/hub/features/communications/SmsConsentPanel";
import { Award, CalendarPlus, Send, Stethoscope, Syringe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/hub/hooks/use-client";
import { ClientNotesCard } from "@/hub/components/clients/ClientNotesCard";
import { PatientFormDialog } from "@/hub/features/patients/PatientFormDialog";
import { EditClientDialog } from "@/hub/components/clients/EditClientDialog";
import { usePageTitle } from "@/hooks/use-page-title";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { HouseholdInvoices } from "@/hub/features/billing/HouseholdInvoices";
import { useHousehold360 } from "@/hub/features/patient-360/api";
import { Header360, QuickActions360 } from "@/hub/features/patient-360/Header360";
import { NextSteps360 } from "@/hub/features/patient-360/NextSteps360";
import { Timeline360 } from "@/hub/features/patient-360/Timeline360";
import { Section360 } from "@/hub/features/patient-360/Section360";
import { useScrollToSection } from "@/hub/features/patient-360/use-scroll-to-section";
import {
  conversationHref, deriveNextSteps, formatCents, formatDateTime, patientHref, resolveHouseholdTab, scheduleHref,
  type HouseholdTab,
} from "@/hub/features/patient-360/model";

const TAB_LABELS: Record<HouseholdTab, string> = {
  overview: "Overview",
  patients: "Patients",
  communication: "Communication",
  billing: "Billing",
  schedule: "Schedule",
  documents: "Documents",
};

/**
 * Household 360. Legacy `?tab=` values (estimates, invoices, messages,
 * consent) resolve to the tab and section that now hold them.
 */
export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const resolved = resolveHouseholdTab(searchParams.get("tab"));
  const tab = resolved.tab;
  const section = searchParams.get("section") ?? resolved.section ?? null;
  const [visited, setVisited] = useState<Set<HouseholdTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
  const [invoiceDirty, setInvoiceDirty] = useState(false);
  const [estimateDirty, setEstimateDirty] = useState(false);
  const dirty = invoiceDirty || estimateDirty;
  // Tabs and sections are search-param changes on the same household; only
  // leaving the household can discard billing work.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const { data: client, isLoading, isError, refetch } = useClient(id);
  const summary = useHousehold360(id ?? "", { paused: dirty });
  const steps = useMemo(() => (summary.data ? deriveNextSteps(summary.data) : undefined), [summary.data]);
  useScrollToSection(tab, section);

  usePageTitle(client ? client.full_name : "Client Profile");

  const setTab = (next: HouseholdTab) => {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next === "overview") nextParams.delete("tab");
      else nextParams.set("tab", next);
      nextParams.delete("section");
      return nextParams;
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError) return <div className="space-y-3 p-6" role="alert"><p>Client details could not be loaded.</p><Button variant="outline" onClick={() => void refetch()}>Retry client</Button></div>;

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-muted-foreground">Client not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/hub/clients")}>
          Back to clients
        </Button>
      </div>
    );
  }

  const read = summary.data;
  const shown = (value: HouseholdTab) => cn("mt-0 space-y-5", tab !== value && "hidden");
  const activePets = client.pets.filter((pet) => !pet.archived_at && !pet.deceased_at);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <AlertDialog open={blocker.state === "blocked"}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave unfinished household work?</AlertDialogTitle><AlertDialogDescription>Unsent edits will be discarded. Submitted requests may already be recorded. Estimate recovery requests remain saved; recover those requests and review invoice history before submitting again.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.state === "blocked" && blocker.reset()}>Stay and reconcile</AlertDialogCancel><AlertDialogAction onClick={() => blocker.state === "blocked" && blocker.proceed()}>Leave and recover later</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      {read ? <Header360 read={read} manage={<EditClientDialog client={client} />} /> : (
        <header className="sticky top-0 z-20 border-b bg-card">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl md:text-2xl">{client.full_name}</h1>
              <p className="text-xs text-muted-foreground">{client.preferred_channel || "SMS"} preferred</p>
              {summary.isError && <p role="alert" className="text-sm">Summary could not be loaded. <Button variant="link" className="h-auto p-0" onClick={() => void summary.refetch()}>Retry summary</Button></p>}
            </div>
            <EditClientDialog client={client} />
          </div>
        </header>
      )}

      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
        {read && <QuickActions360 read={read} />}
        <Tabs value={tab} onValueChange={(v) => setTab(v as HouseholdTab)}>
          <TabsList className="h-auto w-full justify-start overflow-x-auto md:w-auto" aria-label="Household sections">
            {(Object.keys(TAB_LABELS) as HouseholdTab[]).map((value) => (
              <TabsTrigger key={value} value={value} className="shrink-0">
                {TAB_LABELS[value]}
                {value === "billing" && dirty && <><span className="ml-1.5 h-2 w-2 rounded-full bg-warning" aria-hidden="true" /><span className="sr-only"> (unsaved changes)</span></>}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" forceMount className={shown("overview")}>
            {visited.has("overview") && <>
              <NextSteps360 steps={steps} loading={summary.isPending} error={summary.isError} onRetry={() => void summary.refetch()} />
              <div className="grid items-start gap-5 lg:grid-cols-[1fr_2fr]">
                <section aria-labelledby="household-details" className="space-y-3 rounded-2xl border bg-card p-4 shadow-card">
                  <h2 id="household-details" className="font-display text-lg">Household details</h2>
                  <dl className="space-y-2">
                    <div><dt className="text-xs text-muted-foreground">Housecall address</dt><dd className="whitespace-pre-wrap text-sm">{client.housecall_address || "Not recorded"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Mailing address</dt><dd className="whitespace-pre-wrap text-sm">{client.mailing_address || "Not recorded"}</dd></div>
                  </dl>
                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Patients</h3><PatientFormDialog clientId={client.id} /></div>
                    {client.pets.length === 0 ? <p className="text-sm text-muted-foreground">No pets on file</p> : (
                      <ul className="mt-2 space-y-1">
                        {client.pets.map((pet) => (
                          <li key={pet.id}><Link to={patientHref(pet.id)} className="text-sm text-primary hover:underline">{pet.name}</Link><span className="text-xs text-muted-foreground"> · {pet.species}{pet.archived_at ? " · Archived" : ""}{pet.deceased_at ? " · Deceased" : ""}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
                <Timeline360 scope="household" id={client.id} clientId={client.id} title="Household timeline" />
              </div>
            </>}
          </TabsContent>

          <TabsContent value="patients" forceMount className={shown("patients")}>
            {visited.has("patients") && <>
              <div className="flex justify-end"><PatientFormDialog clientId={client.id} /></div>
              {client.pets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pets on file</p>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2" aria-label="Household patients">
                  {client.pets.map((pet) => {
                    const inactive = Boolean(pet.archived_at || pet.deceased_at);
                    return (
                      <li key={pet.id} className="rounded-2xl border bg-card p-4 shadow-card">
                        <Link to={patientHref(pet.id)} className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{pet.name[0]}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{pet.name}{pet.archived_at ? " · Archived" : ""}{pet.deceased_at ? " · Deceased" : ""}</span>
                            <span className="block text-xs text-muted-foreground">{pet.species}{pet.breed ? ` · ${pet.breed}` : ""}</span>
                          </span>
                        </Link>
                        <div className="mt-3 flex flex-wrap gap-2" aria-label={`Actions for ${pet.name}`} role="group">
                          {!inactive && <Button asChild size="sm" variant="outline" className="guided-touch"><Link to={scheduleHref({ book: true, clientId: client.id, petId: pet.id })}><CalendarPlus className="mr-1 h-4 w-4" aria-hidden="true" />Book</Link></Button>}
                          {!inactive && <Button asChild size="sm" variant="outline" className="guided-touch"><Link to={patientHref(pet.id, "medical", "soap")}><Stethoscope className="mr-1 h-4 w-4" aria-hidden="true" />Visit note</Link></Button>}
                          <Button asChild size="sm" variant="outline" className="guided-touch"><Link to={patientHref(pet.id, "medical", "treatments")}><Syringe className="mr-1 h-4 w-4" aria-hidden="true" />Treatment</Link></Button>
                          <Button asChild size="sm" variant="outline" className="guided-touch"><Link to={patientHref(pet.id, "documents", "certificates")}><Award className="mr-1 h-4 w-4" aria-hidden="true" />Certificate</Link></Button>
                          <Button asChild size="sm" variant="outline" className="guided-touch"><Link to={patientHref(pet.id, "documents", "releases")}><Send className="mr-1 h-4 w-4" aria-hidden="true" />Release</Link></Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {activePets.length === 0 && client.pets.length > 0 && <p className="text-sm text-muted-foreground">No active patients.</p>}
            </>}
          </TabsContent>

          <TabsContent value="communication" forceMount className={shown("communication")}>
            {visited.has("communication") && <>
              <Section360 id="messages" className="space-y-5">
                {read && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-card">
                    <div className="min-w-0">
                      <h2 className="font-display text-lg">Conversation</h2>
                      <p className="text-sm text-muted-foreground">
                        {read.signals.communication.awaiting_reply ? "Waiting on a reply from the practice." : read.signals.communication.unread ? "Unread activity in the thread." : "Up to date."}
                        {read.signals.communication.last_client_at && ` Last client message ${formatDateTime(read.signals.communication.last_client_at)}.`}
                      </p>
                    </div>
                    <Button asChild><Link to={conversationHref(read.signals.communication.conversation_id, client.id)}>Open thread</Link></Button>
                  </div>
                )}
                <Timeline360 scope="household" id={client.id} clientId={client.id} filters={["communication"]} title="Messages, calls and reminders" />
              </Section360>
              <Section360 id="consent" className="space-y-3">
                <SmsConsentPanel key={`consent:${client.id}`} clientId={client.id} />
                <ClientNotesCard clientId={client.id} />
              </Section360>
            </>}
          </TabsContent>

          {/* Billing stays mounted (hidden) from first render, as before, so unsaved invoice and estimate work is guarded. */}
          <TabsContent value="billing" forceMount className={shown("billing")}>
            {read && (
              <div className="rounded-2xl border bg-card p-4 shadow-card">
                <h2 className="font-display text-lg">Balance</h2>
                <p className="text-sm text-muted-foreground">{Number(read.balance.outstanding_cents) > 0 ? `${formatCents(read.balance.outstanding_cents)} due across ${read.balance.open_invoice_count} invoice${read.balance.open_invoice_count === 1 ? "" : "s"}.` : "No balance due."}</p>
              </div>
            )}
            <Section360 id="estimates"><HouseholdEstimates key={`estimates:${client.id}`} clientId={client.id} onDirtyChange={setEstimateDirty} /></Section360>
            <Section360 id="invoices"><HouseholdInvoices key={client.id} clientId={client.id} externalNavigationGuard onDirtyChange={setInvoiceDirty} /></Section360>
            {visited.has("billing") && <Timeline360 scope="household" id={client.id} clientId={client.id} filters={["billing"]} title="Billing history" />}
          </TabsContent>

          <TabsContent value="schedule" forceMount className={shown("schedule")}>
            {visited.has("schedule") && <>
              {read && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4 shadow-card">
                  <div><h2 className="font-display text-lg">Next visit</h2><p className="text-sm text-muted-foreground">{read.signals.upcoming_appointment ? `${formatDateTime(read.signals.upcoming_appointment.scheduled_at)} · ${read.signals.upcoming_appointment.pet_name ?? "Household"} · ${read.signals.upcoming_appointment.appointment_type ?? "Appointment"}` : "No upcoming visit booked."}</p></div>
                  <Button asChild><Link to={scheduleHref({ book: true, clientId: client.id })}>Book visit</Link></Button>
                </div>
              )}
              <Timeline360 scope="household" id={client.id} clientId={client.id} filters={["schedule"]} title="Appointments" />
            </>}
          </TabsContent>

          <TabsContent value="documents" forceMount className={shown("documents")}>
            {visited.has("documents") && <>
              <p className="text-sm text-muted-foreground">Patient documents, certificates and record releases are filed on each patient. Open a patient to upload or release records.</p>
              <Timeline360 scope="household" id={client.id} clientId={client.id} filters={["documents"]} title="Documents, certificates and releases" />
            </>}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
