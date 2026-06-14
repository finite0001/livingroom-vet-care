import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { usePageTitle } from "@/hooks/use-page-title";
import { useProfiles } from "@/hub/hooks/use-profiles";
import {
  useTicket, useUpdateTicket, TICKET_STATUSES, statusLabel, formTypeLabel, type Ticket, type TicketStatus, type PetSex,
} from "@/hub/hooks/use-tickets";

const UNASSIGNED = "__unassigned__";

const CHECKLIST: { key: keyof Ticket; label: string }[] = [
  { key: "dvm_review_needed", label: "DVM review needed" },
  { key: "vaccine_status_reviewed", label: "Vaccine status reviewed" },
  { key: "rdvm_records_requested", label: "rDVM records requested" },
  { key: "new_client", label: "New client" },
  { key: "form_contract_sent", label: "Form / contract sent" },
  { key: "estimate_sent", label: "Estimate sent" },
  { key: "consent_form_sent", label: "Consent form sent" },
  { key: "confirm_with_jane", label: "Confirm with provider" },
  { key: "health_cert_form_sent", label: "Health cert form sent" },
];

type TicketForm = Pick<Ticket,
  "status" | "assigned_to_id" | "client_name" | "client_contact" | "pet_name" | "species_breed" |
  "dob_age" | "sex" | "rdvm" | "symptom_summary" | "notes" | "destination_country" | "travel_date" |
  "dvm_review_needed" | "vaccine_status_reviewed" | "rdvm_records_requested" | "new_client" |
  "form_contract_sent" | "estimate_sent" | "consent_form_sent" | "confirm_with_jane" | "health_cert_form_sent">;

function toForm(t: Ticket): TicketForm {
  const { id, created_at, updated_at, conversation_id, form_type, ...rest } = t;
  return rest;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: ticket, isLoading } = useTicket(id);
  const { data: staff } = useProfiles();
  const update = useUpdateTicket();
  usePageTitle(ticket ? `Ticket — ${ticket.pet_name}` : "Ticket");

  const [form, setForm] = useState<TicketForm | null>(null);
  useEffect(() => { if (ticket) setForm(toForm(ticket)); }, [ticket]);

  const set = <K extends keyof TicketForm>(key: K, value: TicketForm[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSave = () => {
    if (!id || !form) return;
    update.mutate({ id, ...form }, {
      onSuccess: () => toast.success("Ticket saved"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
    });
  };

  if (!isLoading && !ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Ticket not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/hub/tickets")}>Back to tickets</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-card px-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate("/hub/tickets")} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{ticket?.pet_name ?? "Ticket"}</p>
          <p className="truncate text-xs text-muted-foreground">{ticket?.client_name}{ticket && ` · ${formTypeLabel(ticket.form_type)}`}</p>
        </div>
        <Button size="sm" disabled={update.isPending || !form} onClick={handleSave}>{update.isPending ? "Saving…" : "Save"}</Button>
      </header>

      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {isLoading || !form ? (
          <>{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}</>
        ) : (
          <>
            {/* Status & assignment */}
            <Card>
              <CardContent className="grid grid-cols-2 gap-3 p-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={(v) => set("status", v as TicketStatus)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>{TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Assigned to</Label>
                  <Select value={form.assigned_to_id ?? UNASSIGNED} onValueChange={(v) => set("assigned_to_id", v === UNASSIGNED ? null : v)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {(staff ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name} ({p.role})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Pet & client */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Pet &amp; client</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pet name"><Input value={form.pet_name} onChange={(e) => set("pet_name", e.target.value)} /></Field>
                  <Field label="Species / breed"><Input value={form.species_breed ?? ""} onChange={(e) => set("species_breed", e.target.value || null)} /></Field>
                  <Field label="DOB / age"><Input value={form.dob_age ?? ""} onChange={(e) => set("dob_age", e.target.value || null)} /></Field>
                  <Field label="Sex">
                    <Select value={form.sex} onValueChange={(v) => set("sex", v as PetSex)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>{(["MALE", "FEMALE", "UNKNOWN"] as PetSex[]).map((s) => <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <Field label="Client name"><Input value={form.client_name} onChange={(e) => set("client_name", e.target.value)} /></Field>
                  <Field label="Contact"><Input value={form.client_contact} onChange={(e) => set("client_contact", e.target.value)} /></Field>
                  <Field label="Referring vet (rDVM)"><Input value={form.rdvm ?? ""} onChange={(e) => set("rdvm", e.target.value || null)} /></Field>
                </div>
                {ticket?.form_type === "HEALTH_CERTIFICATE" && (
                  <div className="grid grid-cols-2 gap-3 border-t pt-3">
                    <Field label="Destination country"><Input value={form.destination_country ?? ""} onChange={(e) => set("destination_country", e.target.value || null)} /></Field>
                    <Field label="Travel date"><Input type="date" value={form.travel_date ?? ""} onChange={(e) => set("travel_date", e.target.value || null)} /></Field>
                  </div>
                )}
                <Field label="Summary"><Textarea value={form.symptom_summary ?? ""} onChange={(e) => set("symptom_summary", e.target.value || null)} rows={3} /></Field>
              </CardContent>
            </Card>

            {/* Workflow checklist */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Workflow</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {CHECKLIST.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between py-1.5">
                    <span className="text-sm">{label}</span>
                    <Switch checked={!!form[key]} onCheckedChange={(c) => set(key as keyof TicketForm, c as never)} aria-label={label} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
              <CardContent>
                <Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} rows={4} placeholder="Internal notes…" />
              </CardContent>
            </Card>

            <Button className="w-full" disabled={update.isPending} onClick={handleSave}>{update.isPending ? "Saving…" : "Save ticket"}</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
