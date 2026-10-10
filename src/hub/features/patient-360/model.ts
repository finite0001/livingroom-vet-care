/**
 * Patient 360 / household 360 view model.
 *
 * Pure functions only (no React, no Supabase) so next-step derivation and
 * timeline mapping are unit-tested with `node --test`. The server read model
 * (read_patient_360 / read_household_360, list_*_timeline) returns facts; this
 * module decides what staff should do next and where each fact is resolved.
 */

import { smsBlockedText, type SmsConsentStatus } from "../communications/sms-consent-status.ts";

export type Scope = "patient" | "household";

export type PatientTab = "overview" | "medical" | "communication" | "billing" | "schedule" | "documents";
export type HouseholdTab = "overview" | "patients" | "communication" | "billing" | "schedule" | "documents";

export const PATIENT_TABS: readonly PatientTab[] = ["overview", "medical", "communication", "billing", "schedule", "documents"];
export const HOUSEHOLD_TABS: readonly HouseholdTab[] = ["overview", "patients", "communication", "billing", "schedule", "documents"];

/** Old household tab names stay valid links (bookmarks, other screens). */
const HOUSEHOLD_TAB_ALIASES: Record<string, { tab: HouseholdTab; section?: string }> = {
  estimates: { tab: "billing", section: "estimates" },
  invoices: { tab: "billing", section: "invoices" },
  messages: { tab: "communication", section: "messages" },
  consent: { tab: "communication", section: "consent" },
};

export function resolvePatientTab(raw: string | null): PatientTab {
  return PATIENT_TABS.includes(raw as PatientTab) ? (raw as PatientTab) : "overview";
}

export function resolveHouseholdTab(raw: string | null): { tab: HouseholdTab; section?: string } {
  if (raw && HOUSEHOLD_TAB_ALIASES[raw]) return HOUSEHOLD_TAB_ALIASES[raw];
  return { tab: HOUSEHOLD_TABS.includes(raw as HouseholdTab) ? (raw as HouseholdTab) : "overview" };
}

// ---------------------------------------------------------------------------
// Read model shapes (mirror supabase/migrations/20260928170000_patient_360_read_model.sql)

export interface PetSummary {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  archived_at: string | null;
  deceased_at: string | null;
  allergies: string | null;
}

export interface Household {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  preferred_channel: string | null;
  housecall_address: string | null;
  mailing_address: string | null;
}

export interface PatientDetail {
  id: string;
  client_id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: string | null;
  neuter_status: string | null;
  dob: string | null;
  birth_date_precision: string | null;
  color: string | null;
  microchip_id: string | null;
  allergies: string | null;
  archived_at: string | null;
  deceased_at: string | null;
  active_problem_count: number;
}

interface PetRef { pet_id: string | null; pet_name: string | null }

export interface Signals {
  as_of: string;
  vaccines_overdue: (PetRef & { group_key: string; group_name: string; due_on: string })[];
  vaccine_plans_awaiting_review: (PetRef & { group_key: string; group_name: string; plan_id: string | null })[];
  care_plans_overdue?: (PetRef & { id: string; name: string; due_on: string })[];
  care_plans_awaiting_review?: (PetRef & { id: string; name: string; due_on: string })[];
  labs_overdue: (PetRef & { id: string; test_name: string; status: string; due_date: string })[];
  labs_awaiting_results: (PetRef & { id: string; test_name: string; collected_date: string | null })[];
  unsigned_records: (PetRef & { kind: "encounter" | "dental" | "anesthesia" | "qol" | "qol_scale"; id: string; at: string })[];
  prescriptions_unsigned: (PetRef & { id: string; medication: string | null; updated_at: string })[];
  refills_open: (PetRef & { id: string; source: "native" | "legacy"; medication: string | null; status: string; requested_at: string })[];
  invoices_draft: { id: string; created_at: string }[];
  invoices_unpaid: { id: string; issued_at: string; outstanding_cents: string | number }[];
  estimates_open: (PetRef & { id: string; status: "draft" | "awaiting_decision"; created_at: string; expires_at: string | null; total_cents: string | number | null })[];
  communication: {
    conversation_id: string | null;
    unread: boolean;
    last_client_at: string | null;
    last_staff_at: string | null;
    awaiting_reply: boolean;
    missed_calls: number;
    voicemails: number;
  };
  upcoming_appointment: (PetRef & { id: string; scheduled_at: string; appointment_type: string | null; visit_type: string | null; status: string }) | null;
  reminders_failing: (PetRef & { job_kind: "care" | "appointment"; id: string; state: string; reason: string | null; at: string; appointment_id?: string; source_kind?: string })[];
  release_emails_unsent: (PetRef & { id: string; release_id: string; state: string; created_at: string })[];
}

