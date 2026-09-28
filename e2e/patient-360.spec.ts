import { test, expect, type Page, type Request } from "@playwright/test";

const staff = "11111111-1111-4111-8111-111111111111";
const client = "33333333-3333-4333-8333-333333333333";
const luna = "22222222-2222-4222-8222-222222222222";
const milo = "22222222-2222-4222-8222-222222222223";
const thread = "44444444-4444-4444-8444-444444444444";

function denverToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shift(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const today = denverToday();
// Cold dev-server chunks can be slow on a loaded machine; assertions keep their own bounds.
test.describe.configure({ timeout: 120_000 });
const household = {
  id: client, full_name: "Ada Lovelace", first_name: "Ada", last_name: "Lovelace",
  primary_phone: "+17205550360", primary_email: "ada@example.test", preferred_channel: "SMS",
  housecall_address: "100 Synthetic Street, Boulder, CO", mailing_address: null,
};
const pets = [
  { id: luna, name: "Luna", species: "Dog", breed: "Mixed", archived_at: null, deceased_at: null, allergies: "Penicillin" },
  { id: milo, name: "Milo", species: "Cat", breed: null, archived_at: null, deceased_at: null, allergies: null },
];
function signals(scope: "patient" | "household") {
  return {
    as_of: today,
    vaccines_overdue: [{ pet_id: luna, pet_name: "Luna", group_key: "rabies", group_name: "Rabies", due_on: shift(today, -35) }],
    vaccine_plans_awaiting_review: [],
    labs_overdue: scope === "household" ? [{ id: "lab-1", pet_id: milo, pet_name: "Milo", test_name: "Senior panel", status: "ordered", due_date: shift(today, -5) }] : [],
    labs_awaiting_results: [],
    unsigned_records: [{ kind: "encounter", id: "enc-1", pet_id: luna, pet_name: "Luna", at: `${shift(today, -2)}T18:00:00Z` }],
    prescriptions_unsigned: [],
    refills_open: [],
    invoices_draft: [],
    invoices_unpaid: [{ id: "inv-1", issued_at: `${shift(today, -15)}T18:00:00Z`, outstanding_cents: "4000" }],
    estimates_open: [],
    communication: { conversation_id: thread, unread: true, last_client_at: `${today}T15:00:00Z`, last_staff_at: `${today}T14:00:00Z`, awaiting_reply: true, missed_calls: 1, voicemails: 0 },
    upcoming_appointment: null,
    reminders_failing: [],
    release_emails_unsent: [],
  };
}
const patientRead = {
  version: 1, scope: "patient", generated_at: new Date().toISOString(),
  patient: { id: luna, client_id: client, name: "Luna", species: "Dog", breed: "Mixed", sex: "female", neuter_status: "spayed", dob: "2020-01-01", birth_date_precision: "exact", color: null, microchip_id: null, allergies: "Penicillin", archived_at: null, deceased_at: null, active_problem_count: 1 },
  household, pets,
  sms_consent: { opted_in: false, can_message: false, phone_number: "+17205550360", updated_at: null },
  balance: { outstanding_cents: "4000", open_invoice_count: 1 },
  high_priority_problems: [{ id: "prob-1", pet_id: luna, pet_name: "Luna", title: "Seizure history" }],
  signals: signals("patient"),
};
const householdRead = { ...patientRead, scope: "household", patient: null, signals: signals("household") };

function timelineEntry(kind: string, id: string, at: string, extra: Record<string, unknown> = {}) {
  return { kind, id, at, sort_key: `${kind}:${id}`, pet_id: luna, pet_name: "Luna", title: null, detail: null, status: null, amount_cents: null, ref: {}, ...extra };
}
const firstPage = [
  timelineEntry("message", "55555555-5555-4555-8555-000000000001", `${today}T15:00:00Z`, { pet_id: null, pet_name: null, title: "SMS", status: "CLIENT", detail: "Can Luna come in?", ref: { conversation_id: thread, internal: false } }),
  timelineEntry("call", "55555555-5555-4555-8555-000000000002", `${today}T14:30:00Z`, { pet_id: null, pet_name: null, title: "CALL_INBOUND", status: "CLIENT", detail: "Missed incoming call", ref: { conversation_id: thread, internal: false } }),
  timelineEntry("encounter", "55555555-5555-4555-8555-000000000003", `${shift(today, -2)}T18:00:00Z`, { status: "draft", detail: "housecall" }),
];
const secondPage = [
  timelineEntry("invoice", "55555555-5555-4555-8555-000000000004", `${shift(today, -15)}T18:00:00Z`, { pet_id: null, pet_name: null, title: "Invoice", status: "issued", amount_cents: "5000", ref: { outstanding_cents: "4000" } }),
];

interface Calls { timeline: Record<string, unknown>[] }

async function fixture(page: Page): Promise<Calls> {
  const calls: Calls = { timeline: [] };
  const user = { id: staff, aud: "authenticated", role: "authenticated", email: "p360@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = Buffer.from(JSON.stringify({ sub: staff, exp, role: "authenticated", aud: "authenticated" })).toString("base64url");
  const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
  await page.addInitScript((value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(test.info().project.use.baseURL as string).origin ? route.continue() : route.abort());
  const timeline = (request: Request) => {
    const body = request.postDataJSON() as Record<string, unknown>;
    calls.timeline.push(body);
    const kinds = body.p_kinds as string[] | undefined;
    if (kinds) {
      const entries = [...firstPage, ...secondPage].filter((e) => kinds.includes(e.kind));
      return { version: 1, entries, has_more: false, next_cursor: null };
    }
    return body.p_before_key
      ? { version: 1, entries: secondPage, has_more: false, next_cursor: null }
      : { version: 1, entries: firstPage, has_more: true, next_cursor: { before_at: firstPage[2].at, before_key: firstPage[2].sort_key } };
  };
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles") return route.fulfill({ json: [{ ...user, full_name: "Staff Test", first_name: "Staff", last_name: "Test", role: "STAFF", is_active: true }] });
    if (path === "/rest/v1/user_roles") return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/pets") {
      const url = new URL(route.request().url());
      if (url.searchParams.get("id") === `eq.${luna}`) {
        return route.fulfill({ json: { id: luna, client_id: client, name: "Luna", species: "Dog", breed: "Mixed", dob: "2020-01-01", birth_date_precision: "exact", color: "Brown", sex: "female", neuter_status: "spayed", allergies: "Penicillin", microchip_id: null, weight_lbs: null, archived_at: null, deceased_at: null, version: 1 } });
      }
      return route.fulfill({ json: pets.map((p) => ({ ...p, client_id: client, version: 1 })) });
    }
    if (path === "/rest/v1/clients") {
      const row = { ...household, version: 1, ezyvet_id: null, created_at: "2026-01-01T00:00:00Z" };
      const single = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
      return route.fulfill({ json: single ? row : [row] });
    }
    if (path === "/rest/v1/rpc/read_patient_360") {
      expect(route.request().postDataJSON()).toEqual({ p_patient_id: luna });
      return route.fulfill({ json: patientRead });
    }
    if (path === "/rest/v1/rpc/read_household_360") {
      expect(route.request().postDataJSON()).toEqual({ p_client_id: client });
      return route.fulfill({ json: householdRead });
    }
    if (path === "/rest/v1/rpc/list_patient_timeline" || path === "/rest/v1/rpc/list_household_timeline") return route.fulfill({ json: timeline(route.request()) });
    if (path === "/rest/v1/rpc/current_sms_consent") return route.fulfill({ json: { id: null, client_id: client, phone_number: "+17205550360", opted_in: false, can_message: false, updated_at: null } });
    if (path === "/rest/v1/rpc/schedule_clinicians") return route.fulfill({ json: [{ id: staff, full_name: "Staff Test" }] });
    if (path === "/rest/v1/rpc/search_clients") return route.fulfill({ json: [] });
    return route.fulfill({ json: [] });
  });
  return calls;
}

