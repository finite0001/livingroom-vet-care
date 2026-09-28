import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, Award, CalendarPlus, FileSignature, Mail, MessageSquare, PawPrint,
  Phone, Receipt, Send, Stethoscope, Syringe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SendToClientDialog } from "@/hub/components/shared/SendToClientDialog";
import { cn } from "@/lib/utils";
import { patientAge } from "@/hub/features/patients/patient-details";
import {
  centsNumber, formatCents, householdHref, patientHref, scheduleHref, type Read360,
} from "./model";

interface Header360Props {
  read: Read360;
  /** Right-aligned management control (edit household / edit patient). */
  manage?: ReactNode;
}

const CHANNEL_LABEL: Record<string, string> = { SMS: "Text", EMAIL: "Email", VOICE: "Phone", VOICEMAIL: "Phone" };

/** Sticky identity, contact, red-flag and balance header shared by patient and household 360. */
export function Header360({ read, manage }: Header360Props) {
  const { household, patient, sms_consent: consent, balance } = read;
  const outstanding = centsNumber(balance.outstanding_cents);
  const allergies = patient
    ? patient.allergies ? [{ pet: null as string | null, text: patient.allergies }] : []
    : read.pets.filter((p) => p.allergies && !p.archived_at && !p.deceased_at).map((p) => ({ pet: p.name, text: p.allergies! }));
  const inactive = patient && (patient.deceased_at || patient.archived_at);
  const phone = household.primary_phone;
  const preferred = household.preferred_channel ? CHANNEL_LABEL[household.preferred_channel] ?? household.preferred_channel : "Text";
  return (
    <section className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85" aria-label={patient ? "Patient summary" : "Household summary"}>
      <div className="mx-auto max-w-6xl space-y-2 px-4 py-3 md:px-6">
        <div className="flex items-start gap-3">
          <Link
            to={patient ? householdHref(household.id) : "/hub/clients"}
            aria-label={patient ? `Back to ${household.full_name}` : "Back to households"}
            className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            {patient ? (
              <>
                <h1 className="flex items-center gap-2 font-display text-xl md:text-2xl">
                  <PawPrint className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{patient.name}</span>
                </h1>
                <p className="truncate text-xs text-muted-foreground md:text-sm">
                  {[patient.species, patient.breed, patientAge(patient.dob, patient.birth_date_precision ?? "unknown", patient.deceased_at ?? undefined)].filter(Boolean).join(" · ")}
                  {" · "}
                  <Link to={householdHref(household.id)} className="text-primary hover:underline">{household.full_name}</Link>
                </p>
              </>
            ) : (
              <>
                <h1 className="truncate font-display text-xl md:text-2xl">{household.full_name}</h1>
                <p className="text-xs text-muted-foreground md:text-sm">
                  Household · {read.pets.filter((p) => !p.archived_at && !p.deceased_at).length} active patient{read.pets.filter((p) => !p.archived_at && !p.deceased_at).length === 1 ? "" : "s"}
                </p>
              </>
            )}
          </div>
          {manage && <div className="shrink-0">{manage}</div>}
        </div>

        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Alerts and status">
          {inactive && <li className="status-chip tone-neutral">{patient?.deceased_at ? `Deceased ${patient.deceased_at}` : "Archived"}</li>}
          {allergies.map((a) => (
            <li key={`${a.pet}:${a.text}`} className="status-chip tone-destructive max-w-full" title={a.text}>
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span className="truncate">Allergy{a.pet ? ` (${a.pet})` : ""}: {a.text}</span>
            </li>
          ))}
          {read.high_priority_problems.map((problem) => (
            <li key={problem.id} className="status-chip tone-destructive max-w-full">
              <span className="truncate">{!patient && problem.pet_name ? `${problem.pet_name}: ` : ""}{problem.title}</span>
            </li>
          ))}
          <li className={cn("status-chip", consent.can_message ? "tone-success" : "tone-warning")}>
            {consent.can_message ? "SMS consent on file" : "SMS blocked"}
          </li>
          <li className="status-chip tone-neutral">Prefers {preferred}</li>
          <li>
            <Link
              to={householdHref(household.id, "billing", "invoices")}
              className={cn("status-chip hover:underline", outstanding > 0 ? "tone-warning" : "tone-success")}
            >
              {outstanding > 0 ? `Balance due ${formatCents(outstanding)}` : "No balance due"}
            </Link>
          </li>
        </ul>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {phone ? (
            <>
              <a href={`tel:${phone}`} className="inline-flex min-h-[36px] items-center gap-1.5 text-primary hover:underline" aria-label={`Call ${household.full_name} at ${phone}`}>
                <Phone className="h-4 w-4" aria-hidden="true" />{phone}
              </a>
              <a href={`sms:${phone}`} className="inline-flex min-h-[36px] items-center gap-1.5 text-primary hover:underline md:hidden" aria-label={`Text ${phone} from this phone`}>
                <MessageSquare className="h-4 w-4" aria-hidden="true" />Text
              </a>
            </>
          ) : (
            <span className="text-muted-foreground">No phone</span>
          )}
          {household.primary_email ? (
            <a href={`mailto:${household.primary_email}`} className="inline-flex min-h-[36px] min-w-0 items-center gap-1.5 text-primary hover:underline">
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">{household.primary_email}</span>
            </a>
          ) : (
            <span className="text-muted-foreground">No email</span>
          )}
        </div>
      </div>
    </section>
  );
}

interface QuickAction { label: string; to: string; icon: typeof Phone }

/** Quick actions: each opens the existing flow for that job. */
export function QuickActions360({ read }: { read: Read360 }) {
  const { household, patient } = read;
  const active = patient && !patient.archived_at && !patient.deceased_at;
  const actions: QuickAction[] = [
    ...(patient === null || active ? [{ label: "Book visit", to: scheduleHref({ book: true, clientId: household.id, petId: patient?.id ?? null }), icon: CalendarPlus }] : []),
    ...(patient
      ? [
          ...(active ? [{ label: "New visit note", to: patientHref(patient.id, "medical", "soap"), icon: Stethoscope }] : []),
          { label: "Record vaccine / treatment", to: patientHref(patient.id, "medical", "treatments"), icon: Syringe },
          { label: "Issue certificate", to: patientHref(patient.id, "documents", "certificates"), icon: Award },
          { label: "Release records", to: patientHref(patient.id, "documents", "releases"), icon: Send },
        ]
      : []),
    { label: "Invoice / payment link", to: householdHref(household.id, "billing", "invoices"), icon: Receipt },
    { label: "Estimate", to: householdHref(household.id, "billing", "estimates"), icon: FileSignature },
  ];
  return (
    <nav aria-label="Quick actions" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      <SendToClientDialog
        clientId={household.id}
        trigger={
          <Button size="sm" className="guided-touch shrink-0">
            <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />Message
          </Button>
        }
      />
      {actions.map((action) => (
        <Button key={action.label} asChild size="sm" variant="outline" className="guided-touch shrink-0">
          <Link to={action.to}>
            <action.icon className="mr-1.5 h-4 w-4" aria-hidden="true" />{action.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
