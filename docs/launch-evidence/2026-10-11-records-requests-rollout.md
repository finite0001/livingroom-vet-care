# Records requests — hosted rollout

> Historical receipt for the October 11, 2026 PR #237 rollout. Migration counts, function versions, deployment identifiers and next steps below describe that run, not current hosted state. Restored to current main on October 18 without rerunning hosted probes or changing practice approvals. The subsequent diagnostics/PDF work is recorded in the [numbered-record package rollout](2026-10-13-diagnostic-pdf-record-packages-rollout.md).

Dave approved PR #237 for merge and hosted rollout on October 11, 2026. [PR #237](https://github.com/finite0001/livingroom-vet-care/pull/237) merged at `2026-10-11T14:53:39Z` as `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`, from approved head `28b984440ba048d5e2530588c88a8f6231b2fa15`. Approved head and merge share Git tree `fc2bfa3827c48310eb469773798997d7fdce8c31`. All required [exact-head CI checks](https://github.com/finite0001/livingroom-vet-care/actions/runs/38111089726) passed: 1,298 unit tests, 514 browser tests plus one existing skip, 140 SQL files / 5,706 assertions, 23 race checks and 36 genuine local Auth/Storage/renderer/typed-email assertions. Zero local provider HTTP requests.

## Backend installation and proof

Both hosted inventories started at 172 migrations, latest `20261010170259`. Both dry runs identified only `20261011025251_records_requests_and_packages.sql`, SHA-256 `46d04df37bd6b1b0d3efcdc36bc9b1a480048e4c250525ed7abd6a0a4ddb166c`. Installed staging `kothoqicubowyhwfsrte`, verified staging, then installed and verified primary `mgadheotkdnrsatfivjy` before merging the frontend. Both now have **173 migrations**, latest `20261011025251`; final dry runs from the reviewed source report no pending migrations. `--skip-vault` preserved Vault configuration. No seeds, role imports or locally generated types. Legacy `ugpyjacqganaqtsiekay` was never targeted.

- **52 pinned rollback-only SQL assertions passed on each host.** Every synthetic identity, clinical record, Storage metadata row, clinical/disclosure policy acceptance and request/package/authorization ledger write was rolled back. Before/after counts and content hashes across the checked records, clinical, communication, audit and financial tables match. Tests verify full 101-source partitioning, no duplicate/omitted sources, immutable receipts, wrong-household/ticket denial, true finalized incoming evidence, explicit scope expansion, oversized connected-source rejection, cancellation/revocation, default-off disclosure and inactive/anonymous/service-role denial. No provider requests.
- **22 genuine staging Auth/private Storage/numbered-renderer assertions passed.** Strict app schemas accepted returned receipts/history/packages. Actual synthetic PDF bytes were uploaded/downloaded, received and fulfilled; sibling evidence was rejected. Named authority was recorded and revoked, while confirmation remained denied with both release/disclosure policies empty. This proof never captured/enqueued an email, enabled a policy or invoked a provider.
- The first Auth proof passed its assertions but cleanup attempted to cancel an already fulfilled request, which correctly rejected the transition. Remaining cleanup completed; aggregate verification showed no active identities, open requests, active authority, ready originals or unexpired sessions. The reproduction helper now treats fulfilled/cancelled requests as already closed. A second full 22-assertion run passed including cleanup. Four synthetic patients are archived; six requests retain their fulfilled/cancelled history; two originals are voided with private synthetic bytes retained as evidence. Four identities are inactive/banned with refresh tokens revoked and sessions expired. No real reviewer was impersonated.
- Primary retained its **three historical outbox rows / three attempts and zero payment profiles**. No persistent synthetic primary account, patient, policy or request was created. Staging retains zero outbox rows/attempts and its pre-existing one test payment profile.
- All ten new request ledgers have RLS and no direct SELECT/INSERT/UPDATE/DELETE grants for anon, authenticated or service_role. SQL authorization assertions cover staff RPCs/private helper denial. Security advisors returned **no ERROR notices** on both hosts.

Reproduction helpers: [rollback-only hosted SQL proof](../../scripts/rollout/records-hosted-probe.py) and [staging-only Auth proof](../../scripts/rollout/records-staging-auth.ts). The SQL proof pins its source hash and refuses nonempty existing request/disclosure inventories; do not rerun it on retained staging fixtures or commissioned practice records. The Auth proof refuses any existing release/disclosure policy. Keys/passwords exist only in process memory; no login credential artifact was written.

## Edge functions

Deployed the approved source to all five changed shared-renderer consumers after the migration. CLI upload transport errors were reconciled against function versions and successfully retried; no code or secrets changed for the retries.

| Function | Staging version | Primary version | Gateway JWT |
|---|---:|---:|---|
| prepare-release-email | 23 | 23 | true |
| prepare-document-link | 22 | 19 | true |
| recover-document-link | 22 | 19 | true |
| retrieve-document-link | 22 | 19 | false |
| dispatch-outbox | 26 | 27 | false |

All are ACTIVE. Unauthenticated POST probes returned 401 for staff endpoints and dispatcher; public document retrieval returned 503 while uncommissioned. Worker-key and capability authorization remain the intended boundaries for `verify_jwt=false`. No worker invocation, real grant/send, financial profile, provider secret/mode, scheduler or practice role change was made.

## Hosted frontend pair

Production **READY**: `dpl_66BGe1DCW1qEBLdndkUxwPNL1oqg`, `livingroom-vet-care-9tkh5jkq4-daves-projects-e0da43ba.vercel.app`, exact merge SHA. `https://thelivingroom.vet/hub/tools/record-requests` loads entry `/assets/index-D-goW6AZ.js`, which contains only the primary backend reference.

Staging preview **READY**: `dpl_EqBvHVqPJGuVd88sQrfUvpGJ5n9Q`, `livingroom-vet-care-8glr3srmb-daves-projects-e0da43ba.vercel.app`, exact approved head. After production reached READY, stable alias `livingroom-vet-care-daves-projects-e0da43ba.vercel.app` was pinned to this preview. Its protected entry `/assets/index-eYXfQvNf.js` contains only staging. Vercel protection remains enabled; existing scoped CLI authentication accesses the protected assets. Authenticated deployment metadata confirms team/project/repository/commit for both builds.

The existing signed-in owner session rendered both hosted Records requests pages. Primary shows an empty queue. Staging shows retained closed synthetic requests, immutable history, revoked recipient authority and the practice-review gate. Its numbered package preview renders the exact selected recipient/original metadata without private authority/destination notes; confirmation is disabled. No save, confirmation, original deletion, communication enqueue or send was performed in the UI.

## Acceptance and continuation

Package **2C is merged, installed and engineering-verified**. Both clinical release and third-party disclosure policies remain empty/off. Actual practice acceptance and later commissioning are still pending, and this engineering receipt does not provide either. All 45 original requirements remain required before launch.

Next is phase 3: structured in-house diagnostics, compatible longitudinal trends and durable generated PDF artifacts. Begin with the existing lab/release contracts and the required PDF runtime/private-registration/recovery feasibility proof. Do not infer a hosted browser renderer from a local print success or activate a paid service implicitly.
