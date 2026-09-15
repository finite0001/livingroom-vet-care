# Merged pilot frontend deployed to staging — September 15, 2026

PR134 merged as `0d401a5cb5c7b4d4cf00cdb7e2023c39187c3002` into `codex/lovable-publication`. Deployed that revision through Vercel CLI59.5.0 to the existing protected preview project `prj_Dn1g9AIBEth78S7V3pqhYHueICl7`, then assigned the existing stable staging alias after build and served-artifact checks.

- Deployment: `https://livingroom-vet-care-mdlwb19dc-daves-projects-e0da43ba.vercel.app` (READY).
- Stable staging: `https://livingroom-vet-care-daves-projects-e0da43ba.vercel.app`.
- Guarded hosted build: preview backend verified, contact intake disabled.
- Served entry bundle `index-DxulPnDX.js` contains `kothoqicubowyhwfsrte`, with neither primary nor legacy backend reference.
- Upload dry run:494 source files; environment files, docs, tests, migrations and local Supabase configuration excluded.
- Merged code validation:587 unit tests and38 targeted browser tests passed; lint, typecheck and build passed with existing warnings.
- Authenticated live schedule shows the saved PILOT TEST appointment, the corrected staff-ID fallback and the new day-route control. Selecting the assigned staff displays the09:00 Mountain Time stop and explicit return to Spruce Street. Maps links were not opened.

No backend migrations, Edge Function deployment, payment/provider configuration or public-site change was made in this checkpoint. The current Vercel CLI session works; its connector returned403. The project uses Preview environment variables; the historical receipt's `staging` target label is not an existing Vercel custom environment.

Staging remains99 migrations. Read-only source audit compared139 recorded deployed function-file hashes against the merged source: zero differences. The11 pending SQL migrations support `/hub/tools/ezyvet` reconciliation and importer authorization; they do not block the route or record-preview changes validated here. Before applying them, back up the now-populated staging database and rehearse the exact99→110 migration path. Do not infer parity from the separate primary110-migration rollout. Stripe reconnect and practice account configuration remain prerequisites for real sandbox payment/refund acceptance.
