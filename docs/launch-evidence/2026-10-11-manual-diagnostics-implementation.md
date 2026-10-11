# Manual diagnostics — engineering implementation

Package 3A1 is implemented from merged PR #237, `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`, in isolated branch `feat/manual-diagnostics-20261011`. It is not merged or installed on either hosted backend/frontend. [Package plan](../../plans/2026-10-11-manual-diagnostics/plan.md). All original launch requirements remain required.

The workflow saves manual numeric/qualitative findings, DVM-reviewed versions and append-only corrections. It preserves zero values, source units/reference context, exact source-version links, actor-owned receipt recovery and historical names/identity. Trend series split incompatible measurements and reject changed page censuses. Patient 360 combines peer-editor/dirty state and retains uncertain intents through remounts. Existing order/reminder status is not changed implicitly.

Generated PDFs, schema14 clinical release support and verified PDF transport remain pending in subsequent phase-3 packages. The UI shows this state; complete request manifests include explicit diagnostic exclusions. Neither migration nor engineering proof activates a clinical/disclosure/provider policy.

| Verification | Evidence |
|---|---|
| Canonical replay | 174 migrations; new migration SHA-256 `ec1682c941fc632fda33a963f92295382c7bc0447edeb1ede277cb1849a8f789` |
| SQL regression | 141 files / 5,745 assertions pass; 39 diagnostic cases |
| Unit, TypeScript, lint, production build | 1,308 unit tests pass; TypeScript/build pass; zero lint errors and four existing warnings |
| Focused browser | Seven scenarios pass: mixed/zero findings, staff boundary, partial numeric text, corrections/history, lost reply/remount, stale version and changed attestation |
| Real concurrency | 22 observed-lock checks pass; exact duplicate finalize is one receipt/version; competing corrections do not fork; offboarding and DVM-role removal during waits deny finalization; owned clone removed |
| Genuine local Auth/private Storage/Patient 360 | 35 assertions pass: real identities, actual uploaded/downloaded bytes, wrong patient/stale source denial, immutable reviewed/corrected values, historical original vs current void state, protected helper denial, zero outbox/policies and full real UI save/finalize/reload |
| Layout | Real Patient 360 screenshots at 1200px and 390px; no horizontal page overflow; warm semantic tokens retained |
| Security advisors / restore guard | No local ERROR notices; ten restore diagnostic tests pass |

The local Node/Chromium proof uses only a public local frontend key and a genuine synthetic staff session; no private database credential enters the browser. It opens a uniquely bound local Vite process and closes only that process/browser. Runtime wrappers assert project/container/path ownership and keep CLI status/credentials in memory or a private temporary log. The new owned-runtime CI wrapper replays the exact source inventory, pins harness/migration hashes, and removes its own containers/volumes. Its standalone final rehearsal also passed all 35 assertions and cleaned its owned runtime. Original default/Ondara runtimes are not targeted.

Clinical reviewer/enterer names are frozen rather than read from mutable profiles. The fingerprint binds version/panel/patient identity, reviewed values/source context, predecessor, author/reviewer identity, timestamps and notes. Later account renaming/offboarding cannot change the original evidence. These are engineering invariants, not a real clinician's acceptance.

The SQL assertion and real Auth runs are sequential on a given runtime. Contention uses a separately marked schema-only clone. No provider HTTP requests, real patient account/grant/send or hosted configuration changes occurred. Required exact-head CI and specific merge approval remain the review/rollout gate.
