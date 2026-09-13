import { test, expect, type Page, type Request } from "@playwright/test";
const grant = "12345678-1234-4234-8234-123456789012",
  collection = "p1." + "a".repeat(43),
  statusToken = "s1." + "b".repeat(43);
const collectionEndpoint =
    "http://127.0.0.1:54321/functions/v1/payment-collection",
  statusEndpoint = "http://127.0.0.1:54321/functions/v1/payment-status";
async function fixture(page: Page) {
  const state = {
    calls: [] as Request[],
    requests: [] as string[],
    denied: false,
    hold: false,
    release: null as (() => void) | null,
    unsafeUrl: false,
    collectionAvailable: true,
    mode: "ready",
    paid: "0",
    refunded: "0",
  };
  page.on("request", (r) => state.requests.push(r.url()));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:8080"
      ? route.continue()
      : route.abort(),
  );
  for (const endpoint of [collectionEndpoint, statusEndpoint])
    await page.route(endpoint, async (route) => {
      state.calls.push(route.request());
      const body = route.request().postDataJSON();
      if (state.hold)
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      if (state.denied || body.grant_id !== grant)
        return route
          .fulfill({
            status: 404,
            json: { error: "Payment information unavailable" },
          })
          .catch(() => {});
      const json = {
        state: body.action === "activate" ? "checkout_ready" : state.mode,
        amount_cents: "12500",
        currency: "usd",
        expires_at: "2099-01-01T00:00:00Z",
        status_expires_at: "2099-01-31T00:00:00Z",
        confirmed_paid_cents: state.paid,
        confirmed_refunded_cents: state.refunded,
        ...(endpoint === collectionEndpoint
          ? { collection_available: state.collectionAvailable }
          : {}),
        ...(body.action === "activate"
          ? {
              checkout_url: state.unsafeUrl
                ? "https://evil.test/c/pay/x"
                : "https://checkout.stripe.com/c/pay/cs_test_synthetic#transient",
            }
          : {}),
      };
      return route.fulfill({ json }).catch(() => {});
    });
  return state;
}
test("collection isolates identity, strips misleading query/fragment and activates only after explicit review", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/pay/${grant}?paid=true&amount=1#${collection}`);
  await expect(
    page.getByRole("heading", { name: "Your payment", exact: true }),
  ).toBeVisible();
  expect(page.url()).toBe(`http://127.0.0.1:8080/pay/${grant}`);
  expect(state.calls).toHaveLength(0);
  await page.getByRole("button", { name: "Open payment", exact: true }).click();
  await expect(page.getByText("$125.00 USD", { exact: true })).toBeVisible();
  expect(state.calls[0].postDataJSON()).toEqual({
    grant_id: grant,
    token: collection,
    action: "inspect",
  });
  expect(state.calls[0].headers().authorization).toBeUndefined();
  expect(state.calls[0].headers().cookie).toBeUndefined();
  expect(state.calls[0].headers().referer).toBeUndefined();
  await expect(
    page.getByRole("heading", { name: "Payment confirmed", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue to secure payment" })
    .click();
  await expect(
    page.getByRole("link", { name: "Open Stripe Checkout" }),
  ).toHaveAttribute(
    "href",
    "https://checkout.stripe.com/c/pay/cs_test_synthetic#transient",
  );
  expect(state.calls.map((r) => r.postDataJSON().action)).toEqual([
    "inspect",
    "activate",
  ]);
  expect(
    state.requests.some((url) =>
      /fonts\.google|\/auth\/|App\.tsx|AuthContext/.test(url),
    ),
  ).toBe(false);
  expect(state.requests.some((url) => url.includes(collection))).toBe(false);
  expect(
    await page.evaluate(() => [
      JSON.stringify(localStorage),
      JSON.stringify(sessionStorage),
    ]),
  ).toEqual(["{}", "{}"]);
  state.mode = "confirmation_pending";
  await page.getByRole("button", { name: "Refresh confirmed status" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Payment confirmation pending",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Stripe Checkout" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Open the original link from your message",
    }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(3);
});
for (const kind of ["return", "cancel"] as const)
  test(`${kind} scoped status displays confirmed partial refunds without creating Checkout`, async ({
    page,
  }) => {
    const state = await fixture(page);
    state.mode = "partially_refunded";
    state.paid = "12500";
    state.refunded = "2500";
    await page.goto(`/payment/${kind}/${grant}?success=true#${statusToken}`);
    await expect(
      page.getByRole("button", { name: "Check payment status", exact: true }),
    ).toBeVisible();
    expect(state.calls).toHaveLength(0);
    await page
      .getByRole("button", { name: "Check payment status", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Partial refund confirmed",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByText("Confirmed paid")
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText("$125.00");
    await expect(
      page
        .getByText("Confirmed refunded")
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText("$25.00");
    expect(state.calls[0].url()).toBe(statusEndpoint);
    expect(state.calls[0].postDataJSON()).toEqual({
      grant_id: grant,
      token: statusToken,
    });
    await expect(
      page.getByRole("button", { name: "Continue to secure payment" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close payment details" }).click();
    await expect(
      page.getByRole("heading", {
        name: "Open the original link from your message",
      }),
    ).toBeVisible();
    await expect(page.getByText("$125.00")).toHaveCount(0);
  });
for (const kind of ["return", "cancel"] as const)
  test(`${kind} legacy route remains neutral regardless of browser flags`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.goto(
      `/payment/${kind}?paid=true&status=paid&session_id=fake#${statusToken}`,
    );
    await expect(
      page.getByRole("heading", { name: "Check your original payment link" }),
    ).toBeVisible();
    expect(page.url()).toBe(`http://127.0.0.1:8080/payment/${kind}`);
    expect(state.calls).toHaveLength(0);
    expect(
      state.requests.some((url) =>
        /App\.tsx|AuthContext|fonts\.google/.test(url),
      ),
    ).toBe(false);
  });
test("expired or revoked collection access can inspect status but cannot activate", async ({
  page,
}) => {
  const state = await fixture(page);
  state.collectionAvailable = false;
  await page.goto(`/pay/${grant}#${collection}`);
  await page.getByRole("button", { name: "Open payment", exact: true }).click();
  await expect(
    page.getByText(/This link can no longer start a payment/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to secure payment" }),
  ).toHaveCount(0);
  expect(state.calls).toHaveLength(1);
});
test("unsafe provider address or denied access never exposes a payment link or retained balance", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/pay/${grant}#${collection}`);
  await page.getByRole("button", { name: "Open payment", exact: true }).click();
  state.unsafeUrl = true;
  await page
    .getByRole("button", { name: "Continue to secure payment" })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Payment information is unavailable",
  );
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByText("$125.00 USD")).toHaveCount(0);
  state.denied = true;
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Payment information is unavailable",
  );
});
test("close aborts in-flight inspection and a late response cannot restore private payment details", async ({
  page,
}) => {
  const state = await fixture(page);
  state.hold = true;
  await page.goto(`/pay/${grant}#${collection}`);
  await page.getByRole("button", { name: "Open payment", exact: true }).click();
  await expect.poll(() => Boolean(state.release)).toBe(true);
  await page.getByRole("button", { name: "Close payment details" }).click();
  state.release!();
  await expect(
    page.getByRole("heading", {
      name: "Open the original link from your message",
    }),
  ).toBeVisible();
  await expect(page.getByText("$125.00 USD")).toHaveCount(0);
  expect(state.calls).toHaveLength(1);
});
test("pagehide erases capability and malformed links remain isolated without requests", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/pay/${grant}#${collection}`);
  await page.getByRole("button", { name: "Open payment", exact: true }).click();
  await expect(page.getByText("$125.00 USD")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expect(
    page.getByRole("heading", {
      name: "Open the original link from your message",
    }),
  ).toBeVisible();
  await page.goto(`/pay/not-a-grant?paid=true#${collection}`);
  await expect(
    page.getByRole("heading", {
      name: "Open the original link from your message",
    }),
  ).toBeVisible();
  expect(state.calls).toHaveLength(1);
  expect(state.requests.some((url) => /App\.tsx|AuthContext/.test(url))).toBe(
    false,
  );
});
