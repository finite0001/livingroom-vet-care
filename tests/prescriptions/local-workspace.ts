/** Actual browser + Auth + RPC acceptance, restricted to an explicitly owned
 * disposable runtime. Does not start, reset or stop a database. */
import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { createPrescriptionApi } from "../../src/hub/features/prescriptions/prescription-api.ts";
import type {
  NativeDispense,
  NativePickup,
} from "../../src/hub/features/prescriptions/fulfillment-api.ts";
import { createFulfillmentApi } from "../../src/hub/features/prescriptions/fulfillment-api.ts";
const root = realpathSync(new URL("../..", import.meta.url).pathname);
const project = process.env.NATIVE_PRESCRIPTION_TEST_PROJECT;
assert.ok(project, "An explicit owned disposable project is required");
const projectPath = realpathSync(project);
const projectId = readFileSync(
  resolve(projectPath, "supabase/config.toml"),
  "utf8",
).match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
assert.ok(
  projectId?.startsWith("lrv-prescription-"),
  "Only lrv-prescription-* disposable runtimes are accepted",
);
function capture(command: string, args: string[], input?: string): string {
  try {
    return execFileSync(command, args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    }).trim();
  } catch {
    throw new Error(
      `Owned local ${command} command failed; private output was withheld.`,
    );
  }
}
const container = `supabase_db_${projectId}`;
const labels = JSON.parse(capture("docker", ["inspect", container]))[0]?.Config
  ?.Labels;
