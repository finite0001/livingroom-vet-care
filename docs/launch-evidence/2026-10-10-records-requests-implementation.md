# Package 2C — records requests and selective sharing

Implementation checkout: `feat/records-requests-20261010`, based on merged PR #236 (`77cf8d52af68a9372a716838e260ec65ea5649c4`). Local engineering verification passed; the review PR and required exact-head CI are the next gate. This package has not been merged or installed on either hosted backend/frontend.

Dave selected **client contacts and authorized third parties**. Third-party delivery uses a named, independently verified email destination and client authorization for one exact numbered manifest. Client texts retain the protected document-link workflow. Every original launch requirement remains required.

## Staff workflow

- Records requests appears under Tools and is reachable from patient Documents, household Documents and existing tickets. Ticket text never guesses patient identity; staff select an authoritative patient/household.
- Incoming/outgoing requests retain assignment, calendar request/due dates, subset, counterpart and notes. Version checks preserve drafts when another staff member changes the request. An uncertain action retains its exact submitted content and action ID, with read-only receipt lookup and unchanged retry.
- Incoming receipt requires actual same-patient finalized originals and exact versions with matching private Storage metadata. Fulfillment rechecks those originals under row locks. Historical receipt evidence remains separate from current availability.
- Full eligible chart, vaccine-only, laboratory and custom selection capture a complete bounded source census with exclusions. An immutable manifest numbers packages around existing 20/100-family limits, 24 original attachments, 1 MiB reviewed snapshot and conservative 32 MiB encoded transport budget. Required original/provenance groups stay together. A single oversized group fails explicitly; nothing is silently dropped.
- Every package has a fixed release UUID, exact selection, schema13 snapshot and hash. Request confirmation calls the existing private clinical confirmation core and atomically records the package/release association. The ordinary public confirmation RPC cannot bypass that association.
- Staff review the exact numbered HTML report and originals, confirm each package, then use the existing email or protected-text composer. Laboratory originals that expand the requested scope need an extra acknowledgment. This work does not add generated clinical PDFs; that remains phase 3.
- Queue/acceptance/uncertain/failure states remain distinct from provider-confirmed delivery. Outgoing fulfillment requires delivered evidence for every numbered package and explicitly does not claim the recipient read it.
- Third-party authorization records client authority, destination verification, exact manifest, staff actor, expiry and optional finalized supporting document. Revocation remains available after fulfillment. Private authority notes and supporting-evidence metadata do not appear in outward report HTML.

## Authorization and rollout boundary

Migration `20261011025251_records_requests_and_packages.sql` raises the canonical inventory to **173**. New ledgers are private/RLS enabled with no direct API grants. Explicit staff RPCs require a currently active clinical staff session. Internal helpers and renamed clinical cores have no PUBLIC/anonymous/authenticated/service execution grants.

The existing clinical release policy still gates confirmation. The separate `record_request_disclosure_policy` starts **empty/off** and has no staff/provider commissioning API. Installation does not authorize third-party disclosure. A trusted operator must record actual practice review separately. Cancellation/revocation serializes on the request row with final authorization; an external request already started cannot be recalled. Suppression, current actor eligibility, source validity, lease checks, frozen payload verification and provider flags remain in force.

Future owner-approved rollout order:

1. Verify the exact PR head and required frontend/edge/database checks; obtain Dave's specific approval for this PR.
2. Install the reviewed 173rd migration on staging, then primary after the staging proof. Never target legacy `ugpyjacqganaqtsiekay`.
3. Deploy shared-renderer consumers: `prepare-release-email`, `prepare-document-link`, `recover-document-link`, `retrieve-document-link`, and `dispatch-outbox`. Database migration precedes functions/frontend. Confirm each dependency against the final source inventory.
4. Verify the frontend/backend pair, staff queue/preview access and default-off policies without real client grants or sends. Preserve current Stripe/provider/scheduler commissioning settings.
5. Obtain practice acceptance of the clinical form and third-party authorization workflow; commission only after that acceptance. Real provider round trips need separately named authorized test recipients.

## Evidence

| Verification | Result |
|---|---|
| Clean migration replay | 173 migrations |
| Full SQL regression | 140 files / 5,695 assertions passed before the final evidence cases |
| Final records-request SQL suite | 52 assertions passed; combined final inventory is 5,706 |
| Genuine owned local Auth/private Storage/renderer/email queue | 36 assertions passed; zero provider HTTP requests |
| Observed concurrency | 23 checks passed; owned race database removed |
| Unit / TypeScript / lint / production build | 1,298 unit tests and all checks pass; four existing lint warnings and existing bundle warning |
| Browser | Nine new workflows pass; 504 broad-run cases passed, one baseline skip, all six initial failures pass on focused rerun |
| Edge | All entry points pass `deno check --frozen` |
| Restore guard diagnostics | 10 tests pass |

The photo mock now generates its original bytes before registering the HTTP interceptor, preventing `page.evaluate` from racing a page reload. Numbered-report validation runs inside the query boundary so malformed reports show a local retry error and retain the request draft. These fixes were driven by observed browser failures.

Required exact-head CI will provide the complete quiet browser/database run; its immutable checks are linked from the PR. No provider HTTP requests or hosted mutations were made for this implementation.
