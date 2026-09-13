import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const backend = "http://127.0.0.1:54321";
const staff = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
async function fixture(page: Page) {
  const user = {
    id: staff,
    aud: "authenticated",
    role: "authenticated",
    email: "staff@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(
    JSON.stringify({
      sub: staff,
      exp,
      role: "authenticated",
      aud: "authenticated",
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const state = {
    invoice: null as Record<string, unknown> | null,
    items: [] as Record<string, unknown>[],
    credits: [] as Record<string, unknown>[],
    creates: [] as string[],
    services: [] as string[],
    loseCreate: true,
    loseService: true,
    failDocument: false,
  };
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8080"
      ? route.continue()
      : route.abort(),
  );
  await page.route(`${backend}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [{ id: staff, full_name: "Synthetic Staff", is_active: true }],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ role: "STAFF" }] });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: clientId,
          full_name: "Synthetic Billing Household",
          first_name: "Synthetic",
          last_name: "Household",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
    if (path === "/rest/v1/catalog_products")
      return route.fulfill({
        json: [
          {
            id: productId,
            name: "Housecall examination",
            kind: "service",
            unit_price_cents: 12500,
            active: true,
          },
        ],
      });
    if (path === "/rest/v1/billing_invoices")
      return route.fulfill({
        json: url.searchParams.has("id")
          ? state.invoice
          : state.invoice
            ? [state.invoice]
            : [],
      });
    if (path === "/rest/v1/billing_invoice_items")
      return route.fulfill({ json: state.items });
    if (path === "/rest/v1/billing_credits")
      return route.fulfill({ json: state.credits });
    if (path === "/rest/v1/rpc/read_invoice_document") {
      const body = route.request().postDataJSON();
      expect(body.p_invoice_id).toBe(state.invoice?.id);
      expect(body.p_client_id).toBe(clientId);
      if (state.failDocument)
        return route.fulfill({
          status: 403,
          json: { message: "Unavailable", code: "42501" },
        });
      return route.fulfill({
        json: {
          ...state.invoice,
          currency: "usd",
          issued_at:
            state.invoice?.status === "draft" ? null : "2026-09-12T18:00:00Z",
          voided_at:
            state.invoice?.status === "void" ? "2026-09-12T19:00:00Z" : null,
          rendered_at: "2026-09-12T20:00:00Z",
          client: {
            id: clientId,
            name: "Synthetic <script> Household",
            mailing_address: "123 A & B\nBoulder, CO",
          },
          total_cents: String(state.invoice?.total_cents ?? 12500),
          items: state.items.map((item) => ({
            ...item,
            quantity: String(item.quantity),
            unit_price_cents: String(item.unit_price_cents),
            amount_cents: String(item.amount_cents),
          })),
          credits: state.credits.map((item) => ({
            ...item,
            amount_cents: String(item.amount_cents),
          })),
        },
      });
    }
    if (path === "/rest/v1/rpc/create_billing_invoice") {
      const body = route.request().postDataJSON();
      state.creates.push(body.p_id);
      expect(body.p_client_id).toBe(clientId);
      state.invoice ??= {
        id: body.p_id,
        client_id: clientId,
        status: "draft",
        total_cents: null,
        version: 1,
        created_at: "2026-09-12T18:00:00Z",
      };
      if (state.loseCreate) {
        state.loseCreate = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: state.invoice });
    }
    if (path === "/rest/v1/rpc/add_invoice_service") {
      const body = route.request().postDataJSON();
      state.services.push(body.p_id);
      expect(body.p_invoice_id).toBe(state.invoice?.id);
      if (!state.items.some((item) => item.id === body.p_id)) {
        state.items.push({
          id: body.p_id,
          description: "Housecall examination",
          quantity: body.p_quantity,
          unit_price_cents: 12500,
          amount_cents: 12500 * body.p_quantity,
        });
        state.invoice!.version = 2;
      }
      if (state.loseService) {
        state.loseService = false;
        return route.abort("connectionfailed");
      }
      return route.fulfill({ json: state.items[0] });
    }
    if (path === "/rest/v1/rpc/issue_billing_invoice") {
      const body = route.request().postDataJSON();
      expect(body.p_expected_version).toBe(2);
      state.invoice = {
        ...state.invoice,
        status: "issued",
        version: 3,
        total_cents: 12500,
      };
      return route.fulfill({ json: state.invoice });
    }
    if (path === "/rest/v1/rpc/credit_billing_invoice") {
      const body = route.request().postDataJSON();
      expect(body.p_amount_cents).toBe(29);
      expect(body.p_reason).toBe("Courtesy adjustment");
      state.credits.push({
        id: body.p_id,
        amount_cents: body.p_amount_cents,
        reason: body.p_reason,
        created_at: "2026-09-12T18:00:00Z",
      });
      return route.fulfill({ json: state.credits[0] });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
test("invoice creation and service retries retain operation IDs; issuance and credits remain distinct from payment", async ({
  page,
}, testInfo) => {
  const state = await fixture(page);
  await page.goto(`/hub/client/${clientId}`);
  await page.getByRole("button", { name: "New draft invoice" }).click();
  await page.getByRole("button", { name: "Retry creating invoice" }).click();
  await expect(
    page.getByRole("region", { name: "Invoice details" }),
  ).toBeVisible();
  expect(state.creates).toHaveLength(2);
  expect(new Set(state.creates).size).toBe(1);
  await page.getByLabel("Service", { exact: true }).selectOption(productId);
  await page.getByRole("button", { name: "Add service charge" }).click();
  await expect(
    page.getByRole("button", { name: "Retry service charge" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "New draft invoice" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Clients", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Stay and reconcile" }).click();
  await page.getByRole("button", { name: "Retry service charge" }).click();
  expect(state.services).toHaveLength(2);
  expect(new Set(state.services).size).toBe(1);
  await page.getByRole("button", { name: "Issue invoice for $125.00" }).click();
  await expect(
    page.getByRole("button", { name: "Add service charge" }),
  ).toHaveCount(0);
  await page.getByLabel("Credit or void reason").fill("Courtesy adjustment");
  await page.getByLabel("Accounting credit (USD)").fill("0.29");
  await page.getByRole("button", { name: "Record accounting credit" }).click();
  await expect(page.getByText("$124.71", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Void invoice and retain history" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Net charges show billed services minus accounting credits.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("invoice-credit-history.png"),
    fullPage: true,
  });
});

for (const mobile of [false, true]) {
  test(`invoice document preview, download and refresh ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const state = await fixture(page);
    state.invoice = {
      id: "55555555-5555-4555-8555-555555555555",
      client_id: clientId,
      status: "issued",
      version: 3,
      total_cents: 12500,
      created_at: "2026-09-12T18:00:00Z",
    };
    state.items = [
      {
        id: productId,
        description: "Housecall examination",
        quantity: 1,
        unit_price_cents: 12500,
        amount_cents: 12500,
      },
    ];
    state.credits = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        amount_cents: 29,
        reason: "Internal",
        created_at: "2026-09-12T19:00:00Z",
      },
    ];
    await page.goto(`/hub/client/${clientId}`);
    await page.getByRole("button", { name: /issued.*125.00/ }).click();
    await page
      .getByRole("button", { name: "Preview invoice document" })
      .click();
    const frame = page.frameLocator('iframe[title="Invoice document preview"]');
    await expect(
      frame.getByRole("heading", { name: "Invoice", exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByText("Synthetic <script> Household", { exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByText(/Net charges after accounting credits/),
    ).toContainText("$124.71");
    await expect(frame.locator("script")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Print / save PDF" }),
    ).toBeInViewport();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download HTML copy" }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/invoice-.*\.html$/);
    const fs = await import("node:fs/promises");
    const contents = await fs.readFile((await download.path())!, "utf8");
    expect(contents).toContain("$124.71");
    expect(contents).toContain("&lt;script&gt;");
    expect(contents).not.toContain("Internal");
    if (!mobile) {
      const popupPromise = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Print / save PDF" }).click();
      const popup = await popupPromise;
      await expect(
        popup.getByRole("heading", { name: "Invoice", exact: true }),
      ).toBeVisible();
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      const pdf = await popup.pdf({ format: "Letter" });
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      await testInfo.attach("invoice-print.pdf", {
        body: pdf,
        contentType: "application/pdf",
      });
      await popup.close();
    }
    await page.screenshot({
      path: testInfo.outputPath("invoice-preview.png"),
      fullPage: true,
    });
    state.invoice.status = "void";
    await page
      .getByRole("button", { name: "Refresh invoice document" })
      .click();
    await expect(
      frame.getByRole("heading", { name: "VOID — CANCELLED INVOICE" }),
    ).toBeVisible();
    await expect(
      frame.getByText("This invoice is void. Do not pay this invoice."),
    ).toBeVisible();
    state.failDocument = true;
    await page
      .getByRole("button", { name: "Refresh invoice document" })
      .click();
    await expect(page.getByRole("alert")).toContainText("could not be loaded");
    await expect(
      page.getByRole("button", { name: "Download HTML copy" }),
    ).toBeDisabled();
    await expect(
      page.locator('iframe[title="Invoice document preview"]'),
    ).toHaveCount(0);
  });
}