export interface Read360 {
  version: 1;
  scope: Scope;
  generated_at: string;
  patient: PatientDetail | null;
  household: Household;
  pets: PetSummary[];
  sms_consent: SmsConsentStatus & { opted_in: boolean; updated_at: string | null };
  balance: { outstanding_cents: string; open_invoice_count: number };
  high_priority_problems: (PetRef & { id: string; title: string })[];
  signals: Signals;
}

// ---------------------------------------------------------------------------
// Links

export function patientHref(petId: string, tab: PatientTab = "overview", section?: string): string {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  if (section) params.set("section", section);
  const query = params.toString();
  return `/hub/patient/${petId}${query ? `?${query}` : ""}`;
}

export function householdHref(clientId: string, tab: HouseholdTab = "overview", section?: string): string {
  const params = new URLSearchParams();
  if (tab !== "overview") params.set("tab", tab);
  if (section) params.set("section", section);
  const query = params.toString();
  return `/hub/client/${clientId}${query ? `?${query}` : ""}`;
}

export function scheduleHref(options: { date?: string | null; book?: boolean; clientId?: string; petId?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (options.date) params.set("date", options.date);
  if (options.book) params.set("book", "1");
  if (options.clientId) params.set("client", options.clientId);
  if (options.petId) params.set("pet", options.petId);
  const query = params.toString();
  return `/hub/schedule${query ? `?${query}` : ""}`;
}

export function conversationHref(conversationId: string | null | undefined, clientId: string): string {
  return conversationId ? `/hub/conversation/${conversationId}` : householdHref(clientId, "communication", "messages");
}

const CHART_SECTION: Record<string, string> = {
  encounter: "soap",
  dental: "dental",
  anesthesia: "anesthesia",
  qol: "care-charts",
  qol_scale: "care-charts",
};

// ---------------------------------------------------------------------------
// Formatting helpers (locale-stable for tests)

export function centsNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(n) ? n : 0;
}

export function formatCents(value: string | number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(centsNumber(value) / 100);
}

