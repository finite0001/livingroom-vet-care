import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useTickets, useCreateTicket, TICKET_STATUSES, TICKET_FORM_TYPES,
  statusLabel, formTypeLabel, type TicketStatus, type TicketFormType,
} from "@/hub/hooks/use-tickets";

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-blue-500/10 text-blue-600",
  DVM_REVIEW: "bg-amber-500/10 text-amber-600",
  READY_FOR_SCHEDULING: "bg-green-500/10 text-green-600",
  CLOSED: "bg-muted text-muted-foreground",
};

const FILTERS: (TicketStatus | "ALL")[] = ["ALL", ...TICKET_STATUSES];

export default function TicketsPage() {
  usePageTitle("Tickets");
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TicketStatus | "ALL">("ALL");
  const { data: tickets, isLoading } = useTickets(filter);
  const create = useCreateTicket();

  const [open, setOpen] = useState(false);
  const [formType, setFormType] = useState<TicketFormType>("WELLNESS");
  const [clientName, setClientName] = useState("");
  const [clientContact, setClientContact] = useState("");
  const [petName, setPetName] = useState("");
  const [speciesBreed, setSpeciesBreed] = useState("");
  const [symptom, setSymptom] = useState("");

  const reset = () => { setFormType("WELLNESS"); setClientName(""); setClientContact(""); setPetName(""); setSpeciesBreed(""); setSymptom(""); };

  const handleCreate = () => {
    if (!clientName.trim() || !clientContact.trim() || !petName.trim()) { toast.error("Client name, contact, and pet name are required"); return; }
    create.mutate(
      {
        form_type: formType,
        client_name: clientName.trim(),
        client_contact: clientContact.trim(),
        pet_name: petName.trim(),
        species_breed: speciesBreed.trim() || null,
        symptom_summary: symptom.trim() || null,
      },
      {
        onSuccess: (row) => { toast.success("Ticket created"); setOpen(false); reset(); navigate(`/hub/ticket/${row.id}`); },
        onError: () => toast.error("Failed to create ticket"),
      },
    );
  };

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
        <h1 className="text-lg font-semibold">Tickets</h1>
        <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => { reset(); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> New</Button>
      </header>

      <div className="border-b bg-card px-3 py-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors", filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent")}
            >
              {f === "ALL" ? "All" : statusLabel(f)}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-2 p-4">
        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
        ) : !tickets || tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No tickets{filter !== "ALL" ? ` in ${statusLabel(filter)}` : ""}</p>
            <p className="mt-1 text-xs text-muted-foreground">Create an intake ticket to start the workflow.</p>
          </div>
        ) : (
          tickets.map((t) => (
            <Card key={t.id} className="cursor-pointer transition-colors hover:bg-accent/40" onClick={() => navigate(`/hub/ticket/${t.id}`)}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{t.pet_name}</p>
                    <Badge variant="outline" className="h-5 shrink-0 text-[10px]">{formTypeLabel(t.form_type)}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{t.client_name}{t.symptom_summary ? ` · ${t.symptom_summary}` : ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_TONE[t.status])}>{statusLabel(t.status)}</span>
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader><SheetTitle>New ticket</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Form type</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as TicketFormType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TICKET_FORM_TYPES.map((t) => <SelectItem key={t} value={t}>{formTypeLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-sm">Client name *</Label><Input value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-sm">Contact *</Label><Input value={clientContact} onChange={(e) => setClientContact(e.target.value)} placeholder="phone or email" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-sm">Pet name *</Label><Input value={petName} onChange={(e) => setPetName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-sm">Species / breed</Label><Input value={speciesBreed} onChange={(e) => setSpeciesBreed(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label className="text-sm">Summary</Label><Textarea value={symptom} onChange={(e) => setSymptom(e.target.value)} rows={3} placeholder="Reason for visit / symptoms…" /></div>
            <Button className="w-full" onClick={handleCreate} disabled={create.isPending}>{create.isPending ? "Creating…" : "Create ticket"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
