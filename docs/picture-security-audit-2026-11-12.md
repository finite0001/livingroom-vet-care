# Screenshot security review — November 12, 2026

Review baseline: `bdc40db68b7747d5fcb65e4b23f992a45e8b4eb2`. Scope is repository source, generated assets and isolated synthetic validation. Hosted configuration, DNS ownership, current provider accounts and live traffic were not queried. No deployment, provider activation, real message, payment, clinical processing, migration application to a hosted project or production promotion is part of this work.

Detailed findings and source references: [authentication review](auth-security-picture-audit-20261112.md) and [database/private-file review](picture-data-security-2026-11-12.md). This review does not supersede the existing beta release hold or clinical acceptance register.

## Findings fixed

**Confirmed callback session substitution:** the shared SDK accepted a session from a URL fragment before user interaction. An actual-app regression reproduced the staff identity changing on link open. Shared URL adoption is now disabled; supported invitation/recovery links use a memory-only password-setup client, display the authoritative account email, and require an explicit password save. They never replace the shared staff session or preview-broker session. Normal password sign-in follows setup. Existing clinical unsaved-draft navigation is preserved.

**Separate reliability correction:** three deterministic stale-version branches returned retryable SQLSTATE `40001`. A local PostgREST 16.3 gateway returned HTTP 500 for each. Additive migration 214 changes only those literals to `PT409`; the same requests then return HTTP 409. Tests verify unchanged function definitions apart from the literals, ownership, grants, locking and replay behavior. This is not a demonstrated authorization bypass, and historical gateway retry incidents are not relabeled as current hosted behavior.

## Coverage

| Screenshot category | Repository evidence and boundary |
| --- | --- |
| 1. Next.js header | Vite/React SPA, not Next.js. The named Next.js middleware bypass is not applicable. |
| 2. Exposed `.git` | Vercel publishes `dist`, not the checkout. Generated-artifact inspection is recorded below; actual hosted dotfile responses remain unverified. |
| 3. Supabase storage | Private object retrieval uses authenticated contexts/leases. `capture-inbound-attachment` derives provider and metadata from a saved database receipt; `retrieve-reviewed-ezyvet-original` obtains a reviewed context rather than accepting a browser object path. Database policy coverage is in the specialist report. |
| 4. Browser price | `stripe-checkout.ts` and `stripe-refund.ts` accept exact request ID/action inputs, validate the authenticated actor, and obtain amounts from server contexts. `stripe-provider.ts` validates server amounts and provider evidence, uses stable idempotency keys, and restricts checkout URLs to Stripe. No additional browser-price finding established. |
| 5. Credential stuffing | The November 6 evidence records enabled breached-password protection and closed signup. It is historical evidence, not a current hosted inspection. Current Auth quotas and provider controls remain unverified. |
| 6. Open database | The repository has extensive RLS, staff checks and narrowly scoped service RPCs. Database findings and limits are in the specialist report; no live unrestricted-database claim is made. |
| 7. Polyfill.io | Generated-asset and dependency checks are recorded below. No need to replace unrelated dependencies merely because the screenshot names this supply-chain incident. |
| 8. SMS pumping | Outbox submission requires authenticated staff and a prepared request; database checks match the recipient to the household and check channel consent/suppression. Dispatch rechecks actor/recipient eligibility and requires service/dispatcher credentials and delivery mode. CloudTalk remains the selected provider; current provider spend caps are not verified. |
| 9. Prompt injection | Clinical note/audio/call/recap handlers use fixed provider destinations, bounded structured proposals, source evidence and clinician review. Prompts treat source material as untrusted; that instruction alone is not a security boundary. No new unrestricted tool/action path established in this review, and no clinical AI gate was enabled. |
| 10. Weak JWT secret | Hosted signing-key strength and rotation are not source-verifiable. Worker authentication compares configured credentials; human authentication uses Auth and database authority. See auth report for specific findings. |
| 11. Race conditions | Payments use durable request IDs/provider idempotency, and outbox work uses database leases with an explicit uncertain state for transports without provider idempotency. Database audit records additional reviewed races and any fixes. |
| 12. Account pre-hijacking | See authentication report for callback/session and invitation findings. Closed signup in historical evidence is not a guarantee of current email-ownership behavior. |
| 13. Subdomain takeover | DNS and vendor resource ownership require a separate current infrastructure inspection. No DNS records or provider registrations changed. The documented practice domain is `thelivingroom.vet`. |
| 14. SSRF | Resend attachment retrieval restricts the exact HTTPS CDN host/path and rejects redirects; AgentMail downloads originate from provider-authenticated metadata, reject private literal/local URL forms and redirects, but DNS/provider behavior is not certified. CloudTalk media uses fixed provider hosts and numeric saved call IDs. No new caller-controlled server fetch exploit established. |
| 15. Path traversal | Reviewed original/PDF readers obtain database-authorized object paths and encode path segments; the client does not select arbitrary filesystem paths. Public deployment publishes generated artifacts. See database/storage report for scope. |
| 16. Reset poisoning | See authentication review. Hosted URL allowlists and email template parity were not inspected; browser-origin use is not evidence that an untrusted HTTP Host header controls a server-created reset link. |
| 17. Source maps | Production build/artifact inspection recorded below. Public source maps alone are not authentication credentials; source/secret checks are separate. |
| 18. Clickjacking | Global Vercel `X-Frame-Options: DENY` is configured. Actual served response parity remains a deployment verification item. |
| 19. Open redirect | Payment evidence restricts Stripe checkout destinations; protected document/payment routes use capability context. Authentication-specific destination handling is covered by the auth report. |
| 20. User enumeration | No hosted enumeration/timing experiment performed. Auth/provider responses and invite access are reviewed in the authentication report; no broad absence claim is made. |

