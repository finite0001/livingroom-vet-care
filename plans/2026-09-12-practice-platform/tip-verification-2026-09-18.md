# Integration tip — verification results, 2026-09-18

> **Update 2026-09-20:** the tip this file verified is now inside `main`. It landed on 2026-09-19 as PR #160, and the whole stack landed as PR #162 (`9bc97b6`, product `024fd13`). The numbers below remain the verification record for that content, and the e2e fix described here is in `main` as `004c4aa`. The "next steps" reading of this file is superseded by [`../2026-09-19-commercial-readiness-map/MAP.md`](../2026-09-19-commercial-readiness-map/MAP.md).

Author: PM. Verified by running the commands below; results are quoted as they came out. No code changed, no commits made, nothing pushed.

## What was verified

- Branch: `origin/codex/communications-restore-acceptance` (the tip of the unmerged stack)
- Commit: `6f03fdd` — `test(backups): run restore metadata regressions in CI`, 2026-09-16 08:20:51 -0700
- Isolated worktree: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-tip-verify` (temp; the repo's working tree was not touched)
- Contents: 132 migrations (116 more than `main`), 146 unit test files, 60 e2e specs, 107 database test files

## Results

| Check | Command | Result |
|---|---|---|
| Install | `npm ci --ignore-scripts` | Pass — 445 packages, 0 vulnerabilities |
| Lint | `npm run lint` | Pass — 0 errors, 1 warning (pre-existing Fast Refresh warning in `src/hub/contexts/AuthContext.tsx`) |
| Typecheck | `npm run typecheck` | Pass — both tsconfigs clean |
| Unit tests | `npm test` | **Pass — 1014 tests, 1014 pass, 0 fail** (5.5s) |
| Build | `npm run build` | Pass (5.15s); existing warning: chunks over 500 kB |
| Migration replay | `supabase start` | Pass — all 132 migrations applied with no error |
| Database tests | `supabase test db` | **Pass — Files=107, Tests=4386, Result: PASS** |
| Browser tests | `npm run test:e2e` | Initially **412 passed, 1 failed** (7.4m); after the test fix below, **413 passed, 0 failed** (5.7m) |

## The one failure — diagnosed and fixed

`e2e/native-dispense-finance.spec.ts:378` — *"sibling invoice invalidation preserves a locked review and requires new evidence"*.

**Symptom.** First run: timeout at line 385, waiting for `getByRole('checkbox')`. Re-run of that test alone (`--grep`, `--retries=0`): failed again, but at a different step — line 298, waiting for the *"Lock reviewed request"* button.

**Cause — a test-side race, not a product bug.**
- The "Review financial evidence" button calls `review()` in `src/hub/features/prescriptions/NativeDispenseFinance.tsx`, which awaits `api.preview(intent)` — the `preview_native_dispense_finance` RPC (`dispense-finance-api.ts:646`).
- When that preview resolves, the component runs `setPreview(p); setStale(false); setAttest(false)` (line 200) — it deliberately **clears the attestation** because the reviewer must re-attest to new evidence.
- The test ticked the attestation checkbox *immediately* after clicking, before the preview settled. The tick was then wiped by `setAttest(false)`, so the "Lock reviewed request" button (disabled unless `attest` is true) never enabled, and the click timed out.
- Which line timed out depended on timing: sometimes the checkbox was not rendered yet (its block requires `preview` to be non-null), sometimes it rendered and was then reset.
- The product behaviour is correct: a user cannot tick the box before the preview appears, and the lock button is also disabled while `busy`. No product change was made.

**Fix (test-only).** In `e2e/native-dispense-finance.spec.ts`:
- Added a `reviewAndLock(page)` helper that waits for the `preview_native_dispense_finance` response, waits for the attestation checkbox to be visible, then retries ticking it until the "Lock reviewed request" button is really enabled, and only then clicks it.
- `review(page)` and the failing test now call that helper instead of the raw click→check→click sequence.

**Evidence.**
- Before: 0 of 2 runs passed (two failures at different steps).
- After: targeted test repeated 5× — **5 passed**; the whole `native-dispense-finance.spec.ts` file — **8 passed**.
- Full-suite re-run result is recorded below.

**Observation, not changed.** While a new preview is in flight, the previous preview's attestation block is still shown and its checkbox is still clickable (it sits outside the disabled fieldset). A tick made in that window is silently cleared when the new preview lands. This is defensible — re-attestation to new evidence is the safer behaviour — but it is a sharp edge worth a deliberate decision later.

### Full-suite re-run after the fix

`npm run test:e2e` → **413 passed, 0 failed (5.7m)**. The whole browser suite is green, and the tip now has no known failing test.

### Where the fix lives

- Branch: `fix/native-dispense-finance-e2e-race`, created from the tip `6f03fdd`.
- Commit: `d7efd352a6eb00064128b1422c33015244c60829` — `test(e2e): remove dispense-finance attestation race` (1 file, +21/−6).
- Only `e2e/native-dispense-finance.spec.ts` is in the commit. The repository's checked-out branch (`feat/stripe-sandbox-invoicing`) and its working tree were not touched.

### Side effect found while verifying

Running `npm run test:e2e` **rewrites six tracked evidence images** in `docs/evidence/` (`migration-history-desktop-20260914.png`, `migration-history-mobile-…`, `migration-prescription-…`, `migration-vaccination-…`, desktop and mobile each). They showed as modified after the suite ran; they were restored with `git checkout -- docs/evidence/` before committing, so they are not in the fix commit.

This means any full e2e run leaves those committed screenshots dirty in the working tree. It is a repository-hygiene issue, not a product defect, and should be decided deliberately (regenerate and commit them, or stop tracking them, or make the tests write elsewhere).

## Integration findings (these change the plan)

- **`main` is an ancestor of the tip.** `git merge-base --is-ancestor main HEAD` is true; 0 commits exist in `main` that are not in the tip, and 620 commits exist in the tip that are not in `main`. Merging the tip into `main` would therefore be a **fast-forward**, not a conflict resolution.
- **No migration on `main` was altered or removed.** `git diff --name-status main..HEAD -- supabase/migrations/` shows additions only; every migration `main` has is present on the tip. The tip adds 116 migrations.
- The checked-out branch `feat/stripe-sandbox-invoicing` (2 commits: a standalone Stripe starter) is **not** in the tip's lineage.

## PR stack reconciliation (M2)

All 108 open PRs were classified against the tip by ancestry (`git merge-base --is-ancestor <pr-branch> <tip>`).

| Class | Count |
|---|---|
| **Contained in the tip** (already superseded) | **102** |
| Not contained (different commit line) | 6 |

The 6 not contained: `#12 codex/brand-direction`, `#79 codex/payment-delivery-acceptance`, `#121 codex/prescription-release`, `#122 codex/ezyvet-prescription-releases`, `#126 codex/ezyvet-attachment-import`, `#130 codex/api-original-release`.

