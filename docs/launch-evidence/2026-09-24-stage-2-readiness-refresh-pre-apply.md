# Stage 2 readiness refresh before hosted Phase 2 apply

Date: 2026-09-24  
Scope: remaining commercial-readiness plan item 2, before applying the local Phase 2 migration to hosted Supabase  
Hosted Supabase project: `mgadheotkdnrsatfivjy`

## Summary

Stage 2 evidence was refreshed without applying hosted SQL. A later same-day no-live-send drill added `20260924130000_inbound_sms_service_rpc_security.sql`, so the current hosted apply set is now two local-only migrations. The refreshed generated summary is still blocked, but only by the expected non-public-contact blockers:

- Supabase/database: `2` local readiness migrations are not applied remotely.
- Public website: owner phone, email, and emergency phone/content are not configured.

Hub/frontend readiness, external services/deployment readiness, and verification/release-control pass.

## Readiness-tooling fixes

Two local evidence-generation fixes were made before regenerating the dated evidence:

1. `scripts/supabase-migration-drift.mjs` now requests Supabase CLI JSON output explicitly with:

   ```bash
   npx supabase --output-format json migration list --linked
   ```

   This preserves the existing matching/local-only/remote-only logic while avoiding `migrationDrift: null` when the CLI emits a table by default.

2. `scripts/hosted-readiness-inventory.mjs` now uses passive Vercel domain inspection instead of `vercel domains verify` for the generated inventory. The summary-facing shape remains compatible: each domain still has `result.ok`.

## Hosted migration pre-apply dry run

Command:

```bash
npx supabase db push --linked --dry-run --skip-vault
```

Result:

```text
Would push these migrations:
 • 20260924120000_canonical_housecall_appointment_contract.sql
{"upToDate":false,"dryRun":true,"migrations":["20260924120000_canonical_housecall_appointment_contract.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

This result was superseded later on 2026-09-24 by the no-live-send drill. The current pending hosted apply set is:

- `20260924120000_canonical_housecall_appointment_contract.sql`
- `20260924130000_inbound_sms_service_rpc_security.sql`

No Vault secrets, seeds, or roles are part of the current dry-run plan.

The pending migrations are non-data-destructive but behavior-changing: one replaces appointment write/reminder functions so appointment saves remain on the canonical housecall-aware contract; the other makes the service-role-only inbound SMS RPC run as a definer-owned function so verified Twilio inbound handling can write durable client/conversation/consent rows. Hosted apply still requires explicit owner approval.

## Refreshed generated evidence

Command:

```bash
npm run readiness:refresh --silent
```

Result:

```text
Wrote readiness refresh report to /Users/davidedler/livingroom-vet-care/docs/launch-evidence/2026-09-24-readiness-refresh.json
```

The refresh completed all generated-evidence steps:

- `hosted-readiness`
- `remote-only-migration-file-search`
- `remote-only-migration-source-comparison`
- `remote-public-schema`
- `edge-functions`
- `remote-edge-function-review`
- `public-site`
- `hub-workflows`
- `commercial-summary`

Generated summary:

```json
{
  "status": "blocked",
  "summary": {
    "gates": 5,
    "passing": 3,
    "blocked": 2
  }
}
```

## Summary command

Command:

```bash
npm run readiness:summary -- --fail-on-blockers
```

Result: exited `1`, as expected, because the generated summary still has the exact blockers above.

## Operational notes

- The hosted Supabase database was not mutated during this checkpoint.
- The final refresh uses passive Vercel domain inspection. Before that script change, the existing inventory command called `vercel domains verify` once and returned configured domains; no DNS edit was made.
- Two attempted `vercel alias inspect ...` commands were invalid Vercel CLI usage and failed before creating aliases. A follow-up `vercel alias list --json` showed the current custom aliases `thelivingroom.vet`, `www.thelivingroom.vet`, and `livingroom-vet-care.vercel.app` still mapped to deployment `dpl_EnvwqCoXkakCik1Sd6A7yyq6kxAY`.
- No provider dashboard, email/SMS send mode, phone, voice, voicemail, or CloudTalk state was changed.

## Next exact hosted step, pending explicit approval

After explicit owner approval, apply the two pending migrations with:

```bash
npx supabase db push --linked --skip-vault
```

Then rerun:

```bash
npm run readiness:refresh --silent
npm run readiness:summary -- --fail-on-blockers
```

Expected post-apply result: the Supabase/database gate should clear unless a new hosted drift appears. The public website gate should remain blocked until owner-approved public phone, email, and emergency content are configured.
