# Phase 6 — Financing, unpaid-balance reminders and doctor production

**Status:** Unpaid reminders in PR260 are merged and production READY; automatic sending remains off. Standalone Settings configuration before the first invoice is in implementation; doctor production remains planned. Affirm installed per Dave October 15. **Priority:** high. **Requirements:** N06–N07, N21; H09. **Depends on:** Phase 2 outbox; financing enrollment/interface and compensation attribution rules. [Confirmed decisions](decisions.md).

## 6A — Third-party financing and settlement

- **Resolved October 15:** Dave confirms Affirm is already set up and installed. Stripe remains selected. Do not repeat provider selection or enrollment; preserve installed configuration. The remaining bullets describe accounting/acceptance contracts, not a request to install financing again.
- For a native Stripe choice, extend the existing card-only Checkout creation and audit payment verification, completion/async events, refunds and reconciliation for that method in staging. Do not assume a Dashboard toggle alone updates this app. For a separate provider, begin with approved application/payment links and audited staff reconciliation; automate only under an available vendor contract.
- Keep provider application, credit approval, completed transaction and settled payment separate. Application approval does not mark a clinic invoice paid.
- Native Stripe financing retains the existing Stripe payment/checkout identities and ledger; handle the selected method without creating a second payment. For a separate provider, extend the ledger with explicit external-provider references and audited settlement/reversal evidence. Do not invent Stripe checkout IDs to pass existing constraints. Require idempotent external transaction IDs and invoice allocations, including partial amounts.
- Show financing status beside invoice balance. Handle rejected/abandoned applications, delayed settlement, refunds/reversals and reconciliation conflicts. Store operational references, not loan application or card data.
- CareCredit/Scratch financing installments are administered by those providers; the clinic's reminders concern only amounts still owed to the clinic.

## 6B — Unpaid-invoice reminders

- Owner-confirmed defaults: due on receipt, email at 7/14/30 overdue. Add explicit invoice due date/terms, editable practice cadence, reminder status, dispute/hold and next action. Preserve existing invoices without silently labeling them overdue until terms are reviewed.
- Add a canonical outbox reminder source using current unpaid balance and a supported payment link. Check balance, void/dispute/hold, contact consent and financing settlement at final send eligibility, not just initial scheduling.
- Stop when paid/voided/held; partial payments update the amount. Reminder retries are idempotent and visible in Daily communications. Staff can pause with a reason; bereavement handling is separate from routine deceased-patient care suppression.

## 6C — Net-invoiced doctor production

- **Confirmed basis:** net invoiced revenue after discounts and refunds. Add explicit credited DVM and optional split attribution to eligible invoice lines, linked to performed service/treatment where available. Invoice creator or booking assignee is not a reliable substitute.
- Define eligible categories, treatment of tax/pass-through charges, split credit and effective posting date with Dave. Proposed default: production posts when the invoice is issued; exclude sales tax; credit adjustments refer to the original attributed line. These details require policy confirmation.
- Store effective-dated adjustable percentages by doctor. Save the rule version used for each calculation and close/reopen periods through audited steps. Changing today's percentage must not silently rewrite last month's report.
- Define calculation and rounding with worked examples: money in integer cents; rates/splits in fixed precision; split totals exactly 100%; deterministic allocation of residual cents. Store the selected policy and calculation version with the period. A $1 discount/refund must allocate completely rather than disappear through per-line rounding.
- Calculate the eligible line base after allocated discounts and economic reversals. A credit and its cash refund that represent the same reversal reduce production **once**, not twice. Partial refunds allocate to original lines/splits. Late corrections appear as explicit adjustments under the approved closed-period policy.
- Report doctor, date range, eligible gross, discounts, reversals, net production, rate/rule, earned production and unresolved attribution. Provide line-level drilldown and export. Report totals reconcile to the billing ledger before compensation is sent to Gusto.

## Files and schema

| Action | Absolute path | Change |
|---|---|---|
| Modify if native Stripe method selected | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/functions/_shared/stripe-provider.ts` | Replace card-only Checkout selection with the approved financing method/configuration; retain existing Stripe identity and verification contracts |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/payments/InvoicePayments.tsx` | External settlement history |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/payments/PaymentCollectionPanel.tsx` | Financing links/status and clear balance |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/billing/HouseholdInvoices.tsx` | Terms, hold and overdue reminder status |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/production/` | Attribution/rate management and doctor reports |
| Create independently | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_invoice_reminders.sql` | Invoice terms, holds and reminder source; does not wait for provider selection |
| Create only for a separate financing provider | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_external_financing_settlements.sql` | External-provider settlement evidence and invoice allocation without fabricated Stripe IDs |
| Create separately | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_doctor_production.sql` | Attribution, effective rates, period snapshots and adjustments |

## Acceptance

- [ ] Financing approval alone leaves balance unpaid; reconciled settlement reduces the balance once; reversal restores correct state.
- [ ] For native Stripe financing, a paid Checkout completion plus any async completion/failure transitions produce one correct ledger result; redirect return alone cannot mark paid. Duplicate events and refunds reconcile without creating an external-provider duplicate payment.
- [ ] A payment received after reminder enqueue suppresses the stale reminder; partial balance, void/dispute and duplicate callback cases pass.
- [ ] A fixture with two doctors, split service, discount, partial refund, credit/refund pair and rate change reconciles exactly in integer currency units.
- [ ] Historical rates and closed periods remain reproducible; unassigned charges are visible rather than silently credited to their creator.
- [ ] A one-cent residual, multiple split lines, a changed rate and a late refund reproduce the accepted report exactly. An external provider's account/transaction reference is unique in its own namespace; webhook replay and a manual reconciliation of the same payment cannot allocate it twice.
- [ ] External finance activity uses correct roles and auditable evidence; clinic staff cannot modify closed production rules without authority.
- [ ] Extend payment SQL/concurrency/round-trip suites and add production-calculation, allocation and browser drilldown cases. Dave accepts the compensation formula with worked examples before real payroll use.

No customer lending schedule or automatic payroll execution is introduced by these features.

Current implementation and exact rollout gates: [October 15 unpaid invoice reminders](../2026-10-15-invoice-reminders/plan.md). Automatic reminders use approved clinic balance/contact instructions; reviewed payment links remain available through the existing invoice payment-delivery workflow. No lender installment schedule is imported or chased.
