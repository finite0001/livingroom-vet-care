# Decisions required before implementation expands

1. **October service menu:** Which exact services will be offered in housecalls? Any service requiring dental, anesthesia, lab automation, QOL, or a specific certificate promotes that capability to P0.
2. **Backend authority:** Keep the original Lovable backend, or migrate to `mgadheotkdnrsatfivjy`? Who owns approval and credentials for each?
3. **Existing data:** Are the current old-backend rows disposable foundation data, or must they be migrated with Auth and Storage preservation?
4. **Messaging:** Which verified mailbox/domain and Twilio number will be operational? Who owns SMS consent, A2P registration, opt-out policy, and after-hours handling?
5. **Payments:** Stripe account, tax policy, refund/manual-payment policy, and who can issue/void/refund invoices.
6. **External clinical systems:** Confirm ezyVet account/entitlement and whether the first mode is read-only, staged import, or ongoing sync. Identify lab and anesthesia vendors and provide synthetic samples.
7. **Clinical governance:** Name the veterinarian reviewer and practice manager. Approve role permissions, certificate templates, QOL/consent instruments, and record-release policy.
8. **Availability:** Is an offline/no-network workflow required for housecalls? The current plan assumes connection-required operation with explicit save state and a downtime procedure.
9. **Launch date:** If provider accounts, vendor access, or restore evidence are not ready by the pilot decision checkpoint, reduce scope or move the software launch rather than weakening the gates.
10. **Public launch content:** Approve the exact public phone, email, opening hours, emergency referral language, staff names/credentials/licenses, housecall coverage area, travel/parking details, owner-approved social image/logo, payment/refund language, and the service claims that can be advertised before the clinic opens.
