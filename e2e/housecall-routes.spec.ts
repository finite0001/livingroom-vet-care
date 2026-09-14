import { test, expect, type Page, type Locator } from "@playwright/test";

const staff = "11111111-1111-4111-8111-111111111111";
const otherStaff = "11111111-1111-4111-8111-111111111112";
const day = "2026-10-28";
const base = "2619 Spruce Street, Boulder, CO";
const firstAddress = "100 Saved & Historical Street #2, Boulder, CO";
const lastAddress = "300 Saved Street, Boulder, CO";

function appointment(
  id: string,
  hour: number,
  address: string,
  status = "SCHEDULED",
  assignedStaff = staff,
  visitType = "housecall",
  date = day,
) {
  return {
    id,
    assigned_dvm_id: assignedStaff,
    scheduled_at: `${date}T${hour}:00:00Z`,
    address_snapshot: address,
    status,
    visit_type: visitType,
    duration_minutes: 30,
    travel_before_minutes: 15,
    travel_after_minutes: 10,
    appointment_type: "Synthetic private visit reason",
    notes: "Synthetic private access note",
    client_id: "22222222-2222-4222-8222-222222222222",
    pet_id: "33333333-3333-4333-8333-333333333333",
    profiles: {
      full_name: assignedStaff === staff ? "Synthetic Staff" : "Other Staff",
    },
    pets: { name: `Patient ${id}` },
    clients: {
      full_name: "Synthetic Family",
      housecall_address: "999 Current Household Address, Boulder, CO",
    },
    reminder_offsets: [],
    resource_name: null,
    version: 1,
  };
}

const appointments = [
  appointment("last", 19, lastAddress, "CONFIRMED"),
  appointment("canceled", 20, "Canceled address", "CANCELLED"),
  appointment("other", 15, "Other staff address", "SCHEDULED", otherStaff),
  appointment("first", 15, firstAddress),
  appointment("clinic", 17, base, "SCHEDULED", staff, "clinic"),
  appointment("completed", 16, "Completed address", "COMPLETED"),
  appointment("no-show", 18, "No-show address", "NO_SHOW"),
  appointment(
    "tomorrow",
    15,
    "Tomorrow address",
    "SCHEDULED",
    staff,
    "housecall",
    "2026-10-29",
  ),
];

interface FixtureOptions {
  rows?: ReturnType<typeof appointment>[];
  incomplete?: boolean;
  missingCount?: boolean;
  beforeAppointmentResponse?: () => Promise<void>;
}

