# Provider inputs - October 15 update

Dave confirmed on October 15 that **Affirm is already set up and installed**. Treat the financing-provider decision as resolved; do not ask Susan to choose/enroll again or pursue other financing providers without a new request. Stripe remains the processor. This is the owner's reported installed state, not a newly performed live-payment audit in this task. Preserve installed configuration and existing payment/refund accounting.

Dave also confirmed **due on receipt, email at 7/14/30 days overdue** for unpaid invoices. Current implementation is tracked in [the reminder plan](../2026-10-15-invoice-reminders/plan.md). Existing invoices require explicit due-date/enrollment review. Affirm installment collection is separate from clinic receivables.

After unpaid reminders, use the explicitly requested reverse-engineer-anything skill to inspect authorized VetRec and VetRocket workflows and recreate the required functionality natively. Preserve observations versus inference; actual PACS identity/interface/diagnostic-viewer acceptance remains required.

Vendor/device details still needed where not already available: MWI and Midwest representative catalog samples/approved interface; VetRocket account/interface; anesthesia manufacturer/model/software/feed; supported Gusto internal integration coverage; authorized VetRec/VetSnap reference access. Native work can proceed while actual provider acceptance remains open. Never close actual vendor-round-trip acceptance using mocked responses or manual links.

Clinical/SOP decisions belong to Susan. The outstanding approval worksheet was emailed October 15 with item IDs CL01-CL12, RM/RR/AI/SC/CD/VN and Dave-owned BS decisions. Sending the worksheet is not approval. No new message is sent by this repository change.