assert.equal(
  labels?.["com.supabase.cli.project"],
  projectId,
  "Container project ownership must match",
);
assert.equal(
  realpathSync(labels?.["com.supabase.cli.workdir"]),
  projectPath,
  "Container workdir ownership must match",
);
const local = JSON.parse(
  capture("supabase", ["status", "--workdir", projectPath, "--output", "json"]),
);
assert.match(local.API_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(typeof local.ANON_KEY, "string");
assert.equal(typeof local.SERVICE_ROLE_KEY, "string");
const sql = (query: string) =>
  capture(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    query,
  );
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const anonymous = {
  apikey: local.ANON_KEY,
  "Content-Type": "application/json",
};
const service = {
  ...anonymous,
  Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`,
};
let checks = 0,
  blockedExternal = 0;
const check = (condition: unknown, label: string) => {
  assert.ok(condition, label);
  checks++;
};
async function post(
  path: string,
  body: unknown,
  headers: Record<string, string>,
) {
  const response = await fetch(`${local.API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      `Local synthetic HTTP request failed with status ${response.status}; response withheld.`,
    );
  return value;
}
async function user(label: string) {
  const email = `native-workspace-${label}-${randomUUID()}@example.test`,
    password = `Synthetic-${randomUUID()}-Aa1!`;
  const created = await post(
    "/auth/v1/admin/users",
    {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Synthetic ${label}` },
    },
    service,
  );
  const session = await post(
    "/auth/v1/token?grant_type=password",
    { email, password },
    anonymous,
  );
  check(
    typeof created.id === "string" && session.user.id === created.id,
    "Actual synthetic Auth identity is bound",
  );
  return {
    id: created.id as string,
    session,
    headers: { ...anonymous, Authorization: `Bearer ${session.access_token}` },
  };
}
const doctor = await user("DVM"),
  staff = await user("dispensing-staff");
sql(
  `insert into user_roles(user_id,role) values(${quote(doctor.id)},'DVM'),(${quote(doctor.id)},'ADMIN'),(${quote(staff.id)},'STAFF') on conflict do nothing; update profiles set is_active=true,full_name='Synthetic workspace staff' where id in (${quote(doctor.id)},${quote(staff.id)});`,
);
async function rpc(
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = doctor.headers,
) {
  return post(`/rest/v1/rpc/${name}`, args, headers);
}
const adapter = (headers: Record<string, string>) => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    try {
      return { data: await rpc(name, args, headers), error: null };
    } catch {
      return {
        data: null,
        error: new Error(`Synthetic local RPC ${name} failed`),
      };
    }
  },
});
const startsOn = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  expiresOn = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const household = await rpc("save_client", {
  p_actor_id: doctor.id,
  p_client_id: null,
  p_expected_version: null,
  p_first_name: "Synthetic",
  p_last_name: "Browser household",
  p_primary_phone: null,
  p_primary_email: "synthetic@example.test",
  p_preferred_channel: "EMAIL",
  p_mailing_address: "Synthetic browser test address",
  p_housecall_address: null,
});
const patient = await rpc("save_patient", {
  p_id: null,
  p_client_id: household.id,
  p_expected_version: null,
  p_name: "Synthetic browser patient",
  p_species: "Dog",
  p_breed: null,
  p_dob: null,
  p_birth_date_precision: "unknown",
  p_color: null,
  p_sex: "unknown",
  p_neuter_status: "unknown",
  p_microchip_id: null,
  p_archived_at: null,
  p_deceased_at: null,
});
const doctorApi = createPrescriptionApi(
  adapter(doctor.headers),
  doctor.id,
  patient.id,
);
await doctorApi.execute({
  id: randomUUID(),
  kind: "configure_prescriber",
  payload: {
    user_id: doctor.id,
    expected_version: null,
    fields: {
      active: true,
      license_number: "SYNTHETIC-ONLY",
      license_state: "CO",
      license_expires_on: expiresOn,
      practice_name: "Synthetic browser practice",
      practice_address: "Synthetic location",
      practice_phone: null,
      clinical_review_note:
        "Synthetic local acceptance fixture only; not production clinical approval.",
    },
    attest_review: true,
  },
});
const product = await rpc(
  "save_catalog_product",
  {
    p_id: null,
    p_expected_version: null,
    p_name: "Synthetic browser stock",
    p_kind: "medication",
    p_manufacturer: "",
    p_unit: "tablet",
    p_unit_price_cents: 125,
    p_active: true,
  },
  staff.headers,
);
const lotIds = [randomUUID(), randomUUID()].sort();
for (const [index, lotId] of lotIds.entries())
  await rpc(
    "receive_inventory",
    {
      p_id: randomUUID(),
      p_lot_id: lotId,
      p_product_id: product.id,
      p_lot_number: `SYNTHETIC-BROWSER-${index + 1}`,
      p_expires_on: expiresOn,
      p_location: "Synthetic shelf",
      p_quantity: 10,
      p_reason: "Synthetic browser stock fixture",
    },
    staff.headers,
  );
const invoiceId = randomUUID();
await rpc(
  "create_billing_invoice",
  { p_id: invoiceId, p_client_id: household.id },
  staff.headers,
);
const draftId = randomUUID();
await doctorApi.execute({
  id: randomUUID(),
  kind: "save_draft",
  payload: {
    draft_id: draftId,
    pet_id: patient.id,
    client_id: household.id,
    expected_version: null,
    fields: {
      encounter_id: null,
      medication: {
        name: "Synthetic browser medication",
        strength: "Synthetic strength",
        form: "Synthetic form",
        directions:
          "Synthetic fixture directions, never clinical instructions.",
        route: "Synthetic route",
      },
      quantity_per_fill: "3",
      unit: "tablet",
      refills_authorized: 1,
      fulfillment_mode: "practice_stock",
      product_id: product.id,
      starts_on: startsOn,
      expires_on: expiresOn,
    },
  },
});
const draft = await doctorApi.readDraft(draftId);
assert.ok(draft);
const signing = await doctorApi.preview(draft);
const signed = await doctorApi.execute({
  id: randomUUID(),
  kind: "sign",
  payload: {
    draft_id: draft.id,
    pet_id: patient.id,
    expected_version: draft.version,
    expected_context_hash: signing.context_hash,
    signature_name: signing.context.prescriber.name,
    attest_review: true,
  },
});
assert.equal(signed.operation, "sign");
const authorization = await doctorApi.readAuthorization(signed.id);
assert.ok(authorization);
const api = createFulfillmentApi(
  adapter(staff.headers),
  staff.id,
  authorization,
);
const untouched = sql(
  "select jsonb_build_object('treatments',(select count(*) from patient_treatments),'outbox',(select count(*) from communication_outbox))::text",
);
// Explicitly synthetic acceptance in the owned disposable database only.
sql(`insert into public.record_release_policy(id,enabled,accepted_by,accepted_at,acceptance_reference,accepted_schema_version)
  values(true,true,'Synthetic local browser reviewer',now(),'Disposable browser acceptance only; not production clinical approval',11)
  on conflict(id) do update set enabled=true,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,
  acceptance_reference=excluded.acceptance_reference,accepted_schema_version=excluded.accepted_schema_version;`);
const privateDir = mkdtempSync(resolve(tmpdir(), "lrv-native-browser-"));
chmodSync(privateDir, 0o700);
let server: ChildProcess | undefined,
  browser: Browser | undefined,
  context: BrowserContext | undefined,
  logFd: number | undefined;
let serverExited = false;
const baseUrl = "http://127.0.0.1:8091";
try {
  // Refuse to attach to or terminate an unrelated server on the requested port.
  await new Promise<void>((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(new Error("Owned browser port 8091 is already occupied")),
    );
    probe.listen(8091, "127.0.0.1", () => probe.close(() => resolvePort()));
  });
  logFd = openSync(resolve(privateDir, "vite.log"), "wx", 0o600);
  server = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      "8091",
      "--strictPort",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        VITE_SUPABASE_URL: local.API_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
        VITE_CONTACT_INTAKE_URL: `${local.API_URL}/functions/v1/public-contact`,
        VITE_CONTACT_TURNSTILE_SITE_KEY: "synthetic-local-only",
      },
    },
  );
  server.once("exit", () => {
    serverExited = true;
  });
  server.once("error", () => {
    serverExited = true;
  });
  const deadline = Date.now() + 30000;
  while (true) {
    if (serverExited)
      throw new Error("Owned Vite process failed; private logs withheld");
    try {
      const response = await fetch(baseUrl, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
    } catch {
      /* Wait only for our own Vite process. */
    }
    if (Date.now() > deadline)
      throw new Error("Owned Vite did not become ready");
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ serviceWorkers: "block" });
  const allowed = new Set([baseUrl, local.API_URL]);
  await context.route("**/*", (route) => {
    if (allowed.has(new URL(route.request().url()).origin))
      return route.continue();
    blockedExternal++;
    return route.abort();
  });
  await context.routeWebSocket("**/*", (socket) => {
    const url = new URL(socket.url());
    if (
      url.hostname === "127.0.0.1" &&
      ["8091", new URL(local.API_URL).port].includes(url.port)
    )
      socket.connectToServer();
    else socket.close();
  });
  const storageKey = `sb-${new URL(local.API_URL).hostname.split(".")[0]}-auth-token`;
  await context.addInitScript(
    ({ key, session }) => localStorage.setItem(key, JSON.stringify(session)),
    { key: storageKey, session: staff.session },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(`${baseUrl}/hub/patient/${patient.id}`);
  await page
    .getByRole("button", { name: "View signed snapshot", exact: true })
    .click();
  const workspace = page.getByRole("region", {
    name: "Prescription fulfillment",
    exact: true,
  });
  await expect(workspace).toContainText(
    "remaining mathematical allowance: 6.000",
  );
  checks++;
  await page
    .getByRole("button", { name: "Record a dispense", exact: true })
    .click();
  await page
    .getByLabel("Draft household invoice", { exact: true })
    .selectOption(invoiceId);
  await page
    .getByLabel("Total quantity to dispense", { exact: true })
    .fill("2");
  await page.getByLabel("Lot 1", { exact: true }).selectOption(lotIds[0]);
  await page.getByLabel("Quantity from lot 1", { exact: true }).fill("1.250");
  await page.getByRole("button", { name: "Add another lot" }).click();
  await page.getByLabel("Lot 2", { exact: true }).selectOption(lotIds[1]);
  await page.getByLabel("Quantity from lot 2", { exact: true }).fill("0.750");
  await page
    .getByLabel("Reason for this fulfillment record", { exact: true })
    .fill("Synthetic browser partial dispensing");
  await page
    .getByRole("button", { name: "Review fulfillment evidence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Frozen fulfillment review" }),
  ).toContainText("charge $2.50");
  checks++;
  await expect(
    page.getByRole("button", { name: "Confirm reviewed dispense" }),
  ).toBeDisabled();
  checks++;
  await page
    .getByRole("checkbox", {
      name: /I reviewed patient identity, signed directions/,
    })
    .check();
  await page.getByRole("button", { name: "Confirm reviewed dispense" }).click();
  await expect(workspace).toContainText("Open fill 1: 1.000");
  checks++;
  await expect(
    page.getByRole("region", { name: "Prescription lifecycle" }),
  ).toContainText("Native dispensed quantity: 2.000");
  checks++;
  const records = (await api.history("dispenses"))
    .dispenses as NativeDispense[];
  check(
    records.length === 1,
    "Actual browser action persisted one immutable dispense",
  );
  const saved = records[0];
  check(
    saved.quantity === "2.000" &&
      saved.amount_cents === "250" &&
      saved.allocations.length === 2 &&
      saved.actor_id === staff.id,
    "Actual saved dispense binds actor, exact allocations and one charge",
  );
  const recovered = await rpc(
    "recover_native_fulfillment_operation",
    { p_id: saved.id },
    staff.headers,
  );
  check(
    recovered.operation === "dispense" &&
      recovered.id === saved.id &&
      recovered.request.allocations[0].quantity === "1.250" &&
      recovered.request.allocations[1].quantity === "0.750",
    "Actual receipt preserves exact UI allocation strings",
  );
  check(
    sql(
      `select count(*) from billing_invoice_items where invoice_id=${quote(invoiceId)}`,
    ) === "1",
    "Actual browser multi-lot dispense creates one invoice item",
  );
  check(
    sql(
      `select sum(amount_cents)::text from billing_invoice_items where invoice_id=${quote(invoiceId)}`,
    ) === "250",
    "Actual browser charge equals the reviewed exact amount",
  );
  for (const [index, lotId] of lotIds.entries())
    check(
      sql(
        `select sum(quantity)::text from inventory_movements where lot_id=${quote(lotId)}`,
      ) === (index === 0 ? "8.750" : "9.250"),
      "Actual stock movement equals exact selected lot allocation",
    );
  await page
    .getByRole("button", { name: "Preview this dispense label", exact: true })
    .click();
  const label = page
    .frameLocator('iframe[title="Native dispensing label"]')
    .locator("body");
  await expect(label).toContainText("SYNTHETIC-BROWSER-1");
  await expect(label).toContainText("SYNTHETIC-BROWSER-2");
  checks += 2;
  await expect(label).toContainText("Synthetic fixture directions");
  checks++;
  await page
    .getByRole("button", { name: "Record pickup", exact: true })
    .click();
  await page
    .getByLabel("Recipient name", { exact: true })
    .fill("Synthetic recipient");
  await page
    .getByLabel("Recipient relationship", { exact: true })
    .fill("Synthetic owner");
  await page
    .getByLabel("Reason for this fulfillment record", { exact: true })
    .fill("Synthetic browser handoff");
  await page
    .getByRole("button", { name: "Review fulfillment evidence" })
    .click();
  await page
    .getByRole("checkbox", { name: /confirm the actual handoff/ })
    .check();
  await page.getByRole("button", { name: "Confirm physical pickup" }).click();
  await expect(
    page.getByRole("region", { name: "Fulfillment history" }),
  ).toContainText("Synthetic recipient (Synthetic owner)");
  checks++;
  const pickups = (await api.history("pickups")).pickups as NativePickup[];
  check(
    pickups.length === 1 &&
      pickups[0].dispense_id === saved.id &&
      pickups[0].actor_id === staff.id,
    "Actual UI pickup binds original dispense and staff",
  );
  const pickupReceipt = await rpc(
    "recover_native_fulfillment_operation",
    { p_id: pickups[0].id },
    staff.headers,
  );
  check(
    pickupReceipt.operation === "pickup" &&
      pickupReceipt.request.dispense_id === saved.id,
    "Actual pickup has its own immutable operation receipt",
  );
  check(
    sql(
      `select count(*) from billing_invoice_items where invoice_id=${quote(invoiceId)}`,
    ) === "1" &&
      sql(
        `select sum(quantity)::text from inventory_movements where lot_id in (${lotIds.map(quote).join(",")})`,
      ) === "18.000",
    "Label and pickup never duplicate stock debit or charge",
  );
  check(
    (await api.read())?.usage.fulfillment_head.version === 1,
    "Pickup does not consume another fill allowance",
  );
  const releasePanel = page.getByRole("region", {
    name: "Patient medical-record releases",
    exact: true,
  });
  await releasePanel
    .getByRole("button", {
      name: "Select all shown: Signed practice prescriptions",
      exact: true,
    })
    .click();
  await releasePanel
    .getByRole("button", {
      name: "Select all shown: Recorded practice dispensing",
      exact: true,
    })
    .click();
  const previewResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${local.API_URL}/rest/v1/rpc/preview_record_release_v11` &&
      response.request().method() === "POST",
  );
  await releasePanel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  const reviewedResponse = await previewResponse;
  check(reviewedResponse.ok(), "Actual browser release preview succeeds");
  const reviewed = await reviewedResponse.json();
  check(
    reviewed.snapshot.schema_version === 11 &&
      reviewed.snapshot.native_prescriptions.length === 1 &&
      reviewed.snapshot.native_dispenses.length === 1,
    "Actual browser preview explicitly selects both native families",
  );
  const releaseHtml = releasePanel
    .frameLocator('iframe[title="Medical-record release artifact"]')
    .locator("body");
  await expect(releaseHtml).toContainText("Selected signed prescription");
  await expect(releaseHtml).toContainText("Selected recorded dispense");
  await expect(releaseHtml).toContainText("SYNTHETIC-BROWSER-1");
  await expect(releaseHtml).toContainText("SYNTHETIC-BROWSER-2");
  await expect(releaseHtml).toContainText("Synthetic recipient");
  await expect(releaseHtml).not.toContainText(invoiceId);
  checks += 6;
  await expect(
    releasePanel.getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toBeDisabled();
  checks++;
  await releasePanel
    .getByRole("checkbox", { name: /I reviewed the complete selected records/ })
    .check();
  const confirmResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${local.API_URL}/rest/v1/rpc/confirm_record_release` &&
      response.request().method() === "POST",
  );
  await releasePanel
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
  const confirmedResponse = await confirmResponse;
  check(
    confirmedResponse.ok(),
    "Actual browser confirms reviewed schema11 package",
  );
  const confirmed = await confirmedResponse.json();
  await expect(
    releasePanel.getByRole("button", {
      name: "Confirm reviewed package",
      exact: true,
    }),
  ).toHaveCount(0);
  checks++;
  const releaseRead = await rpc(
    "read_record_release",
    { p_id: confirmed.id },
    staff.headers,
  );
  check(
    releaseRead.eligible === true &&
      releaseRead.release.created_by === staff.id &&
      releaseRead.release.pet_id === patient.id &&
      releaseRead.release.client_id === household.id &&
      releaseRead.release.source_hash === reviewed.source_hash,
    "Actual release read binds actor, patient, household and reviewed fingerprint",
  );
  assert.deepEqual(releaseRead.release.snapshot, reviewed.snapshot);
  checks++;
  assert.deepEqual(releaseRead.release.selection.native_prescription_ids, [
    authorization.id,
  ]);
  checks++;
  assert.deepEqual(releaseRead.release.selection.native_dispense_ids, [
    saved.id,
  ]);
  checks++;
  const frozen = JSON.parse(
    sql(
      `select snapshot::text from record_releases where id=${quote(confirmed.id)}`,
    ),
  );
  assert.deepEqual(frozen, reviewed.snapshot);
  checks++;
  check(
    frozen.native_prescriptions[0].id === authorization.id &&
      frozen.native_dispenses[0].id === saved.id &&
      frozen.native_dispenses[0].pickup.id === pickups[0].id &&
      frozen.native_dispenses[0].prescription.id === authorization.id &&
      !Object.hasOwn(frozen.native_dispenses[0].artifact, "invoice_id"),
    "Database frozen artifact binds exact order, dispense and pickup without financial internals",
  );
  check(
    sql(
      `select count(*) from record_release_sources where release_id=${quote(confirmed.id)} and source_kind in ('native_prescription','native_dispense')`,
    ) === "2",
    "Actual release registers both explicit native source dependencies",
  );
  await releasePanel
    .getByRole("button", { name: "Open release package", exact: true })
    .click();
  await expect(releaseHtml).toContainText("Selected recorded dispense");
  await expect(releaseHtml).toContainText("Synthetic recipient");
  checks += 2;
  const originalDispense = sql(
    `select document::text from native_dispenses where id=${quote(saved.id)}`,
  );
  const originalPickup = sql(
    `select document::text from native_pickups where id=${quote(pickups[0].id)}`,
  );
  await page
    .getByRole("button", {
      name: "Review annotations and pickup amendments",
      exact: true,
    })
    .click();
  const corrections = page.getByRole("region", {
    name: "Dispense record corrections",
    exact: true,
  });
  await expect(
    corrections.getByText("No annotations recorded.", { exact: true }),
  ).toBeVisible();
  checks++;
  await corrections
    .getByLabel("Reason for annotation", { exact: true })
    .fill("Synthetic browser record clarification");
  await corrections
    .getByLabel("Correction note", { exact: true })
    .fill(
      "Synthetic client-shareable clarification; original dispensing preserved.",
    );
  await corrections
    .getByRole("button", { name: "Review record correction", exact: true })
    .click();
  await expect(
    corrections.getByRole("button", {
      name: "Save reviewed correction",
      exact: true,
    }),
  ).toBeDisabled();
  checks++;
  await corrections
    .getByRole("checkbox", { name: /I reviewed the original record/ })
    .check();
  const annotationResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${local.API_URL}/rest/v1/rpc/append_native_dispense_correction` &&
      response.request().method() === "POST",
  );
  await corrections
    .getByRole("button", { name: "Save reviewed correction", exact: true })
    .click();
  const annotationHttp = await annotationResponse;
  check(
    annotationHttp.ok(),
    "Actual browser appends a reviewed operational annotation",
  );
  const annotation = await annotationHttp.json();
  await expect(
    corrections.getByText(
      "Synthetic client-shareable clarification; original dispensing preserved.",
      { exact: true },
    ),
  ).toBeVisible();
  checks++;
  await corrections
    .getByLabel("Annotation type", { exact: true })
    .selectOption("pickup_amendment");
  await corrections
    .getByLabel("Pickup amendment meaning", { exact: true })
    .selectOption("recorded_in_error");
  await corrections
    .getByLabel("Reason for annotation", { exact: true })
    .fill("Synthetic original acknowledgment disputed");
  await corrections
    .getByLabel("Correction note", { exact: true })
    .fill("Synthetic amendment does not establish a replacement handoff.");
  await corrections
    .getByRole("button", { name: "Review record correction", exact: true })
    .click();
  await corrections
    .getByRole("checkbox", { name: /I reviewed the original record/ })
    .check();
  const amendmentResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${local.API_URL}/rest/v1/rpc/append_native_dispense_correction` &&
      response.request().method() === "POST",
  );
  await corrections
    .getByRole("button", { name: "Save reviewed correction", exact: true })
    .click();
  const amendmentHttp = await amendmentResponse;
  check(
    amendmentHttp.ok(),
    "Actual browser records a disputed pickup acknowledgment separately",
  );
  const amendment = await amendmentHttp.json();
  await expect(
    corrections.getByText(
      /Latest pickup assertion: Original acknowledgment disputed/,
    ),
  ).toBeVisible();
  checks++;
  const correctionPage = await rpc(
    "list_native_dispense_corrections",
    {
      p_authorization_id: authorization.id,
      p_pet_id: patient.id,
      p_dispense_id: saved.id,
      p_before_version: null,
      p_limit: 25,
    },
    staff.headers,
  );
  check(
    correctionPage.events.length === 2 &&
      correctionPage.events[0].id === amendment.id &&
      correctionPage.events[1].id === annotation.id &&
      correctionPage.events[0].prior_event_id === annotation.id &&
      correctionPage.events[0].actor.id === staff.id,
    "Actual browser writes an attributed two-entry immutable predecessor chain",
  );
  check(
    amendment.request.pickup_amendment.original_pickup_id === pickups[0].id &&
      amendment.request.pickup_amendment.handoff === null,
    "Actual disputed acknowledgment names original pickup without invented handoff",
  );
  check(
    originalDispense ===
      sql(
        `select document::text from native_dispenses where id=${quote(saved.id)}`,
      ) &&
      originalPickup ===
        sql(
          `select document::text from native_pickups where id=${quote(pickups[0].id)}`,
        ),
    "Correction and amendment preserve exact original dispense and pickup documents",
  );
  check(
    sql(
      `select count(*) from billing_invoice_items where invoice_id=${quote(invoiceId)}`,
    ) === "1" &&
      sql(
        `select sum(quantity)::text from inventory_movements where lot_id in (${lotIds.map(quote).join(",")})`,
      ) === "18.000" &&
      (await api.read())?.usage.fulfillment_head.version === 1,
    "Actual corrections do not debit stock, create charges or restore allowance",
  );
  const priorRelease = await rpc(
    "read_record_release",
    { p_id: confirmed.id },
    staff.headers,
  );
  check(
    priorRelease.eligible === false,
    "Actual correction invalidates the previously confirmed release",
  );
  assert.deepEqual(priorRelease.release.snapshot, frozen);
  checks++;
  await corrections
    .getByRole("button", { name: "Close annotation panel", exact: true })
    .click();
  await releasePanel
    .getByRole("button", {
      name: "Select all shown: Signed practice prescriptions",
      exact: true,
    })
    .click();
  await releasePanel
    .getByRole("button", {
      name: "Select all shown: Recorded practice dispensing",
      exact: true,
    })
    .click();
  const correctedPreviewResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${local.API_URL}/rest/v1/rpc/preview_record_release_v11` &&
      response.request().method() === "POST",
  );
  await releasePanel
    .getByRole("button", { name: "Review selected package", exact: true })
    .click();
  const correctedPreviewHttp = await correctedPreviewResponse;
  check(
    correctedPreviewHttp.ok(),
    "Actual browser re-reviews a schema11 package after corrections",
  );
  const correctedPreview = await correctedPreviewHttp.json();
  check(
    correctedPreview.snapshot.native_prescriptions[0].corrections
      .event_count === 2 &&
      correctedPreview.snapshot.native_dispenses[0].corrections.events
        .length === 2 &&
      correctedPreview.snapshot.native_dispenses[0].corrections.head
        .event_id === amendment.id,
    "New preview binds exact authorization summary and complete selected dispense amendments",
  );
  const correctedHtml = releasePanel
    .frameLocator('iframe[title="Medical-record release artifact"]')
    .last()
    .locator("body");
  await expect(correctedHtml).toContainText(
    "Synthetic client-shareable clarification; original dispensing preserved.",
  );
  await expect(correctedHtml).toContainText(
    "Synthetic amendment does not establish a replacement handoff.",
  );
  await expect(correctedHtml).toContainText("Synthetic recipient");
  checks += 3;
  await releasePanel
    .getByRole("checkbox", { name: /I reviewed the complete selected records/ })
    .check();
  const correctedConfirmResponse = page.waitForResponse(
    (response) =>
      response.url() ===
        `${local.API_URL}/rest/v1/rpc/confirm_record_release` &&
      response.request().method() === "POST",
  );
  await releasePanel
    .getByRole("button", { name: "Confirm reviewed package", exact: true })
    .click();
  const correctedConfirmHttp = await correctedConfirmResponse;
  check(
    correctedConfirmHttp.ok(),
    "Actual browser confirms the newly reviewed correction disclosure",
  );
  const correctedSaved = await correctedConfirmHttp.json();
  assert.deepEqual(
    JSON.parse(
      sql(
        `select snapshot::text from record_releases where id=${quote(correctedSaved.id)}`,
      ),
    ),
    correctedPreview.snapshot,
  );
  checks++;
  check(
    (
      await rpc(
        "read_record_release",
        { p_id: correctedSaved.id },
        staff.headers,
      )
    ).eligible === true,
    "New correction-aware release is eligible while its exact context remains current",
  );
  check(
    untouched ===
      sql(
        "select jsonb_build_object('treatments',(select count(*) from patient_treatments),'outbox',(select count(*) from communication_outbox))::text",
      ),
    "Browser dispensing sends no message and creates no administration record",
  );
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server?.pid && !serverExited) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    const deadline = Date.now() + 5000;
    while (!serverExited && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    if (!serverExited) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
    }
  }
  if (logFd !== undefined) closeSync(logFd);
  rmSync(privateDir, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    synthetic_only: true,
    suite: "native-fulfillment-and-release-browser",
    checks_passed: checks,
    provider_requests: 0,
    blocked_external_requests: blockedExternal,
    project_id: projectId,
    cleanup:
      "Owned browser, Vite process group and private temporary files closed; caller owns database cleanup.",
  }),
);
