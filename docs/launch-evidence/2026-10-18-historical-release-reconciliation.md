# Historical evidence reconciliation rollout

PRs [233](https://github.com/finite0001/livingroom-vet-care/pull/233) and [238](https://github.com/finite0001/livingroom-vet-care/pull/238) merged after all four exact-head CI jobs passed. They restore missing patient-photo/records rollout evidence and label the older PDF feasibility proof as historical and superseded by the production renderer. Existing production features are unchanged; historical SQL and acceptance scripts were not executed.

Combined merge `879cf155fe9c7da6d4eea23164aba21178021214` contains PR 233’s merge `1a75bd9bc2fd9780ab6f49fda0092dc817ce7e6a`. Its Vercel status matched production deployment `dpl_GKYpFZV5TR5uRwv5qeBju46QBXw3`, independently verified READY with apex, www and project aliases. No migration or permanent function deployment was needed. No clinical activation or provider calls followed from this reconciliation. This receipt records deployment metadata; final combined public browser smoke is separate.

The [machine-readable receipt](2026-10-18-historical-release-reconciliation.json) binds exact heads, merges, CI runs and observed deployment identity. Later deployments may move the aliases.
