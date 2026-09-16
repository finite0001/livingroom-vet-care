# Existing Vet Connect Hub connection handoff

Current status — September 15, 2026: the ezyVet representative confirmed that the additional application requires a **new API registration and credentials**. The owner subsequently directed us to continue using the current credentials temporarily while they work with the vendor, without changing the current setup. Preserve the existing registration, credentials and permissions. Bounded read-only testing remains authorized; keep imports disabled between checks. Historical successful authentication proves technical connectivity, not provider approval to reuse that registration.

## Provider response and next steps

The owner supplied the representative’s response: the quoted $500 setup includes two-way read/write access, and the setup fee is one-time for approval/access. We are responsible for building and maintaining the integration. No fee or agreement has been accepted. The [published private-integration guidance](https://developers.ezyvet.com/apply/private.html), checked September 15, additionally lists $50/location/month for write-back. Reconcile that with the representative’s quote in the written agreement. The [endpoint/scope reference](https://developers.ezyvet.com/guides/faq.html#api-endpoints) documents many create/update operations but does not make every clinical resource writable.

The owner will coordinate the registration requirement with the vendor. Do not create or purchase a registration or replace the existing credentials without a later instruction. Keep the existing Vet Connect Hub integration unchanged. Preserve current read-only scopes. The owner now prefers dedicated two-way access and is comfortable with the $500 setup. Plan selective write-back, but do not activate it or change the current registration while terms are being clarified. Living Room Vet remains primary; resource ownership, conflict handling and allowed writes require an explicit design. The representative is unsure where the partner ID is found. Prior authentication without it succeeded, so keep the field optional rather than requesting or inventing one as a blocker.

Before this response arrived, the September 15 staging acceptance check successfully persisted one contact page (50 snapshots). No mappings, clients or pets were created, and no messages were queued. The run has next_page=2 because remaining pages were deliberately not requested; this is not a completed whole-source migration. EZYVET_IMPORT_MODE was restored to disabled. Retain this evidence as historical; repeat bounded acceptance if credentials change before commissioning.

The chronological notes below describe earlier decisions and are superseded by this provider clarification wherever they imply credential reuse is sufficient.

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

Dr. Susan Edler will send the revised API questions to her representative. Codex must not send the draft. The owner directs implementation to continue assuming read-only ezyVet access; Living Room Vet remains primary and no ezyVet write-back is required. Clinical-resource sample acceptance remains a commissioning dependency. Basic read-only authentication is verified and does not require a partner ID. The question about two-way access and the $500 setup is exploratory and does not authorize a fee, new integration agreement or write access.

## Verified correction — existing read-only access works

After the owner questioned the new-registration assumption, a direct OAuth-only request using the exported existing clinic credentials and no partner_id returned HTTP 200. A follow-up bounded verification decoded the issued token locally, confirmed exactly `read-contact` and `read-animal` scopes and the exported site UID, then performed `GET /v1/contact?page=1&limit=1`, which returned HTTP 200 and one record. No source response content, token or credential was printed or retained; no records were imported or modified. The session-generated credential download was removed.

This establishes working existing read access, not vaccination/prescription/attachment sample acceptance or permission for write-back. The importer’s mandatory partner-ID validation was a local implementation mistake: `EZYVET_PARTNER_ID` is now optional and omitted from OAuth requests when absent. Present values remain validated, and the site/client credentials, production-source gate and explicit read-resource allowlist are still required.

Staging now has the verified production API origin, explicit production-source opt-in and `contact,animal` read-resource allowlist alongside the previously saved client/site secrets. `EZYVET_IMPORT_MODE` remains disabled/unset until the staff workflow is commissioned; configuring source access does not schedule imports. Dr. Edler can clarify two-way capabilities/terms with her representative separately; that inquiry is not a prerequisite for the demonstrated read-only authentication.
