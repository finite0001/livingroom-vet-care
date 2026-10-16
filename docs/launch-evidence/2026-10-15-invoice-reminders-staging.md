# Unpaid invoice reminders — staging acceptance

PR [#260](https://github.com/finite0001/livingroom-vet-care/pull/260) installs generated migration `20261015235157_unpaid_invoice_reminders.sql` on staging `kothoqicubowyhwfsrte`. Initial staged acceptance below used 190 canonical migrations; the additive lock-order correction brought staging to 191. Frontend merge and business commissioning are not established by this receipt. [Primary backend installation](2026-10-15-invoice-reminders-primary.md) is recorded separately.

## Verified installation

- The CLI dry run selected only migration 190. The push completed without seeds, role changes or other migrations.
- Immediately after DDL and before permanent staged Auth fixtures, all 16 protected business-table fingerprints matched their preflight values. The two renamed predecessor function definitions matched their prior SHA-256 values after normalizing only the renamed function header. The old helpers remain inaccessible to application roles; the public worker wrapper retains service-only execution.
- The separately scoped rollback-only probe passed 53 assertions. It reused staging's existing sandbox payment profile inside the transaction, did not replace that profile and leased only four new fixture invoices. Its live-profile guard rejects production payment configuration. No provider request occurred.
- Security advisors reported the same five notices before and after migration: one INFO, four WARN and zero ERROR; no new WARN/ERROR keys.
- `queue-invoice-reminders` is deployed ACTIVE version 1 with its local import map and `verify_jwt=false`; the handler performs its own service-key authentication. Hosted bundle SHA-256: `e792d5fd2823371bd08d8ef7370dfa0ba9dff44b4fb48a34fe7e2dfe28a402f8`.
- Real deployed HTTP checks: anonymous POST 401, invalid explicit API key 401, authorized disabled POST 200 (`disabled=true`, `queued=0`, `dispatched=false`) and GET 405. The modern server key was used only in process; no credential is in this receipt.

## Real staged Auth and UI

Two owned synthetic Auth accounts exercised ADMIN and STAFF behavior against the actual staging API. The harness recorded 18 combined checks and six browser checks, including private-table denial, actor mismatch, repeat-save receipts, ADMIN-only policy approval, invoice pause/save/reload and mobile layout. The browser used a locally served copy of the proposed frontend with actual staging responses. This is not a claim that the production frontend already includes the panel.

The synthetic invoice was left voided and its product inactive. Both synthetic accounts were signed out, banned and made inactive; their refresh tokens and sessions were retired. Clearly synthetic immutable policy, invoice, terms, household and audit history remain. Therefore the earlier 16-table equality proof describes DDL-only acceptance, not the state after these intentional staged fixtures.

Final verification found zero reminder jobs, zero queue runs, zero outbox rows, zero enrolled current terms, zero synthetic sessions and zero active synthetic profiles. The latest staged practice policy is disabled. The cron is inactive and the Edge Function enablement gate is closed. Staging's existing singleton sandbox payment profile remains present. No provider messages were requested.

## Additive correction acceptance

The second CLI dry run selected only `20261016004714_invoice_reminder_care_gate_order.sql`, which was applied without changing migration 190. All 16 protected business-table fingerprints and all five reminder-family fingerprints matched the immediately preceding 190 state. The installed helper was read back: READ COMMITTED validation, existing care-eligibility gate, then reminder advisory gate; invoker rights, pinned search path and owner-only execute remain intact. The existing four security WARN keys remain unchanged. The previously deployed worker code is unchanged; policy, cron and worker gates remain closed. The local 191 proof passed 57 reminder SQL assertions and actual worker care-gate/invoice contention. This is not a claim that the earlier staged 53-check probe or 18-check Auth harness was rerun after correction.

[Local source-bound proof](2026-10-15-invoice-reminders-local.md) · [Release checklist](../../plans/2026-10-15-invoice-reminders/acceptance.md)