/** Calendar date in America/Denver, YYYY-MM-DD. */
export function denverDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function formatDay(value: string): string {
  // Date-only values are calendar days; timestamps are shown in practice time.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  const timeZone = /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : "America/Denver";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Next steps

export type Priority = "urgent" | "soon" | "info";

export interface NextStep {
  id: string;
  priority: Priority;
  category: "clinical" | "communication" | "billing" | "schedule" | "records";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, soon: 1, info: 2 };

function petPrefix(scope: Scope, name: string | null | undefined): string {
  return scope === "household" && name ? `${name}: ` : "";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const UNSIGNED_LABEL: Record<string, string> = {
  encounter: "Visit note (SOAP) not signed",
  dental: "Dental chart not signed",
  anesthesia: "Anesthesia record not signed",
  qol: "Quality-of-life check-in not signed",
  qol_scale: "Quality-of-life scale not signed",
};

/**
 * Derive the "needs attention / next steps" strip from server facts.
 * Every step links to the screen where it is resolved. Ordered by priority,
 * then by the order the rules below are written (clinical safety first).
 */
export function deriveNextSteps(read: Read360): NextStep[] {
  const { signals: s, scope, household } = read;
  const clientId = household.id;
  const steps: NextStep[] = [];
  const petLink = (petId: string | null, tab: PatientTab, section?: string) =>
    petId ? patientHref(petId, tab, section) : householdHref(clientId, "patients");
  const inactive = read.patient ? Boolean(read.patient.archived_at || read.patient.deceased_at) : false;

  for (const record of s.unsigned_records) {
    steps.push({
      id: `unsigned:${record.kind}:${record.id}`, priority: "urgent", category: "clinical",
      title: `${petPrefix(scope, record.pet_name)}${UNSIGNED_LABEL[record.kind] ?? "Clinical record not signed"}`,
      detail: `Started ${formatDay(record.at)}. Sign or finish it so the record is complete.`,
      href: petLink(record.pet_id, "medical", CHART_SECTION[record.kind] ?? "soap"), actionLabel: "Open record",
    });
  }

  const vaccinesByPet = new Map<string, Signals["vaccines_overdue"]>();
  for (const v of s.vaccines_overdue) {
    const key = v.pet_id ?? "";
    vaccinesByPet.set(key, [...(vaccinesByPet.get(key) ?? []), v]);
  }
  for (const [petId, items] of vaccinesByPet) {
    const oldest = [...items].sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
    const days = daysBetween(oldest.due_on, s.as_of);
    steps.push({
      id: `vaccines:${petId}`, priority: "urgent", category: "clinical",
      title: `${petPrefix(scope, oldest.pet_name)}${items.length === 1 ? `${oldest.group_name} overdue` : `${plural(items.length, "vaccine")} overdue`}`,
      detail: items.length === 1
        ? `Was due ${formatDay(oldest.due_on)} (${plural(days, "day")} ago).`
        : `${items.map(i => i.group_name).join(", ")}. Oldest was due ${formatDay(oldest.due_on)}.`,
      href: petLink(petId || null, "overview", "vaccines"), actionLabel: "Review vaccines",
    });
  }

  for (const lab of s.labs_overdue) {
    steps.push({
      id: `lab-overdue:${lab.id}`, priority: "urgent", category: "clinical",
      title: `${petPrefix(scope, lab.pet_name)}${lab.test_name} overdue`,
      detail: `${lab.status === "ordered" ? "Ordered" : "Planned"}; due ${formatDay(lab.due_date)}.`,
      href: petLink(lab.pet_id, "medical", "labs"), actionLabel: "Open lab tracking",
    });
  }

  const comm = s.communication;
  const thread = conversationHref(comm.conversation_id, clientId);
  if (comm.missed_calls > 0 || comm.voicemails > 0) {
    const parts = [comm.missed_calls > 0 ? plural(comm.missed_calls, "missed call") : "", comm.voicemails > 0 ? plural(comm.voicemails, "voicemail") : ""].filter(Boolean);
    steps.push({
      id: "calls", priority: "urgent", category: "communication",
      title: `Return ${parts.join(" and ")}`,
      detail: `Since the last reply to ${household.full_name}.`,
      href: thread, actionLabel: "Open thread",
    });
  }
  if (comm.awaiting_reply || comm.unread) {
    steps.push({
      id: "reply", priority: "urgent", category: "communication",
      title: comm.awaiting_reply ? `Reply to ${household.full_name}` : `Unread messages from ${household.full_name}`,
      detail: comm.last_client_at ? `Last client message ${formatDateTime(comm.last_client_at)}.` : "The household thread has unread activity.",
      href: thread, actionLabel: "Open thread",
    });
  }

  for (const refill of s.refills_open) {
    steps.push({
      id: `refill:${refill.source}:${refill.id}`, priority: "urgent", category: "clinical",
      title: `${petPrefix(scope, refill.pet_name)}Refill request: ${refill.medication || "medication not named"}`,
      detail: `Requested ${formatDay(refill.requested_at)}${refill.source === "legacy" ? " (legacy request)" : ""}.`,
      href: refill.source === "native" ? petLink(refill.pet_id, "medical", "prescriptions") : "/hub/tools/refills",
      actionLabel: "Review refill",
    });
  }

  for (const invoice of s.invoices_unpaid) {
    steps.push({
      id: `unpaid:${invoice.id}`, priority: "soon", category: "billing",
      title: `Collect ${formatCents(invoice.outstanding_cents)} balance`,
      detail: `Invoice issued ${formatDay(invoice.issued_at)}. Send a payment link or record payment.`,
      href: householdHref(clientId, "billing", "invoices"), actionLabel: "Open billing",
    });
  }
  if (s.invoices_draft.length > 0) {
    steps.push({
      id: "draft-invoices", priority: "soon", category: "billing",
      title: `${plural(s.invoices_draft.length, "draft invoice")} not issued`,
      detail: `Oldest started ${formatDay(s.invoices_draft[0].created_at)}.`,
      href: householdHref(clientId, "billing", "invoices"), actionLabel: "Finish invoice",
    });
  }

  for (const estimate of s.estimates_open) {
    const draft = estimate.status === "draft";
    steps.push({
      id: `estimate:${estimate.id}`, priority: draft ? "soon" : "info", category: "billing",
      title: `${petPrefix(scope, estimate.pet_name)}${draft ? "Estimate not yet sent" : "Estimate awaiting client decision"}`,
      detail: draft
        ? `Draft from ${formatDay(estimate.created_at)}${estimate.total_cents !== null ? ` · ${formatCents(estimate.total_cents)}` : ""}.`
        : `Published${estimate.expires_at ? `; expires ${formatDay(estimate.expires_at)}` : ""}. Follow up with the household.`,
      href: householdHref(clientId, "billing", "estimates"), actionLabel: draft ? "Finish estimate" : "Open estimate",
    });
  }

  for (const rx of s.prescriptions_unsigned) {
    steps.push({
      id: `rx:${rx.id}`, priority: "soon", category: "clinical",
      title: `${petPrefix(scope, rx.pet_name)}Prescription draft not signed: ${rx.medication || "unnamed"}`,
      detail: `Last edited ${formatDay(rx.updated_at)}.`,
      href: petLink(rx.pet_id, "medical", "prescriptions"), actionLabel: "Review prescription",
    });
  }

  for (const lab of s.labs_awaiting_results) {
    steps.push({
      id: `lab-results:${lab.id}`, priority: "soon", category: "clinical",
      title: `${petPrefix(scope, lab.pet_name)}${lab.test_name} awaiting results`,
      detail: lab.collected_date ? `Collected ${formatDay(lab.collected_date)}.` : "Sample collected.",
      href: petLink(lab.pet_id, "medical", "labs"), actionLabel: "Open lab tracking",
    });
  }

  for (const plan of s.care_plans_overdue ?? []) {
    steps.push({ id: `care-overdue:${plan.id}`, priority: "soon", category: "clinical",
      title: `${petPrefix(scope, plan.pet_name)}${plan.name} overdue`, detail: `Care due ${formatDay(plan.due_on)}.`,
      href: petLink(plan.pet_id, "medical", "care-plans"), actionLabel: "Review care plan" });
  }
  for (const plan of s.care_plans_awaiting_review ?? []) {
    steps.push({ id: `care-review:${plan.id}`, priority: "soon", category: "clinical",
      title: `${petPrefix(scope, plan.pet_name)}${plan.name} awaiting veterinarian review`,
      detail: "Review the clinical interval and due date before enabling routine reminders.",
      href: petLink(plan.pet_id, "medical", "care-plans"), actionLabel: "Review care plan" });
  }

  for (const plan of s.vaccine_plans_awaiting_review) {
    steps.push({
      id: `plan:${plan.pet_id}:${plan.group_key}`, priority: "soon", category: "clinical",
      title: `${petPrefix(scope, plan.pet_name)}${plan.group_name} due plan awaiting review`,
      detail: "Review the proposed due date so reminders use it.",
      href: petLink(plan.pet_id, "medical", "vaccine-plans"), actionLabel: "Review plan",
    });
  }

  for (const reminder of s.reminders_failing) {
    steps.push({
      id: `reminder:${reminder.job_kind}:${reminder.id}`, priority: "soon", category: "communication",
      title: `${petPrefix(scope, reminder.pet_name)}${reminder.job_kind === "care" ? "Care" : "Appointment"} reminder ${reminder.state === "blocked" ? "blocked" : reminder.state === "uncertain" ? "delivery uncertain" : "failed"}`,
      detail: reminder.reason ? `Reason: ${reminder.reason}.` : "Check the delivery and contact the household another way if needed.",
      href: reminder.job_kind === "care" ? "/hub/tools/care-reminders" : "/hub/deliveries",
      actionLabel: "Review delivery",
    });
  }

  if (household.preferred_channel === "SMS" && !read.sms_consent.can_message) {
    steps.push({
      id: "sms-consent", priority: "soon", category: "communication",
      title: "Texting is blocked for this household",
      detail: read.sms_consent.phone_number
        ? `SMS is their preferred channel. ${smsBlockedText(read.sms_consent) ?? "Consent is missing, withdrawn or suppressed."}`
        : "SMS is their preferred channel but there is no valid primary phone.",
      href: householdHref(clientId, "communication", "consent"), actionLabel: "Record consent",
    });
  }

  for (const release of s.release_emails_unsent) {
    steps.push({
      id: `release:${release.id}`, priority: "soon", category: "records",
      title: `${petPrefix(scope, release.pet_name)}Record release email not sent`,
      detail: `Prepared ${formatDay(release.created_at)}; still ${release.state}.`,
      href: petLink(release.pet_id, "documents", "releases"), actionLabel: "Open release",
    });
  }

  const next = s.upcoming_appointment;
  if (next) {
    const date = denverDate(next.scheduled_at);
    steps.push({
      id: `appointment:${next.id}`, priority: "info", category: "schedule",
      title: `${petPrefix(scope, next.pet_name)}Next visit ${formatDateTime(next.scheduled_at)}`,
      detail: [next.appointment_type, next.visit_type === "housecall" ? "House call" : next.visit_type === "clinic" ? "Clinic" : null].filter(Boolean).join(" · "),
      href: scheduleHref({ date }), actionLabel: "Open schedule",
    });
  } else if (!inactive && (s.vaccines_overdue.length > 0 || s.labs_overdue.length > 0)) {
    steps.push({
      id: "book", priority: "soon", category: "schedule",
      title: "No visit booked for overdue care",
      detail: "Book a visit to catch up on overdue vaccines or labs.",
      href: scheduleHref({ book: true, clientId, petId: read.patient?.id ?? null }), actionLabel: "Book visit",
    });
  }

  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => PRIORITY_RANK[a.step.priority] - PRIORITY_RANK[b.step.priority] || a.index - b.index)
    .map(({ step }) => step);
}

// ---------------------------------------------------------------------------
// Timeline

export type TimelineKind =
  | "appointment" | "encounter" | "chart" | "treatment" | "lab" | "document" | "certificate"
  | "prescription" | "refill" | "estimate" | "invoice" | "payment" | "refund" | "credit"
  | "message" | "call" | "voicemail" | "reminder" | "record_release";

export interface TimelineEntry {
  kind: TimelineKind;
  id: string;
  at: string;
  sort_key: string;
  pet_id: string | null;
  pet_name: string | null;
  title: string | null;
  detail: string | null;
  status: string | null;
  amount_cents: string | null;
  ref: Record<string, unknown>;
}

export interface TimelinePage {
  version: 1;
  entries: TimelineEntry[];
  has_more: boolean;
  next_cursor: { before_at: string; before_key: string } | null;
}

export type TimelineFilter = "all" | "medical" | "prescriptions" | "documents" | "billing" | "communication" | "schedule";

export const TIMELINE_FILTERS: { id: TimelineFilter; label: string; kinds: TimelineKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "medical", label: "Medical", kinds: ["encounter", "chart", "treatment", "lab"] },
  { id: "prescriptions", label: "Prescriptions", kinds: ["prescription", "refill"] },
  { id: "documents", label: "Documents", kinds: ["document", "certificate", "record_release"] },
  { id: "billing", label: "Billing", kinds: ["estimate", "invoice", "payment", "refund", "credit"] },
  { id: "communication", label: "Messages & calls", kinds: ["message", "call", "voicemail", "reminder"] },
  { id: "schedule", label: "Appointments", kinds: ["appointment"] },
];

