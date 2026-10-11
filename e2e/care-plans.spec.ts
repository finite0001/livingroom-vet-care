import { test, expect, type Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const actorId = "cabe0000-0000-4000-8000-000000000001", petId = "cabe0000-0000-4000-8000-000000000002", clientId = "cabe0000-0000-4000-8000-000000000003";
const templateId = "cabe0000-0000-4000-8000-000000000004", planId = "cabe0000-0000-4000-8000-000000000005", sourceId = "cabe0000-0000-4000-8000-000000000006";
const at = "2026-01-01T18:00:00+00:00";
const template = { id: templateId, care_key: "synthetic-wellness", name: "Quarterly wellness", care_kind: "wellness", interval_amount: 3, interval_unit: "months", anchor_mode: "completed_care", month_end: "clamp", active: true, review_note: "Synthetic DVM review", version: 1, approved_by: actorId, approved_at: at };
const plan = { id: planId, pet_id: petId, template_id: templateId, template_version: 1, template_snapshot: template, care_key: template.care_key, care_kind: template.care_kind, name: template.name, interval_amount: 3, interval_unit: "months", anchor_mode: "completed_care", month_end: "clamp", anchor_on: "2026-01-31", cycle_index: 1, due_on: "2026-04-30", status: "current", reminders_enabled: true, override_reason: "", review_note: "Synthetic plan review", approved_by: actorId, approved_at: at, last_completion_id: null as string | null, occurrence_id: "cabe0000-0000-4000-8000-000000000007", version: 1, created_by: actorId, updated_by: actorId, created_at: at, updated_at: at };
const source = { source_kind: "service", id: sourceId, pet_id: petId, completed_on: "2026-03-31", source_version: 1, label: "Recorded wellness exam", at: "2026-03-31T18:00:00+00:00" };
interface SavedAction { id: string; request: Record<string, unknown>; receipt: unknown }
async function fixture(page: Page, baseURL: string | undefined, role = "DVM", initialPlan = true, inactive = false) {
 const user = { id: actorId, aud: "authenticated", role: "authenticated", email: "synthetic-care@example.test", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: at };
 const expires = Math.floor(Date.now() / 1000) + 3600;
 const token = Buffer.from(JSON.stringify({ sub: actorId, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url");
 const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.synthetic`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
 await page.addInitScript(value => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)), session);
 const state = { plans: initialPlan ? [structuredClone(plan)] : [], templates: [structuredClone(template)], actions: [] as SavedAction[], loseAck: false, conflict: false, savedCompletions: 0, sourceRows: [structuredClone(source)], rejected: null as Record<string, unknown> | null, policy: null as Record<string, unknown> | null };
 const display = (value: typeof plan) => ({ plan: value, patient_name: "Synthetic Juniper", patient_inactive: inactive, reminder_reason: inactive ? "Patient inactive; routine reminders stopped" : value.status === "proposed" ? "Awaiting veterinarian review" : value.status === "paused" ? "Paused" : "Uses reviewed delivery policies", next_send_at: null });
 await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL ?? "http://127.0.0.1:8080").origin ? route.continue() : route.abort());
 await page.route(`${backend}/**`, async route => {
  const url = new URL(route.request().url()), path = url.pathname, rpc = path.replace("/rest/v1/rpc/", "");
  const body = route.request().method() === "POST" ? route.request().postDataJSON() ?? {} : {};
  const ok = (json: unknown) => route.fulfill({ json });
  if (path === "/auth/v1/token") return ok(session);if (path === "/auth/v1/user") return ok(user);
  if (path === "/rest/v1/profiles") return ok([{ id: actorId, full_name: "Synthetic Reviewer", first_name: "Synthetic", last_name: "Reviewer", role, is_active: true }]);
  if (path === "/rest/v1/user_roles") return ok([{ role }]);
  if (path === "/rest/v1/pets") return ok([{ id: petId, client_id: clientId, name: "Synthetic Juniper", species: "Dog", breed: null, dob: null, birth_date_precision: "unknown", color: null, sex: "unknown", neuter_status: "unknown", microchip_id: null, allergies: null, weight_lbs: null, deceased_at: inactive ? "2026-10-01" : null, archived_at: null, version: 1 }]);
  if (path === "/rest/v1/clients") return ok({ id: clientId, full_name: "Synthetic Household" });
  if (path === "/rest/v1/care_message_templates") return ok([{ id: "cabe0000-0000-4000-8000-000000000008", name: "Reviewed care email", channel: "email", active: true, body: "{{patient_name}} {{care_name}} {{due_date}}", days_before: 0, version: 1 }]);
  if (path === "/rest/v1/reminder_automation_policies") return ok(state.policy ? [state.policy] : []);
  if (rpc === "read_patient_360") return ok(null);
  if (rpc === "list_record_release_sources") return ok({ pet_id: petId, client_id: clientId, client_name: "Synthetic Household", email: null, phone: null, policy_accepted: false, encounter_ids: [], certificate_ids: [], lab_order_ids: [], document_ids: [], dental_ids: [], qol_ids: [], anesthesia_ids: [], lesion_ids: [] });
  if (rpc === "list_recurring_care_templates") return ok({ rows: state.templates, next: null });
  if (rpc === "read_recurring_care_template") return ok(state.templates.find(row => row.id === body.p_id) ?? null);
  if (rpc === "list_patient_care_plans") return ok({ rows: state.plans.map(display), next: null });
  if (rpc === "read_patient_care_plan") return ok(state.plans.find(row => row.id === body.p_plan_id && row.pet_id === body.p_pet_id) ? display(state.plans[0]) : null);
  if (rpc === "list_recurring_care_due") return ok({ rows: [], next: null });
  if (rpc === "list_care_plan_delivery_windows") return ok(state.policy ? [{ policy_id: state.policy.id, start_minute: 480, end_minute: 1200 }] : []);
  if (rpc === "list_care_plan_history") return ok({ rows: state.plans.map(row => ({ version: row.version, snapshot: row, actor_id: actorId, recorded_at: at, completion: null })), next: null });
  if (rpc === "list_care_completion_sources") return ok({ rows: state.savedCompletions ? [] : state.sourceRows, next: null });
  if (rpc === "preview_care_plan_completion") {
   expect(body.p_source_id).toBe(sourceId);
   const current = state.sourceRows[0];
   if (body.p_source_version !== current.source_version) return route.fulfill({ status: 409, json: { code: "PT409", message: "Source changed" } });
   return ok({ source: current, completed_on: current.completed_on, next_due_on: current.source_version === 1 ? "2026-06-30" : "2026-07-01", next_anchor_on: current.completed_on, next_cycle_index: 1 });
  }
  if (rpc === "read_care_workflow_action") return ok(state.actions.find(action => action.id === body.p_action_id)?.receipt ?? null);
  if (["save_patient_care_plan", "save_recurring_care_template", "complete_patient_care_plan", "save_care_plan_delivery_policy"].includes(rpc)) {
   const saved = state.actions.find(action => action.id === body.p_action_id);
   if (saved) { expect(body).toEqual(saved.request);return ok(saved.receipt); }
   if (state.conflict) { state.conflict = false;state.rejected = body;return route.fulfill({ status: 409, json: { code: "PT409", message: "Source changed" } }); }
   let receipt: unknown;
   if (rpc === "save_patient_care_plan") {
    const values = { ...body.p_request };delete values.replace_anchor_evidence;
    const updated = { ...plan, ...values, id: body.p_id, pet_id: body.p_pet_id, template_snapshot: state.templates.find(row => row.id === values.template_id && row.version === values.template_version) ?? plan.template_snapshot, version: Number(body.p_expected_version ?? 0) + 1,
      approved_by: values.status === "current" ? actorId : null, approved_at: values.status === "current" ? at : null };
    state.plans = [updated];receipt = updated;
   } else if (rpc === "complete_patient_care_plan") {
    expect(body.p_pet_id).toBe(petId);expect(body.p_request.source_id).toBe(sourceId);expect(body.p_request.source_version).toBe(state.sourceRows[0].source_version);
    const current = state.sourceRows[0], due = current.source_version === 1 ? "2026-06-30" : "2026-07-01";
    const updated = { ...state.plans[0], anchor_on: current.completed_on, due_on: due, version: 2, last_completion_id: body.p_action_id };
    state.plans = [updated];state.savedCompletions++;
    receipt = { plan: updated, completion: { id: body.p_action_id, plan_id: planId, pet_id: petId, plan_version: 1, source_kind: current.source_kind, source_id: sourceId, source_version: current.source_version, source_snapshot: current, completed_on: current.completed_on, next_due_on: due, review_note: body.p_request.review_note, created_by: actorId, created_at: at } };
   } else if (rpc === "save_recurring_care_template") {
    const updated = { ...body.p_request, id: body.p_id, version: Number(body.p_expected_version ?? 0) + 1, approved_by: actorId, approved_at: at };state.templates.push(updated);receipt = updated;
   } else {
    const values = { ...body.p_request };delete values.start_minute;delete values.end_minute;
    const policy = { ...values, id: body.p_id, source_kind: "care_plan", version: Number(body.p_expected_version ?? 0) + 1, approved_by: actorId, approved_at: at };state.policy = policy;
    receipt = { policy, window: { policy_id: policy.id, start_minute: body.p_request.start_minute, end_minute: body.p_request.end_minute } };
   }
   state.actions.push({ id: body.p_action_id, request: body, receipt });
   if (state.loseAck) { state.loseAck = false;return route.abort("failed"); }
   return ok(receipt);
  }
  return ok([]);
 });
 return state;
}
const patientUrl = `/hub/patient/${petId}?tab=medical&section=care-plans`;
const care = (page: Page) => page.getByRole("region", { name: "Recurring care plans", exact: true });
async function reviewCompletion(page: Page) {
 const region = care(page);await region.getByRole("button", { name: "Link completed care", exact: true }).click();
 await expect(region.getByRole("radio")).not.toBeChecked();await expect(region.getByRole("button", { name: "Confirm completed care", exact: true })).toBeDisabled();
 await region.getByRole("radio").check();await expect(region.getByText("Completed care: 2026-03-31 · next due: 2026-06-30")).toBeVisible();
 await region.getByLabel("Completed care clinical review").fill("Actual exam fulfills this reviewed care plan");
 await region.getByRole("checkbox", { name: "I reviewed that this recorded care fulfills this plan and its calculated next due date" }).check();
}
test("DVM links actual care and recovers a committed completion after lost acknowledgment", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL);await page.goto(patientUrl);await reviewCompletion(page);state.loseAck = true;
 await care(page).getByRole("button", { name: "Confirm completed care", exact: true }).click();
 await expect(care(page).getByLabel("Completed care clinical review")).toBeDisabled();
 await expect(care(page).getByText(/Could not confirm the save/)).toBeVisible();
 await care(page).getByRole("button", { name: "Retry unchanged completion", exact: true }).click();
 await expect(care(page).getByText("Wellness · due 2026-06-30", { exact: true })).toBeVisible();
 expect(state.savedCompletions).toBe(1);expect(state.actions).toHaveLength(1);
});
test("read-only action recovery keeps the exact submitted completion", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL);await page.goto(patientUrl);await reviewCompletion(page);state.loseAck = true;
 await care(page).getByRole("button", { name: "Confirm completed care", exact: true }).click();
 await care(page).getByRole("button", { name: "Check saved action", exact: true }).click();
 await expect(care(page).getByText("Wellness · due 2026-06-30", { exact: true })).toBeVisible();expect(state.savedCompletions).toBe(1);
});
test("STAFF proposes patient-specific wellness interval without clinical activation", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL, "STAFF", false);await page.goto(patientUrl);
 await care(page).getByRole("button", { name: "Add care plan", exact: true }).click();
 await care(page).getByRole("button", { name: "Quarterly wellness · every 3 months", exact: true }).click();
 await care(page).getByLabel("Repeat every", { exact: true }).fill("6");
 await care(page).getByLabel("Calendar anchor date", { exact: true }).fill("2026-01-31");
 await care(page).getByRole("button", { name: "Use calculated due date", exact: true }).click();
 await care(page).getByLabel("Patient override or replacement-baseline reason", { exact: true }).fill("Proposed patient-specific interval for vet review");
 await care(page).getByLabel("Care plan review or stop reason", { exact: true }).fill("Clinical review requested");
 await expect(care(page).getByRole("option", { name: "Reviewed current", exact: true })).toBeDisabled();
 await care(page).getByRole("button", { name: "Save patient care plan", exact: true }).click();
 await expect(care(page).getByText("Awaiting veterinarian review", { exact: true }).first()).toBeVisible();
 expect(state.plans[0].reminders_enabled).toBe(false);expect(state.plans[0].interval_amount).toBe(6);
});
test("DVM pause, explicit review, and a conflict retain the draft", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL);await page.goto(patientUrl);
 await care(page).getByRole("button", { name: "Review care plan", exact: true }).click();
 await care(page).getByLabel("Care plan status", { exact: true }).selectOption("paused");
 await care(page).getByLabel("Care plan review or stop reason", { exact: true }).fill("Pause pending clinical review");state.conflict = true;
 await care(page).getByRole("button", { name: "Save patient care plan", exact: true }).click();
 await expect(care(page).getByText(/Your draft is retained/)).toBeVisible();
 await expect(care(page).getByLabel("Care plan review or stop reason", { exact: true })).toHaveValue("Pause pending clinical review");
 await care(page).getByRole("button", { name: "Save patient care plan", exact: true }).click();
 expect(state.plans[0].status).toBe("paused");expect(state.plans[0].reminders_enabled).toBe(false);
 await care(page).getByRole("button", { name: "Review care plan", exact: true }).click();
 await care(page).getByLabel("Care plan status", { exact: true }).selectOption("current");
 await care(page).getByLabel("Care plan review or stop reason", { exact: true }).fill("Reviewed resumption");
 await expect(care(page).getByRole("button", { name: "Save patient care plan", exact: true })).toBeDisabled();
 await care(page).getByRole("checkbox", { name: "I reviewed this patient's interval, due date and reminder eligibility" }).check();
 await care(page).getByRole("button", { name: "Save patient care plan", exact: true }).click();expect(state.plans[0].status).toBe("current");
});
test("medical-tab draft remains mounted and leaving patient asks for confirmation", async ({ page, baseURL }) => {
 await fixture(page, baseURL);await page.goto(patientUrl);await care(page).getByRole("button", { name: "Review care plan", exact: true }).click();
 await care(page).getByLabel("Care plan review or stop reason", { exact: true }).fill("Unsaved review survives tabs");
 await page.getByRole("tab", { name: "Overview", exact: true }).click();await page.getByRole("tab", { name: /Medical/ }).click();
 await expect(care(page).getByLabel("Care plan review or stop reason", { exact: true })).toHaveValue("Unsaved review survives tabs");
 await page.getByRole("button", { name: "Patients", exact: true }).first().click();
 await expect(page.getByRole("alertdialog")).toBeVisible();await page.getByRole("button", { name: "Keep editing", exact: true }).click();
 await expect(care(page).getByLabel("Care plan review or stop reason", { exact: true })).toHaveValue("Unsaved review survives tabs");
});
test("deceased patient retains history and disables new routine care", async ({ page, baseURL }) => {
 await fixture(page, baseURL, "DVM", true, true);await page.goto(patientUrl);
 await expect(care(page).getByRole("button", { name: "Add care plan", exact: true })).toBeDisabled();
 await expect(care(page).getByRole("button", { name: "Link completed care", exact: true })).toBeDisabled();
 await care(page).getByRole("button", { name: "Care plan history", exact: true }).click();await expect(care(page).getByText(/Version 1 · Reviewed current/)).toBeVisible();
});
test("DVM configures a reviewed default on a mobile screen without seeded intervals", async ({ page, baseURL }) => {
 await page.setViewportSize({ width: 390, height: 844 });const state = await fixture(page, baseURL);await page.goto("/hub/tools/care-reminders");
 const region = page.getByRole("region", { name: "Recurring care defaults", exact: true });await region.getByRole("button", { name: "New care default", exact: true }).click();
 await expect(region.getByLabel("Repeat every", { exact: true })).toHaveValue("");await region.getByLabel("Care name", { exact: true }).fill("Annual wellness");
 await region.getByLabel("Repeat every", { exact: true }).fill("1");await region.getByLabel("Calendar unit", { exact: true }).selectOption("years");
 await region.getByLabel("Default clinical review", { exact: true }).fill("Practice default reviewed by veterinarian");
 await region.getByRole("checkbox", { name: "I reviewed this clinical interval and calendar rule" }).check();
 await region.getByRole("button", { name: "Save reviewed default", exact: true }).click();await expect(region.getByText("Annual wellness", { exact: true })).toBeVisible();
 expect(state.templates.at(-1)?.interval_unit).toBe("years");
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("ADMIN configures send hours while clinical approval remains unavailable", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL, "ADMIN");await page.goto("/hub/tools/care-reminders");
 await expect(page.getByRole("button", { name: "New care default", exact: true })).toHaveCount(0);
 const region = page.getByRole("region", { name: "Recurring care delivery policies", exact: true });await region.getByRole("button", { name: "Review recurring care email delivery", exact: true }).click();
 await region.getByLabel("Recurring care message wording", { exact: true }).selectOption("cabe0000-0000-4000-8000-000000000008");
 await region.getByLabel("Recurring care email subject", { exact: true }).fill("Care due reminder");await region.getByLabel("Denver send-window start", { exact: true }).fill("09:00");
 await region.getByLabel("Denver send-window end (HH:MM)", { exact: true }).fill("18:00");await region.getByLabel("Recurring delivery review reason", { exact: true }).fill("Reviewed send hours and wording");
 await region.getByRole("button", { name: "Save recurring delivery policy", exact: true }).click();
 await expect(region.getByText("Recurring care delivery policy saved. No message is sent by this review.")).toBeVisible();expect(state.policy?.enabled).toBe(false);
 expect(state.actions[0].request.p_request).toMatchObject({ start_minute: 540, end_minute: 1080 });
});
test("refreshed lab version requires explicit selection while the stale review is retained", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL);state.templates[0].care_kind = "bloodwork";state.plans[0].care_kind = "bloodwork";
 state.sourceRows[0] = { ...source, source_kind: "lab", label: "Recorded bloodwork", at: "2026-03-31T06:00:00+00:00" };
 await page.goto(patientUrl);await reviewCompletion(page);
 state.sourceRows[0] = { ...state.sourceRows[0], source_version: 2, label: "Revised bloodwork date", completed_on: "2026-04-01", at: "2026-04-01T06:00:00+00:00" };state.conflict = true;
 await care(page).getByRole("button", { name: "Confirm completed care", exact: true }).click();
 await expect(care(page).getByLabel("Completed care clinical review")).toHaveValue("Actual exam fulfills this reviewed care plan");
 await expect(care(page).getByText(/Selected evidence: Recorded bloodwork · 2026-03-31/)).toBeVisible();
 await expect(care(page).getByRole("radio")).not.toBeChecked();
 expect(state.rejected?.p_request).toMatchObject({ source_id: sourceId, source_version: 1 });
 await care(page).getByRole("radio").check();
 await expect(care(page).getByText("Completed care: 2026-04-01 · next due: 2026-07-01")).toBeVisible();
 await expect(care(page).getByRole("button", { name: "Confirm completed care", exact: true })).toBeDisabled();
 await care(page).getByRole("checkbox", { name: "I reviewed that this recorded care fulfills this plan and its calculated next due date" }).check();
 await care(page).getByRole("button", { name: "Confirm completed care", exact: true }).click();expect(state.savedCompletions).toBe(1);
 await expect(care(page).getByText("Bloodwork · due 2026-07-01", { exact: true })).toBeVisible();
});
test("new practice default stays separate until the vet explicitly adopts and reviews it", async ({ page, baseURL }) => {
 const state = await fixture(page, baseURL);state.templates[0] = { ...template, version: 2, name: "Annual wellness", interval_amount: 1, interval_unit: "years" };
 await page.goto(patientUrl);await expect(care(page).getByText("Every 3 months · from completed care")).toBeVisible();
 await care(page).getByRole("button", { name: "Review care plan", exact: true }).click();
 await expect(care(page).getByLabel("Repeat every", { exact: true })).toHaveValue("3");
 await care(page).getByRole("button", { name: "Use latest practice default for review", exact: true }).click();
 await expect(care(page).getByLabel("Care plan status", { exact: true })).toHaveValue("proposed");
 await care(page).getByRole("button", { name: "Use calculated due date", exact: true }).click();
 await expect(care(page).getByLabel("Patient care due date", { exact: true })).toHaveValue("2027-01-31");
 await care(page).getByLabel("Care plan status", { exact: true }).selectOption("current");
 await care(page).getByLabel("Care plan review or stop reason", { exact: true }).fill("Explicit annual default adopted after patient review");
 await care(page).getByRole("checkbox", { name: "I reviewed this patient's interval, due date and reminder eligibility" }).check();
 await care(page).getByRole("button", { name: "Save patient care plan", exact: true }).click();
 expect(state.plans[0].template_version).toBe(2);expect(state.plans[0].interval_unit).toBe("years");expect(state.plans[0].template_snapshot.version).toBe(2);
});
