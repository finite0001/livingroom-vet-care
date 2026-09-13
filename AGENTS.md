# Living Room Vet project instructions

## Authorized router convention

On September 12, 2026, the user explicitly approved upgrading this repository to patched React Router **v7** while preserving React 18 and existing route behavior. This is a project-specific exception to the home-directory React Router v6 convention.

- Keep React Router DOM on the verified patched v7 line; do not restore v6 from a generic Lovable template or global stack default.
- Preserve the `createBrowserRouter` route tree, current public and staff URLs, authentication boundaries and explicit unsaved-clinical-draft navigation confirmation.
- Existing `react-router-dom` imports are supported. Do not introduce SSR/framework routing or a React major upgrade as part of routine router maintenance.
- Use Node 22.12 or newer and the npm lockfile. Validate dependency changes with `npm run check`, the browser suite and `npm audit`.
- Keep all other global React/TypeScript/shadcn/Supabase conventions in force.

## ezyVet read-only authentication

The existing GreenTree clinic credentials were verified on September 13, 2026 to obtain read-contact/read-animal tokens and complete a bounded contact read **without a partner ID**. Keep `EZYVET_PARTNER_ID` optional; do not infer that a new private API registration is required merely because an exported credential file omits it. Preserve required site/client credentials, explicit production-source opt-in, read-only resource allowlists and source acceptance checks. Living Room Vet is primary; ezyVet write-back is not in scope.