They forked from the tip's line on 2026-09-13 (`74d0c0c`). Checking each one's content against the tip:

- **Housecall day routes** (`housecall-day-routes`, merged in by #130) — tip already has `src/hub/features/scheduling/HousecallDayRoute.tsx` and `housecall-route.ts`, and its route tests pass.
- **Record-release originals and previews** (#130, #131, #132) — tip already has `src/hub/features/record-releases/ApiOriginalPreviewDownloads.tsx`, `RecordReleaseArtifact.tsx`, `PatientRecordReleases.tsx`.
- **ezyVet attachment import** (#126) — tip has 19 migrations referencing `ezyvet_attachment_*` tables.
- **Prescription releases** (#121, #122) — tip has `20260913630000_record_release_prescription_history.sql` and `src/hub/features/prescriptions`.
- **Payment delivery** (#79) — tip has the `payment_delivery_*` tables.
- **Brand** (#12) — tip has the integrated brand (`src/components/Logo.tsx`, `public/brand/living-room-medical-mark-v1.png`, `docs/brand/*`); `brand-direction` holds only the earlier design-development docs.

**Conclusion:** every feature carried by those 6 branches already exists on the tip in another form. **The tip is a usable integration target for the whole A-list**, and the 102 contained PRs can be closed as superseded.

## Not verified

- Any live provider path: no Resend, Twilio, Stripe, or SMTP secret was used; nothing was sent or charged.
- Real payments, real clients, real clinical data — none touched.
- The hosted Supabase project and Vercel were not deployed to.
- CI on GitHub was not run; only local commands were run.

## Environment side effects

- Docker Desktop was started by me (it was not running) and is still running. `supabase stop` was run afterwards.
- The worktree above was left in the temp directory; remove it with `git worktree remove <path>` when no longer needed.
