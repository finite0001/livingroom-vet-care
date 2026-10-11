import { test, expect, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import type {
  DiagnosticDetail,
  DiagnosticValues,
  FinalizedPanel,
} from "../src/hub/features/diagnostics/model";
import { uuid, finalized } from "../tests/diagnostics/fixture";
const actor = uuid(801),
  pet = uuid(900),
  at = "2026-10-03T18:00:00Z";
const bundle = buildSync({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{AuthContext}from'./src/hub/contexts/auth-context';import{PatientDiagnostics}from'./src/hub/features/diagnostics/PatientDiagnostics';const role=window.__diagRole;const user={id:'${actor}'};const ctx={user,session:{user},profile:{id:user.id,is_active:true,full_name:'Synthetic reviewer'},hasRole:r=>r===role};createRoot(document.getElementById('diagnostic-root')).render(React.createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},React.createElement(AuthContext.Provider,{value:ctx},React.createElement(PatientDiagnostics,{petId:'${pet}',disabled:false,onDirtyChange:v=>window.__diagnosticDirty=v}))));`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: {
    "process.env.NODE_ENV": '"test"',
    "import.meta.env": JSON.stringify({
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "synthetic-diagnostic-browser",
    }),
  },
}).outputFiles[0].text;
interface RpcArgs {
  p_id: string;
  p_action_id: string;
  p_kind: "draft" | "finalize";
  p_values: DiagnosticValues;
  p_review_note: string;
  p_correction_reason: string;
}
interface State {
  details: DiagnosticDetail[];
  actions: Array<{ id: string; args: RpcArgs; receipt: DiagnosticDetail }>;
  lose: boolean;
  conflict: boolean;
  history: FinalizedPanel[];
  trends: FinalizedPanel[];
}
async function fixture(page: Page, baseURL: string | undefined, role = "DVM") {
  const state: State = {
    details: [],
    actions: [],
    lose: false,
    conflict: false,
    history: [],
    trends: [],
  };
  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      name = url.pathname.split("/").pop()!,
      args =
        route.request().method() === "POST"
          ? (route.request().postDataJSON() as RpcArgs)
          : ({} as RpcArgs);
    const ok = (json: unknown) => route.fulfill({ json });
    if (!url.pathname.includes("/rpc/")) return ok([]);
    if (name === "list_diagnostic_panels")
      return ok({ items: state.details, next: null });
    if (name === "read_diagnostic_panel")
      return ok(state.details.find((d) => d.panel.id === args.p_id) ?? null);
    if (name === "list_diagnostic_history")
      return ok({
        items: state.history.filter((v) => v.panel_id === args.p_id),
        next: null,
      });
    if (name === "list_diagnostic_trends")
      return ok({
        items: state.trends,
        census_hash: "a".repeat(64),
        next: null,
      });
    if (name === "read_diagnostic_action") {
      const saved = state.actions.find((a) => a.id === args.p_action_id);
      if (saved) expect(args).toEqual(saved.args);
      return ok(saved?.receipt ?? null);
    }
    if (name === "save_diagnostic_panel") {
      const saved = state.actions.find((a) => a.id === args.p_action_id);
      if (saved) {
        expect(args).toEqual(saved.args);
        return ok(saved.receipt);
      }
      if (state.conflict) {
        state.conflict = false;
        return route.fulfill({
          status: 409,
          json: {
            code: "PT409",
            message:
              "Diagnostic panel changed; reload before resolving your draft",
          },
        });
      }
      const old = state.details.find((d) => d.panel.id === args.p_id);
      const version = Number(old?.panel.version ?? 0) + 1;
      const panel: DiagnosticDetail["panel"] = {
        id: args.p_id,
        pet_id: pet,
        version,
        draft: args.p_kind === "draft" ? args.p_values : null,
        current_finalized_id: old?.panel.current_finalized_id ?? null,
        current_finalized_number: old?.panel.current_finalized_number ?? 0,
        created_by: actor,
        updated_by: actor,
        created_at: at,
        updated_at: at,
      };
      let current = old?.current ?? null;
      if (args.p_kind === "finalize") {
        current = {
          ...finalized(),
          id: args.p_action_id,
          panel_id: args.p_id,
          snapshot: args.p_values,
          number: panel.current_finalized_number + 1,
          predecessor_id: panel.current_finalized_id,
          review_note: args.p_review_note,
          correction_reason: args.p_correction_reason,
          original_current_available: null,
        };
        panel.current_finalized_id = current.id;
        panel.current_finalized_number = current.number;
        state.history.unshift(current);
        state.trends = state.trends
          .filter((v) => v.panel_id !== panel.id)
          .concat(current);
      }
      const receipt = {
        panel,
        current,
        pdf_status: "not_available",
        export_eligible: false,
      };
      state.details = state.details
        .filter((d) => d.panel.id !== panel.id)
        .concat(receipt);
      state.actions.push({
        id: args.p_action_id,
        args,
        receipt: structuredClone(receipt),
      });
      if (state.lose) {
        state.lose = false;
        return route.abort("failed");
      }
      return ok(receipt);
    }
    return ok([]);
  });
  await page.goto(baseURL!);
  await mount(page, role);
  return state;
}
async function mount(page: Page, role: string) {
  await page.setContent('<div id="diagnostic-root"></div>');
  await page.evaluate((r) => {
    (window as unknown as { __diagRole: string }).__diagRole = r;
  }, role);
  await page.addScriptTag({ content: bundle });
  await expect(
    page.getByRole("heading", { name: "In-house diagnostics", exact: true }),
  ).toBeVisible();
}
async function fill(page: Page) {
  await page
    .getByRole("button", { name: "New in-house panel", exact: true })
    .click();
  await page
    .getByLabel("Panel name", { exact: true })
    .fill("Synthetic chemistry");
  await page.getByLabel("Specimen", { exact: true }).fill("Serum");
  await page
    .getByLabel("Method / device", { exact: true })
    .fill("Synthetic device");
  await page
    .getByLabel("Manual source", { exact: true })
    .fill("Manual in-house");
  await page
    .getByLabel("Collection / observation date", { exact: true })
    .fill("2026-10-01");
  await page.getByLabel("Report date", { exact: true }).fill("2026-10-02");
  await page
    .getByLabel("Analyte identity", { exact: true })
    .fill("synthetic-alt");
  await page.getByLabel("Original analyte label", { exact: true }).fill("ALT");
  await page.getByLabel("Numeric value", { exact: true }).fill("0");
  await page
    .getByLabel("Original unit (use 1 for dimensionless)", { exact: true })
    .fill("U/L");
}
async function saveDraft(page: Page) {
  await page
    .getByRole("button", { name: "Save diagnostic draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Diagnostic draft saved",
  );
}
async function finalizePanel(page: Page, correction = false) {
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Synthetic veterinarian review");
  if (correction)
    await page
      .getByLabel("Correction reason", { exact: true })
      .fill("Corrected source transcription");
  await page
    .getByRole("checkbox", { name: /I reviewed every finding/ })
    .check();
  await page
    .getByRole("button", {
      name: "Finalize reviewed diagnostic version",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Reviewed diagnostic version saved",
  );
}
test("numeric zero and text findings save/reopen/finalize with a source-linked trend", async ({
  page,
  baseURL,
}) => {
  const s = await fixture(page, baseURL);
  await fill(page);
  await page.getByRole("button", { name: "Add diagnostic finding" }).click();
  await page
    .getByLabel("Analyte identity", { exact: true })
    .nth(1)
    .fill("synthetic-screen");
  await page
    .getByLabel("Original analyte label", { exact: true })
    .nth(1)
    .fill("Screen");
  await page
    .getByLabel("Finding type", { exact: true })
    .nth(1)
    .selectOption("qualitative");
  await page.getByLabel("Qualitative result").fill("Not detected");
  await saveDraft(page);
  await finalizePanel(page);
  expect(s.history[0].snapshot.observations[0].value_number).toBe(0);
  expect(s.history[0].snapshot.observations[1].value_text).toBe("Not detected");
  await expect(
    page.getByRole("img", { name: /ALT reviewed values/ }),
  ).toBeVisible();
  await expect(
    page.getByText("PDF unavailable · Excluded from outgoing record packages"),
  ).toBeVisible();
});
test("ordinary staff draft findings but cannot finalize them", async ({
  page,
  baseURL,
}) => {
  const s = await fixture(page, baseURL, "STAFF");
  await fill(page);
  await saveDraft(page);
  await expect(
    page.getByText(
      "Clinical finalization requires an active named veterinarian.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finalize reviewed diagnostic version" }),
  ).toHaveCount(0);
  expect(s.actions).toHaveLength(1);
});
test("invalid partial numeric edit cannot save a previous valid value", async ({
  page,
  baseURL,
}) => {
  const s = await fixture(page, baseURL);
  await fill(page);
  await page.getByLabel("Numeric value", { exact: true }).fill("-");
  await expect(
    page.getByRole("button", { name: "Save diagnostic draft", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Numeric value", { exact: true }).fill("-2.5");
  await saveDraft(page);
  expect(s.details[0].panel.draft.observations[0].value_number).toBe(-2.5);
});
test("correction preserves original zero and records a new reviewed version", async ({
  page,
  baseURL,
}) => {
  const s = await fixture(page, baseURL);
  await fill(page);
  await saveDraft(page);
  await finalizePanel(page);
  await page
    .getByRole("button", { name: "Start correction draft", exact: true })
    .click();
  await page.getByLabel("Numeric value", { exact: true }).fill("2");
  await saveDraft(page);
  await finalizePanel(page, true);
  expect(s.history.map((v) => v.snapshot.observations[0].value_number)).toEqual(
    [2, 0],
  );
  await page.locator("summary").filter({ hasText: "Version 2" }).click();
  await expect(
    page.getByText("Correction reason: Corrected source transcription"),
  ).toBeVisible();
  expect(s.trends).toHaveLength(1);
});
test("lost save response survives remount and recovers its exact receipt", async ({
  page,
  baseURL,
}) => {
  const s = await fixture(page, baseURL);
  await fill(page);
  s.lose = true;
  await page
    .getByRole("button", { name: "Save diagnostic draft", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Recover diagnostic receipt" }),
  ).toBeVisible();
  await mount(page, "DVM");
  await page
    .getByRole("button", { name: "Recover diagnostic receipt" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Original diagnostic receipt recovered",
  );
  expect(s.actions).toHaveLength(1);
  await expect(page.getByLabel("Numeric value", { exact: true })).toHaveValue(
    "0",
  );
});
test("version conflict retains editable draft and does not manufacture an action receipt", async ({
  page,
  baseURL,
}) => {
  const s = await fixture(page, baseURL);
  await fill(page);
  s.conflict = true;
  await page
    .getByRole("button", { name: "Save diagnostic draft", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Diagnostic panel changed",
  );
  await expect(page.getByLabel("Panel name", { exact: true })).toHaveValue(
    "Synthetic chemistry",
  );
  await expect(
    page.getByRole("button", { name: "Save diagnostic draft", exact: true }),
  ).toBeEnabled();
  expect(s.actions).toHaveLength(0);
});
test("changing reviewed findings resets attestation until the changed draft is saved", async ({
  page,
  baseURL,
}) => {
  await fixture(page, baseURL);
  await fill(page);
  await saveDraft(page);
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Synthetic review");
  await page
    .getByRole("checkbox", { name: /I reviewed every finding/ })
    .check();
  await page.getByLabel("Numeric value", { exact: true }).fill("4");
  await expect(
    page.getByRole("checkbox", { name: /I reviewed every finding/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Finalize reviewed diagnostic version" }),
  ).toBeDisabled();
});
