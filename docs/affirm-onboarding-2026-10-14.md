# Affirm onboarding — October 14, 2026

## Decision and observed status

Owner selected Affirm as the single financing provider for The Living Room Vet.
The live account recorded during September setup is `acct_1UKA9RCamD04yVzW`, login
`admin@thelivingroom.vet`. After owner sign-in, the live Dashboard confirmed Affirm already Enabled on the
Standard package (6% + $0.30), with USD $35–$30,000 availability for U.S. customers.
Default configuration: `pmc_1UKAA6CamD04yVzWfyc8Z67Q`. Klarna was disabled both
directly and inside Link to implement the single-financing-provider decision.
Sunbit, Afterpay, Scalapay and Zip were already disabled. Other payment methods
were left unchanged. Payout readiness and production app commissioning remain
unverified; do not infer them from an Enabled payment-method label.

Ondara's separate account `acct_1SORr5Pfxkgt60Gg` already shows Affirm Enabled in
its default payment-method configuration. This observation is not an end-to-end
checkout test or confirmation of underwriting for every aftercare service.
Do not reuse Ondara's account or credentials for Living Room Vet.

## Before deploying this checkout change

1. Sign into the Living Room Vet live account and verify the account name and ID.
   Complete outstanding business/representative verification and payout setup.
2. Review Settings → Payments → Payment methods → Affirm. Complete any approval
   prompts; review actual Standard pricing and applicable terms. Confirm the
   veterinary business classification, public USD pricing and refund policies.
3. Review the entire default payment-method configuration. This change follows
   that configuration, not just Affirm: retain intended card/wallet methods and
   Affirm, and disable other financing or uncommissioned delayed methods before
   deployment. Repeat separately in the existing LRV sandbox.
4. Reconcile any pre-deployment checkout creation attempts with uncertain outcomes.
   Removing the card-only parameter changes the request body; never retry an old
   idempotency key with changed parameters. Retrieve existing sessions and resolve
   uncertain requests before switching the deployed provider implementation.
5. Run a sandbox invoice checkout with an Affirm-eligible USD amount. Verify the
   successful payment reaches the invoice ledger once, cancellation remains unpaid,
   and full/partial refunds reconcile correctly. Existing mocked tests do not prove
   merchant approval or actual offer availability.
6. Merge through owner review, then deploy the affected Edge Functions using the
   project's release process. A Git commit alone does not deploy Edge Functions.
   Preserve live payment gates until production commissioning is complete. Never
   install a sandbox provider profile in production.

## Sources

- https://docs.affirm.com/platforms/docs/set-up-stripe
- https://docs.stripe.com/payments/affirm
- https://docs.stripe.com/payments/payment-method-configurations
- https://stripe.com/pricing/local-payment-methods

Only the two Klarna settings described above were changed in the live Dashboard.
No live credentials, production app flags or financial transactions were changed.
The local checkout change passes all 48 focused Stripe tests; sandbox end-to-end
acceptance and deployment remain pending.

## Client-facing website information

Prepared `/payment-options` with estimate-first copy, an optional Affirm explanation,
eligibility and interest caveats, lending disclosures link, and practical questions.
The copy reflects current pre-opening status and does not claim checkout is live.
Added discovery links in the global footer, About payment section, and shared service
page layout. No promotional hero, loan calculator, guaranteed approval, advertised
monthly amount, or application form was added.

Before publication, submit the custom copy to Affirm for marketing review (not sent
by the agent). The Adaptive Checkout guide requires review of custom messaging:
https://businesshub.affirm.com/hc/article_attachments/26853907856148
Use the approved disclosures returned by Affirm for this specific program before
publishing. Reference also the Stripe resource hub and healthcare supplement:
https://businesshub.affirm.com/hc/en-us/articles/30660865631892-Stripe-User-Affirm-Resources

After checkout acceptance and opening readiness are confirmed, update the two
pre-opening paragraphs and the checkout FAQ to reflect actual availability.
Do not infer readiness from Affirm being enabled in the Dashboard alone.

Website validation: production build and targeted ESLint passed. Browser visual
verification remains outstanding because computer-use reported no available browsers.
Preview uses placeholder credentials for a local backend only; no production keys
or ignored configuration files were copied or modified.

Final validation: full TypeScript checks, production build, targeted ESLint, and
48 focused Stripe tests passed using this worktree’s locked dependencies.