## Validation and release

- Baseline full check passed: 2,807 unit tests, all three TypeScript projects, production build, and lint with seven existing Fast Refresh warnings. After the authentication change, the full check passed again with 2,810 tests and no failures/skips. The subsequent database/source changes have separate focused checks below.
- Authentication: 19 focused Node tests and 14 distinct real-app browser scenarios passed, including nine new callback scenarios, existing foundation checks and unchanged clinical unsaved-SOAP navigation. Phone/desktop widths and keyboard password submission are covered. All remote Auth responses are mocked.
- Database/storage: 58 existing private-file tests, 12 inventory/current-migration guard tests, and the isolated PostgreSQL/real-HTTP conflict regression passed. The database report records exact scope and the full native acceptance limitation.
- Full npm dependency audit reports zero known advisories. Generated production assets contain no `.map`, `.git`, or `polyfill.io` references. These checks do not inspect current hosting/DNS configuration.
- Redacted secret scans of current application source (6.39 MB), Edge Functions (1.01 MB), and generated browser assets (5.02 MB) report no findings. This is current-tree evidence, not a completed Git-history certification.
- The integrated successor uses a new exact candidate source closure; prior manifests, migration receipts and browser bindings are preserved. Source admission does not constitute migration-214 native/Auth/restore acceptance. That full matrix remains required in CI and before a separately approved release.
- Final integrated source verification: all 144 Python source-control tests pass in one clean run, official statement framing and the browser inverse pass, and the new candidate closure captures 1,425 source files and passes exact admission. Final inventory/migration guards pass 12 tests, followed by the real PostgreSQL/PostgREST regression with all three HTTP 409 outcomes. No historical receipt was replaced.

Existing historical evidence is not relabeled as new acceptance. Exact-head PR CI and hosted staging acceptance are distinct from the local checks above.

Preserve the production frontend promotion hold described in `beta-remediation-2026-11-06.md`. Any backend release must use `deployment-runbook.md` and the specialized narcotics source/receipt sequence; a generic database push or rewritten historical receipt is not a valid substitute. Preserve imported patient history, disabled ongoing ezyVet synchronization, delivery/payment/clinical gates, and pending human acceptance. This review does not authorize a merge or release.
