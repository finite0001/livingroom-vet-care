# A2 reconnaissance — origin pinning for the staff-token handlers

Date: 2026-09-21. Author: the stronger-model seat. Written as a handover so a fresh session can start A2 without repeating the reconnaissance.

**Task (from `plans/2026-09-19-commercial-readiness-map/MAP.md` §4):** *"Replace `Access-Control-Allow-Origin: *` on the ~15 staff-JWT handlers with the origin-pinning helper the payment/estimate handlers already use."* Tier **K+R**. Done when: *"no `*` remains on a handler that accepts a staff JWT; existing handler tests pass; add one test per helper."*

## 1. The pattern that is already correct

`supabase/functions/_shared/payment-access-http.ts` lines 68–73 is the model. Copy its shape, not just its header line:

```ts
const baseHeaders = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
};
const headers = { ...baseHeaders, "Access-Control-Allow-Origin": config.origin };
const reply = (status: number, value: object) => Response.json(value, { status, headers });
if (request.headers.get("Origin") && request.headers.get("Origin") !== config.origin)
  return reply(403, { error: "unavailable" });
```

Three parts, and all three matter: the header names **the configured origin** rather than `*`; `Vary: Origin` stops a shared cache serving one origin's response to another; and a request whose `Origin` is present but different is **refused**, not merely answered without CORS headers. `_shared/payment-access-staff.ts` lines 269–284 does the same with a conditional header.

## 2. The 15 files that still set the wildcard

Measured with `grep -rln 'Access-Control-Allow-Origin": "\*"' supabase/functions/`:

**Shared helpers (8)** — these are the response builders for the handlers below, so a wildcard here can survive an entry-point fix:

- `_shared/capture-conversation-email.ts`
- `_shared/document-link-http.ts`
- `_shared/estimate-publication-http.ts`
- `_shared/inbound/capture-attachment.ts`
- `_shared/inbound/read-attachment.ts`
- `_shared/prepare-invoice-email.ts`
- `_shared/prepare-release-email.ts`
- `_shared/verify-conversation-attachment.ts`

**Entry points (7):**

- `capture-inbound-attachment/index.ts`
- `enqueue-message/index.ts`
- `read-inbound-attachment/index.ts`
- `send-email/index.ts`
- `send-provider-email/index.ts`
- `send-sms/index.ts`
- `suggest-replies/index.ts`

## 3. Why this is one change and not fifteen

**It must be done whole or not at all.** If the entry points are pinned but a shared helper still emits `*` on the same response path, the endpoint continues to advertise the wildcard while the diff looks finished. A security change that looks complete and is not is worse than one plainly not started. Verify at the end with the grep above returning **nothing** in `supabase/functions/`.

**The cascade is the real cost.** Each handler needs the configured origin, and several do not receive it today, so their dependency interfaces change — which reaches their callers and the tests. **80 test files import from `supabase/functions/_shared/`.** Budget for that, not for 15 one-line edits.

**Per-file judgement is required**, and it is not the same everywhere: a staff-JWT handler must pin and refuse; a provider webhook (Stripe, Twilio, Resend) needs no CORS at all and should arguably have none; anything genuinely public still belongs to the application's own origin. Decide each one deliberately and say so in the pull request.

## 4. Where the tests live, and the model to copy

Handler tests are **centralised under `tests/`**, not co-located with each function — `tests/payment-access/http.test.ts`, `tests/worker-auth/auth.test.ts` (which exercises `createReminderSchedulerHandler`) and `tests/reminder-dispatch/scheduler.test.ts` are the closest models. `npm test` runs them via `node --test tests/**/*.test.ts`.

**No test currently pins the CORS header** — so nothing will fail today if the wildcard is wrong, and nothing will catch a regression tomorrow unless the new tests assert it. Write each test to assert the three parts of §1: the header equals the configured origin, `Vary: Origin` is present, and a foreign `Origin` is refused.

## 5. Verification available locally

The repository can run a real local stack with the pinned CLI:

```
export PATH=/tmp/sbcli:$PATH HOME=/tmp/sbhome
export XDG_CACHE_HOME=/tmp/sbhome/.cache XDG_CONFIG_HOME=/tmp/sbhome/.config TMPDIR=/tmp
```

Build a disposable project beside the repository the way `tests/prescriptions/native-disposable.py` does — its own `project_id`, its own ports, `supabase start --workdir <dir> --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor` — and never start a stack in the working copy, because a local stack for this project's own id is already running on this machine. `supabase gen types typescript --local` output does **not** match the committed `src/integrations/supabase/types.ts` (21,335 lines in a different format against 8,521), so never regenerate that file locally; see the A4 migration for the full reason.

## 6. State at handover

- `main` is `23b6d20`. A1 (`handle_new_user`), A3, C0, D1–D3, B6–B8, C2–C9 are all landed.
- A4 (consent redaction) and A5 (on-duty guard) are verified and open as pull requests **#197** and **#198**.
- A2 is **not started**: no branch, no code.
- The A2 tests must pass the whole suite: `supabase test db` stood at **111 files / 4,495 tests, PASS** when A4 and A5 were checked.