async function openSchedule(page: Page, options: FixtureOptions = {}) {
  const user = {
    id: staff,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: staff, exp: expires, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user,
  };
  await page.addInitScript(
    (value) => localStorage.setItem("sb-127-auth-token", JSON.stringify(value)),
    session,
  );
  const externalRequests: string[] = [];
  const writes: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1")
      return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (request.method() !== "GET") writes.push(path);
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: staff,
            full_name: "Synthetic Staff",
            first_name: "Synthetic",
            last_name: "Staff",
            is_active: true,
            role: "STAFF",
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: [{ user_id: staff, role: "STAFF" }] });
    if (path === "/rest/v1/appointments") {
      expect(request.headers().prefer).toContain("count=exact");
      await options.beforeAppointmentResponse?.();
      const filters = url.searchParams.getAll("scheduled_at");
      const from = filters.find((value) => value.startsWith("gte."))?.slice(4);
      const until = filters.find((value) => value.startsWith("lt."))?.slice(3);
      expect(from).toBeTruthy();
      expect(until).toBeTruthy();
      const rows = (options.rows ?? appointments).filter(
        (row) =>
          Date.parse(row.scheduled_at) >= Date.parse(from!) &&
          Date.parse(row.scheduled_at) < Date.parse(until!),
      );
      const total = rows.length + (options.incomplete ? 1 : 0);
      return route.fulfill({
        json: rows,
        headers: {
          "access-control-expose-headers": "content-range",
          ...(options.missingCount
            ? {}
            : {
                "content-range": rows.length
                  ? `0-${rows.length - 1}/${total}`
                  : `*/${total}`,
              }),
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/hub/schedule");
  await page.getByLabel("Schedule date").fill(day);
  return { externalRequests, writes };
}

async function openRoute(page: Page, date = day) {
  const region = page.getByRole("region", {
    name: `Housecall route ${date}`,
    exact: true,
  });
  await page.getByText("Plan housecall route", { exact: true }).click();
  await expect(region).toBeVisible();
  await expect(
    page.getByLabel(`Route staff for ${date}`, { exact: true }),
  ).toHaveValue("");
  await expect(region.getByRole("link")).toHaveCount(0);
  await page
    .getByLabel(`Route staff for ${date}`, { exact: true })
    .selectOption(staff);
  return region;
}

async function expectLeg(link: Locator, origin: string, destination: string) {
  await expect(link).toBeVisible();
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.origin).toBe("https://www.google.com");
  expect(url.pathname).toBe("/maps/dir/");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
}

test("mobile route preserves staff, Denver day, appointment order and saved addresses without external requests", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const traffic = await openSchedule(page);
  const region = await openRoute(page);
  await expect(region.getByRole("link")).toHaveCount(4);
  await expectLeg(
    region.getByRole("link", { name: "Directions to stop 1", exact: true }),
    base,
    firstAddress,
  );
  await expectLeg(
    region.getByRole("link", { name: "Directions to stop 2", exact: true }),
    firstAddress,
    base,
  );
  await expectLeg(
    region.getByRole("link", { name: "Directions to stop 3", exact: true }),
    base,
    lastAddress,
  );
  await expectLeg(
    region.getByRole("link", {
      name: "Directions back to clinic",
      exact: true,
    }),
    lastAddress,
    base,
  );
  for (const excluded of [
    "Canceled address",
    "Completed address",
    "No-show address",
    "Other staff address",
    "Tomorrow address",
    "999 Current Household Address",
  ])
    await expect(region).not.toContainText(excluded);
  await page.screenshot({
    path: test.info().outputPath("housecall-route-mobile.png"),
    fullPage: true,
  });
  await page
    .getByLabel(`Route staff for ${day}`, { exact: true })
    .selectOption(otherStaff);
  await expect(region.getByRole("link")).toHaveCount(2);
  await expectLeg(
    region.getByRole("link", { name: "Directions to stop 1", exact: true }),
    base,
    "Other staff address",
  );
  await expect(region).not.toContainText(firstAddress);
  await page.getByLabel("Schedule date").fill("2026-10-29");
  const tomorrow = await openRoute(page, "2026-10-29");
  await expect(tomorrow.getByRole("link")).toHaveCount(2);
  await expectLeg(
    tomorrow.getByRole("link", { name: "Directions to stop 1", exact: true }),
    base,
    "Tomorrow address",
  );
  await expect(tomorrow).not.toContainText(firstAddress);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    traffic.externalRequests.filter((requestUrl) => {
      const url = new URL(requestUrl);
      return (
        url.hostname === "maps.googleapis.com" ||
        url.hostname === "maps.google.com" ||
        (url.hostname === "www.google.com" &&
          url.pathname.startsWith("/maps")) ||
        url.hostname === "maps.gstatic.com" ||
        url.hostname === "maps.app.goo.gl"
      );
    }),
  ).toEqual([]);
  expect(traffic.writes).toEqual([]);
});

test("a missing saved address blocks every route leg", async ({ page }) => {
  await openSchedule(page, {
    rows: [
      appointment("first", 15, firstAddress),
      appointment("missing", 17, "   "),
    ],
  });
  const region = await openRoute(page);
  await expect(region).toContainText(
    "Complete every visit address before opening this route.",
  );
  await expect(region.getByRole("link")).toHaveCount(0);
});

test("an incomplete appointment response cannot generate a route", async ({
  page,
}) => {
  await openSchedule(page, { incomplete: true });
  await expect(
    page.getByText(
      "The schedule may be incomplete. Route planning is unavailable until the full period loads.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Plan housecall route", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: `Housecall route ${day}`, exact: true }),
  ).toHaveCount(0);
});

test("an appointment response without a count cannot generate a route", async ({
  page,
}) => {
  await openSchedule(page, { missingCount: true });
  await expect(
    page.getByText(
      "The schedule may be incomplete. Route planning is unavailable until the full period loads.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Plan housecall route", { exact: true }),
  ).toHaveCount(0);
});

test("refresh pauses directions and preserves the expanded route and staff selection", async ({
  page,
}) => {
  let pendingRefresh: Promise<void> | undefined;
  let releaseRefresh = () => {};
  await openSchedule(page, {
    beforeAppointmentResponse: async () => {
      await pendingRefresh;
    },
  });
  const region = await openRoute(page);
  const staffSelect = page.getByLabel(`Route staff for ${day}`, {
    exact: true,
  });
  await expect(region.getByRole("link")).toHaveCount(4);
  pendingRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  try {
    await page
      .getByRole("button", { name: "Refresh schedule", exact: true })
      .click();
    await expect(region).toBeVisible();
    await expect(region).toContainText(
      "Refreshing schedule… Directions are temporarily unavailable.",
    );
    await expect(region.getByRole("link")).toHaveCount(0);
    await expect(staffSelect).toHaveValue(staff);
    await expect(staffSelect).toBeDisabled();
  } finally {
    releaseRefresh();
  }
  await expect(region.getByRole("link")).toHaveCount(4);
  await expect(region).toBeVisible();
  await expect(staffSelect).toHaveValue(staff);
  await expect(staffSelect).toBeEnabled();
  await expect(region).not.toContainText("Refreshing schedule…");
  await expectLeg(
    region.getByRole("link", { name: "Directions to stop 1", exact: true }),
    base,
    firstAddress,
  );
});
