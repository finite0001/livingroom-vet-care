import { useEffect, useState } from "react";
import { useBlocker, useSearchParams } from "react-router-dom";
import { HouseholdEstimates } from "@/hub/features/estimates/HouseholdEstimates";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { SmsConsentPanel } from "@/hub/features/communications/SmsConsentPanel";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, Mail, MessageSquare, PawPrint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/hub/hooks/use-client";
import { useClientMessages } from "@/hub/hooks/use-conversations";
import { ClientNotesCard } from "@/hub/components/clients/ClientNotesCard";
import { BrandAvatar } from "@/hub/components/conversations/BrandAvatar";
import { formatDistanceToNow } from "date-fns";
import { PatientFormDialog } from "@/hub/features/patients/PatientFormDialog";
import { EditClientDialog } from "@/hub/components/clients/EditClientDialog";
import { usePageTitle } from "@/hooks/use-page-title";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { HouseholdInvoices } from "@/hub/features/billing/HouseholdInvoices";

const TABS = [
  "overview",
  "patients",
  "estimates",
  "invoices",
  "messages",
  "consent",
] as const;
type Tab = (typeof TABS)[number];

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoiceDirty, setInvoiceDirty] = useState(false);
  const [estimateDirty, setEstimateDirty] = useState(false);
  const dirty = invoiceDirty || estimateDirty;
  const blocker = useBlocker(dirty);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const { data: client, isLoading, isError, refetch } = useClient(id);
  const { data: recentMessages } = useClientMessages(id);

  usePageTitle(client ? client.full_name : "Client Profile");

  const rawTab = searchParams.get("tab");
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";
  const setTab = (next: Tab) => {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next === "overview") nextParams.delete("tab");
      else nextParams.set("tab", next);
      return nextParams;
    });
  };

  const goBack = () => {
    if (window.history.length > 2) navigate(-1);
    else navigate("/hub/clients");
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <AlertDialog open={blocker.state === "blocked"}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave unfinished household work?</AlertDialogTitle><AlertDialogDescription>Unsent edits will be discarded. Submitted requests may already be recorded. Estimate recovery requests remain saved; recover those requests and review invoice history before submitting again.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel onClick={() => blocker.state === "blocked" && blocker.reset()}>Stay and reconcile</AlertDialogCancel><AlertDialogAction onClick={() => blocker.state === "blocked" && blocker.proceed()}>Leave and recover later</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      {/* Header */}
      <div className="flex items-center gap-3 border-b px-3 py-2.5 bg-card sticky top-0 z-10">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goBack} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <BrandAvatar name={client.full_name} email={client.primary_email} className="h-8 w-8 text-xs" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{client.full_name}</p>
          <p className="text-xs text-muted-foreground">{client.preferred_channel || "SMS"} preferred</p>
        </div>
        <EditClientDialog client={client} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Summary rail */}
        <aside className="w-full shrink-0 border-b bg-card md:w-64 md:border-b-0 md:border-r">
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Phone className="h-4 w-4 text-muted-foreground" />
              {client.primary_phone ? (
                <a href={`tel:${client.primary_phone}`} className="text-primary hover:underline truncate">{client.primary_phone}</a>
              ) : (
                <span className="text-muted-foreground">No phone</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              {client.primary_email ? (
                <a href={`mailto:${client.primary_email}`} className="text-primary hover:underline truncate">{client.primary_email}</a>
              ) : (
                <span className="text-muted-foreground">No email</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <PawPrint className="h-4 w-4 text-muted-foreground" />
              <span>{client.pets.length} patient{client.pets.length === 1 ? "" : "s"}</span>
            </div>
            <dl className="space-y-2 border-t pt-3">
              <div><dt className="text-xs text-muted-foreground">Mailing address</dt><dd className="whitespace-pre-wrap text-sm">{client.mailing_address || "Not recorded"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Housecall address</dt><dd className="whitespace-pre-wrap text-sm">{client.housecall_address || "Not recorded"}</dd></div>
            </dl>
            <div className="border-t pt-3">
              <PatientFormDialog clientId={client.id} />
            </div>
          </div>
        </aside>

        {/* Tabbed main pane */}
        <div className="min-w-0 flex-1 p-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="patients">Patients</TabsTrigger>
              <TabsTrigger value="estimates">Estimates</TabsTrigger>
              <TabsTrigger value="invoices">Invoices &amp; payments</TabsTrigger>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="consent">Consent &amp; notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className={cn(tab !== "overview" && "hidden")}>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {client.pets.length === 0
                    ? "No patients on file yet."
                    : `${client.pets.length} patient${client.pets.length === 1 ? "" : "s"} on file.`}
                </p>
                {recentMessages && recentMessages.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {recentMessages.length} recent message{recentMessages.length === 1 ? "" : "s"}.
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="patients" className={cn(tab !== "patients" && "hidden")}>
              {client.pets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pets on file</p>
              ) : (
                <div className="space-y-3">
                  {client.pets.map((pet) => (
                    <Link to={`/hub/patient/${pet.id}`} key={pet.id} className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold">
                        {pet.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{pet.name}{pet.archived_at ? " · Archived" : ""}{pet.deceased_at ? " · Deceased" : ""}</p>
                        <p className="text-xs text-muted-foreground">
                          {pet.species}{pet.breed ? ` · ${pet.breed}` : ""}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="estimates" forceMount className={cn(tab !== "estimates" && "hidden")}>
              <HouseholdEstimates key={`estimates:${client.id}`} clientId={client.id} onDirtyChange={setEstimateDirty} />
            </TabsContent>

            <TabsContent value="invoices" forceMount className={cn(tab !== "invoices" && "hidden")}>
              <HouseholdInvoices key={client.id} clientId={client.id} externalNavigationGuard onDirtyChange={setInvoiceDirty} />
            </TabsContent>

            <TabsContent value="messages" className={cn(tab !== "messages" && "hidden")}>
              {!recentMessages || recentMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet</p>
              ) : (
                <div className="space-y-2">
                  {recentMessages.slice(0, 5).map((msg) => (
                    <div key={msg.id} className="rounded-lg bg-muted/50 p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="outline" className="text-[10px] h-4">
                          {msg.sender_type} · {msg.type}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs text-foreground line-clamp-2">{msg.content || "(no text)"}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="consent" className={cn(tab !== "consent" && "hidden")}>
              <div className="space-y-3">
                <SmsConsentPanel key={`consent:${client.id}`} clientId={client.id} />
                <ClientNotesCard clientId={id!} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
