import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  clinicalId as id,
  clinicalActor as actor,
  clinicalPet as pet,
  clinicalClient as client,
  clinicalMapping as mapping,
  clinicalAt as at,
  approvedClinicalHistory,
  existingClinicalProblem,
} from "../tests/clinical-history/fixtures";
interface Row {
  // Synthetic RPC rows span request/source/problem contracts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
async function fixture(page: Page, role = "DVM") {
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
  const state = {
    histories: [approvedClinicalHistory()] as Row[],
    problems: [] as Row[],
    extractions: [] as Row[],
    requests: [] as Row[],
    calls: [] as Row[],
    losePrepare: false,
    loseApprove: false,
    stale: false,
    wrongContext: false,
  };
  const patient = {
    id: pet,
    client_id: client,
    name: "Synthetic Juniper",
    species: "Dog",
    breed: null,
    dob: null,
    birth_date_precision: "unknown",
    color: null,
    microchip_id: null,
    sex: "unknown",
    neuter_status: "unknown",
    archived_at: null,
    deceased_at: null,
    weight_lbs: null,
    allergies: null,
    version: 1,
  };
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:8080"
      ? r.continue()
      : r.abort(),
  );
  await page.route("http://127.0.0.1:54321/**", async (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname,
      body = r.request().method() === "POST" ? r.request().postDataJSON() : {};
    if (path === "/auth/v1/token") return r.fulfill({ json: session });
    if (path === "/auth/v1/user") return r.fulfill({ json: user });
    if (path === "/auth/v1/logout") return r.fulfill({ json: {} });
    if (path === "/rest/v1/profiles")
      return r.fulfill({
        json: [
          {
            id: actor,
            first_name: "Synthetic",
            last_name: "Reviewer",
            full_name: "Synthetic Reviewer",
            role,
            is_active: true,
          },
        ],
      });
    if (path === "/rest/v1/user_roles") return r.fulfill({ json: [{ role }] });
    if (path === "/rest/v1/pets")
      return r.fulfill({
        json: r.request().headers().accept?.includes("vnd.pgrst.object")
          ? patient
          : [patient],
      });
    if (path === "/rest/v1/clients")
      return r.fulfill({
        json: {
          id: client,
          full_name: "Synthetic Family",
          housecall_address: "Synthetic address",
        },
      });
    if (path === "/rest/v1/patient_problems")
      return r.fulfill({ json: state.problems });
    if (path.startsWith("/rest/v1/rpc/") || path.startsWith("/functions/"))
      state.calls.push({ path, ...body });
    if (path.endsWith("search_ezyvet_mapped_patients"))
      return r.fulfill({
        json: [
          {
            link_id: mapping,
            pet_id: pet,
            patient_name: patient.name,
            household_name: "Synthetic Family",
            source_origin: "https://api.trial.ezyvet.com",
            source_site_uid: "synthetic-site",
            external_id: "22",
            patient_version: 1,
          },
        ],
      });
    if (path.endsWith("list_ezyvet_clinical_runs"))
      return r.fulfill({
        json: { runs: [], has_more: false, next_cursor: null },
      });
    if (path.endsWith("list_ezyvet_clinical_candidates")) {
      const h = approvedClinicalHistory();
      return r.fulfill({
        json: {
          animal_link_id: mapping,
          resource: body.p_resource,
          candidates:
            body.p_resource === "history"
              ? [
                  {
                    id: h.snapshot_id,
                    payload: { id: "71", animal_id: "22", ...h.original },
                    payload_hash: h.payload_hash,
                    external_id: "71",
                    resource: "history",
                    source_origin: h.source.origin,
                    source_site_uid: h.source.site_uid,
                    created_at: at,
                    head_version: 1,
                    observed_head_version: 1,
                    current_snapshot_id: h.snapshot_id,
                    is_current: true,
                    is_current_snapshot: true,
                    current_head_scoped: true,
                    animal_link_id: mapping,
                    pet_id: pet,
                    client_id: client,
                  },
                ]
              : [],
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (path.endsWith("list_patient_imported_histories"))
      return r.fulfill({
        json: {
          histories: state.histories,
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("search_patient_problems"))
      return r.fulfill({ json: state.problems });
    if (path.endsWith("read_patient_problem_import_provenance"))
      return r.fulfill({
        json: body.p_problem_ids.map((problem_id: string) => ({
          problem_id,
          extractions: state.extractions.filter(
            (e) => e.problem_id === problem_id,
          ),
        })),
      });
    if (path.endsWith("list_ezyvet_history_requests"))
      return r.fulfill({
        json: {
          requests: state.requests.filter(
            (e) => e.request.kind === body.p_kind,
          ),
          has_more: false,
          next_cursor: null,
        },
      });
    if (path.endsWith("recover_ezyvet_history_request")) {
      const saved = state.requests.find((e) => e.request.id === body.p_id);
      const v = saved ? structuredClone(saved) : null;
      if (v && state.wrongContext && v.request.review_context?.histories[0])
        v.request.review_context.histories[0].id = id(99);
      return r.fulfill({ json: v });
    }
    const kind =
      path.includes("history_approval") ||
      path.endsWith("approve_ezyvet_history")
        ? "history_approval"
        : path.includes("history_discrepancy")
          ? "discrepancy_review"
          : "problem_extraction";
    if (path.includes("/prepare_ezyvet_")) {
      expect(role).toBe(kind === "history_approval" ? "ADMIN" : "DVM");
      const p = body.p_payload;
      const h = approvedClinicalHistory();
      const context = {
        history_source:
          kind === "history_approval"
            ? {
                source: h.source,
                snapshot_id: h.snapshot_id,
                payload_hash: h.payload_hash,
                observed_head_version: 1,
                original: h.original,
                consult: { status: p.consult_mode },
              }
            : null,
        histories:
          kind === "history_approval"
            ? []
            : state.histories.filter((h) =>
                (p.sources ?? p.reviewed_sources).some(
                  (s: Row) => (s.id ?? s.reviewed_history_id) === h.id,
                ),
              ),
        problem:
          p.action === "link"
            ? state.problems.find((v) => v.id === p.problem_id)
            : null,
        extraction:
          kind === "discrepancy_review"
            ? state.extractions.find((e) => e.id === p.extraction_id)
            : null,
      };
      const value = {
        request: {
          id: body.p_id,
          actor_id: actor,
          pet_id: pet,
          kind,
          status: "prepared",
          request_hash: createHash("sha256")
            .update(JSON.stringify(p))
            .digest("hex"),
          payload: p,
          review_context: structuredClone(context),
          created_at: at,
          resolved_at: null,
        },
        receipt: null,
      };
      state.requests.push(value);
      if (state.losePrepare) {
        state.losePrepare = false;
        return r.abort();
      }
      return r.fulfill({ json: value });
    }
    if (path.includes("/approve_ezyvet_")) {
      const saved = state.requests.find((e) => e.request.id === body.p_id)!;
      expect(body.p_expected_hash).toBe(saved.request.request_hash);
      if (state.stale)
        return r.fulfill({ status: 409, json: { message: "Source changed" } });
      const p = saved.request.payload;
      if (kind === "history_approval") {
        saved.receipt = { ...approvedClinicalHistory(), id: body.p_id };
        state.histories.push(saved.receipt);
      } else if (kind === "problem_extraction") {
        const problem =
          p.action === "link"
            ? state.problems.find((v) => v.id === p.problem_id)
            : { ...existingClinicalProblem(), id: id(90), ...p.fields };
        if (p.action === "create") state.problems.push(problem);
        saved.receipt = {
          id: body.p_id,
          problem_id: problem.id,
          action: p.action,
          problem_version: problem.version,
          problem_fields: p.fields,
          extracted_by: actor,
          extracted_at: at,
          sources: saved.request.review_context.histories,
          current_problem_version: problem.version,
          locally_edited: false,
          discrepancy: {
            required: false,
            reviewed: false,
            changed_from_original: false,
            review_history: [],
          },
        };
        state.extractions.push(saved.receipt);
      } else {
        const extraction = state.extractions.find(
          (e) => e.id === p.extraction_id,
        )!;
        saved.receipt = {
          id: body.p_id,
          reviewed_by: actor,
          reviewed_at: at,
          source_heads: saved.request.review_context.histories.map(
            (h: Row) => ({
              history_id: h.id,
              snapshot_id: h.snapshot_id,
              head_version: h.observed_head_version,
            }),
          ),
          sources: saved.request.review_context.histories,
        };
        extraction.discrepancy = {
          required: false,
          reviewed: true,
          changed_from_original: true,
          review_history: [saved.receipt],
        };
      }
      saved.request.status = "approved";
      saved.request.resolved_at = at;
      if (state.loseApprove) {
        state.loseApprove = false;
        return r.abort();
      }
      return r.fulfill({ json: saved.receipt });
    }
    if (path.endsWith("abandon_ezyvet_history_request")) {
      let value = state.requests.find((e) => e.request.id === body.p_id);
      if (!value) {
        value = {
          request: {
            id: body.p_id,
            actor_id: actor,
            pet_id: pet,
            kind: body.p_kind,
            status: "abandoned",
            request_hash: null,
            payload: null,
            review_context: null,
            created_at: at,
            resolved_at: at,
          },
          receipt: null,
        };
        state.requests.push(value);
      }
      if (value.request.status === "prepared") {
        value.request.status = "abandoned";
        value.request.resolved_at = at;
      }
      return r.fulfill({ json: value });
    }
    return r.fulfill({ json: [] });
  });
  return state;
}
const extraction = (page: Page) =>
  page.getByRole("region", { name: "Review local finding", exact: true });
async function draftFinding(page: Page) {
  const p = extraction(page);
  await p.getByLabel("Use history 71 version 1", { exact: true }).check();
  await p
    .getByLabel("Compare existing patient problems", { exact: true })
    .fill("reaction");
  await p
    .getByLabel("Reviewed problem title", { exact: true })
    .fill("Locally reviewed vaccine reaction");
  await p
    .getByRole("combobox", { name: "Reviewed problem status", exact: true })
    .selectOption("active");
  await p
    .getByRole("combobox", { name: "Reviewed problem importance", exact: true })
    .selectOption("high");
  await p
    .getByLabel(
      "I compared the existing patient problems and chose a distinct finding or an exact existing link.",
      { exact: true },
    )
    .check();
  await p
    .getByRole("textbox", {
      name: "Clinical extraction reason (5–2,000 characters)",
      exact: true,
    })
    .fill("ok");
  await expect(
    p.getByRole("button", {
      name: "Prepare local finding review",
      exact: true,
    }),
  ).toBeDisabled();
  await p
    .getByRole("textbox", {
      name: "Clinical extraction reason (5–2,000 characters)",
      exact: true,
    })
    .fill("Compared source evidence and current problem list");
}
async function approveFinding(page: Page) {
  const p = extraction(page);
  await p
    .getByRole("button", { name: "Prepare local finding review", exact: true })
    .click();
  await p
    .getByLabel(
      "I reviewed the complete frozen evidence and the exact proposed local finding.",
      { exact: true },
    )
    .check();
  await p
    .getByRole("button", {
      name: "Approve reviewed local finding",
      exact: true,
    })
    .click();
}

test("ADMIN recovers frozen source approval after reload without importing local clinical authority", async ({
  page,
}) => {
  const state = await fixture(page, "ADMIN");
  state.losePrepare = true;
  await page.goto("/hub/tools/ezyvet");
  const clinical = page.getByRole("region", {
    name: "Patient-scoped clinical import",
  });
  await clinical.getByLabel("Find clinical import patient").fill("Juniper");
  await clinical
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  await clinical
    .getByRole("button", {
      name: "Read history 71 · current observation",
      exact: true,
    })
    .click();
  const review = page.getByRole("region", {
    name: "Review source history import",
    exact: true,
  });
  await review
    .getByLabel("Consult context decision")
    .selectOption("unresolved");
  await review
    .getByLabel("Source approval reason")
    .fill("Reviewed patient identity and uninterpreted source narrative");
  await review
    .getByRole("button", {
      name: "Prepare source history import review",
      exact: true,
    })
    .click();
  await expect(review.getByRole("alert")).toBeVisible();
  await page.reload();
  await clinical.getByLabel("Find clinical import patient").fill("Juniper");
  await clinical
    .getByRole("button", {
      name: "Synthetic Juniper · Synthetic Family · synthetic-site",
      exact: true,
    })
    .click();
  await review
    .getByRole("button", {
      name: "Recover original source history import review",
      exact: true,
    })
    .click();
  await expect(
    review.getByText(
      "Outside reaction narrative <img src=x onerror=alert(1)>",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(review.locator("img")).toHaveCount(0);
  await review
    .getByLabel(
      "I reviewed the complete frozen evidence and the exact proposed source history import.",
      { exact: true },
    )
    .check();
  await review
    .getByRole("button", {
      name: "Approve reviewed source history import",
      exact: true,
    })
    .click();
  await expect(
    review.getByText(/Original reviewed action is saved/),
  ).toBeVisible();
  expect(state.problems).toHaveLength(0);
  expect(
    state.calls.filter((c) =>
      c.path.includes("prepare_ezyvet_history_approval"),
    ),
  ).toHaveLength(1);
});

test("DVM authored reaction recovers lost approval once and refreshes native alerts and provenance", async ({
  page,
}) => {
  const state = await fixture(page);
  state.loseApprove = true;
  await page.goto(`/hub/patient/${pet}`);
  await draftFinding(page);
  await approveFinding(page);
  const p = extraction(page);
  await expect(p.getByRole("alert")).toBeVisible();
  await p
    .getByRole("button", {
      name: "Recover original local finding review",
      exact: true,
    })
    .click();
  await expect(p.getByText(/Original reviewed action is saved/)).toBeVisible();
  expect(state.problems).toHaveLength(1);
  expect(state.problems[0].onset_date).toBeNull();
  await expect(
    page
      .getByText("Locally reviewed vaccine reaction", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Reviewed ezyVet source evidence · locally authored finding/,
    ),
  ).toBeVisible();
  expect(
    state.calls.filter((c) =>
      c.path.includes("approve_ezyvet_problem_extraction"),
    ),
  ).toHaveLength(1);
  expect(
    state.calls.some((c) => c.path.includes("prepare_ezyvet_history_approval")),
  ).toBe(false);
});

test("DVM links existing fields unchanged and discovers its saved receipt after pointer loss", async ({
  page,
}) => {
  const state = await fixture(page);
  state.problems.push(existingClinicalProblem());
  const before = structuredClone(state.problems[0]);
  await page.goto(`/hub/patient/${pet}`);
  const p = extraction(page);
  await p.getByLabel("Use history 71 version 1", { exact: true }).check();
  await p.getByLabel("Compare existing patient problems").fill("reaction");
  await p
    .getByRole("button", {
      name: "Link existing problem Existing locally authored reaction",
      exact: true,
    })
    .click();
  await p
    .getByLabel(
      "I compared the existing patient problems and chose a distinct finding or an exact existing link.",
      { exact: true },
    )
    .check();
  await p
    .getByLabel("Clinical extraction reason")
    .fill("Reviewed matching existing local finding");
  await approveFinding(page);
  await expect(p.getByText(/Original reviewed action is saved/)).toBeVisible();
  expect(state.problems).toEqual([before]);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await p.getByText("Earlier local finding requests", { exact: true }).click();
  await p
    .getByRole("button", {
      name: `Recover review ${state.requests[0].request.id.slice(0, 8)}`,
      exact: true,
    })
    .click();
  await expect(p.getByText(/Original reviewed action is saved/)).toBeVisible();
  expect(state.extractions).toHaveLength(1);
});

test("stale approval stays recoverable, abandonment is durable, and drafts use the shared patient guard", async ({
  page,
}) => {
  const state = await fixture(page);
  state.stale = true;
  await page.goto(`/hub/patient/${pet}`);
  await draftFinding(page);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Leave with unsaved changes?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await approveFinding(page);
  const p = extraction(page);
  await expect(p.getByRole("alert")).toBeVisible();
  await p
    .getByLabel(
      "Abandon this original request if it has not already been approved.",
      { exact: true },
    )
    .check();
  await p
    .getByRole("button", {
      name: "Abandon original local finding review",
      exact: true,
    })
    .click();
  await expect(p.getByText(/Original request is abandoned/)).toBeVisible();
  expect(state.problems).toHaveLength(0);
  expect(state.requests[0].request.status).toBe("abandoned");
});

test("mismatched frozen source blocks recovered approval and signout clears operation references", async ({
  page,
}) => {
  const state = await fixture(page);
  state.wrongContext = true;
  await page.goto(`/hub/patient/${pet}`);
  await draftFinding(page);
  const p = extraction(page);
  await p
    .getByRole("button", { name: "Prepare local finding review", exact: true })
    .click();
  await expect(p.getByRole("alert")).toContainText(
    "Frozen extraction source evidence differs",
  );
  await expect(
    p.getByRole("button", {
      name: "Approve reviewed local finding",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Sign out/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).filter((k) =>
          k.startsWith("ezyvet-history-intent:"),
        ),
      ),
    )
    .toEqual([]);
  expect(state.problems).toHaveLength(0);
});

test("DVM reviews later approved source evidence without rewriting the local problem", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(`/hub/patient/${pet}`);
  await draftFinding(page);
  await approveFinding(page);
  const finding = extraction(page);
  await expect(
    finding.getByText(/Original reviewed action is saved/),
  ).toBeVisible();
  await finding
    .getByRole("button", {
      name: "Close saved local finding review",
      exact: true,
    })
    .click();
  const original = structuredClone(state.problems[0]);
  const previous = state.histories[0];
  previous.current = {
    snapshot_id: id(10),
    head_version: 2,
    scoped: true,
    is_current: false,
    source_active: "0",
  };
  state.extractions[0].discrepancy = {
    required: true,
    reviewed: false,
    changed_from_original: true,
    review_history: [],
  };
  state.histories.push({
    ...approvedClinicalHistory(),
    id: id(9),
    version: 2,
    version_hash: "d".repeat(64),
    snapshot_id: id(10),
    payload_hash: "e".repeat(64),
    observed_head_version: 2,
    original: {
      ...approvedClinicalHistory().original,
      comments: "Later reviewed source correction",
      active: "0",
    },
    current: {
      snapshot_id: id(10),
      head_version: 2,
      scoped: true,
      is_current: true,
      source_active: "0",
    },
  });
  const panel = page.getByRole("region", {
    name: "Approved imported clinical history",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Refresh approved history", exact: true })
    .click();
  await panel
    .getByLabel("Find problem for source discrepancy review")
    .fill("reaction");
  await panel
    .getByRole("button", {
      name: "Inspect imported sources for Locally reviewed vaccine reaction",
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", {
      name: `Review source changes ${state.extractions[0].id.slice(0, 8)}`,
      exact: true,
    })
    .click();
  const review = page.getByRole("region", {
    name: "Review source discrepancy",
    exact: true,
  });
  await review
    .getByRole("combobox", {
      name: "Replacement reviewed evidence for history 71",
      exact: true,
    })
    .selectOption(id(9));
  await review
    .getByLabel("Source discrepancy review reason (5–2,000 characters)", {
      exact: true,
    })
    .fill("Compared later source evidence; local finding remains unchanged");
  await review
    .getByRole("button", {
      name: "Prepare source discrepancy review",
      exact: true,
    })
    .click();
  await expect(
    review.getByText("Later reviewed source correction", { exact: true }),
  ).toBeVisible();
  await review
    .getByLabel(
      "I reviewed the complete frozen evidence and the exact proposed source discrepancy.",
      { exact: true },
    )
    .check();
  await review
    .getByRole("button", {
      name: "Approve reviewed source discrepancy",
      exact: true,
    })
    .click();
  await expect(
    review.getByText(/Original reviewed action is saved/),
  ).toBeVisible();
  expect(state.problems).toEqual([original]);
  expect(state.extractions[0].discrepancy.reviewed).toBe(true);
});
