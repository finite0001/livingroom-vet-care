# Implementation and validation receipt — November 14, 2026

This records the candidate implementation, not production activation. The original feature matrix remains the baseline inventory.

| Photo IDs | Implementation | Activation/acceptance gate |
| --- | --- | --- |
| T1–T5, L1–L5 | Existing clock retained; workforce time/leave page, private ledgers, corrections, period review, shifts, attendance, configurable overtime and paused automatic jobs | Assign Dave/Susan; supply approved policies/opening balances; enable configured jobs after reconciliation |
| O1–O3 | Staff-duty rotation, quick tasks integrated with daily tasks, staff board | Configure participants/duties and staff acceptance |
| C1–C4 | Source-versioned deterministic clinical worksheets, saved patient artifacts | DVM protocol approval and clinic acceptance |
| C5 | Existing interactive dental chart retained | Six local dental browser regressions passed; release workflow remains existing behavior |
| C6–C8 | Source-cited discharge/bloodwork drafts, DVM approval, exact-imprint verified-catalog pill assistance | Provider/model configuration and clinical evaluation; verified pill catalog required; no image guessing |
| W1–W3 | Frozen payroll CSV, effective-dated rates/raises, approved bonuses | Payroll policies/provider export reconciliation and explicit private-pay access |
| W4 | Versioned benefit form assignments and private immutable PDFs | Supply current provider-approved SIMPLE IRA forms |
| W5 | Anonymous response storage with separate eligibility and thresholded closed-cycle results | Minimum three responses; small-team/infrastructure anonymity limits disclosed |
| W6 | Encrypted database + Storage export, NAS/Drive destinations, receipts, installed inactive local schedule | Three Keychain credentials, populated restore drill, remote NAS verification and activation remain |
| E1–E4 | Opt-in birthdays/anniversaries, dismiss/snooze, party RSVP, capacity/waitlist events | Staff preferences and event setup |

## Local validation

- `npm run check`: passed lint, TypeScript, **2,819 tests** and production build. Existing lint/chunk warnings remain.
- Staff/dental Playwright checks: **13 passed** across the original combined run, plus **one passed** unconfirmed-save retry test added afterward.
- Disposable PostgreSQL workforce verification passed: permissions, leave privacy, concurrent approvals/RSVPs, accrual reruns, frozen payroll, storage boundaries, peer aggregation, clinical boundaries and durable mutation retries.
- Backup authenticated-encryption tests and frozen clinical-helper Deno check passed.
- Full owned 219-migration rehearsal, profile `ordinary_none`: **passed**, exact ledgers 208–219 verified, protected controlled-drug properties/rows/sequences preserved, automatic workforce job paused, actual application Auth verified and owned cleanup completed.
- That rehearsal made **zero hosted writes**, **zero provider requests** and did not deploy production. Other medication runtime profiles remain separate CI gates; this receipt does not claim those profiles were exercised locally.
- Synthetic Google Drive encrypted upload/download/decrypt transport passed; the temporary synthetic cloud file was trashed. No production data was exported.

## Release boundaries

Five additive migrations and the clinical-helper Edge Function must be deployed through the verified LRV rollout. A Git commit does not deploy backend functions. Clinical artifacts appear in the patient medical workspace; the existing record-release package builder has not been extended for them. Full hosted restore acceptance is outstanding.

See [the rollout runbook](../../docs/staff-feature-rollout-2026-11.md) for migration order, configuration, backup recovery and remaining inputs. PR merge requires Dave’s explicit approval.
