# Commercial-readiness map — The Living Room Vet

Date: 2026-09-19 (revised after integration). Product commit: **`024fd13`** — branch `integration/2026-09`, PR #162 into `main`. CI on that exact commit: frontend, edge and database all green (run 35459935180).

**Precondition — run this before any task:**

```
git fetch origin && git merge-base --is-ancestor 024fd13 origin/main && echo "OK: main is the product" || echo "STOP: PR #162 is not merged yet"
```

If it prints STOP, do nothing and tell the owner. Do not work from any other branch.

Purpose: a work order that a less capable coding model (Kimi K3, Qwen 3.8 or similar — called "the executor" below; tier letter **K**) can execute safely. Every task carries a **tier** that says who may do it. Read section 1 before touching anything.

---

## 1. Rules for the executing model — read first

### 1.1 Where the product lives

- **`main` is the product** once the precondition above passes. Until 2026-09-19 it was ~630 commits behind a stacked-PR chain; PR #162 landed the whole chain.
- Branch from `origin/main`. Open PRs **against `main`**. One task = one branch = one PR. **Never stack a PR on another PR's branch** — that is how `main` fell 630 commits behind.
- **Ignore every `codex/*`, `hub-*`, `lovable-sync-*` and `integration/*` branch.** ~180 old branches and ~100 old open PRs still exist. They are either already inside `main` or deliberately abandoned (see section 2). Never branch from them, merge them, cherry-pick from them, or treat an open PR as pending work.
- The app is large and already built: 133 migrations, ~200 tables, 44 edge functions. **Before building anything, search `main` for it.** Never conclude "feature absent" without grepping `src/hub/features/`, `supabase/migrations/` and `docs/`.
- The backlog is in prose, not in code: the repo has **zero** TODO/FIXME markers. The authoritative gap table is `docs/standalone-feature-matrix-20260916.md`.

### 1.2 Commands

| Purpose | Command |
|---|---|
| Install | `npm ci --ignore-scripts` (Node ≥ 22.12) |
| Lint + typecheck + unit + build | `npm run check` |
| Database tests | `supabase start` then `supabase test db` (needs Docker) |
| Browser tests | `npm run test:e2e` — **then run `git checkout -- docs/evidence/`** (the suite rewrites tracked PNGs until task B6 lands) |
| Edge functions | `deno check --frozen supabase/functions/<name>/index.ts` |

Known-good baseline: on `024fd13`, **1,069 unit tests pass** (local, 2026-09-19) and the full GitHub CI (database + contention harnesses, edge, browser) is green. On its ancestor the day before: 4,386 database tests in 107 files and 413 browser tests, all passing. **Every PR description must quote the real numbers from your own run.** If a number drops, stop.

### 1.3 Never do these

1. Never merge a PR, never push to `main` directly, never force-push, never deploy, never publish in Lovable, never run `supabase db push` / `functions deploy` against a hosted project. Prepare the PR and stop.
2. Never set, read, print, rotate or invent a secret. Never flip a provider gate (`OUTBOUND_DELIVERY_MODE`, any `STRIPE_*_ENABLED`, `*_PUBLIC_ENABLED`, `REMINDER_SCHEDULER_ENABLED`, `EZYVET_*`).
3. Never call the ezyVet API. Never add ezyVet sync, write-back or import features. (`AGENTS.md`, decision of 2026-09-16.)
4. Never edit or delete an existing file in `supabase/migrations/`. Schema changes are **new** migrations only, with a timestamp later than the newest existing file, plus a pgTAP test in `supabase/tests/`.
5. Never drop or truncate any `ezyvet_*` table, the `ezyvet-attachment-originals` bucket, `external_record_*` rows, or anything in `docs/evidence/` or `docs/clinical-review/`. These hold real reviewed patient history and acceptance evidence.
6. Never change text or schema-version branches inside `supabase/functions/_shared/record-release-*.ts`. Confirmed medical-record packages are frozen and re-rendered by those exact branches.
7. Never weaken an RLS policy, a `SECURITY DEFINER` function, a webhook signature check, a capability-token check, or `verify_jwt`. Every new edge function needs an explicit `[functions.<name>]` entry in `supabase/config.toml`.
8. Never read `src/integrations/supabase/types.ts` whole (8,521 lines, generated) — grep it. Never hand-edit it.
9. Only `package-lock.json` is authoritative for npm; `deno.lock` for edge functions. Never regenerate `bun.lock` / `bun.lockb`. Never use bun.
10. Never add a sixth `VITE_*` variable without updating the allowlist in `scripts/build-deployment.mjs` and `docs/deployment-environment.md` — the build guard fails closed.
11. Keep React Router on v7 and React on 18 (`AGENTS.md`).
12. Treat `docs/COMMERCIAL-READINESS-REVIEW-2026-07-07.md` and `docs/hub-smoke-tests.md` as **historical and partly wrong**. Do not act on them.

