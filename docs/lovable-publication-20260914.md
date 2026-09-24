# Lovable editor synchronization — 2026-09-14

The current readiness checkpoint is pushed to `codex/attachment-canonical-integration`. Integration branch `codex/lovable-publication` merges that checkpoint with Lovable main `44822ff`, preserving SEO and editor preview authentication changes. The Lovable project `7ea421c9-31d9-4bc4-acc7-d206c92b4b42` now selects this integration branch and reports GitHub synchronization.

The duplicate clinical migration from the legacy backend is preserved under `docs/legacy-lovable-migrations`, outside the executable canonical stack. Sitemap generation now uses the required Node toolchain rather than downloading an unpinned tool at build time; the preview-auth timer passes lint. The merged build and 583 unit tests pass, as do 42 public intake, staff-access, navigation and migration browser tests. Both restore inventory guards still validate the 110 canonical migrations.

This is an editor sync, not a public release. The existing `.env` targets the old Lovable backend. Read-only ledger checks found 52 migrations on the selected future-production project and 99 on staging. Neither backend nor DNS nor outbound/payment gates were changed. Public rollout requires matching backend/functions, old-data disposition and authenticated acceptance; the user was asked whether the requested publication includes that cutover.

Next work: reconcile exact prescription-item observations against approved selected/omitted evidence; finish identity/weight receipt adapters, global totals, operational resolutions and frozen report acceptance. Keep continued development on the synchronized integration branch and fetch concurrent Lovable edits before pushing. Do not treat the archived legacy migration as a new canonical migration or silently switch backend targets.

[Validation receipt](evidence/lovable-editor-sync-20260914.json).
