# T-04 — corrected on 2026-09-20: the integration already happened

Author: PM. This is the corrected record for **T-04** in [tasks.md](tasks.md). It replaces `merge-strategy-decision.md` (written 2026-09-19), which is void.

## What went wrong

The 2026-09-19 decision said `main` should receive the unmerged product stack in one integration merge. It named `main` as `56f8315` and called the merge a fast-forward.

**That decision was void when it was written.** It was made from a stale local `main`. The real target, `origin/main`, had already moved on and already contained the stack:

| | |
|---|---|
| Local `main` when the decision was written | `56f8315` — 683 commits behind the remote, stale |
| Real `origin/main` | `3f9e2c1` (2026-09-19) |

Evidence, re-run on 2026-09-20:

```
git fetch origin --prune
git merge-base --is-ancestor origin/codex/communications-restore-acceptance origin/main   -> exit 0 (contained)
git log --oneline origin/main | grep communications-restore-acceptance                    -> cd747c4, PR #160
git merge-base --is-ancestor 024fd13 origin/main                                          -> exit 0 (contained)
```

**No merge is needed, and this plan never performed one.** The mistake was reading `main` instead of `origin/main` while working from a branch that had not been fetched for two days. The repository's current work order opens with a precondition check for exactly this; it is repeated here because it cost this plan a day.

## What is true now (verified 2026-09-20)

- **`main` is the product.** `origin/main` = `3f9e2c1`, protected, 133 migrations, ~200 tables, 44 edge-function directories.
- The stack landed on **2026-09-19** as merge commit `9bc97b6` (PR #162 from `integration/2026-09`, product commit `024fd13`), with #156–#163 around it.
- The one failing browser test this plan diagnosed is fixed **in `main`**, cherry-picked as `004c4aa test(e2e): remove dispense-finance attestation race`. The local branch `fix/native-dispense-finance-e2e-race` (`d7efd35`) is therefore redundant.
- The one migration `main` has that the old tip did not: `20260916144117_native_estimate_decisions.sql`.
- 104 of the old stacked pull requests were closed as landed on 2026-09-19.

## What survives from the old version

The parts that were **measured**, not decided, are still true for the content that is now inside `main`, and they remain the verification record for that content:

- The overlay is additions only: 116 migrations added, **0 modified, 0 deleted**, and `20260912210000_clinical_core.sql` is byte-identical on both sides (blob `3790d62e`). **This corrects the earlier note in T-05**, which claimed it existed on both sides with different content.
- Tip content verified on 2026-09-18: 1014 unit tests, 4386 database tests in 107 files, 413 browser tests, all passing.

The long merge plan and its 116-migration appendix were dropped with this rewrite: the merge they describe will never happen, and those migrations are now part of `main`'s history, where git holds them.

## The live work order is no longer this plan

The current plan for the product is **`plans/2026-09-19-commercial-readiness-map/MAP.md`** — written after the integration landed, with the tracks, the tiers, the owner checklist and the execution order. This document does not compete with it.

Under that map the first task is **A1**: `handle_new_user()` gives every new auth user an active STAFF account. **Verified independently on 2026-09-20**, not taken from the map:

- `supabase/migrations/20260308184039_*.sql:52` — `is_active BOOLEAN DEFAULT TRUE NOT NULL`;
- `supabase/migrations/20260613223600_*.sql:20-41` — `handle_new_user()` inserts a `profiles` row **without** setting `is_active`, and inserts a `user_roles` row with `'STAFF'`;
- `supabase/migrations/20260613183224_*.sql:3-16` — `is_active_staff()` requires exactly `p.is_active = true` plus a `user_roles` row, so the column default makes the new account pass.

## Not verified here

- GitHub CI was not read in this session. The map records run `35459935180` as green on `024fd13`; that is the map's claim, not this session's measurement.
- No hosted environment, provider, or secret was touched.
