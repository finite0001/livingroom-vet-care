# Health Edge Function smoke — 2026-09-24

Target project: `mgadheotkdnrsatfivjy`

Function URL:

```text
https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/health
```

Validation performed after deploying only the `health` Edge Function:

- `node --test tests/health/health.test.ts` passed 6/6 focused probe tests.
- `npx supabase functions deploy health --project-ref mgadheotkdnrsatfivjy` succeeded.
- `curl -i --max-time 15 https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/health` returned HTTP/2 200 with `Cache-Control: no-store` and body shape `{"status":"ok","checked_at":"…"}`.
- `curl -I --max-time 15 https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/health` returned HTTP/2 200 with no response body.

This is a liveness probe only. It proves the function and database answer. It does not prove provider credentials, outbound delivery, scheduler execution, payment readiness or clinical acceptance.
