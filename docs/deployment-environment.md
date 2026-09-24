# Deployment configuration checks

Vercel runs `npm run build:deployment`. This checks the explicit deployment environment and Vite's resolved public configuration before starting the build. Ordinary `npm run build`, local development and Lovable's existing connection are unchanged. No hosting settings or database connections have been changed by adding this guard.

## Required configuration

Set these in the intended Vercel environment, not just in a repository `.env` file:

| Variable | Production | Preview |
| --- | --- | --- |
| `VERCEL_ENV` | Vercel supplies `production` | Vercel supplies `preview` |
| `VITE_SUPABASE_PROJECT_ID` | `mgadheotkdnrsatfivjy` | Explicit separately commissioned staging project reference |
| `VITE_SUPABASE_URL` | `https://mgadheotkdnrsatfivjy.supabase.co` | Exact `https://<staging-reference>.supabase.co` origin |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Matching browser publishable key | Matching staging browser publishable key |

The dedicated project is reserved for eventual production even while its current provider settings say staging. Preview builds cannot use it or the original Lovable project. A separate hosted staging backend has not been provisioned or approved by this change; until one is available, use the isolated local validation environment. Production configuration passing is not permission to launch or proof that the dedicated database is commissioned.

Modern `sb_publishable_` keys are accepted. Legacy JWT keys must declare `role=anon` and the selected project reference. JWT payload inspection is a configuration sanity check, **not signature verification**; modern opaque keys cannot be bound to a project offline. Hosted authentication and backend commissioning must verify actual validity, ownership and privileges. Secret keys and service-role JWTs are rejected without printing their values. Follow [Supabase's key guidance](https://supabase.com/docs/guides/getting-started/api-keys).

Only the five currently reviewed `VITE_` variable names are allowed: the three Supabase settings above, `VITE_CONTACT_INTAKE_URL` and `VITE_CONTACT_TURNSTILE_SITE_KEY`. Adding another browser setting requires updating this allowlist. This reduces accidental browser exposure; it does not inspect hardcoded source secrets or prove that arbitrary values assigned to public names are safe.

Contact settings must both be unset (intake explicitly remains disabled), or both configured. The intake URL must be exactly the selected backend origin followed by `/functions/v1/public-contact`. Actual Turnstile hostname/action configuration, server secrets, deployment and accepted submission/recovery testing remain commissioning tasks. A configured string does not establish a working contact form.

## Verification

`npm test` includes configuration regression tests for missing explicit variables despite a complete `.env`, unknown targets, cross-environment references, misleading URLs, secret/mismatched keys, accidental extra public variables and cross-backend contact intake. The real entry point is invoked with a temporary synthetic `.env` to verify it exits before Vite runs. A successful local guarded build with synthetic public configuration proves the build path executes; it makes no network request or provider authentication claim.

Vite always loads its general `.env` files and gives already-present process variables priority; see [Vite environment precedence](https://vite.dev/guide/env-and-mode). Vercel settings are environment scoped; see [Vercel environment variables](https://vercel.com/docs/environment-variables). The guard intentionally requires explicit process configuration for the backend values instead of silently accepting the old checked-in fallback.

This guard does not check schema parity, RLS, staff bootstrap, DNS, TLS, backup restoration, mail delivery or clinical acceptance. Complete the [deployment runbook](deployment-runbook.md) and [commercial-readiness gates](commercial-readiness.md) before cutover.
