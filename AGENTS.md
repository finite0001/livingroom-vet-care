# Living Room Vet project instructions

## Authorized router convention

On September 12, 2026, the user explicitly approved upgrading this repository to patched React Router **v7** while preserving React 18 and existing route behavior. This is a project-specific exception to the home-directory React Router v6 convention.

- Keep React Router DOM on the verified patched v7 line; do not restore v6 from a generic Lovable template or global stack default.
- Preserve the `createBrowserRouter` route tree, current public and staff URLs, authentication boundaries and explicit unsaved-clinical-draft navigation confirmation.
- Existing `react-router-dom` imports are supported. Do not introduce SSR/framework routing or a React major upgrade as part of routine router maintenance.
- Use Node 22.12 or newer and the npm lockfile. Validate dependency changes with `npm run check`, the browser suite and `npm audit`.
- Keep all other global React/TypeScript/shadcn/Supabase conventions in force.

## ezyVet registration and read-only authentication

On September 15, 2026, the owner supplied the ezyVet representative’s confirmation that this additional application requires a **new API registration and credentials**. The owner subsequently authorized continued use of the current credentials while they coordinate with the vendor, with no changes to the current setup. Preserve credentials, registration, permissions and read-only behavior; bounded testing may continue under that authorization. Do not rotate credentials, create a registration, expand scopes or enable write-back implicitly. Keep imports disabled between explicitly bounded acceptance checks. Prior successful reads establish technical connectivity only, not provider approval for reuse. The owner now prefers a dedicated two-way integration and is comfortable with the $500 setup. Planning for selective write-back is in scope; activating writes or changing the current setup is not. Published documentation also lists $50/location/month for write-back; confirm the applicable agreement before accepting additional charges. This provider clarification supersedes earlier credential-reuse assumptions.

The existing GreenTree clinic credentials were verified on September 13, 2026 to obtain read-contact/read-animal tokens and complete a bounded contact read **without a partner ID**. Keep `EZYVET_PARTNER_ID` optional; do not infer that a new private API registration is required merely because an exported credential file omits it. Preserve required site/client credentials, explicit production-source opt-in, read-only resource allowlists and source acceptance checks. Living Room Vet remains primary under the current architecture. Plan selective ezyVet write-back with explicit ownership/conflict rules; preserve read-only runtime behavior until the new registration and supported write scope are commissioned.

## Approved live backend rollout

On September 14, 2026, the owner explicitly authorized completing the backend rollout and publishing the live Lovable site. The application backend is `mgadheotkdnrsatfivjy`; `ugpyjacqganaqtsiekay` is retained legacy Lovable Cloud, not the target for new application writes or generated migrations. The Lovable Cloud panel may still display the retained legacy database: verify the project reference before every deployment. Browser configuration contains only the selected project's public publishable key. Stripe stays sandbox-only and provider delivery gates remain disabled until separately commissioned.
