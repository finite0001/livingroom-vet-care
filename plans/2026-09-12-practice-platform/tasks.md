# Detailed task breakdown (REVISED)

> ## SUPERSEDED from M3 onward — 2026-09-20
>
> **The live work order is [`../2026-09-19-commercial-readiness-map/MAP.md`](../2026-09-19-commercial-readiness-map/MAP.md).**
>
> M1 and M2 of this file were done and are still valid. **M3 is already finished, by work this file did not plan:** the stack landed in `main` on 2026-09-19 as merge commit `9bc97b6` (PR #162), product commit `024fd13`. `origin/main` is now `3f9e2c1` with 133 migrations. Nothing in M3 needs doing, and no merge was ever performed by this plan.
>
> What remains of M4 and M5 is covered far more completely by the map's tracks A–F and its owner checklist. Read that document, not this one, before starting any work.
>
> Why this file was wrong: it read the local `main` (`56f8315`, 683 commits stale) instead of `origin/main`. Details and evidence: [t04-correction-2026-09-20.md](t04-correction-2026-09-20.md).

Date: 2026-09-18. Author: PM. Supersedes the earlier version of this file, which assumed a greenfield build (T-01–T-28). Complements `a-list-verification-and-milestones.md`. Planning only — no code changed, no commits made.

The A-list is largely built on an unmerged stack whose tip is `origin/codex/communications-restore-acceptance` (620 commits ahead of `main`, 118 migrations, ~200 tables, 304 test files). The work is **verify → reconcile → integrate → close gaps → rehearse**.

Shape: every task is **solo**. Paired shape requires an architect, which the `crew` preset provides and this session does not.

Commands: unit `npm test`; database `supabase test db`; e2e `npm run test:e2e`; full `npm run check`; edge functions `deno test`.

## M1 — Verify the integration tip

Goal: establish whether the stack tip is actually green before anyone depends on it.

### T-01 — Worktree and static checks on the tip — DONE 2026-09-18

Run in an isolated worktree at commit `6f03fdd`. Results in [tip-verification-2026-09-18.md](tip-verification-2026-09-18.md).

- `npm ci --ignore-scripts`: pass (445 packages, 0 vulnerabilities).
- `npm run lint`: pass (0 errors, 1 pre-existing warning).
- `npm run typecheck`: pass.
- `npm run build`: pass (existing large-chunk warning).

### T-02 — Test suites on the tip — DONE 2026-09-18

- `npm test`: **1014 tests, 1014 pass, 0 fail**.
- `supabase start`: all 132 migrations applied cleanly.
- `supabase test db`: **107 files, 4386 tests, PASS**.
- `npm run test:e2e`: initially **412 passed, 1 failed** — `e2e/native-dispense-finance.spec.ts:378`, reproduced on re-run at a different step. **Fixed the same day** (test-side race: the attestation tick was made before the async preview settled and was cleared by `setAttest(false)`). After the fix: **413 passed, 0 failed**. Details in [tip-verification-2026-09-18.md](tip-verification-2026-09-18.md).
- Integration bonus: `main` is an ancestor of the tip, so merging is a **fast-forward**.

## M2 — Reconcile the 161-PR stack

Goal: turn 108 open PRs into one known integration path.

### T-03 — Classify every open PR — DONE 2026-09-18

Classified all 108 open PRs by ancestry against the tip: **102 contained, 6 not contained**.

The 6 (`brand-direction`, `payment-delivery-acceptance`, `prescription-release`, `ezyvet-prescription-releases`, `ezyvet-attachment-import`, `api-original-release`) forked on 2026-09-13, and each one's feature already exists on the tip in another form (verified: housecall day routes, record-release originals/previews, ezyVet attachment tables, prescription release history, payment_delivery tables, brand assets). Details in [tip-verification-2026-09-18.md](tip-verification-2026-09-18.md).

**Verdict: the tip is a usable integration target for the whole A-list; the 102 contained PRs can be closed as superseded.**

### T-04 — Merge strategy decision — DONE 2026-09-19

- **Work:** decide and write down how the stack reaches `main`: merge the tip as one integration, or replay PR-by-PR.
- **DoD:**
  - A written decision with the reason, the migration-ordering approach, and the rollback plan.
  - Check: the decision names the exact branch that will be merged and the migrations it brings.
- **Depends on:** T-03.
- **Decision made:** one integration merge of `origin/codex/communications-restore-acceptance` at `6f03fdd` into `main`, with `--no-ff`.
- **VOID — corrected 2026-09-20.** The decision was made against a stale local `main` (`56f8315`). `origin/main` already contained the tip (PR #160) and the product (PR #162). No merge is needed and none was performed. Corrected record: [t04-correction-2026-09-20.md](t04-correction-2026-09-20.md).

## M3 — Integrate into `main` and staging — ALREADY DONE BY OTHERS (2026-09-19)

Goal: the product is in `main` and running in staging.

**Status 2026-09-20:** `main` is the product (`3f9e2c1`, 133 migrations, protected). Staging and the primary project are still behind at 119 and 113 migration receipts; bringing them up is **MAP.md §3 item 0.8**, through `docs/hosted-upgrade-preflight.md`.

### T-05 — Merge and reconcile migrations — DONE 2026-09-19 by PR #162

- **Work:** merge the chosen tip into `main`; confirm the migration overlay; regenerate Supabase types.
- **Correction (2026-09-19):** the earlier note here said `20260912210000_clinical_core.sql` "exists on both with different content". **That was wrong.** It exists on both sides and is byte-identical (`git rev-parse` gives `3790d62e` on both). The overlay is 116 additions, 0 modifications, 0 deletions. Evidence: [t04-correction-2026-09-20.md](t04-correction-2026-09-20.md).
- **Done by:** PR #162 as merge commit `9bc97b6`, product `024fd13`, on `main`. `main` carries 133 migrations, one more than the old tip (`20260916144117_native_estimate_decisions.sql`).

### T-06 — Stage deployment — SUPERSEDED

- **Work:** deploy the merged result to the dedicated Supabase project and to Vercel staging; confirm deep links and disabled outbound delivery in previews.
- **DoD:**
  - Staging loads, login works, and no preview can send to a real client.
  - Check: a manual smoke pass on the staging URL, recorded.
- **Superseded by:** MAP.md §3 item 0.8, which carries the current hosted numbers and the preflight to follow. Staging work already landed on `main` in the meantime (`docs(staging): …` commits).

### T-07 — Full check on the merged result

- **Work:** run the complete suite on the merged `main` result.
- **DoD:**
  - `npm run check` and the browser/database suites report real numbers.
  - Check: the numbers are recorded, not remembered.
- **Status 2026-09-20 — static and unit checks re-run on `main` (`3f9e2c1`) by this session:**
  - `npm ci --ignore-scripts`: pass, 0 vulnerabilities.
  - `npm run check` (lint + typecheck + unit + build): **exit 0**.
  - `npm test`: **1069 tests, 1069 pass, 0 fail** (5.0s).
  - `npm run lint`: 0 errors, 1 pre-existing warning (`src/hub/contexts/AuthContext.tsx:147`, Fast Refresh).
  - `npm run build`: pass (4.67s); the usual large-chunk warning (`App` 731 kB, `PatientPage` 542 kB).
  - Still **not** re-run here: `supabase test db` (needs Docker) and `npm run test:e2e`. Their last numbers on this content, from 2026-09-18, are 4386 database tests in 107 files and 413 browser tests, all passing.

## M4 — Close the genuine gaps

Only the parts the tip does not have. Detail is written when M3 lands.

- **T-08 Consent signing** — no `consent_*` tables or UI on the tip; the pre-existing `consent_submissions` / `consent_form_templates` on `main` are unused. Blocked by: consent instrument decision.
- **T-09 Check-in** — no check-in tables or modules found on the tip.
- **T-10 Reporting** — no report feature found on the tip (only `lab_report_*`).
- **T-11 Client portal** — not built by design; the tip uses controlled expiring `document_link_*` and payment links instead. Decide whether the link approach is sufficient for launch.
- **T-12 Anesthesia vendor adapter** — records exist; the vendor adapter does not. Blocked by: vendor decision.
- **T-13 Campaign completion** — campaign tables exist on `main` only; wire them to the tip's delivery backbone.

## M5 — Launch rehearsal

### T-14 — End-to-end acceptance on staging

- **Work:** one pass of the full flow on staging with the merged product: household → booking → reminder → SOAP → administer from a lot → charge + certificates → send records/invoice → inbound reply → reconcile payment → next-due.
- **DoD:**
  - The whole flow completes with no duplicate charge, stock movement or message.
  - Check: the run is recorded step by step with the real outputs.
- **Depends on:** M3. **Blocked by:** owner-provided secrets (Resend, Twilio, Stripe sandbox, Auth SMTP, Turnstile, practice details).

No code was changed and nothing was committed to produce this document.
