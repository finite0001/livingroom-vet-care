# A-list verification and milestone plan (REVISED)

> ## SUPERSEDED — 2026-09-20
>
> **The live work order is [`../2026-09-19-commercial-readiness-map/MAP.md`](../2026-09-19-commercial-readiness-map/MAP.md).**
>
> This file was written on 2026-09-18, when the stack was still unmerged. It is now out of date in one decisive way: **the stack landed in `main` on 2026-09-19** (PR #162, merge commit `9bc97b6`, product `024fd13`). `main` is at `3f9e2c1` with 133 migrations. M1 (verify) and M2 (reconcile) below remain valid evidence; M3–M5 are superseded.
>
> Why it was wrong: it read the local `main` (`56f8315`, 683 commits stale) instead of `origin/main`. Evidence: [t04-correction-2026-09-20.md](t04-correction-2026-09-20.md).

Date: 2026-09-18. Author: PM. Supersedes the version of this file dated 2026-09-18 that described only the current branch. No code changed, no commits made.

## Correction: the first version was wrong

The first version of this document checked only the checked-out branch (`feat/stripe-sandbox-invoicing`) and concluded most A-list items were "open". That was incomplete. Checking all branches shows the great majority of the A-list is **already built**, on a large stack of unmerged branches.

What is actually true:

- `main` (`56f8315`) contains only the foundation and clinical-core work.
- The checked-out branch `feat/stripe-sandbox-invoicing` is `main` plus 2 commits — a standalone Stripe starter, not the product.
- There are **158 `origin/codex/*` remote branches**; only 2 are merged into `main`.
- There are **161 pull requests: 53 merged, 108 open** — a stacked-PR effort where each PR merges into the one below it, not into `main`.
- The stack tip is **`origin/codex/communications-restore-acceptance`**: 620 commits ahead of `main`, 1,312 changed files, **118 new migrations**, ~200 new tables, 304 test files, with a CI workflow and the same test scripts.

The A-list is therefore not a build backlog. It is an **integration backlog**.

## 1. Revised A-list status

Status is judged against the stack tip, because that is where the work lives. "Built (unmerged)" means real code, migrations and tests exist on the branches but the feature is **not in `main` and not live**.

| # | Item | Status | Evidence (tip branch `communications-restore-acceptance`) |
|---|---|---|---|
| 1 | Estimate delivery by email/SMS | **Built (unmerged)** | `native_estimate_drafts`, `native_estimate_publication_*`; migrations `20260916120716_native_estimate_drafts.sql`, `20260916123017_native_estimate_publications.sql` |
| 2 | Accepted-price execution (accepted estimate → charge + stock) | **Built (unmerged)** | `native_dispenses`, `native_dispense_allocations`, `native_dispense_finance_*`, `native_dispense_credit_links`, `native_dispense_refund_links`; migration `20260916110000_native_dispense_finance.sql` |
| 3 | Vaccine workflows + vaccine/rabies certificates | **Built (unmerged)** | `vaccine_certificates`, `vaccine_certificate_events`, `vaccine_certificate_treatments`, `patient_vaccine_due_plans`, `vaccine_due_templates`, `certificate_issuers`; migration `20260913080000_vaccine_certificates.sql` |
| 4 | Medication/vaccine inventory + billing | **Built (unmerged)** | `catalog_products`, `inventory_lots`, `inventory_movements`; migrations `20260913000000_inventory_billing.sql`, `20260913030000_inventory_read_models.sql`, `20260916070108_inventory_product_before_lot_locking.sql` |
| 5 | Scheduling UI | **Built (unmerged)** | migration `20260912230000_scheduling.sql` (+ `native_fill_slots`, `native_slot_closures`); branch `codex/scheduling` is an ancestor of the tip |
| 6 | Reminders (due engine, invalidation, outbox) | **Built (unmerged)** | `care_reminder_jobs`, `reminder_scheduler_runs`, `reminder_scheduler_results`, `reminder_outbox_links`, `reminder_automation_policies`; migrations `20260913140000_care_reminders.sql`, `20260913180000_reminder_outbox.sql` |
| 7 | Dental charting | **Built (unmerged)** | `dental_charts`, `dental_chart_revisions`, `dental_chart_addenda`; migration `20260913070000_dental_chart.sql` |
| 8 | Anesthesia records + vendor adapter | **Partly built (unmerged)** | Records built: `patient_anesthesia_records`, `anesthesia_record_revisions`, `anesthesia_record_addenda`; migration `20260913110000_anesthesia_records.sql`. **Vendor adapter still undecided/absent** (`codex/anesthesia-records` = 46 commits, manual record path only) |
| 9 | QOL charting | **Built (unmerged)** | `patient_qol_records`, `patient_qol_addenda`; migration `20260913060000_care_charts.sql` |
| 10 | Body maps | **Built (unmerged)** | `patient_lesions`, `patient_lesion_observations`, `patient_lesion_corrections`; migration `20260913060000_care_charts.sql` |
| 11 | Unified inbox (read state, pagination, callbacks, idempotency) | **Built (unmerged)** | `communication_outbox`, `communication_inbound`, `communication_provider_events`, `communication_delivery_events`, `communication_event_retry_actions`, `communication_reconciliations`, `conversation_read_cursors`, `conversation_unread_flags`, `inbox_read_snapshots`, `inbound_attachment_captures`; migrations `20260913020000_communications_outbox.sql`, `20260913050000_inbound_delivery.sql`, `20260913095000_inbox_workspace.sql` |
| 12a | Payments (Stripe ledger) | **Built (unmerged)** | `billing_invoices`, `billing_invoice_items`, `billing_credits`, `invoice_payments`, `invoice_refunds`, `payment_collection_*`, `payment_reconciliation_*`, `stripe_event_receipts`, `stripe_event_work`; migrations `20260913300000_payment_ledger.sql` … `20260913400000_stripe_event_retry_cycles.sql` |
| 12b | Record delivery | **Built (unmerged)** | `record_releases`, `record_release_events`, `record_release_sources`, `document_link_*`, `release_email_*`, `patient_documents` |
| 12c | Purchasing / transfers / returns | **Built (unmerged)** | `native_return_*`, `native_fulfillment_*`, `inventory_movements` |
| 12d | Lab workflows | **Built (unmerged)** | `patient_lab_orders`, `lab_report_*`, `lab_due_templates`, `lab_source_accounts` |
| 12e | Campaigns | **Partial (main only)** | Campaign tables exist on `main` from the earlier hub work; no campaign extension found on the tip |
| 12f | Consent signing | **OPEN** | No `consent_*` tables created on the tip (only the pre-existing `consent_submissions` / `consent_form_templates` on `main`) |
| 12g | Check-in | **OPEN** | No `check_in` / `checkin` tables or modules found on the tip |
| 12h | Reporting | **OPEN** | No report tables or report feature found on the tip (only `lab_report_*`) |
| 12i | Client portal | **OPEN (by design)** | No portal tables. The built design uses controlled, expiring `document_link_*` and payment links instead — which matches the original plan ("clients receive controlled document/payment links; a full client portal is later scope") |

**Beyond the A-list**, the tip also contains a large ezyVet (external PIMS) integration (~60 `ezyvet_*` tables), native prescribing/refills/fulfillment, treatment alerts, and website-inquiry triage.

## 2. Revised plan

The job is **verify → reconcile → integrate → close gaps → rehearse**, not build from scratch.

### M1 — Verify the integration tip — DONE 2026-09-18

Verified at commit `6f03fdd` in an isolated worktree. Full results in [tip-verification-2026-09-18.md](tip-verification-2026-09-18.md).

- `npm ci`: pass (445 packages, 0 vulnerabilities).
- `npm run lint`: pass (0 errors, 1 pre-existing warning).
- `npm run typecheck`: pass.
- `npm test`: **1014 tests, 1014 pass, 0 fail**.
- `npm run build`: pass.
- `supabase start`: all 132 migrations applied cleanly.
- `supabase test db`: **107 files, 4386 tests, PASS**.
- `npm run test:e2e`: initially **412 passed, 1 failed** (`e2e/native-dispense-finance.spec.ts:378`, a test-side race). **Fixed and re-verified the same day: 413 passed, 0 failed.** The tip now has no known failing test.

**Integration bonus:** `main` is an ancestor of the tip, so merging the tip into `main` is a **fast-forward** — 0 conflicts, 0 migrations on `main` altered.

### M2 — Reconcile the 161-PR stack

Goal: turn 108 open PRs into one known integration path.

- For each open PR, determine whether its commits are already contained in the tip (`git merge-base --is-ancestor`).
- Produce a list: contained (can be closed/superseded) vs not contained (real outstanding work).
- Decide the merge strategy: merge the tip as one integration, or replay PR-by-PR.
- Depends on: M1.

### M3 — Integrate into `main` and staging

Goal: get the product into `main` and running in staging.

- Merge the tip into `main`. **This is a fast-forward** (verified 2026-09-18): `main` is an ancestor of the tip, no migration on `main` was altered, and the only conflict is with the unrelated 2 commits on `feat/stripe-sandbox-invoicing`.
- Regenerate Supabase types from the merged schema.
- Deploy to the dedicated Supabase project (`mgadheotkdnrsatfivjy`) and to Vercel staging.
- Re-run the full check suite on the merged result and fix the one failing e2e test.
- Depends on: M1 (done), M2. Blocked by: Supabase/Vercel access; provider secrets for live paths.

### M4 — Close the genuine gaps

Goal: build only what is actually missing.

- Consent signing, check-in, reporting, and (optionally) a full client portal.
- Anesthesia vendor adapter — blocked on the vendor decision.
- Campaign completion on top of the delivery backbone.
- Depends on: M3. Blocked by: anesthesia vendor, consent instrument (if a specific one is required).

### M5 — Launch rehearsal

Goal: the end-to-end acceptance flow, on staging, with the real merged product.

- household → booking → reminder → SOAP → administer from a lot → charge + certificates → send records/invoice → inbound reply → reconcile payment → next-due.
- Depends on: M3. Blocked by: owner-provided secrets (Resend, Twilio, Stripe sandbox, Auth SMTP, Turnstile, practice details).

## 3. Residual risks (updated after verification)

- ~~One failing e2e test~~ — diagnosed as a test-side race and fixed; the full suite is now 413 passed, 0 failed.
- **108 open PRs** — reconciled: 102 are contained in the tip, and the other 6 carry features the tip already has. Safe to close the contained ones as superseded.
- **Live paths unverified** — nothing was sent, charged, or deployed; no provider secret was used.
- **Blob size** — the build warns the main chunk is 787 kB (230 kB gzip) and `PatientPage` is 543 kB; not a blocker, but noticeable on housecall mobile connections.
- The current branch `feat/stripe-sandbox-invoicing` (standalone Stripe starter) is not in the tip's lineage. `docs/STRIPE-INTEGRATION.md` already says not to commission it as a competing ledger, so it should be dropped rather than merged.
- The migration overlay is clean (fast-forward, nothing altered), so migration ordering is no longer a risk.
- **The fix above is not yet committed anywhere** — it exists only in the verification worktree. It must be landed on a branch before the tip is integrated.
