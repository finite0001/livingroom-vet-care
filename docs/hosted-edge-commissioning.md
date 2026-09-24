# Hosted Edge commissioning — 2026-09-13 UTC

The dedicated Living Room Vet project `mgadheotkdnrsatfivjy` received the 13 reviewed Edge handlers from source `b229740`, after all 47 database migrations were confirmed. The original Lovable backend and public frontend were not changed. This is backend commissioning, not completed staff or provider acceptance.

## Initial deployment and probes

The authenticated CLI used an explicit target and explicit function names, with server-side bundling and one deployment job. No prune, provider secret, scheduler activation or DNS change was included. The list excluded unfinished `send-provider-email` and `suggest-replies`.

All 13 functions reported ACTIVE. Existing invite-staff, send-email and send-sms advanced to version 3; the other ten began at version 1. The two direct-send endpoints now return 410 and direct callers to the reviewed queue workflow.

Initial live probes verified ten JWT-protected routes rejected missing authorization at the gateway. With a valid public anon JWT, eight handlers rejected unauthorized callers, while the two retired send endpoints returned 410. Public GET probes returned 503 for the two unconfigured provider webhooks and for unconfigured contact intake. These 23 probes established runtime boot and fail-closed behavior without valid staff requests, intake budget consumption, invitations or provider sends.

A service-role probe passed the gateway but failed the worker's literal-token comparison. Its CLI-issued legacy token did not match the runtime managed-key digest. This is a verified worker authentication defect, not a reason to weaken staff authorization or claim disabled-worker acceptance. PR46 (`472c44d`) corrects the three workers to validate managed secret API keys before any work; see [the authentication contract](service-worker-authentication.md).

## Environment and data boundaries

The live environment metadata matched staging mode, `https://thelivingroom.vet`, and disabled outbound delivery. Reminder activation and provider credentials were absent. Credentials used for probes were read into process memory from the authenticated CLI; no key value was printed or stored in Git.

Exact post-probe counts showed only app_settings populated with the same eight rows. Auth users and Storage objects remained zero. No clinical acceptance, invoice preparation, inbound event, message, invitation or staff account was created.

## Remaining acceptance

Actual staff sessions, authorized invoice/release preparation, private Storage upload/download, provider signature/delivery callbacks, reviewed ezyVet imports, Auth SMTP and monitoring remain separate gates. Missing-provider 503 responses are expected safeguards, not successful provider integration. Staff identity and the existing DNS approval request remain pending.

## Corrected workers and final hosted proof

The three workers were redeployed together from `472c44d`. Each reports ACTIVE, version 2, with `verify_jwt=false`; the handler performs managed-secret authentication. The seven staff/retired endpoints retain `verify_jwt=true`. The two provider webhooks and public intake retain `verify_jwt=false` with their own signature/configuration checks. The hosted inventory contains exactly the 13 reviewed functions.

Before privileged probes, live checks reconfirmed disabled outbound mode, no reminder activation, no provider credentials, zero provider events and zero outbox rows. Modern secret credentials were obtained in process memory without logging their values. Each worker received four requests: missing credentials, a public key, an unknown key, and a valid managed secret key. The first three returned 401. The unknown key was rejected by the platform; injected entrypoint tests separately cover handler rejection. Valid requests returned:

| Worker | HTTP | Exact result |
| --- | --- | --- |
| dispatch-outbox | 200 | `{"processed":false,"disabled":true}` |
| queue-reminders | 200 | `{"disabled":true,"queued":0,"dispatched":false}` |
| process-inbound | 200 | `{"processed":false}` |

The inbound request was made only after confirming no work was queued and inbound providers were unconfigured. It verifies that the worker's authenticated database client can execute its service-only RPC; it does not prove provider retrieval or client matching. A final exact count query again found only eight app_settings rows, zero Auth users and zero Storage objects.

In total, 23 initial denial/configuration probes and 12 corrected-worker probes passed. The earlier legacy service probe failed as documented and is not counted as a pass. The code correction passed 167 unit tests, lint, TypeScript, production build and all 15 frozen Edge checks before deployment. PR45's frontend/database/Edge CI is green; later PRs have their own CI gates.

Use managed secret keys in `apikey` for worker invocation, following [Supabase's service authentication guidance](https://supabase.com/docs/guides/functions/auth). Do not put these credentials in browser configuration or use staff invitations, valid contact submissions or queued inbound events as harmless health probes.
