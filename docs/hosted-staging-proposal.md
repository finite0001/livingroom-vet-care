# Separate hosted staging — awaiting cost approval

Proposed project: `livingroom-vet-staging`, US West, in the same owner-selected Camp Sequoia Lake organization as the dedicated future production project. This is a second database/Auth/Storage environment, not a rename or reset of `mgadheotkdnrsatfivjy`.

The connected Supabase cost tool returned `{type: "project", recurrence: "monthly", amount: 10}` for organization `bzohhpylbpjkopbmrzmh`. The owner has been asked to approve this **additional $10/month**. Approval for the existing production-designated project does not authorize this second charge. No staging project has been created and no cost-confirmation/provisioning operation has been submitted.

Purpose: deploy the reviewed migration/Edge stack and run real hosted staff, private-file, clinical and provider acceptance using synthetic records. The existing Vercel build guard requires a separately commissioned staging reference for previews; it rejects the production-designated and original Lovable projects in preview builds. This environment would supply that missing reference.

After approval, recheck the quote and create the explicitly named project in the approved organization/region. Apply the exact reviewed migration stack with sends and schedulers disabled, verify hosted auth and private Storage, then configure a protected Vercel preview using only its publishable browser key. Provider secrets remain server-side and test recipient allowlists must be explicit. Do not copy production enablement or route live callbacks into an unreviewed preview.

Staging creation does not approve clinical forms, authorize messages, configure mailboxes, migrate patient records or permit public cutover. Private mailbox/Auth SMTP, controlled provider acceptance and Dr. Edler's review remain separate requirements. If the owner declines the additional project, continue local verification; do not bypass the preview guard by pointing previews at the future production database.
