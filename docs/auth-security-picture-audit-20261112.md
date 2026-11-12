# Authentication attack review — November 12, 2026

Baseline: `bdc40db68b7747d5fcb65e4b23f992a45e8b4eb2`. Repository review and
synthetic local tests only. No hosted settings, accounts, email delivery or
production API endpoints were accessed. Historical evidence is dated below and
is not treated as current provider assurance.

## Confirmed issue: callback session substitution

The shared client left Supabase's `detectSessionInUrl` default enabled.
`App.tsx` imports the staff AuthProvider, which imports that client. A valid
session in a URL fragment was therefore saved into staff auth storage before a
user made any choice. `ResetPasswordPage.tsx` accepted whichever shared session
resulted and displayed no target account identity before changing its password.

An attacker needs an existing valid Auth session and must persuade staff to open
a crafted application URL. For practical clinical access/attribution impact, the
substituted account also needs active staff authorization: the current onboarding
trigger creates inactive profiles without roles. This is login CSRF/session
substitution, not JWT forgery or a claim that an anonymous user can grant itself
staff access. The resulting shared account switch could discard account-bound
work or attribute later staff actions to the attacker's account.

The actual-app Playwright reproduction seeded current staff `111…`, opened a
synthetic valid recovery fragment for staff `222…`, and observed stored identity
`222…` before any click. Its unchanged assertion now passes with the fix.
Only mocked local Auth responses were used; the SDK, application, router and
stylesheet were real.

## Narrow fix and intended behavior

- Shared automatic URL adoption is disabled. `brokeredPreviewStorage()` remains
  configured and its implementation is unchanged.
- `main.tsx` captures/scrubs Auth material before importing App, staff auth, or
  marketing. Existing isolated public estimate/payment/document bootstraps retain
  their own precedence and capability handling.
- Only existing supported `invite`/`recovery` fragments on the exact
  `/hub/reset-password` route become a memory-only password-setup capability.
  Unsupported routes/types and malformed callbacks cannot establish a session.
- An isolated client with persistence, auto-refresh and URL detection disabled
  validates the link and obtains authoritative Auth user email. The form displays
  that email before the explicit Save password action.
- Save resolves the isolated session first, then checks that the page's intent
  remains current before sending an explicit-bearer password PUT for that exact
  account. Cancellation while validation or token refresh is pending prevents
  the later password write. No callback session is copied to local staff storage,
  preview broker or shared AuthProvider, even after a successful password change.
- After saving, staff use the existing password sign-in flow. A definitive 422
  password-policy refusal lets them choose a different password; provider payloads
  are not displayed. Other failures require a new link. Once an explicit Save's
  HTTP request has been dispatched, navigation cannot guarantee undoing that
  server-side password change; no such cancellation guarantee is claimed.

AuthProvider, role checks, cache/session generation controls, preview brokering,
clinical draft blockers and Router 7 are unchanged. This does not activate MFA,
change the staff invitation policy, or enable any provider/clinical/payment/import
gate. It does not lift the existing production frontend promotion hold.

## Screenshot category coverage

| Category | Outcome | Evidence / qualification boundary |
| --- | --- | --- |
| 5. Credential stuffing | No new confirmed code bypass; hosted controls need fresh qualification. | `src/hub/pages/LoginPage.tsx:26` calls Supabase password authentication. The application does not claim a client-side limiter substitutes for provider enforcement. `docs/evidence/beta-production-auth-security-2026-11-06.json` records breached-password protection enabled, signup closed and minimum length 6 on Nov 6. Current rate limits, CAPTCHA, breached-password enforcement and server password minimum were not queried. The setup form's 12-character rule alone does not enforce a server minimum. |
| 10. Weak JWT / verification | No new confirmed signature bypass in reviewed auth/invitation/worker chains. | `supabase/functions/invite-staff/index.ts:27` calls Auth `getUser` before active-admin checks. `_shared/worker-auth.ts` accepts exact configured managed credentials and rejects forged decoded service-role claims; runtime worker tests cover the actual handlers. `src/hub/features/controlled-drugs/record-review/staff-session.ts:68` decodes SDK token fields for client identity/expiry tracking, not as a replacement for backend authorization. Hosted signing keys/rotation remain unknown. |
| 12. Account pre-hijacking / session substitution | **Confirmed callback substitution fixed as above.** No new self-provisioning staff escalation established. | `20260919120000_new_auth_users_inactive.sql` replaces older onboarding behavior: new profiles are inactive and role-less until explicit administrator onboarding. `AuthContext.tsx` rejects public signup; `invite-staff` accepts only active administrators and ignores caller role/redirect metadata. Nov 6 evidence records signup disabled and autoconfirm false, not a fresh hosted assertion. |
| 16. Reset poisoning | No new Host-header poisoning chain found; callback adoption was independently fixed. | `LoginPage.tsx:45` uses current browser origin plus fixed reset path. `invite-staff/policy.ts:22` validates a configured origin and appends the fixed path; request Host/redirect fields do not select the target. Fresh hosted redirect-allowlist validation remains a rollout prerequisite. |
| 19. Open redirect | No new arbitrary-origin redirect found in auth paths. | `src/hub/lib/safe-redirect.ts:10` permits hub paths only and rejects schemes, backslashes, control characters, literal traversal and auth-loop destinations; `tests/auth/safe-redirect.test.ts` covers rejection and intended paths. Invitation request parsing rejects caller-supplied redirect fields. |
| 20. User enumeration | No new confirmed public enumeration exploit. | Login/reset use provider Auth responses; reset success text is neutral (`LoginPage.tsx:85`). Provider error/timing behavior was not probed. Invitation failures are generic and the endpoint is active-admin-only; it is not a public account-existence oracle. Database row visibility is covered by the separate data audit. |

## Validation and release handoff

`e2e/auth-callback-isolation.spec.ts` exercises the real app/SDK with all external
network blocked and local mocked Auth responses: identity substitution regression,
recovery and invitation password writes at 390/1440 widths, keyboard submission,
URL scrubbing, unsupported routes, cancellation during validation and refresh,
policy refusal/retry and unchanged current staff storage. Parser tests reject
unsupported/malformed callbacks and prove capabilities are consumed only once.
Existing foundation coverage verifies protected-route denial and unsaved staff
drafts across token refresh; the existing clinical unsaved SOAP navigation test
passed unchanged.

These are local engineering checks, not hosted acceptance. Follow
[the deployment runbook](deployment-runbook.md) and
[the beta remediation hold](beta-remediation-2026-11-06.md) for any later release.
A separately authorized staging rehearsal should exercise genuine invitation and
recovery, password-policy rejection, new-password sign-in, staff role denial and
preview brokering before any production frontend promotion is considered.

Final local results: 19 auth/worker Node tests passed; all 9 new callback browser
scenarios passed, along with 4 existing foundation scenarios and the clinical
unsaved-SOAP navigation scenario (14 distinct browser scenarios). Application
TypeScript, touched-file ESLint and `git diff --check` passed on Node 22.
Root integration owns the complete repository checks and source-admission manifest.
