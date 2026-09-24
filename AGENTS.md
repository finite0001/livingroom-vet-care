# Living Room Vet project instructions

## Authorized router convention

On September 12, 2026, the user explicitly approved upgrading this repository to patched React Router **v7** while preserving React 18 and existing route behavior. This is a project-specific exception to the home-directory React Router v6 convention.

- Keep React Router DOM on the verified patched v7 line; do not restore v6 from a generic Lovable template or global stack default.
- Preserve the `createBrowserRouter` route tree, current public and staff URLs, authentication boundaries and explicit unsaved-clinical-draft navigation confirmation.
- Existing `react-router-dom` imports are supported. Do not introduce SSR/framework routing or a React major upgrade as part of routine router maintenance.
- Use Node 22.12 or newer and the npm lockfile. Validate dependency changes with `npm run check`, the browser suite and `npm audit`.
- Keep all other global React/TypeScript/shadcn/Supabase conventions in force.

## Standalone practice platform direction — September 16, 2026

The owner and Dr. Edler have decided against ongoing ezyVet integration. Finish and package the current local operational-decision phase, then stop further ezyVet synchronization, write-back, registration and migration-report development. Living Room Vet must function independently as the primary practice system, pursuing ezyVet feature parity and Vet Connect Hub's communications capabilities in its own platform. Retain the original practice-feature requirements.

Authorized existing ezyVet API/account access may be used read-only to understand features and workflows for the native feature-parity audit. It does not authorize new integration setup, expanded permissions, fees, source writes or ongoing synchronization. Preserve the existing ezyVet setup and credentials; keep provider import/write gates disabled. Use the Living Room Vet and Vet Connect Hub repositories, authorized workflow inspection and public documentation to produce an evidence-based native feature-gap matrix. Do not infer full feature parity from API endpoint coverage alone.

This direction supersedes the earlier preference for dedicated two-way integration below. Historical integration acceptance is not a launch requirement for the standalone product. Review retained import tooling separately when planning removal of integration dependencies; do not delete patient records or existing source evidence implicitly.

## Historical ezyVet registration and read-only authentication

On September 15, 2026, the owner supplied the ezyVet representative’s confirmation that this additional application requires a **new API registration and credentials**. The owner subsequently authorized continued use of the current credentials while they coordinate with the vendor, with no changes to the current setup. Preserve credentials, registration, permissions and read-only behavior; bounded testing may continue under that authorization. Do not rotate credentials, create a registration, expand scopes or enable write-back implicitly. Keep imports disabled between explicitly bounded acceptance checks. Prior successful reads establish technical connectivity only, not provider approval for reuse. The owner now prefers a dedicated two-way integration and is comfortable with the $500 setup. Planning for selective write-back is in scope; activating writes or changing the current setup is not. Published documentation also lists $50/location/month for write-back; confirm the applicable agreement before accepting additional charges. This provider clarification supersedes earlier credential-reuse assumptions.

The existing GreenTree clinic credentials were verified on September 13, 2026 to obtain read-contact/read-animal tokens and complete a bounded contact read **without a partner ID**. Keep `EZYVET_PARTNER_ID` optional; do not infer that a new private API registration is required merely because an exported credential file omits it. Preserve required site/client credentials, explicit production-source opt-in, read-only resource allowlists and source acceptance checks. Living Room Vet remains primary under the current architecture. Plan selective ezyVet write-back with explicit ownership/conflict rules; preserve read-only runtime behavior until the new registration and supported write scope are commissioned.

## Approved live backend rollout

On September 14, 2026, the owner explicitly authorized completing the backend rollout and publishing the live Lovable site. The application backend is `mgadheotkdnrsatfivjy`; `ugpyjacqganaqtsiekay` is retained legacy Lovable Cloud, not the target for new application writes or generated migrations. The Lovable Cloud panel may still display the retained legacy database: verify the project reference before every deployment. Browser configuration contains only the selected project's public publishable key. Stripe stays sandbox-only and provider delivery gates remain disabled until separately commissioned.

## Hub design direction — September 24, 2026

The owner approved the phase-1 hub redesign combining the three exploration mockups in `docs/design-explorations/`: Direction A's warm brand look (cream/terracotta/forest tokens, Libre Baskerville display headings via the `font-display` utility, warm shadows), Direction B's status-color grammar, and Direction C's Guided mode as a per-user toggle.

- `src/hub/components/shared/StatusChip.tsx` is the single source of truth for appointment status → label/color. Statuses use the real DB enum (`SCHEDULED` → "Booked" → info blue; `CONFIRMED` → "Confirmed" → terracotta as the checked-in/on-site state; `COMPLETED` → success green; `CANCELLED` → destructive; `NO_SHOW` → warning amber). New status surfaces must reuse `StatusChip`/`statusTone()` — do not invent local color mappings.
- Guided mode persists in `localStorage["lrv:guided-mode"]` (default off) and toggles a `guided` class on `<html>`; the switch lives in the shared header (`src/hub/components/layout/guided-mode.tsx`). Guided mode adds the "Start your day" checklist on Home, helper lines, and 44px touch targets (`.guided-touch`).
- Phase 1 restyled: shell (sidebar, tab bar, header), Home (`HubHomePage`), and Schedule day view. Other hub pages still carry the pre-redesign look — apply the same tokens/`StatusChip` when touching them; do not introduce gray-shadcn styling on new surfaces.
- Nav labels were renamed (labels only, routes unchanged): "Communication" → "Messages", "Website inquiries" → "New inquiries".
