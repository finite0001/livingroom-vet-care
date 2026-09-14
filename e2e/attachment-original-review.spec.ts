import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  actor,
  pet,
  client,
  capture,
  recordId,
  request,
  at,
  record,
  candidate,
} from "../tests/ezyvet/attachment-review-fixture";
interface Row {
  [key: string]: unknown;
}
async function fixture(page: Page, roles = ["ADMIN"]) {
  const bytes = Buffer.from("%PDF-1.4\nSynthetic review original\n%%EOF"),
    hash = createHash("sha256").update(bytes).digest("hex");
  const r = { ...record(), content_sha256: hash, file_size: bytes.length };
  const c = { ...candidate(), content_sha256: hash, file_size: bytes.length };
  const state = {
    records: [] as Row[],
    candidates: [c] as Row[],
    actions: [] as Row[],
    calls: [] as Row[],
    lose: false,
    reject: false,
    tamper: false,
    wrong: false,
  };
  const user = {
    id: actor,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: at,
  };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: actor, exp, role: "authenticated", aud: "authenticated" })).toString("base64url")}.synthetic`,
    refresh_token: "synthetic",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
  await page.addInitScript(
    (s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)),
    session,
  );
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin ===
    new URL(test.info().project.use.baseURL!).origin
      ? route.continue()
      : route.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : {};
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/auth/v1/logout") return route.fulfill({ json: {} });
    if (path === "/rest/v1/profiles")
      return route.fulfill({
        json: [
          {
            id: actor,
            first_name: "Synthetic",
            last_name: "Reviewer",
            full_name: "Synthetic Reviewer",
            role: roles[0],
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles")
      return route.fulfill({ json: roles.map((role) => ({ role })) });
    if (path === "/rest/v1/pets")
      return route.fulfill({
        json: {
          id: pet,
          client_id: client,
          name: "Synthetic Juniper",
          species: "Dog",
          breed: null,
          dob: null,
          birth_date_precision: "unknown",
          color: null,
          microchip_id: null,
          sex: "female",
          neuter_status: "neutered",
          archived_at: null,
          deceased_at: null,
          weight_lbs: null,
          allergies: null,
          version: 1,
        },
      });
    if (path === "/rest/v1/clients")
      return route.fulfill({
        json: {
          id: client,
          full_name: "Synthetic household",
          housecall_address: null,
        },
      });
    if (path.endsWith("read_ezyvet_attachment_original_history"))
      return route.fulfill({
        json: {
          pet_id: pet,
          records: state.records,
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("list_ezyvet_attachment_original_candidates"))
      return route.fulfill({
        json: {
          candidates: state.candidates,
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("recover_ezyvet_attachment_review_action")) {
      state.calls.push({ path, ...body });
      const a = state.actions.find((a) => a.id === body.p_id);
      return route.fulfill({
        json: a ? { ...a, actor_id: state.wrong ? client : actor } : null,
      });
    }
    if (
      path.includes("/rpc/") &&
      [
        "approve_ezyvet_attachment_original",
        "acknowledge_ezyvet_attachment_original",
        "withdraw_ezyvet_attachment_original",
        "abandon_ezyvet_attachment_original_approval",
        "abandon_ezyvet_attachment_original_acknowledgment",
        "abandon_ezyvet_attachment_original_withdrawal",
      ].some((name) => path.endsWith(name))
    ) {
      state.calls.push({ path, ...body });
      const existing = state.actions.find((a) => a.id === body.p_id);
      if (existing) return route.fulfill({ json: existing });
      const abandon = path.includes("/abandon_"),
        kind = path.includes("acknowledg")
          ? "acknowledge"
          : path.includes("withdraw")
            ? "withdraw"
            : "approve";
      if (state.reject && !abandon)
        return route.fulfill({ status: 409, json: { message: "stale" } });
      const result: Row = {
        id: body.p_id,
        action: kind,
        actor_id: actor,
        pet_id: pet,
        request_hash: "b".repeat(64),
        status: abandon ? "abandoned" : "committed",
        created_at: at,
        record: null,
        acknowledgment: null,
        withdrawal: null,
      };
      if (!abandon && kind === "approve") {
        const next = {
          ...r,
          id: body.p_previous_record_id ? request : recordId,
          action_id: body.p_id,
          capture_id: body.p_capture_id,
          capture_hash: body.p_expected_capture_hash,
          patient_version: body.p_expected_patient_version,
          previous_record_id: body.p_previous_record_id,
          kind: body.p_previous_record_id ? "replacement" : "original",
          version: body.p_previous_record_id ? 2 : 1,
          review_reason: body.p_review_reason,
        };
        result.record = next;
        state.records = state.records.map((v) => ({
          ...v,
          is_latest: false,
          latest_record_id: next.id,
        }));
        state.records.unshift({
          record: next,
          latest_record_id: next.id,
          is_latest: true,
          withdrawal: null,
          acknowledgments: [],
        });
        state.candidates = state.candidates.map((v) => ({
          ...v,
          admitted_record: next,
          latest_record: next,
        }));
      }
      if (!abandon && kind !== "approve") {
        const row = state.records.find(
          (v) => (v.record as Row).id === body.p_record_id,
        )!;
        const value = {
          id: request,
          action_id: body.p_id,
          record_id: body.p_record_id,
          pet_id: pet,
          actor_id: actor,
          record_hash: body.p_expected_record_hash,
          created_at: at,
          ...(kind === "acknowledge"
            ? { capture_hash: body.p_expected_capture_hash }
            : { reason: body.p_reason }),
        };
        result[kind === "acknowledge" ? "acknowledgment" : "withdrawal"] =
          value;
        if (kind === "acknowledge") row.acknowledgments = [value];
        else row.withdrawal = value;
      }
      state.actions.push(result);
      if (state.lose) return route.abort();
      return route.fulfill({ json: result });
    }
    if (
      path.endsWith("/capture-ezyvet-attachment") ||
      path.endsWith("/retrieve-reviewed-ezyvet-attachment")
    ) {
      state.calls.push({ path, ...body });
      return route.fulfill({
        contentType: "application/pdf",
        body: state.tamper ? Buffer.alloc(bytes.length, 65) : bytes,
      });
    }
    return route.fulfill({ json: [] });
  });
  return { state, r, c };
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "Imported API originals", exact: true });
async function open(page: Page) {
  await page.goto(`/hub/patient/${pet}`);
  await expect(panel(page)).toBeVisible();
}
async function admission(page: Page) {
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 44444444" })
    .click();
  await panel(page)
    .getByRole("button", {
      name: "Download captured original for provenance review",
    })
    .click();
  await expect(
    panel(page).getByText(/Original downloaded after checksum/),
  ).toBeVisible();
  await panel(page)
    .getByLabel("Provenance review reason")
    .fill("Reviewed historical original");
  await panel(page).getByRole("checkbox").check();
}
test("administrator admits verified historical capture without clinical acknowledgment", async ({
  page,
}) => {
  const { state } = await fixture(page);
  await admission(page);
  await panel(page)
    .getByRole("button", {
      name: "Admit original to patient chart",
      exact: true,
    })
    .click();
  await expect(panel(page).getByText("Clinical review pending.")).toBeVisible();
  expect(
    state.calls.find((v) =>
      String(v.path).endsWith("approve_ezyvet_attachment_original"),
    ),
  ).toMatchObject({
    p_capture_id: capture,
    p_previous_record_id: null,
    p_attest: true,
  });
  await expect(
    panel(page).getByRole("button", { name: /Acknowledge original/ }),
  ).toHaveCount(0);
});
test("staff sees chart metadata without original download or review mutations", async ({
  page,
}) => {
  const { state, r } = await fixture(page, ["STAFF"]);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [],
    },
  ];
  await open(page);
  await expect(panel(page).getByText("Clinical review pending.")).toBeVisible();
  await expect(
    panel(page).getByRole("button", {
      name: /Download|Admit|Acknowledge|withdrawal/,
    }),
  ).toHaveCount(0);
});
test("DVM download gates exact version acknowledgment and lost reply recovers", async ({
  page,
}) => {
  const { state, r } = await fixture(page, ["DVM"]);
  state.lose = true;
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [],
    },
  ];
  await open(page);
  await expect(
    panel(page).getByRole("button", { name: "Acknowledge original version 1" }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("button", { name: "Download chart original version 1" })
    .click();
  await expect(
    panel(page).getByText(/Original downloaded after checksum/),
  ).toBeVisible();
  await panel(page).getByRole("checkbox").check();
  await panel(page)
    .getByRole("button", { name: "Acknowledge original version 1" })
    .click();
  await expect(panel(page).getByText(/DVM acknowledgment:/)).toBeVisible();
  expect(
    state.calls.filter((v) =>
      String(v.path).endsWith("acknowledge_ezyvet_attachment_original"),
    ),
  ).toHaveLength(1);
});
test("lost admission reply recovers exact original UUID", async ({ page }) => {
  const { state } = await fixture(page);
  state.lose = true;
  await admission(page);
  await panel(page)
    .getByRole("button", {
      name: "Admit original to patient chart",
      exact: true,
    })
    .click();
  await expect(panel(page).getByText("Clinical review pending.")).toBeVisible();
  expect(
    state.calls.filter((v) =>
      String(v.path).endsWith("approve_ezyvet_attachment_original"),
    ),
  ).toHaveLength(1);
});
test("rejected admission retains intent until server abandonment tombstone", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.reject = true;
  await admission(page);
  await panel(page)
    .getByRole("button", {
      name: "Admit original to patient chart",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByText(/Unconfirmed approve action/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", { name: "Abandon original review action" })
    .click();
  await expect(panel(page).getByText(/Review action abandoned/)).toBeVisible();
  expect(state.actions[0].status).toBe("abandoned");
});
test("withdrawal preserves original and existing DVM acknowledgment", async ({
  page,
}) => {
  const { state, r } = await fixture(page);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [
        {
          id: request,
          action_id: request,
          record_id: r.id,
          pet_id: pet,
          actor_id: client,
          record_hash: r.record_hash,
          capture_hash: r.capture_hash,
          created_at: at,
        },
      ],
    },
  ];
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Prepare withdrawal of version 1" })
    .click();
  await panel(page)
    .getByLabel("Withdrawal reason")
    .fill("Incorrect source association");
  await panel(page)
    .getByRole("button", { name: "Record withdrawal of version 1" })
    .click();
  await expect(
    panel(page).getByText(/Withdrawal: Incorrect source association/),
  ).toBeVisible();
  await expect(panel(page).getByText(/DVM acknowledgment:/)).toBeVisible();
});
test("same-size original tampering never enables admission attestation", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.tamper = true;
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 44444444" })
    .click();
  await panel(page)
    .getByRole("button", {
      name: "Download captured original for provenance review",
    })
    .click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await expect(panel(page).getByRole("checkbox")).toBeDisabled();
});
test("replacement explicitly binds previous version and preserves earlier evidence", async ({
  page,
}) => {
  const { state, r, c } = await fixture(page);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [],
    },
  ];
  state.candidates = [
    { ...c, capture_id: client, capture_request_id: client, latest_record: r },
  ];
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 33333333" })
    .click();
  await expect(
    panel(page).getByText(/Explicit replacement of chart version 1/),
  ).toBeVisible();
  await panel(page)
    .getByRole("button", {
      name: "Download captured original for provenance review",
    })
    .click();
  await expect(
    panel(page).getByText(/Original downloaded after checksum/),
  ).toBeVisible();
  await panel(page)
    .getByLabel("Provenance review reason")
    .fill("Reviewed replacement original");
  await panel(page).getByRole("checkbox").check();
  await panel(page)
    .getByRole("button", { name: "Admit explicit replacement original" })
    .click();
  await expect(panel(page).getByText(/Superseded version/)).toBeVisible();
  expect(
    state.calls.find((v) =>
      String(v.path).endsWith("approve_ezyvet_attachment_original"),
    ),
  ).toMatchObject({ p_capture_id: client, p_previous_record_id: r.id });
});
test("pending action survives reload and retry uses saved UUID", async ({
  page,
}) => {
  const { state } = await fixture(page);
  state.reject = true;
  await admission(page);
  await panel(page)
    .getByRole("button", {
      name: "Admit original to patient chart",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByText(/Unconfirmed approve action/),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "Retry original review action" }),
  ).toBeEnabled();
  const id = state.calls.find((v) =>
    String(v.path).endsWith("approve_ezyvet_attachment_original"),
  )!.p_id;
  await page.reload();
  await expect(
    panel(page).getByText(/Unconfirmed approve action/),
  ).toBeVisible();
  state.reject = false;
  await panel(page)
    .getByRole("button", { name: "Retry original review action" })
    .click();
  await expect(panel(page).getByText("Clinical review pending.")).toBeVisible();
  expect(
    new Set(
      state.calls
        .filter((v) =>
          String(v.path).endsWith("approve_ezyvet_attachment_original"),
        )
        .map((v) => v.p_id),
    ),
  ).toEqual(new Set([id]));
});
test("changed household disables new admission but keeps owned original download", async ({
  page,
}) => {
  const { state, c } = await fixture(page);
  state.candidates = [{ ...c, mapping_current: false }];
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 44444444" })
    .click();
  await panel(page)
    .getByRole("button", {
      name: "Download captured original for provenance review",
    })
    .click();
  await expect(
    panel(page).getByText(/Original downloaded after checksum/),
  ).toBeVisible();
  await expect(panel(page).getByRole("checkbox")).toBeDisabled();
  await expect(
    panel(page).getByRole("button", {
      name: "Admit original to patient chart",
      exact: true,
    }),
  ).toBeDisabled();
});
test("DVM can inspect withdrawn original without adding new acknowledgment", async ({
  page,
}) => {
  const { state, r } = await fixture(page, ["DVM"]);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: {
        id: request,
        action_id: request,
        record_id: r.id,
        pet_id: pet,
        actor_id: actor,
        record_hash: r.record_hash,
        reason: "Historical withdrawal",
        created_at: at,
      },
      acknowledgments: [],
    },
  ];
  await open(page);
  await expect(
    panel(page).getByRole("button", {
      name: "Download chart original version 1",
    }),
  ).toBeEnabled();
  await expect(
    panel(page).getByRole("button", { name: "Acknowledge original version 1" }),
  ).toHaveCount(0);
});
test("admission draft triggers patient navigation guard", async ({ page }) => {
  await fixture(page);
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 44444444" })
    .click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
test("late clinical original bytes after signout cannot be downloaded", async ({
  page,
}) => {
  const { state, r } = await fixture(page, ["DVM"]);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [],
    },
  ];
  await open(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(
    "**/functions/v1/retrieve-reviewed-ezyvet-attachment",
    async (route) => {
      started();
      await gate;
      await route.fallback();
    },
  );
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await panel(page)
    .getByRole("button", { name: "Download chart original version 1" })
    .click();
  await entered;
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/retrieve-reviewed-ezyvet-attachment"),
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(downloads).toBe(0);
});
async function refreshRole(page: Page) {
  await page.evaluate(async (moduleUrl) => {
    const { supabase } = await import(moduleUrl);
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;
  }, "/src/integrations/supabase/client.ts");
}
test("ADMIN role loss clears hidden admission draft and unlocks DVM history", async ({
  page,
}) => {
  const roles = ["ADMIN"];
  const { state, r } = await fixture(page, roles);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [],
    },
  ];
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 44444444" })
    .click();
  await panel(page).getByLabel("Provenance review reason").fill("Unsent draft");
  roles.splice(0, 1, "DVM");
  await refreshRole(page);
  await expect(
    panel(page).getByRole("region", { name: "Owned API original admission" }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", {
      name: "Download chart original version 1",
    }),
  ).toBeEnabled();
  await expect(
    panel(page).getByRole("button", { name: "Refresh API original history" }),
  ).toBeEnabled();
});
test("DVM role loss clears unsent clinical attestation", async ({ page }) => {
  const roles = ["DVM"];
  const { state, r } = await fixture(page, roles);
  state.records = [
    {
      record: r,
      latest_record_id: r.id,
      is_latest: true,
      withdrawal: null,
      acknowledgments: [],
    },
  ];
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Download chart original version 1" })
    .click();
  await expect(
    panel(page).getByText(/Original downloaded after checksum/),
  ).toBeVisible();
  await panel(page).getByRole("checkbox").check();
  await expect(
    panel(page).getByRole("button", { name: "Refresh API original history" }),
  ).toBeDisabled();
  roles.splice(0, 1, "STAFF");
  await refreshRole(page);
  await expect(
    panel(page).getByRole("button", { name: "Acknowledge original version 1" }),
  ).toHaveCount(0);
  await expect(
    panel(page).getByRole("button", { name: "Refresh API original history" }),
  ).toBeEnabled();
});
test("role loss preserves pending immutable review action", async ({
  page,
}) => {
  const roles = ["ADMIN"];
  const { state } = await fixture(page, roles);
  state.reject = true;
  await admission(page);
  await panel(page)
    .getByRole("button", {
      name: "Admit original to patient chart",
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Retry original review action" }),
  ).toBeEnabled();
  const before = await panel(page)
    .getByText(/Unconfirmed approve action/)
    .textContent();
  roles.splice(0, 1, "DVM");
  await refreshRole(page);
  await expect(
    panel(page).getByRole("region", { name: "Owned API original admission" }),
  ).toHaveCount(0);
  await expect(panel(page).getByText(/Unconfirmed approve action/)).toHaveText(
    before!,
  );
  expect(state.actions).toHaveLength(0);
});
test("own admission cancel remains available while sibling care draft is dirty", async ({
  page,
}) => {
  await fixture(page);
  await open(page);
  await panel(page)
    .getByRole("button", { name: "Review capture 44444444" })
    .click();
  await page
    .getByRole("button", { name: "New QOL observation", exact: true })
    .click();
  await page
    .getByLabel("Observer / source", { exact: true })
    .fill("Synthetic observer draft");
  await expect(
    panel(page).getByRole("button", {
      name: "Download captured original for provenance review",
    }),
  ).toBeDisabled();
  await panel(page)
    .getByRole("button", { name: "Cancel original admission review" })
    .click();
  await expect(
    panel(page).getByRole("article", {
      name: "Selected API original admission",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Observer / source", { exact: true }),
  ).toHaveValue("Synthetic observer draft");
});
