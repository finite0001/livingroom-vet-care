# Invoice reminder setup before the first invoice

PR260 is approved, merged as `70df10e4da98e16066f5080c845b3c284c675768`, and production READY on thelivingroom.vet (`dpl_AXQMBNE8q6AyTcQPBKfm6mRVsWiv`). This follow-up makes its existing versioned practice policy available in Settings without manufacturing an issued invoice. Frontend release and actual business activation of this follow-up remain pending.

[Machine rollout receipt](2026-10-16-invoice-reminder-practice-settings.json) · [Exact local proof](2026-10-16-invoice-reminder-practice-settings-local.json) · [Plan](../../plans/2026-10-16-invoice-reminder-settings/plan.md) · [Staff instructions](../features/unpaid-invoice-reminders.md)

## Implementation and verification

Settings and the issued-invoice panel share one policy form/schema and the existing immutable save/recover API. The new read API requires a matched current ADMIN and live Auth session. It exposes no raw table access. One Settings navigation guard combines reminder and existing return-policy drafts; explicit textarea labeling preserves the existing field's accessible name when its value changes. Existing return-policy authorization and clinical review are unchanged.

- Application: 1,481 tests, type checks and build passed; zero lint errors and four existing refresh warnings. The existing mocked return-policy Settings browser test also passed; it is separate from genuine backend evidence.
- Canonical SQL: 156 suites /6,605 assertions, including 65 focused reminder assertions. The separately scoped rollback probe passed53 checks and cannot claim existing outbox work.
- Fresh owned Auth/PostgREST/UI/restore: **57 combined assertions**, **24 browser checks** (13 practice Settings +11 existing invoice checks), two actually observed worker waits and all209 source-input hashes verified. The 57 include SQL-only isolation/restore assertions and are not57 independent genuine HTTP requests.
- The practice workflow starts with an empty invoice ledger. An actual committed save response is deliberately dropped; recovery confirms the same UUID without submitting a second write. A real competing ADMIN policy write rejects the stale UI draft, which remains visible until explicit reload. Both the new reminder draft and existing return-policy draft block navigation. The latter is edited/discarded only; no clinical policy is saved. Its temporary DVM role exists only in the owned local fixture and is retired afterward.
- Populated restore preserves396 relation fingerprints and all five reminder families. Restored authenticated SQL reads both paused invoice terms and the expected practice policy identity through the new API. This is not a new physical Storage-object backup claim.
- Every owned local runtime, clone, container, volume and private working directory was removed; synthetic Auth sessions retired. No email/SMS/payment provider request occurred.

## Hosted installation

Staging and primary both have192 canonical migrations, latest `20261016020711_invoice_reminder_practice_settings.sql`. Each CLI dry run selected only this generated migration, no seeds and no roles. No Edge Function code or environment value was changed by this package.

The reader body SHA-256 is identical locally and on both backends: `45da064b9e3c2089239b8b9e78dc5668b994ff82de57b63818c9c082f50117e3`. It is stable, postgres-owned, SECURITY DEFINER with pinned public search path, and executable only by postgres/authenticated; the function body checks actual ADMIN/session authority. Anonymous and service-role callers are denied.

Staging passed nine genuine Auth/API assertions using two explicitly owned synthetic accounts. Current ADMIN read succeeds without an invoice. Anonymous, service, ordinary staff, mismatched-actor and retired-account requests fail; raw policy SELECT is denied. No policy or invoice was created. Both accounts are banned/inactive with no roles or sessions. All16 original business fingerprints match the preflight after excluding only those two new owned profile rows; all five reminder-family fingerprints match exactly. Do not describe the entire staged profiles table as byte-identical after these deliberate fixtures.

Primary's16 business-table and five reminder-family fingerprints match the refreshed preflight without exclusions. No production fixture or policy was created. Advisors on both projects have the same WARN/ERROR keys as their preflights; direct ACL and actual role checks establish the new endpoint's access boundary. Existing intentionally private tables remain private.

## Activation boundary

Primary still has no practice policy or invoice enrollment. Cron remains inactive and the invoice-worker gate absent. Read-only comparison of configuration metadata digests confirmed primary `APP_ENV=staging` and `OUTBOUND_DELIVERY_MODE=test`; staging delivery is disabled. These are preserved existing settings, not a claim of live email commissioning. No customer reminder was sent.

After the frontend release, use an actual current ADMIN session to save the owner-approved due-on-receipt/7/14/30 wording and policy. Verify and commission only the new worker/cron within the existing delivery constraints; do not switch unrelated clinical, financing or email/SMS gates. Existing invoices require explicit enrollment. Affirm remains installed per Dave's confirmation. Private VetRec/VetRocket workflow access is still outstanding.
