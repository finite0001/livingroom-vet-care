import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIMELINE_FILTERS, centsNumber, deriveNextSteps, filterKinds, formatCents, groupByDay, householdHref,
  patientHref, resolveHouseholdTab, resolvePatientTab, scheduleHref, timelineEntryView,
} from "../../src/hub/features/patient-360/model.ts";
import type { Read360, Signals, TimelineEntry, TimelineKind } from "../../src/hub/features/patient-360/model.ts";

const CLIENT = "36100000-0000-4000-8000-000000000001";
const LUNA = "36200000-0000-4000-8000-000000000001";
const MILO = "36200000-0000-4000-8000-000000000002";
const THREAD = "36700000-0000-4000-8000-000000000001";

function emptySignals(): Signals {
  return {
    as_of: "2026-09-27",
    vaccines_overdue: [], vaccine_plans_awaiting_review: [], labs_overdue: [], labs_awaiting_results: [],
    unsigned_records: [], prescriptions_unsigned: [], refills_open: [], invoices_draft: [], invoices_unpaid: [],
    estimates_open: [],
    communication: { conversation_id: THREAD, unread: false, last_client_at: null, last_staff_at: null, awaiting_reply: false, missed_calls: 0, voicemails: 0 },
    upcoming_appointment: null, reminders_failing: [], release_emails_unsent: [],
  };
}

