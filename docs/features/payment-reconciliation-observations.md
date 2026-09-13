# Payment reconciliation observations

Migration `20260913330000` records unusable provider responses separately from payment or refund evidence. A malformed response does not justify inventing a provider refund ID, amount, status, or payment association.

The service-only RPC `record_payment_reconciliation(p_family text, p_request_id uuid, p_reason text)` returns an immutable observation row. Families are `checkout` and `refund`; reasons are `provider_context_mismatch`, `provider_object_unavailable`, and `provider_reconciliation_required`. The RPC validates the existing request, derives its invoice, locks that invoice, and returns the same row for an exact retry. It accepts no arbitrary provider text, URL, credentials, or customer data.

Active staff can read observations through RLS and the `reconciliation_observations` array returned by `read_invoice_payment_state`. Checkout and refund state show `reconciliation` while an observation exists, including when subsequent authoritative settlement arrives. Settlement evidence remains recordable and the cash ledger remains intact. New checkout/refund inserts, credits, and voids lock the same invoice and reject unresolved observations; exact retries can recover existing immutable intents.

Terminal failure checks consult immutable accepted failure evidence independently of the displayed state. A late success after a failed refund released capacity is quarantined unless that request already has a settled refund. Pending reservations exclude requests already present in the settled refund ledger, so review observations cannot double-count refunded cash as pending. Regression tests cover both observations and quarantined evidence hiding failure, replacement reservations, and observations after successful settlement.

This increment deliberately has no resolution RPC or automatic clearing. Operational review and a separately verified resolution workflow are still required before affected financial actions can resume. Do not commission collection broadly without that operational workflow.

## Local evidence

Applied to the existing local foundation database without reset or hosted changes. Actual PostgreSQL rollback tests passed:

- `supabase/tests/payment_reconciliation_observations.test.sql`: 58 assertions covering permissions, request validation, deduplication, frozen history, state, safe summaries, reservation/cash behavior, mutation guards, recovery and later authoritative settlement.
- `supabase/tests/payment_ledger.test.sql`: 64 existing assertions passed against the updated schema.

Fixtures are synthetic and rolled back. These checks do not demonstrate Stripe provider acceptance or production commissioning.