test("mobile patient 360 shows header, red flags, next steps and a unified timeline", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await fixture(page);
  await page.goto(`/hub/patient/${luna}`);

  const header = page.getByRole("region", { name: "Patient summary" });
  await expect(header.getByRole("heading", { name: "Luna" })).toBeVisible({ timeout: 30_000 });
  await expect(header.getByRole("link", { name: "Ada Lovelace", exact: true })).toBeVisible();
  const flags = header.getByRole("list", { name: "Alerts and status" });
  await expect(flags).toContainText("Allergy: Penicillin");
  await expect(flags).toContainText("Seizure history");
  await expect(flags).toContainText("SMS blocked");
  await expect(flags).toContainText("Prefers Text");
  await expect(flags.getByRole("link", { name: "Balance due $40.00" })).toHaveAttribute("href", `/hub/client/${client}?tab=billing&section=invoices`);
  await expect(header.getByRole("link", { name: /^Call Ada Lovelace/ })).toHaveAttribute("href", "tel:+17205550360");
  await expect(header.getByRole("link", { name: "ada@example.test" })).toHaveAttribute("href", "mailto:ada@example.test");

  const actions = page.getByRole("navigation", { name: "Quick actions" });
  await expect(actions.getByRole("button", { name: "Message" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Book visit" })).toHaveAttribute("href", `/hub/schedule?book=1&client=${client}&pet=${luna}`);
  await expect(actions.getByRole("link", { name: "Issue certificate" })).toHaveAttribute("href", `/hub/patient/${luna}?tab=documents&section=certificates`);

  const steps = page.getByRole("list", { name: "Next steps" }).getByRole("listitem");
  await expect(steps.first()).toContainText("Visit note (SOAP) not signed");
  await expect(steps.nth(1)).toContainText("Rabies overdue");
  await expect(page.getByRole("list", { name: "Next steps" })).toContainText("Return 1 missed call");
  await expect(page.getByRole("list", { name: "Next steps" })).toContainText("Reply to Ada Lovelace");
  await page.getByRole("button", { name: /Show \d+ more/ }).click();
  await expect(page.getByRole("list", { name: "Next steps" })).toContainText("Collect $40.00 balance");
  await expect(page.getByRole("list", { name: "Next steps" })).toContainText("Texting is blocked for this household");

  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByRole("link", { name: /Text from client/ })).toHaveAttribute("href", `/hub/conversation/${thread}`);
  await expect(timeline.getByRole("link", { name: /Incoming call/ })).toContainText("Missed incoming call");
  await expect(timeline.getByRole("link", { name: /Visit note \(SOAP\)/ })).toHaveAttribute("href", `/hub/patient/${luna}?tab=medical&section=soap`);
  await timeline.getByRole("button", { name: "Load older entries" }).click();
  await expect(timeline.getByRole("link", { name: /Invoice/ })).toContainText("$40.00 due");
  await expect(timeline.getByRole("button", { name: "Load older entries" })).toHaveCount(0);
  expect(calls.timeline[1]).toMatchObject({ p_patient_id: luna, p_before_at: firstPage[2].at, p_before_key: firstPage[2].sort_key, p_limit: 20 });

  await timeline.getByRole("button", { name: "Billing" }).click();
  await expect(timeline.getByRole("button", { name: "Billing" })).toHaveAttribute("aria-pressed", "true");
  await expect(timeline.getByRole("listitem").filter({ hasText: "Text from client" })).toHaveCount(0);
  expect(calls.timeline.at(-1)).toMatchObject({ p_kinds: ["estimate", "invoice", "payment", "refund", "credit"] });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("next steps deep-link into the owning tab and section", async ({ page }) => {
  await fixture(page);
  await page.goto(`/hub/patient/${luna}`);
  await page.getByRole("link", { name: /Visit note \(SOAP\) not signed/ }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/hub/patient/${luna}\\?tab=medical&section=soap$`));
  await expect(page.getByRole("tab", { name: "Medical" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#p360-soap")).toBeFocused();
  await expect(page.getByRole("region", { name: "Clinical records" })).toBeVisible();
  // Switching tabs keeps the record on the same page (no leave-confirmation) and back again.
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page).toHaveURL(new RegExp(`tab=documents`));
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("region", { name: "Next steps" })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("household 360 aggregates pets and keeps legacy tab links working", async ({ page }) => {
  const calls = await fixture(page);
  await page.goto(`/hub/client/${client}`);
  const header = page.getByRole("region", { name: "Household summary" });
  await expect(header.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible({ timeout: 30_000 });
  await expect(header).toContainText("2 active patients");
  await expect(header.getByRole("list", { name: "Alerts and status" })).toContainText("Allergy (Luna): Penicillin");
  await expect(header.getByRole("list", { name: "Alerts and status" })).toContainText("Luna: Seizure history");
  const nextSteps = page.getByRole("list", { name: "Next steps" });
  await expect(nextSteps).toContainText("Luna: Visit note (SOAP) not signed");
  await expect(nextSteps.getByRole("link", { name: /Milo: Senior panel overdue/ })).toHaveAttribute("href", `/hub/patient/${milo}?tab=medical&section=labs`);
  await expect(page.getByRole("region", { name: "Household timeline" })).toBeVisible();
  expect(calls.timeline[0]).toMatchObject({ p_client_id: client, p_limit: 20 });

  await page.goto(`/hub/client/${client}?tab=invoices`);
  await expect(page.getByRole("tab", { name: "Billing" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await page.goto(`/hub/client/${client}?tab=consent`);
  await expect(page.getByRole("tab", { name: "Communication" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "SMS consent" })).toBeVisible();

  await page.getByRole("tab", { name: "Patients" }).click();
  const actions = page.getByRole("group", { name: "Actions for Milo" });
  await expect(actions.getByRole("link", { name: "Visit note" })).toHaveAttribute("href", `/hub/patient/${milo}?tab=medical&section=soap`);
});

test("book visit quick action opens the existing booking form prefilled", async ({ page }) => {
  await fixture(page);
  await page.goto(`/hub/patient/${luna}`);
  await page.getByRole("navigation", { name: "Quick actions" }).getByRole("link", { name: "Book visit" }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/hub\/schedule\?book=1/);
  const dialog = page.getByRole("dialog", { name: "Book appointment" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByLabel("Household", { exact: true })).toHaveValue(client);
  await dialog.getByRole("button", { name: /cancel|close/i }).first().click();
  await expect(page).toHaveURL(/\/hub\/schedule$/);
});

test("message quick action opens the existing send dialog for the household", async ({ page }) => {
  await fixture(page);
  await page.goto(`/hub/patient/${luna}`);
  await page.getByRole("navigation", { name: "Quick actions" }).getByRole("button", { name: "Message" }).click({ timeout: 30_000 });
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a failed summary never hides the patient record", async ({ page }) => {
  await fixture(page);
  await page.route("http://127.0.0.1:54321/rest/v1/rpc/read_patient_360", (route) => route.fulfill({ status: 500, json: { message: "boom" } }));
  await page.goto(`/hub/patient/${luna}`);
  await expect(page.getByRole("heading", { name: "Luna" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Next steps could not be loaded.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: "Medical" })).toBeVisible();
});