function read(scope: "patient" | "household", signals: Partial<Signals> = {}, overrides: Partial<Read360> = {}): Read360 {
  return {
    version: 1, scope, generated_at: "2026-09-27T18:00:00Z",
    patient: scope === "patient"
      ? { id: LUNA, client_id: CLIENT, name: "Luna", species: "Dog", breed: null, sex: null, neuter_status: null, dob: null, birth_date_precision: "unknown", color: null, microchip_id: null, allergies: null, archived_at: null, deceased_at: null, active_problem_count: 0 }
      : null,
    household: { id: CLIENT, full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace", primary_phone: "+17205550360", primary_email: "ada@example.test", preferred_channel: "EMAIL", housecall_address: null, mailing_address: null },
    pets: [],
    sms_consent: { opted_in: true, can_message: true, phone_number: "+17205550360", updated_at: null },
    balance: { outstanding_cents: "0", open_invoice_count: 0 },
    high_priority_problems: [],
    signals: { ...emptySignals(), ...signals },
    ...overrides,
  };
}

test("tabs resolve with safe defaults and legacy household aliases", () => {
  assert.equal(resolvePatientTab(null), "overview");
  assert.equal(resolvePatientTab("medical"), "medical");
  assert.equal(resolvePatientTab("../../etc"), "overview");
  assert.deepEqual(resolveHouseholdTab("invoices"), { tab: "billing", section: "invoices" });
  assert.deepEqual(resolveHouseholdTab("estimates"), { tab: "billing", section: "estimates" });
  assert.deepEqual(resolveHouseholdTab("messages"), { tab: "communication", section: "messages" });
  assert.deepEqual(resolveHouseholdTab("consent"), { tab: "communication", section: "consent" });
  assert.deepEqual(resolveHouseholdTab("patients"), { tab: "patients" });
  assert.deepEqual(resolveHouseholdTab("nope"), { tab: "overview" });
});

test("links encode tab and section and omit the default tab", () => {
  assert.equal(patientHref(LUNA), `/hub/patient/${LUNA}`);
  assert.equal(patientHref(LUNA, "medical", "soap"), `/hub/patient/${LUNA}?tab=medical&section=soap`);
  assert.equal(householdHref(CLIENT, "billing", "invoices"), `/hub/client/${CLIENT}?tab=billing&section=invoices`);
  assert.equal(scheduleHref({ book: true, clientId: CLIENT, petId: LUNA }), `/hub/schedule?book=1&client=${CLIENT}&pet=${LUNA}`);
  assert.equal(scheduleHref({ date: "2026-09-30" }), "/hub/schedule?date=2026-09-30");
  assert.equal(scheduleHref(), "/hub/schedule");
});

test("no facts means no next steps", () => {
  assert.deepEqual(deriveNextSteps(read("patient")), []);
});

test("next steps rank urgent clinical and communication work first and link to where each is resolved", () => {
  const steps = deriveNextSteps(read("patient", {
    unsigned_records: [{ kind: "encounter", id: "enc-1", pet_id: LUNA, pet_name: "Luna", at: "2026-09-07T18:00:00Z" }],
    vaccines_overdue: [{ pet_id: LUNA, pet_name: "Luna", group_key: "rabies", group_name: "Rabies", due_on: "2026-08-23" }],
    labs_overdue: [{ id: "lab-1", pet_id: LUNA, pet_name: "Luna", test_name: "Senior panel", status: "ordered", due_date: "2026-09-22" }],
    invoices_unpaid: [{ id: "inv-1", issued_at: "2026-09-12T18:00:00Z", outstanding_cents: "4000" }],
    invoices_draft: [{ id: "inv-2", created_at: "2026-09-26T18:00:00Z" }],
    communication: { conversation_id: THREAD, unread: true, last_client_at: "2026-09-27T15:00:00Z", last_staff_at: "2026-09-27T14:00:00Z", awaiting_reply: true, missed_calls: 1, voicemails: 1 },
    refills_open: [{ id: "rf-1", source: "legacy", pet_id: LUNA, pet_name: "Luna", medication: "Carprofen", status: "REQUESTED", requested_at: "2026-09-27T12:00:00Z" }],
    upcoming_appointment: { id: "appt-1", pet_id: LUNA, pet_name: "Luna", scheduled_at: "2026-09-30T16:00:00Z", appointment_type: "Recheck", visit_type: "housecall", status: "SCHEDULED" },
  }));
  const byId = Object.fromEntries(steps.map(s => [s.id, s]));
  assert.deepEqual(steps.map(s => s.priority), [...steps.map(s => s.priority)].sort((a, b) => ["urgent", "soon", "info"].indexOf(a) - ["urgent", "soon", "info"].indexOf(b)));
  assert.equal(steps[0].id, "unsigned:encounter:enc-1");
  assert.equal(byId["unsigned:encounter:enc-1"].href, `/hub/patient/${LUNA}?tab=medical&section=soap`);
  assert.equal(byId["unsigned:encounter:enc-1"].title, "Visit note (SOAP) not signed");
  assert.equal(byId[`vaccines:${LUNA}`].title, "Rabies overdue");
  assert.match(byId[`vaccines:${LUNA}`].detail, /35 days ago/);
  assert.equal(byId[`vaccines:${LUNA}`].href, `/hub/patient/${LUNA}?section=vaccines`);
  assert.equal(byId["lab-overdue:lab-1"].href, `/hub/patient/${LUNA}?tab=medical&section=labs`);
  assert.equal(byId.calls.title, "Return 1 missed call and 1 voicemail");
  assert.equal(byId.calls.href, `/hub/conversation/${THREAD}`);
  assert.equal(byId.reply.title, "Reply to Ada Lovelace");
  assert.equal(byId["refill:legacy:rf-1"].href, "/hub/tools/refills");
  assert.equal(byId["unpaid:inv-1"].title, "Collect $40.00 balance");
  assert.equal(byId["unpaid:inv-1"].href, `/hub/client/${CLIENT}?tab=billing&section=invoices`);
  assert.equal(byId["draft-invoices"].title, "1 draft invoice not issued");
  assert.equal(byId["appointment:appt-1"].priority, "info");
  assert.equal(byId["appointment:appt-1"].href, "/hub/schedule?date=2026-09-30");
  assert.equal(steps.at(-1)?.id, "appointment:appt-1");
  assert.equal(byId.book, undefined, "a booked visit suppresses the booking prompt");
});

test("household next steps name the pet and group several overdue vaccines per pet", () => {
  const steps = deriveNextSteps(read("household", {
    vaccines_overdue: [
      { pet_id: MILO, pet_name: "Milo", group_key: "fvrcp", group_name: "FVRCP", due_on: "2026-09-01" },
      { pet_id: MILO, pet_name: "Milo", group_key: "rabies", group_name: "Rabies", due_on: "2026-07-01" },
    ],
    labs_awaiting_results: [{ id: "lab-2", pet_id: MILO, pet_name: "Milo", test_name: "CBC", collected_date: "2026-09-20" }],
  }));
  const vaccines = steps.find(s => s.id === `vaccines:${MILO}`)!;
  assert.equal(vaccines.title, "Milo: 2 vaccines overdue");
  assert.match(vaccines.detail, /FVRCP, Rabies/);
  assert.match(vaccines.detail, /Jul 1, 2026/);
  assert.equal(steps.find(s => s.id === "lab-results:lab-2")!.title, "Milo: CBC awaiting results");
  const book = steps.find(s => s.id === "book")!;
  assert.equal(book.href, `/hub/schedule?book=1&client=${CLIENT}`);
});

test("patient-scope titles do not repeat the patient name", () => {
  const steps = deriveNextSteps(read("patient", { labs_overdue: [{ id: "lab-1", pet_id: LUNA, pet_name: "Luna", test_name: "Panel", status: "planned", due_date: "2026-09-01" }] }));
  assert.equal(steps.find(s => s.id === "lab-overdue:lab-1")!.title, "Panel overdue");
  assert.equal(steps.find(s => s.id === "book")!.href, `/hub/schedule?book=1&client=${CLIENT}&pet=${LUNA}`);
});

test("inactive patients are not prompted to book", () => {
  const base = read("patient", { vaccines_overdue: [{ pet_id: LUNA, pet_name: "Luna", group_key: "r", group_name: "Rabies", due_on: "2026-01-01" }] });
  const deceased = { ...base, patient: { ...base.patient!, deceased_at: "2026-09-01" } };
  assert.equal(deriveNextSteps(deceased).some(s => s.id === "book"), false);
});

test("SMS-preferred households without effective consent get a consent step", () => {
  const blocked = read("household", {}, { household: { ...read("household").household, preferred_channel: "SMS" }, sms_consent: { opted_in: false, can_message: false, phone_number: "+17205550360", updated_at: null } });
  const step = deriveNextSteps(blocked).find(s => s.id === "sms-consent")!;
  assert.equal(step.href, `/hub/client/${CLIENT}?tab=communication&section=consent`);
  const emailOnly = read("household", {}, { sms_consent: { opted_in: false, can_message: false, phone_number: null, updated_at: null } });
  assert.equal(deriveNextSteps(emailOnly).some(s => s.id === "sms-consent"), false);
});

test("estimates, prescriptions, reminders and releases each route to their owning screen", () => {
  const steps = deriveNextSteps(read("patient", {
    estimates_open: [
      { id: "est-1", pet_id: LUNA, pet_name: "Luna", status: "draft", created_at: "2026-09-25T18:00:00Z", expires_at: null, total_cents: "12500" },
      { id: "est-2", pet_id: LUNA, pet_name: "Luna", status: "awaiting_decision", created_at: "2026-09-20T18:00:00Z", expires_at: "2026-10-20T18:00:00Z", total_cents: null },
    ],
    prescriptions_unsigned: [{ id: "rx-1", pet_id: LUNA, pet_name: "Luna", medication: "Gabapentin", updated_at: "2026-09-26T18:00:00Z" }],
    reminders_failing: [
      { job_kind: "care", id: "job-1", pet_id: LUNA, pet_name: "Luna", state: "blocked", reason: "No consent", at: "2026-09-26T18:00:00Z" },
      { job_kind: "appointment", id: "ar-1", pet_id: LUNA, pet_name: "Luna", state: "failed", reason: null, at: "2026-09-26T18:00:00Z" },
    ],
    release_emails_unsent: [{ id: "rel-q", release_id: "rel-1", pet_id: LUNA, pet_name: "Luna", state: "ready", created_at: "2026-09-26T18:00:00Z" }],
    vaccine_plans_awaiting_review: [{ pet_id: LUNA, pet_name: "Luna", group_key: "rabies", group_name: "Rabies", plan_id: "plan-1" }],
    refills_open: [{ id: "rf-2", source: "native", pet_id: LUNA, pet_name: "Luna", medication: null, status: "open", requested_at: "2026-09-27T12:00:00Z" }],
  }));
  const byId = Object.fromEntries(steps.map(s => [s.id, s]));
  assert.equal(byId["estimate:est-1"].title, "Estimate not yet sent");
  assert.match(byId["estimate:est-1"].detail, /\$125\.00/);
  assert.equal(byId["estimate:est-1"].priority, "soon");
  assert.equal(byId["estimate:est-2"].priority, "info");
  assert.equal(byId["estimate:est-2"].href, `/hub/client/${CLIENT}?tab=billing&section=estimates`);
  assert.equal(byId["rx:rx-1"].href, `/hub/patient/${LUNA}?tab=medical&section=prescriptions`);
  assert.equal(byId["reminder:care:job-1"].title, "Care reminder blocked");
  assert.equal(byId["reminder:care:job-1"].href, "/hub/tools/care-reminders");
  assert.equal(byId["reminder:appointment:ar-1"].href, "/hub/deliveries");
  assert.equal(byId["release:rel-q"].href, `/hub/patient/${LUNA}?tab=documents&section=releases`);
  assert.equal(byId[`plan:${LUNA}:rabies`].href, `/hub/patient/${LUNA}?tab=medical&section=vaccine-plans`);
  assert.equal(byId["refill:native:rf-2"].title, "Refill request: medication not named");
  assert.equal(byId["refill:native:rf-2"].href, `/hub/patient/${LUNA}?tab=medical&section=prescriptions`);
});

test("money helpers accept server text and never show NaN", () => {
  assert.equal(formatCents("4000"), "$40.00");
  assert.equal(formatCents(null), "$0.00");
  assert.equal(centsNumber("not money"), 0);
  assert.equal(centsNumber(12), 12);
});

function entry(kind: TimelineKind, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return { kind, id: `${kind}-id`, at: "2026-09-27T18:00:00Z", sort_key: `${kind}:${kind}-id`, pet_id: LUNA, pet_name: "Luna", title: null, detail: null, status: null, amount_cents: null, ref: {}, ...overrides };
}
const ctx = { clientId: CLIENT };

test("timeline entries deep-link to the screen that owns each record", () => {
  const cases: [TimelineEntry, string][] = [
    [entry("appointment", { title: "Recheck", status: "SCHEDULED", ref: { date: "2026-09-30" } }), "/hub/schedule?date=2026-09-30"],
    [entry("encounter", { status: "draft" }), `/hub/patient/${LUNA}?tab=medical&section=soap`],
    [entry("chart", { ref: { chart: "dental" } }), `/hub/patient/${LUNA}?tab=medical&section=dental`],
    [entry("chart", { ref: { chart: "qol_scale" } }), `/hub/patient/${LUNA}?tab=medical&section=care-charts`],
    [entry("treatment", { title: "Rabies", ref: { treatment_kind: "vaccine" } }), `/hub/patient/${LUNA}?tab=medical&section=treatments`],
    [entry("lab", { title: "CBC" }), `/hub/patient/${LUNA}?tab=medical&section=labs`],
    [entry("document", { title: "xray.png", ref: { document: "patient" } }), `/hub/patient/${LUNA}?tab=documents&section=documents`],
    [entry("document", { pet_id: null, ref: { document: "household", conversation_id: THREAD } }), `/hub/conversation/${THREAD}`],
    [entry("certificate", { title: "rabies" }), `/hub/patient/${LUNA}?tab=documents&section=certificates`],
    [entry("prescription", { title: "Gabapentin" }), `/hub/patient/${LUNA}?tab=medical&section=prescriptions`],
    [entry("refill", { ref: { refill: "legacy" } }), "/hub/tools/refills"],
    [entry("refill", { ref: { refill: "native" } }), `/hub/patient/${LUNA}?tab=medical&section=prescriptions`],
    [entry("estimate", { pet_id: null }), `/hub/client/${CLIENT}?tab=billing&section=estimates`],
    [entry("invoice", { pet_id: null, status: "issued", amount_cents: "5000", ref: { outstanding_cents: "4000" } }), `/hub/client/${CLIENT}?tab=billing&section=invoices`],
    [entry("payment", { pet_id: null, amount_cents: "1000" }), `/hub/client/${CLIENT}?tab=billing&section=invoices`],
    [entry("message", { pet_id: null, title: "SMS", status: "CLIENT", ref: { conversation_id: THREAD } }), `/hub/conversation/${THREAD}`],
    [entry("call", { pet_id: null, title: "CALL_INBOUND", status: "CLIENT", ref: {} }), `/hub/client/${CLIENT}?tab=communication&section=messages`],
    [entry("reminder", { ref: { reminder: "care" } }), "/hub/tools/care-reminders"],
    [entry("reminder", { ref: { reminder: "appointment", date: "2026-09-30" } }), "/hub/schedule?date=2026-09-30"],
    [entry("record_release", { title: "EMAIL", detail: "vet@example.test" }), `/hub/patient/${LUNA}?tab=documents&section=releases`],
  ];
  for (const [e, href] of cases) assert.equal(timelineEntryView(e, ctx).href, href, `${e.kind} ${JSON.stringify(e.ref)}`);
});

test("timeline entries map labels, statuses and amounts for display", () => {
  const appt = timelineEntryView(entry("appointment", { title: "Recheck", detail: "housecall", status: "SCHEDULED", ref: { date: "2026-09-30" } }), ctx);
  assert.equal(appt.title, "Recheck");
  assert.equal(appt.detail, "House call");
  assert.deepEqual(appt.status, { label: "Booked", tone: "info" });
  const invoice = timelineEntryView(entry("invoice", { status: "issued", amount_cents: "5000", ref: { outstanding_cents: "4000" } }), ctx);
  assert.equal(invoice.amount, "$50.00");
  assert.equal(invoice.detail, "$40.00 due");
  const paid = timelineEntryView(entry("invoice", { status: "issued", amount_cents: "2000", ref: { outstanding_cents: "0" } }), ctx);
  assert.equal(paid.detail, "Paid in full");
  const inbound = timelineEntryView(entry("message", { title: "SMS", status: "CLIENT", detail: "Can Luna come in?" }), ctx);
  assert.equal(inbound.title, "Text from client");
  assert.equal(inbound.status, null, "message sender is not a status");
  const note = timelineEntryView(entry("message", { title: "NOTE", status: "STAFF", ref: { internal: true } }), ctx);
  assert.equal(note.title, "Internal note");
  const missed = timelineEntryView(entry("call", { title: "CALL_INBOUND", status: "CLIENT", detail: "Missed incoming call" }), ctx);
  assert.equal(missed.icon, "phone");
  assert.equal(missed.detail, "Missed incoming call");
  const voicemail = timelineEntryView(entry("voicemail", { title: "VOICEMAIL", status: "CLIENT" }), ctx);
  assert.equal(voicemail.icon, "voicemail");
  const reminder = timelineEntryView(entry("reminder", { title: "lab", detail: "sms", status: "blocked", ref: { reminder: "care", reason: "No consent" } }), ctx);
  assert.equal(reminder.title, "Lab reminder");
  assert.equal(reminder.detail, "By text · No consent");
  assert.deepEqual(reminder.status, { label: "Blocked", tone: "destructive" });
  const cert = timelineEntryView(entry("certificate", { title: "rabies", detail: "Dr. Synthetic", status: "void" }), ctx);
  assert.equal(cert.title, "rabies certificate");
  assert.equal(cert.detail, "Signed by Dr. Synthetic");
  const unknownStatus = timelineEntryView(entry("lab", { status: "some_new_state" }), ctx);
  assert.deepEqual(unknownStatus.status, { label: "some new state", tone: "neutral" });
  const treatment = timelineEntryView(entry("treatment", { title: "Rabies", detail: "vaccine · 1 mL", ref: { treatment_kind: "vaccine", next_due_on: "2027-09-27" } }), ctx);
  assert.equal(treatment.label, "Vaccine");
  assert.equal(treatment.detail, "vaccine · 1 mL · Next due Sep 27, 2027");
});

test("timeline groups by practice-time day in server order", () => {
  const views = [
    entry("message", { id: "a", sort_key: "message:a", at: "2026-09-28T03:00:00Z" }), // Sep 27 in Denver
    entry("message", { id: "b", sort_key: "message:b", at: "2026-09-27T18:00:00Z" }),
    entry("message", { id: "c", sort_key: "message:c", at: "2026-09-26T18:00:00Z" }),
  ].map(e => timelineEntryView(e, ctx));
  const days = groupByDay(views);
  assert.deepEqual(days.map(d => [d.day, d.items.map(i => i.key)]), [["2026-09-27", ["message:a", "message:b"]], ["2026-09-26", ["message:c"]]]);
});

test("filters cover every timeline kind exactly once", () => {
  const all = TIMELINE_FILTERS.flatMap(f => f.kinds ?? []);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual([...all].sort(), ["appointment", "call", "certificate", "chart", "credit", "document", "encounter", "estimate", "invoice", "lab", "message", "payment", "prescription", "record_release", "refill", "refund", "reminder", "treatment", "voicemail"]);
  assert.equal(filterKinds("all"), null);
  assert.deepEqual(filterKinds("schedule"), ["appointment"]);
});