### 1.4 Tiers

| Tier | Meaning |
|---|---|
| **K** | The executor may do this alone. No schema, no auth, no money, no clinical-record semantics. |
| **K+R** | The executor implements; a stronger model or the owner reviews the diff **before** merge. Anything touching migrations, RLS, `SECURITY DEFINER`, edge-function auth, payments, or signed clinical records. |
| **S→K** | A stronger model writes a short design contract first (the repo's convention: `plans/<date>-<topic>/*-contract.md`). The executor implements from it. Do not start without the contract. |
| **O** | Owner only. No model can do it. |

### 1.5 Stop and escalate when

A test count drops · a migration fails to replay from empty · a task needs a secret or a hosted project · you would have to break a rule in 1.3 · the task touches a signed/immutable record and you are unsure whether history is preserved · two tasks conflict.

---

## 2. State of the repository (verified 2026-09-19)

| Fact | Value |
|---|---|
| Product | `024fd13` = former tip `codex/native-estimates` (`2900366`) + `codex/lovable-publication` + e2e race fix + brand docs + one duplicate-import fix. 669 commits ahead of the old `main` (`44822ff`), 0 behind ⇒ fast-forward. CI green. |
| Second live head | `origin/codex/lovable-publication` — 23 real commits (staging evidence, restore-permission fix, a 30-line extension to `20260916130000_abandoned_attachment_cleanup.sql` that **is** what staging runs). Merged into the integration branch 2026-09-19; both conflicts were additive. It also carried a duplicate import/render in `EzyVetMigrationRuns.tsx` (TS2300) — fixed during integration. |
| Diverged, deliberately NOT merged | `codex/ezyvet-attachment-import` (61 commits) and `codex/api-original-release` (37) are an earlier parallel draft of the ezyVet attachment importer (`ezyvet_attachment_download_*`, `_review_*` tables) that the tip reimplemented as `ezyvet_attachment_capture_*`. Merging would duplicate schema for a roadmap stopped on 2026-09-16. Branches kept as an archive. **Never merge or cherry-pick from them.** |
| Size of tip | 133 migrations · 44 edge-function dirs · 398 TS/TSX files in `src` · 64 e2e specs |
| `main` | Lands via PR #162. **Still unprotected** — see 0.2. |
| GitHub | Repo is **PUBLIC**. 108 open PRs, of which ≥102 are already contained in the tip. 180 remote branches. |
| Unpushed work | The e2e race fix `d7efd35` is now in the product (cherry-picked as `004c4aa`). Still local-only: `feat/stripe-sandbox-invoicing` (2 commits) and `feat/stripe-runtime-setup` (1 commit) — a competing Stripe starter the docs say not to commission. |
| Uncommitted work | Worktree `~/Developer/livingroom-readiness-outcomes`: 81 paths of ezyVet migration-report tooling, last touched 2026-09-16 04:02, i.e. just before the standalone decision stopped that roadmap. |
| Hosted | Staging `kothoqicubowyhwfsrte` is at **119** migration receipts (per `docs/standalone-feature-matrix-20260916.md`); primary `mgadheotkdnrsatfivjy` was last recorded at 113. The repo has 133. All outbound delivery and all Stripe gates are off. No provider secret is installed. |
| Lovable | The Lovable project tracks branch **`codex/lovable-publication`**, not `main` (`docs/lovable-publication-20260914.md`). |
| Secrets / PII in repo | None found. Evidence files are synthetic (`example.test`). Tracked `.env` holds only the public URL + publishable key. |
| Tenancy | **Hard single-tenant.** Zero `practice_id`/`clinic_id`/`tenant_id` columns in 133 migrations; RLS is role-based only. |

---

## 3. Phase 0 — land the product (tier O + stronger model; NOT the executor)

| # | Status | Task | Notes |
|---|---|---|---|
| 0.1 | **DONE 2026-09-19** | Build `integration/2026-09` and prove it. | `024fd13`; PR #162; local `npm run check` + 1,069 unit tests; GitHub CI green on all three jobs. |
| 0.2 | **OWNER — the only blocker** | Merge PR #162 into `main`, then protect `main` (require PR + passing CI, no force-push). | **Use "Create a merge commit" or the fast-forward push. NEVER "Squash and merge"** — squashing 669 commits destroys the history that proves the old PRs are contained, and orphans every evidence reference to a commit SHA. After merging, point the Lovable project back at `main` (it currently tracks `codex/lovable-publication`). |
| 0.3 | after 0.2 | Close the ~100 superseded PRs and prune merged branches. | Stronger model, scripted: close only PRs whose head is an ancestor of `main`, with a "landed via #162" comment. Leave `codex/ezyvet-attachment-import`, `codex/api-original-release` and their PRs (#126, #130, #121, #122) closed-as-abandoned but **do not delete those branches**. |
| 0.4 | OWNER | The 81 uncommitted ezyVet paths in `~/Developer/livingroom-readiness-outcomes`. | Recommendation: commit as WIP on `codex/migration-global-outcomes`, push, label "archived — roadmap stopped 2026-09-16", then remove the worktree. Do not merge. |
| 0.5 | OWNER | Drop the three local Stripe-starter commits. | `docs/STRIPE-INTEGRATION.md` already says not to commission a competing ledger. |
| 0.6 | OWNER | Make the GitHub repo private. | It documents project refs, the staging topology and the security model of a system that will hold client PII and take payments. |
| 0.7 | **OWNER — today** | In BOTH Supabase projects, Auth → "Allow new users to sign up" must be OFF. | See A1. Until A1 ships this toggle is the only thing between a stranger and every client record. |
| 0.8 | after 0.2 | Bring staging (119) and primary (113) up to the repo's 133 migrations through the documented preflight (`docs/hosted-upgrade-preflight.md`). | Stronger model + owner. Never the executor. |

---

## 4. Track A — security hardening

| # | Tier | Task | Where | Done when |
|---|---|---|---|---|
| **A1** | **K+R — do first** | `handle_new_user()` creates an **active STAFF** account for any new auth user. New migration: insert profile with `is_active = false` and insert **no** `user_roles` row. Confirm the admin invite/onboarding path explicitly activates and assigns the role (`docs/staff-access.md`, `src/hub/pages/AdminStaffPage.tsx`). | latest def: `supabase/migrations/20260613223600_*.sql`; `is_active_staff` in `20260613183224_*.sql` | New pgTAP test: a raw `auth.users` insert yields `is_active_staff(id) = false`; invited-staff flow still passes its existing tests and e2e. |
| A2 | K+R | Replace `Access-Control-Allow-Origin: *` on the ~15 staff-JWT handlers with the origin-pinning helper the payment/estimate handlers already use. | grep `Allow-Origin` in `supabase/functions/` | No `*` remains on a handler that accepts a staff JWT; existing handler tests pass; add one test per helper. |
| A3 | K | Delete dead pages: `SignupPage`, `CallPage`, `VoicemailsPage`, `SurveysPage`, `AlertsPage`, `CampaignsPage`, `ImportPage`, `AssignmentDropdown`, `SmartReplySuggestions`; remove the unused lazy `PlaceholderPage` import in `src/App.tsx`. | `src/hub/pages/`, `src/hub/components/conversations/` | `npm run check` green; grep shows no importer. Keep `UnavailableToolPage` and its routes. |
| A4 | K+R | `get_consent_submission(text)` returns the whole row to `anon`. New migration: return only the columns the consent page needs (no `ip_address`, `user_agent`, `access_token`). | `20260913460000_explicit_staff_rpc_grants.sql:24` | pgTAP asserts column list. |
| A5 | K+R | Add `is_on_duty` to the fields guarded by `protect_profile_privileges` (or derive it from `time_entries`). | `20260613183224_*.sql`, `20260614171114_*.sql` | pgTAP: non-admin cannot self-set. |
| A6 | K | Add a `Content-Security-Policy-Report-Only` header in `vercel.json`. Do not enforce yet. | `vercel.json` | Build passes; header present in preview. |
| A7 | S→K | Staff idle lock + MFA. Contract must cover: idle timeout with re-auth that **preserves unsaved clinical drafts**, TOTP enrolment UI, admin-enforced MFA. | `src/integrations/supabase/client.ts`, `src/hub/contexts/AuthContext.tsx` | Per contract. |

---

## 5. Track B — operations

| # | Tier | Task | Done when |
|---|---|---|---|
| **B1** | **S→K** | **There is no scheduler.** Nothing invokes `dispatch-outbox`, `queue-reminders`, `process-inbound`, `process-stripe-events` or `cleanup-abandoned-attachment`. Queued messages never send; reminders never fire. **Do NOT schedule `apply_retention_policies()`** — see E9. Contract must choose pg_cron + pg_net vs. an external cron, and say how the worker key reaches the caller without landing in a migration. | Contract approved; scheduler runs visible in `/hub/admin/operations`; stays gated off until the owner enables providers. |
| B2 | K | Error tracking (Sentry or equivalent): browser SDK in both error boundaries + a thin edge-function wrapper. Adds one `VITE_*` var → rule 1.3 #10. Scrub PII: never send request bodies, client names, or message text. | Boundaries report; allowlist updated; no PII in a test event. |
| B3 | K | `health` edge function (DB ping, no auth data) + document an uptime monitor. | Returns 200/503; `config.toml` entry present. |
| B4 | K | Admin audit-log viewer at `/hub/admin/audit` (read-only, paginated, filter by actor/table/date). RLS already allows admin read. | Page + e2e spec. |
| B5 | K+R | CD: a **manually dispatched** GitHub workflow that deploys migrations + functions to **staging only**. Secrets are referenced by name; the owner installs them. No production job. | Workflow lints; dry-run documented. |
| B6 | K | Stop e2e from rewriting tracked PNGs: make the three `screenshot({path})` calls in `e2e/migration-workspace.spec.ts` (≈ lines 411/436/462) opt-in via an env var. | `npm run test:e2e` leaves `git status` clean. |
| B7 | K | Docs hygiene: rewrite `docs/hub-smoke-tests.md` for the current outbox architecture; add a "HISTORICAL — superseded" banner to the 2026-07-07 review. | — |
| B8 | K | Add `.github/dependabot.yml` (npm weekly, actions monthly). | — |
| B9 | O + S | Hosted backups: PITR on, Storage backup ownership, RTO/RPO written down, one real restore drill including communications original bytes (`docs/restore-runbook.md:80,124`). | Drill receipt in `docs/evidence/`. |

---

## 6. Track C — the layout pass ("as simple as 2022 ezyVet")

This is the largest user-visible win and it is mostly **re-arrangement of components that already exist**. Design tokens are clean (0 hex literals in `src/hub`), and `command`, `breadcrumb`, `accordion`, `tabs` primitives are already installed.

What "2022 ezyVet" concretely means: ezyVet's only documented redesign (Q1 2024) hid the persistent left sidebar by default, moved the memo preview and replaced names with avatars. The information architecture did not change. So the target is a **persistent left rail, patient context that never scrolls away, and notes/alerts visible at a glance** — not fewer features.

The central problem: `src/hub/features/patients/PatientPage.tsx` mounts **18 full-width panels in one scroll** (~14,000 lines of components), with no tabs, no summary pane, no deep links — and the SOAP editor is the **last** panel.

| # | Tier | Task | Notes |
|---|---|---|---|
| C0 | K | Extract `PageShell`, `PageHeader`, `SectionCard` into `src/hub/components/shared/`; one `<h1>` style; one nav registry consumed by both `DesktopSidebar.tsx` and `BottomTabBar.tsx` (the lists are currently duplicated). Give every nav item a distinct icon. | Four incompatible page shells exist today. Pure refactor; e2e must stay green. |
| **C1** | **S→K** | **Patient record screen.** Persistent left summary rail (name, species/breed/sex/age, latest weight, alerts + allergies always visible, owner + phone, quick actions) and a tabbed main pane with `?tab=` deep links, each tab `React.lazy`. Proposed tabs: **Summary** (timeline) · **Notes** (`ClinicalWorkspace` + `PatientProblems`) · **Vaccines** (`PatientTreatments`, `PatientVaccineDuePlans`, `PatientCertificates`, outside vaccinations) · **Medications** (`PatientPrescriptions` incl. dispensing, outside prescriptions) · **Labs** · **Procedures** (dental, anesthesia) · **Charts** (QOL, body map) · **Documents** (documents, outside originals, imported history) · **Releases** · **Billing** (household estimates/invoices filtered to this patient) · **Messages**. | The contract MUST specify how the 13-flag dirty-state protocol (`PatientPage.tsx` lines 37–50) and `useUnsavedChanges` survive tab switches — switching tabs with an unsaved signed-record draft must prompt, never silently discard. Also removes the ~543 kB `PatientPage` chunk. Default tab = Notes. |
| C2 | K | Global client/patient search in `UserHeader` + ⌘K palette using the installed `command.tsx` and the existing `search_clients` RPC. | If a patient-name search RPC is needed, that part is K+R. |
| C3 | K | `/hub/patients` list route (search, species filter, active/inactive). | Patients are reachable today only by drilling through a client. |
| C4 | K | Replace the communications-only home with a **Today** screen: today's appointments, arrivals, unread conversations, refill queue, reminders due, unsigned notes, pending lab acknowledgements, unpaid invoices, outbox failures. Read-only counts + links. | New read RPCs, if any, are K+R. |
| **C5** | **S→K** | **Schedule.** Real time-axis day/week grid; appointment-type catalogue (name, colour token, default duration) replacing free-text "Visit reason"; status colours; patient-flow statuses `ARRIVED → IN_CONSULT → READY_TO_PAY → COMPLETED`; a whiteboard/waiting-room view. Keep `HousecallDayRoute` — it already exceeds ezyVet. | Enum + table migration ⇒ contract first. This also delivers the **check-in** gap (E2). |
| C6 | K | Client screen: same rail + tabs pattern (Overview · Patients · Estimates · Invoices & payments · Messages · Consent & notes). | — |
| C7 | O then K | Navigation regroup to ezyVet-like modules: **Today · Schedule · Clients · Patients · Inbox · Pharmacy** (refills, inventory) **· Financial · Reports · Admin**. Surface the three unreachable pages (`/hub/inbox/review`, `/hub/inbox/processing`, `/hub/admin/outbox`). | **Owner decides** whether Tickets, Time Clock and Timesheet stay (they are leftovers from the earlier comms product). Default: move under a "Team" group. |
| C8 | K | Hub-specific 404 inside `AppShell`; status colours (`green/amber/red` raw classes, ~20 real offenders) → semantic tokens; add `eslint-plugin-jsx-a11y`; older pages (Tickets, TimeClock, Templates) must show a load **error** state, not an empty state. | — |
| C9 | K | Bundle: `manualChunks` vendor split in `vite.config.ts`; lazy-load the 12 marketing pages in `src/App.tsx`. | Main chunk is ~790–890 kB today; matters on housecall mobile data. |

---

## 7. Track D — ezyVet retirement (standalone)

Audit verdict: **the app already runs standalone.** With `EZYVET_*` unset and every `ezyvet_*` table empty, nothing in the normal staff workflow breaks. The importer is hard-gated off outside staging (`supabase/functions/ezyvet-import/adapter.ts:84`). Coupling is one-directional — `ezyvet_*` tables point at core tables — with exactly **two** exceptions: `external_record_receipts.animal_link_id` and `external_record_versions.animal_link_id` are `NOT NULL` FKs to `ezyvet_record_links`.

Two things look wrong and one thing is functionally gated:

| # | Tier | Task |
|---|---|---|
| D1 | K | Remove the "ezyVet imports" nav entry (`DesktopSidebar.tsx:47`, `BottomTabBar.tsx:54`); keep the admin route reachable by URL. Update `e2e/commissioned-navigation.spec.ts:377`. |
| D2 | K | Make the four always-rendered patient panels return `null` when they have zero rows: `PatientImportedHistory`, `PatientImportedVaccinations`, `PatientImportedPrescriptions`, `PatientApiAttachments`. Update `e2e/patients.spec.ts`. (C1 then places them under **Documents**.) |
| D3 | K | Vendor-neutral UI labels in `src/hub/features/record-releases/selection.ts:14,16` ("Approved outside clinical narratives", "Reviewed outside record originals"). **UI only** — rule 1.3 #6. |
| D4 | S→K | Let staff stage a manual outside record **without** an ezyVet patient mapping: make the two `animal_link_id` columns nullable with a CHECK that a source descriptor exists; widen `provider_label` from the literal `"ezyVet"` to an enum in `_shared/record-release-source-provenance.ts` and `src/hub/features/external-records/ExternalRecordState.ts`; **bump the release schema version and keep the old branch**. |
| D5 | K | Turn `/hub/tools/ezyvet` into a read-only "Historical import archive": remove run-launch controls, keep review/evidence viewers. |
| D6 | K+R | After D1–D5 ship: retire the importer **write-path** tests and their CI steps (`ci.yml` ≈ lines 52, 118–134, 205–221; `tests/ezyvet/*-roundtrip*`, `*-disposable.py`, adapter/handler tests; the 13 fully-ezyVet e2e specs). **Keep** every read/render test that protects historical packages (`tests/record-releases/*`, `reviewed-original-handler`, `external_record_provenance*`, `ezyvet_release_discovery_boundaries`). |
| D7 | — | **Do not drop ezyVet tables.** The `release_preview_v4…v13` / `list_record_release_sources_v5…v13` RPC chain names them directly. Renaming to `imported_legacy_*` is a far-future S-tier project with no user value. |

Related, outside this repo: the live ezyVet API access actually lives in **Vet Connect Hub** (`supabase/functions/ezyvet-proxy`, `ezyvet-sync`). Living Room Vet must never call those. What happens to the Hub is a separate owner decision. Naming hazard: **"VetConnect PLUS" is an IDEXX lab product** — unrelated to the Hub; keep the names apart in docs and UI.

---

## 8. Track E — feature-parity gaps, ordered by clinic-day value

First, an **owner pruning pass (tier O)**: the ezyVet catalogue includes boarding, student supervision, multi-location, wellness subscriptions, insurance claims and dictation. A housecall-centred single-site clinic probably needs few of these. Strike what is not wanted before anyone builds it. Record the decision in `docs/standalone-feature-matrix-20260916.md`.

| # | Tier | Gap | Notes |
|---|---|---|---|
| E1 | S→K | Estimates: reviewed **delivery** to the client and **accepted-price execution** into charges/stock. | Drafts, immutable publication, client + witnessed decisions are built. Contracts exist in `plans/20260916-native-estimates/`. |
| E2 | — | Check-in / patient flow. | Delivered by **C5**. |
| E3 | S→K | Consent e-signature: versioned template → immutable signed snapshot (who, when, what text, which patient/appointment). | Legacy `consent_*` tables exist but there is no reachable signing flow. |
| E4 | S→K | **Practice reporting:** day-end takings by tender, A/R ageing, sales by product/staff, vaccines due, stock valuation + expiring lots, unsigned notes. SQL views + CSV export. | Today's dashboards are communications analytics only. |
| **E5** | **S→K + O** | **Controlled-substance log.** The repo has **zero** references to DEA, drug schedule or a dispensing register. Needs: schedule class on catalogue products, prescriber DEA number, perpetual per-lot log tied to dispense/return/waste with witness, biennial inventory, reconciliation report. | Regulatory. Owner supplies DEA registration details and confirms Colorado requirements with counsel/state board. See section 9. |
| E6 | K / S→K | SOAP templates & canned text · discounts · client statements · split billing · bundles · barcodes · supplier purchasing & stock transfers · tags/custom fields · internal memos. | Each is its own small contract. Do only what survives the pruning pass. |
| E7 | K+R | Communications: reply-all / CC / BCC / forward; ad-hoc send-later with edit/cancel; mount `suggest-replies`; campaigns on the outbox backbone. | Do **not** copy the Hub's permissive missing-consent or automatic uncertain-resend behaviour. |
| E8 | O + K | Privacy policy, terms, SMS terms pages. | Owner/counsel supply text; model builds routes. |
| E9 | S→K | Client data export and deletion/anonymisation; decide and wire (or remove) `apply_retention_policies()`. | **Legal trap:** Colorado requires records for ≥ 3 years after the patient's **last exam** (C.R.S. 12-315-119). The dormant job archives conversations after 365 idle days and then **hard-deletes them** 730 days later — a clock keyed to the *last message*, not the last exam, so it can delete client communications for a patient who is still being seen. It is off (`retention_enabled='false'`) and has no caller today. **Never enable or schedule it as configured** — B1 must explicitly exclude it until this contract is approved. |
| E10 | S→K | Housecall resilience: PWA shell + durable local draft for SOAP so a dropped connection never loses a note. | No service worker or offline handling exists today. |
| E11 | later | Full client portal. | Expiring document/payment/estimate links cover launch. Link possession must never imply wider access. |

---

## 9. Track F — direct integrations (no ezyVet in the middle)

Full vendor-by-vendor verdicts, the imaging architecture and the regulatory inputs are in **`INTEGRATIONS.md`** in this folder. Summary: every vet-specific vendor (labs, commercial PACS, pharmacy, insurance, microchips, financing) is **partner-gated**; **imaging is the exception** because DICOM is an open standard.

| # | Tier | Task |
|---|---|---|
| F1 | O | Tell us what X-ray hardware/PACS 2619 Spruce will have, and whether Modality Worklist is a paid option on that console. Apply to **Antech** (via the account rep → PIMS integration team) and **Vetcove** now; both take weeks. |
| F2 | S→K | Native **imaging order** model: order → accession number → study link → report attachment, shown under the patient's Procedures/Documents tab. v1 works with a pasted vendor "open study" URL. |
| F3 | O + S | Orthanc + OHIF box on the clinic network (worklist out, studies in, callback to Supabase). Infrastructure — not for the executor. DICOM cannot run in edge functions. |
| F4 | S→K | Lab adapter interface shaped like ezyVet's public SDI spec; Antech test-code catalogue on native lab orders; result-PDF ingestion via the existing inbound-email attachment capture. |
| F5 | K+R | Stripe Terminal (card-present) on the existing ledger — after the sandbox acceptance in `docs/provider-acceptance-20260915.md` has been run. |
| F6 | S→K | Accounting: one daily summary journal entry to QuickBooks Online or Xero. Depends on E4 (reporting views) and B1 (scheduler). |
| F7 | K | "External prescription" record + printable written prescription for Chewy/Vetsource/Covetrus; microchip fields + AAHA lookup link-out. |

Design rule for all of them: one adapter interface per category (imaging, reference lab, in-house analyser, pharmacy), provider chosen by configuration, **manual path always available**. The repo already follows this for labs (manual orders + attached originals + DVM acknowledgement).

---

## 10. Owner-only checklist (nothing ships to real clients without these)

1. **Clinical sign-off.** All 17 review IDs in `docs/clinical-review/README.md` are "Pending". Dr. Edler must approve forms, certificate wording, reminder intervals and release content.
2. Provider accounts + secrets: Stripe (sandbox first), Twilio number, Resend — **Resend is at 10/10 domains**, so `auth.`/`reply.` subdomains need the $20/mo add-on or a freed slot.
3. Auth SMTP on the primary project + a staff mailbox; then bootstrap the first administrator (`docs/staff-access.md`).
4. Cloudflare Turnstile for the public contact form (the only anonymous write path; currently unprotected).
5. Practice phone number and emergency-referral contact.
6. Rabies-certificate issuer details; real opening stock and price list.
7. Antech onboarding contact; anesthesia-monitor vendor decision.
8. Backup posture: PITR, RTO/RPO (B9).
9. One complete real workflow on the hosted backend — the repo's own completion gate (`docs/commercial-readiness.md:132`): household → booking → reminder → SOAP → stock-backed vaccine → invoice → certificate → record delivery → client reply → payment reconciliation → next reminder.
10. The Phase 0 decisions (0.2, 0.4, 0.5, 0.6, 0.7).

---

## 11. One strategic decision: what "commercial" means

If it means **this clinic runs on it**, sections 3–10 are the whole job.

If it means **sell it to other clinics**, know that the system is hard single-tenant. Recommendation: **one Supabase project per clinic**, not a multi-tenant schema. Retrofitting `practice_id` across ~200 tables, every RLS policy and ~470 functions, then re-proving 4,386 database tests, is a months-long project that puts the existing safety evidence at risk. Project-per-clinic keeps PHI physically separated and reuses everything — but it promotes **B5 (CD)** from "should" to "must", and adds a per-clinic configuration layer (name, address, timezone, domain, branding are currently baked in).

---

## 12. Suggested execution order

| Wave | Tasks | Why |
|---|---|---|
| 0 | Phase 0.2 (merge #162), 0.7 | Owner only. The executor cannot start until the precondition check passes. |
| 1 | **A1**, then A3, B6, B7, B8, D1, D2, D3, C0, C9 | The one critical fix, then safe cleanups that make later work easier. No schema except A1. |
| 2 | C1 (after contract), C2, C3, C4, C6, C8, B2, B3, B4 | The layout pass — the visible product improvement. |
| 3 | A2, A4, A5, A6, B1, B5, C5/E2, C7 | Reviewed schema and edge work; scheduler; patient flow. |
| 4 | E1, E4, E5, E3, D4, D5, then D6 | Parity gaps that need contracts. |
| 5 | A7, E7, E9, E10, Track F, E6 survivors, E11 | Depth. |

Owner items in section 10 run in parallel from day one; several (clinical sign-off, Antech, provider accounts) have long lead times and gate launch regardless of how fast the code moves.
