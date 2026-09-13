# Payment history trigger hardening — September 13, 2026

Based on implementation stack `1f515ea`, migration `20260913900000_payment_immutable_search_path.sql` fixes the search path of `public.payment_immutable()` to `pg_catalog`. The trigger only raises the append-only exception. ALTER FUNCTION preserves its body, owner, execution grants and bindings; it remains SECURITY INVOKER.

## Verification and deployment

- Read-only inspection of owner-selected project `mgadheotkdnrsatfivjy` confirmed the missing function configuration before the change.
- The existing payment ledger suite passed all 64 assertions with this migration applied inside a local rollback-only transaction. This covers payment/refund ledger behavior and immutable financial history; no local fixture was committed.
- Applied only this additive migration to `mgadheotkdnrsatfivjy`. No intervening application migrations were deployed. The MCP receipt `20260913193228` was reconciled to repository version `20260913900000` using exact name/version guards.
- Hosted verification confirms `search_path=pg_catalog`, SECURITY INVOKER, the original append-only exception and 14 trigger bindings.
- No client data, provider settings, payment activation, frontend or DNS was changed.

The separate staging project has not received this migration in this task. This narrowly resolves the observed mutable-search-path configuration; it does not establish overall security or commercial readiness. Hosted staff/provider acceptance, deployment parity, clinical review, mail and domain commissioning remain required.