export function filterKinds(filter: TimelineFilter): TimelineKind[] | null {
  return TIMELINE_FILTERS.find(f => f.id === filter)?.kinds ?? null;
}

export type Tone = "neutral" | "info" | "terracotta" | "success" | "warning" | "destructive";

export interface TimelineView {
  key: string;
  kind: TimelineKind;
  icon: "calendar" | "stethoscope" | "chart" | "syringe" | "flask" | "file" | "award" | "pill" | "receipt" | "dollar" | "message" | "phone" | "voicemail" | "bell" | "send";
  label: string;
  title: string;
  detail: string | null;
  status: { label: string; tone: Tone } | null;
  petName: string | null;
  at: string;
  href: string;
  amount: string | null;
}

const STATUS_TONES: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: "Booked", tone: "info" },
  CONFIRMED: { label: "Confirmed", tone: "terracotta" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "destructive" },
  NO_SHOW: { label: "No show", tone: "warning" },
  draft: { label: "Draft", tone: "warning" },
  signed: { label: "Signed", tone: "success" },
  administered: { label: "Given", tone: "success" },
  historical: { label: "Historical", tone: "neutral" },
  corrected: { label: "Corrected", tone: "warning" },
  recorded: { label: "Recorded", tone: "neutral" },
  planned: { label: "Planned", tone: "neutral" },
  ordered: { label: "Ordered", tone: "info" },
  collected: { label: "Collected", tone: "info" },
  resulted: { label: "Resulted", tone: "success" },
  cancelled: { label: "Cancelled", tone: "destructive" },
  ready: { label: "Filed", tone: "success" },
  void: { label: "Void", tone: "destructive" },
  issued: { label: "Issued", tone: "success" },
  superseded: { label: "Superseded", tone: "neutral" },
  replaced: { label: "Replaced", tone: "neutral" },
  open: { label: "Open", tone: "warning" },
  closed: { label: "Closed", tone: "success" },
  denied: { label: "Denied", tone: "destructive" },
  requested: { label: "Requested", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  picked_up: { label: "Picked up", tone: "success" },
  awaiting_decision: { label: "Awaiting decision", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "destructive" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  settled: { label: "Settled", tone: "success" },
  applied: { label: "Applied", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  pending: { label: "Queued", tone: "info" },
  claimed: { label: "Sending", tone: "info" },
  accepted_delivery: { label: "Sent", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  sent: { label: "Sent", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  uncertain: { label: "Uncertain", tone: "warning" },
  blocked: { label: "Blocked", tone: "destructive" },
  invalidated: { label: "Cancelled", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  prepared: { label: "Prepared", tone: "success" },
};

function statusFor(kind: TimelineKind, status: string | null): TimelineView["status"] {
  if (!status) return null;
  if (kind === "message" || kind === "call" || kind === "voicemail") return null;
  if (kind === "reminder" && status === "accepted") return STATUS_TONES.accepted_delivery;
  return STATUS_TONES[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" };
}

const MESSAGE_LABEL: Record<string, { inbound: string; outbound: string }> = {
  SMS: { inbound: "Text from client", outbound: "Text to client" },
  EMAIL: { inbound: "Email from client", outbound: "Email to client" },
  CALL_INBOUND: { inbound: "Incoming call", outbound: "Incoming call" },
  CALL_OUTBOUND: { inbound: "Outgoing call", outbound: "Outgoing call" },
  VOICEMAIL: { inbound: "Voicemail", outbound: "Voicemail" },
  NOTE: { inbound: "Internal note", outbound: "Internal note" },
  SYSTEM: { inbound: "System message", outbound: "System message" },
};

const CHART_LABEL: Record<string, string> = { dental: "Dental chart", anesthesia: "Anesthesia", qol: "Quality of life", qol_scale: "Quality-of-life scale" };

/**
 * Map one server timeline entry to what the list renders, including the deep
 * link to the screen that owns the record.
 */
export function timelineEntryView(entry: TimelineEntry, context: { clientId: string }): TimelineView {
  const ref = entry.ref ?? {};
  const str = (key: string) => (typeof ref[key] === "string" ? (ref[key] as string) : null);
  const pet = (tab: PatientTab, section?: string) =>
    entry.pet_id ? patientHref(entry.pet_id, tab, section) : householdHref(context.clientId, "patients");
  const billing = (section: string) => householdHref(context.clientId, "billing", section);
  const base = { key: entry.sort_key, kind: entry.kind, petName: entry.pet_name, at: entry.at, status: statusFor(entry.kind, entry.status), amount: entry.amount_cents !== null ? formatCents(entry.amount_cents) : null };
  const title = entry.title?.trim() || null;
  switch (entry.kind) {
    case "appointment":
      return { ...base, icon: "calendar", label: "Appointment", title: title ?? "Appointment", detail: entry.detail === "housecall" ? "House call" : entry.detail === "clinic" ? "Clinic" : entry.detail, href: scheduleHref({ date: str("date") ?? denverDate(entry.at) }) };
    case "encounter":
      return { ...base, icon: "stethoscope", label: "Visit note", title: "Visit note (SOAP)", detail: entry.detail === "housecall" ? "House call" : entry.detail === "clinic" ? "Clinic" : entry.detail, href: pet("medical", "soap") };
    case "chart": {
      const chart = str("chart") ?? "";
      return { ...base, icon: "chart", label: CHART_LABEL[chart] ?? "Chart", title: title ?? CHART_LABEL[chart] ?? "Chart", detail: entry.detail, href: pet("medical", CHART_SECTION[chart] ?? "care-charts") };
    }
    case "treatment": {
      const vaccine = str("treatment_kind") === "vaccine" || str("treatment_kind") === "vaccine_record";
      const due = str("next_due_on");
      return { ...base, icon: "syringe", label: vaccine ? "Vaccine" : "Treatment", title: title ?? (vaccine ? "Vaccine" : "Treatment"), detail: [entry.detail, due ? `Next due ${formatDay(due)}` : null].filter(Boolean).join(" · ") || null, href: pet("medical", "treatments") };
    }
    case "lab":
      return { ...base, icon: "flask", label: "Lab", title: title ?? "Lab", detail: entry.detail, href: pet("medical", "labs") };
    case "document":
      if (str("document") === "household") {
        const conversation = str("conversation_id");
        return { ...base, icon: "file", label: "Household file", title: title ?? "File", detail: entry.detail, href: conversation ? `/hub/conversation/${conversation}` : householdHref(context.clientId, "documents") };
      }
      return { ...base, icon: "file", label: "Document", title: title ?? "Document", detail: entry.detail?.replace(/_/g, " ") ?? null, href: pet("documents", "documents") };
    case "certificate":
      return { ...base, icon: "award", label: "Certificate", title: title ? `${title.replace(/_/g, " ")} certificate` : "Certificate", detail: entry.detail ? `Signed by ${entry.detail}` : null, href: pet("documents", "certificates") };
    case "prescription":
      return { ...base, icon: "pill", label: "Prescription", title: title ?? "Prescription", detail: entry.detail, href: pet("medical", "prescriptions") };
    case "refill":
      return { ...base, icon: "pill", label: "Refill request", title: title ?? "Refill request", detail: entry.detail ? `Via ${entry.detail.replace(/_/g, " ")}` : null, href: str("refill") === "legacy" ? "/hub/tools/refills" : pet("medical", "prescriptions") };
    case "estimate":
      return { ...base, icon: "receipt", label: "Estimate", title: "Estimate", detail: entry.detail, href: billing("estimates") };
    case "invoice": {
      const outstanding = centsNumber(str("outstanding_cents"));
      return { ...base, icon: "receipt", label: "Invoice", title: "Invoice", detail: entry.status === "issued" ? (outstanding > 0 ? `${formatCents(outstanding)} due` : "Paid in full") : null, href: billing("invoices") };
    }
    case "payment":
    case "refund":
    case "credit":
      return { ...base, icon: "dollar", label: entry.kind === "payment" ? "Payment" : entry.kind === "refund" ? "Refund" : "Credit", title: title ?? "Payment", detail: entry.detail, href: billing("invoices") };
    case "message":
    case "call":
    case "voicemail": {
      const type = title ?? "SMS";
      const inbound = entry.status === "CLIENT";
      const labels = MESSAGE_LABEL[type] ?? { inbound: "Message from client", outbound: "Message to client" };
      const internal = ref.internal === true;
      const icon = entry.kind === "call" ? "phone" : entry.kind === "voicemail" ? "voicemail" : "message";
      return { ...base, icon, label: internal ? "Internal note" : inbound ? labels.inbound : labels.outbound, title: internal ? "Internal note" : inbound ? labels.inbound : labels.outbound, detail: entry.detail, href: conversationHref(str("conversation_id"), context.clientId) };
    }
    case "reminder": {
      const care = str("reminder") === "care";
      const reason = str("reason");
      return { ...base, icon: "bell", label: "Reminder", title: care ? `${title === "lab" ? "Lab" : title === "care_plan" ? "Recurring care" : "Vaccine"} reminder` : "Appointment reminder", detail: [entry.detail ? `By ${entry.detail.toLowerCase() === "sms" ? "text" : entry.detail.toLowerCase()}` : null, reason].filter(Boolean).join(" · ") || null, href: care ? "/hub/tools/care-reminders" : scheduleHref({ date: str("date") }) };
    }
    case "record_release": {
      const email = str("email");
      return { ...base, icon: "send", label: "Record release", title: `Records released by ${title === "SMS" ? "text" : "email"}`, detail: [entry.detail ? `To ${entry.detail}` : null, email ? `Email ${email}` : null].filter(Boolean).join(" · ") || null, href: pet("documents", "releases") };
    }
    default:
      return { ...base, icon: "file", label: "Record", title: title ?? "Record", detail: entry.detail, href: householdHref(context.clientId) };
  }
}

/** Timeline entries grouped under practice-time day headings, preserving order. */
export function groupByDay(views: TimelineView[]): { day: string; items: TimelineView[] }[] {
  const groups: { day: string; items: TimelineView[] }[] = [];
  for (const view of views) {
    const day = denverDate(view.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(view);
    else groups.push({ day, items: [view] });
  }
  return groups;
}
