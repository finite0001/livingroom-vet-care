# Unpaid invoice reminders

Open a household's **Billing** tab, select an issued invoice and find **Unpaid invoice reminders**. Save its due date, channel and enrollment. The starting business defaults are due on receipt and email at 7, 14 and 30 days overdue. Existing invoices are not enrolled automatically. An administrator reviews practice cadence, contact instructions and exact email/text wording in the same panel.

Choose **Paused**, **Disputed invoice** or **Bereavement** and enter a reason to stop unattempted reminders. Resuming preserves old settings and delivery history. A deceased patient's routine-care suppression is separate from an invoice hold. Text requires current recorded consent. Affirm handles its financing installments; these reminders concern the balance recorded as owed to the clinic.

The system queues only the latest reached reminder stage, rather than sending missed stages together. Current confirmed payments, credits and refunds determine the balance. Paid/voided invoices, pending payment/refund confirmation, unresolved reconciliation, changed contacts and disabled/held settings block stale sends. Every attempt checks eligibility again. A provider's acceptance is distinct from delivery; uncertain results need staff reconciliation before another attempt.

The invoice shows its latest 20 reminder entries; **Daily communications** retains the wider history and labels these as **Unpaid invoice reminder**. Balance snapshots in old entries remain unchanged. Reviewed payment links are prepared separately through the existing invoice payment panel; automatic reminders use the approved payment/contact instructions.

If the panel says automatic scheduling is not commissioned, saving a policy alone does not start messages. Engineering must verify the worker, cron and existing outbound test/live configuration. [Commissioning and rollback](../../plans/2026-10-15-invoice-reminders/acceptance.md). [Local evidence](../launch-evidence/2026-10-15-invoice-reminders-local.md).
