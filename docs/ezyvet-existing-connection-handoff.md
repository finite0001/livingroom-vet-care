# Existing Vet Connect Hub connection handoff

Owner direction, September 13, 2026: use the same ezyVet setup as Vet Connect Hub. The owner reports login credentials and previously confirmed account/API access are available. Do not request credentials in chat.

## Repository evidence

Read-only inspection of `/Users/davidedler/vet-connect-hub` found OAuth client-credentials authentication in `supabase/functions/ezyvet-proxy/index.ts` and `supabase/functions/ezyvet-sync/index.ts`. These functions read API settings from server secrets; ordinary web login credentials are not their authentication mechanism. The owner subsequently confirmed the existing API configuration is production and explicitly authorized copying it to Living Room Vet staging. The exact site identity and API origin must be read from that configuration rather than inferred from repository examples.

| Existing Hub setting | Living Room Vet setting |
| --- | --- |
| EZYVET_API_URL | EZYVET_API_URL; validate against the importer’s allowed API origins |
| EZYVET_PARTNER_ID | EZYVET_PARTNER_ID |
| EZYVET_API_KEY | EZYVET_CLIENT_ID |
| EZYVET_API_SECRET | EZYVET_CLIENT_SECRET |
| No equivalent explicit setting found in inspected authentication code | EZYVET_SITE_UID; confirm the source practice identity |

The Hub config references Supabase project `rgmgluwmhtmoewdzbzxo`. A repeated read-only CLI secret-name listing returned access forbidden for this source project. The standard local environment files and current process contain no ezyVet credentials. No secret values were displayed or copied and no source API requests were made. Existing Hub files were not modified.

## Next configuration step

Use authorized provider/project administration to identify the existing API origin and source practice and provision equivalent credentials securely into the new staging project. Do not assume the source is trial because the destination is staging. Preserve Living Room Vet’s explicit production-source opt-in and resource allowlist; do not copy the Hub’s broad requested scopes blindly. A successful connection and reviewed sample import are still required before claiming integration acceptance.

## Authorized transfer, blocked on source access

Copying the production API configuration into Living Room Vet staging is authorized. Map the existing credential names above, validate the production origin and source identity, and retain read-only import behavior. Do not rotate or modify the source credentials. The current Supabase connection needs access to `rgmgluwmhtmoewdzbzxo`, or the owner can enter the existing API values directly in the destination project’s Edge Function secret store. No credentials should be pasted into chat. No transfer or production API request has occurred.

## Lovable owner inquiry — confirmed September 13

The connected Lovable workspace `m8H7ZHF06cHF9curRfWf` confirms owner membership. Vet Connect Hub is project `7ebcea42-509a-4eb8-a067-54a58a28459a` (internal name `vet-connect-flow`), with its cloud database enabled. The owner authorized asking the project for a secure transfer and offered to sign in again if necessary.

The completed Lovable inquiry (`aimsg_01m2drrd1tfgmrszdfcvxse3h9`) reports all four expected EZYVET secret names present, with no supported retrieval/export of their values. Exact source API origin/site identity remains unavailable from the stored secrets. The inquiry saved `.lovable/plan.md` in the source project despite the read-only request; it reported no application-code edits, deployments, credential changes or ezyVet calls. Do not apply that generated plan blindly: it assumes destination proxy/sync handlers use the old names, whereas Living Room Vet uses the explicit CLIENT_ID/CLIENT_SECRET mapping above and also requires SITE_UID.

Use private ezyVet login/API administration or existing original API records to recover the values, then enter them in [staging Edge Function secrets](https://supabase.com/dashboard/project/kothoqicubowyhwfsrte/functions/secrets). Do not change or rotate working source credentials as an implicit recovery step. If new credentials are necessary, assess the source integration impact first. Lovable’s [documented external migration process](https://docs.lovable.dev/tips-tricks/external-deployment-hosting) likewise requires manual reconfiguration of third-party API credentials in the destination. No secret transfer has occurred.

## ezyVet owner-session export — staging secrets saved

The owner signed into Comet at `https://greentree.usw2.ezyvet.com/`. Admin → Integration → Integrations showed the enabled `API Partner (My Custom app) - GreenTree Veterinary Services` record. Its Partner is `Digital Practice`. The supported Download Credentials control exported clinic_name, client_id, client_secret, grant_type, scope and site_uid. No partner_id or API origin was included. The export identifies GreenTree, consistent with the owner-provided production login.

The exported client ID, client secret and site UID were successfully saved to staging `kothoqicubowyhwfsrte` as EZYVET_CLIENT_ID, EZYVET_CLIENT_SECRET and EZYVET_SITE_UID using a private temporary env file. Values were never printed or committed. The temporary env file and this session’s downloaded credential file were removed after the successful secret write. Prior user downloads were not touched. No source setting, scope or credential was changed.

The exact match to Vet Connect Hub remains unverified because its saved credentials are not readable. The Digital Practice partner designation and missing partner ID must be resolved before activation; do not substitute a guessed ID or use another partner’s credentials. Imports remain disabled, and no OAuth request or patient import was performed. The earlier statements that no transfer occurred describe the prior inquiry; the three-field staging transfer above is the current state.

## Owner authorization and available partner check

The owner confirmed that “My Custom app” / Digital Practice is the exact integration configured for Vet Connect Hub and authorized configuring an API for Living Room Vet. The new API Partner form was inspected without saving. Its partner list contains registered third-party vendors but no GreenTree/Living Room Vet private integration. Do not treat the Application Name field as partner registration. The working source integration remains unchanged and the copied credentials remain inactive in staging.

Prepared [the private API enablement inquiry](ezyvet-private-api-request.md), including the existing entitlement question, import scope, destination communications/payment boundaries and request for an exact quote. ezyVet’s current published private read-only setup fee is $500; no fee or agreement was accepted and the inquiry has not been sent.

## Current direction — read-only premise, owner handles representative

Dr. Susan Edler will send the revised API questions to her representative. Codex must not send the draft. The owner directs implementation to continue assuming read-only ezyVet access; Living Room Vet remains primary and no ezyVet write-back is required. The missing partner configuration and actual provider acceptance remain commissioning dependencies, not blockers for building the rest of the application. The question about two-way access and the $500 setup is exploratory and does not authorize a fee, new integration agreement or write access.
