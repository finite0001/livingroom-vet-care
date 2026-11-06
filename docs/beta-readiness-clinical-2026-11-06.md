# Clinical integration audit — 2026-11-06

Base reviewed: `b8767ff2e560f23d884194b5e9f875c0c647532a` (`origin/main` at audit start). This report covers source integration and local synthetic tests. It does not certify a deployed database, clinical policy, real provider connection, or production patient workflow.

## Confirmed defects corrected

### Clinical saves did not refresh an already-open record package

Patient 360 deliberately retains visited tabs. `PatientRecordReleases` also disables focus/reconnect refetches so a review is not silently replaced. SOAP save/sign/addendum and problem changes previously refreshed their own queries only. Opening Documents, returning to Medical, and signing a new encounter therefore left the Documents source list unchanged until an explicit refresh. Existing release previews also missed the source-invalidation notification used to require fresh review.

The same omission existed in confirmed dental/anesthesia/care-chart changes, certificate issue/void, treatment/stock changes, and patient details/weight saves. These confirmed-success paths now call the existing `refreshPatientReleases` helper. Known-patient changes retain patient scope. Shared chart/stock mutation handlers that have only a record identifier invalidate release-query families across cached patients, without deleting their data. Uncertain or rejected operations do not enter the success path. Certificate void invalidates after the confirmed write and before its follow-up read.

The release workspace already observes invalidation and preserves selection/uncertain requests while requiring fresh evidence for a new confirmation. This change uses that mechanism; it does not relax backend version, identity, source, or release checks.

Verification:

- A new browser regression first failed against unchanged application code: after a successful SOAP save, the already-mounted source query still had exactly one read rather than refetching. The test continues through signature, visibility of the new signed source, addendum, and problem save.
- Three executable QueryClient tests pass: active candidates refresh while sibling cache remains untouched; record-only mutations mark cached sources/history stale; a disabled query backing a frozen preview retains its evidence and does not refetch automatically.
- The full browser result is recorded in the consolidated beta audit; early focused runs also exposed an incomplete new test fixture (`recorded_at`) and cold-load timing, which are not application findings.

### Diagnostic PDF guidance lagged behind implemented sharing

`DiagnosticPdfReview` still said outgoing packages excluded PDFs until record sharing became available, directly below the implemented sharing-scope controls. The footer now directs staff to review scope and confirm a numbered package in Records requests. This does not imply that provider/PDF gates are enabled in a hosted environment.

## Integration trace and boundaries

| Workflow | Source chain reviewed | Evidence and remaining boundary |
| --- | --- | --- |
| Patient → SOAP → signature → addendum → record release | `patients/PatientPage.tsx`, `clinical/ClinicalWorkspace.tsx`, clinical RPCs, `record-releases/PatientRecordReleases.tsx` | Explicit save, expected-version checks, signed-text lock, append-only addenda, retained tab drafts; refresh defect corrected above. Browser tests use synthetic HTTP responses. |
| Appointment → dictation encounter | `clinical/appointment-dictation/{AppointmentDictation,api,model}`, migration `20261016200826_appointment_dictation.sql` | Staff confirms patient/household/appointment. Server checks appointment version, active patient, context and existing encounter. Before microphone start, UI rechecks the linked encounter/version. |
| Recording → transcript → proposed SOAP → clinician review | `clinical/dictation/audio`, `clinical/dictation/ClinicalDictationReview.tsx`, `clinical-audio-process`, shared audio handler/model | Browser WAV capture is separate from provider processing. Actor/job/version and original-attempt recovery are explicit. Saved proposals do not sign or silently replace SOAP; provider processing requires policy/configuration. |
| Template notes and private call notes | `clinical/templates`, `clinical/call-drafts`, `clinical-note-process`, `clinical-call-capture`, `clinical-call-note-process` | Source/template versions and hashes, actor-bound recovery, separate call-generation policy, explicit review/acceptance. Runtime/provider acceptance is separate from passing model/handler tests. |
| Clinical recap | `clinical/recap`, `clinical-recap-process` | Source citations, frozen patient context, generation/review stages and separate policy gate. Recap tests cover coverage/fidelity boundary logic, not clinical approval of model output. |
| Prescription → dispense → stock/invoice → pickup/return/correction | `prescriptions/{prescription-api,fulfillment-api,dispense-finance-api,fulfillment-returns-api}`, `PrescriptionFulfillment.tsx` | Preview/execute/recover state, exact quantities and money, authorization/actor identity; controlled writes enter the shared entry gateway. Confirmed prescription paths already refreshed release sources. |
| Controlled entry → witness → saved receipt/recovery | `controlled-drugs/entry/{client,service,ControlledStockEntryProvider}`, witness client | Captured actor/session identity, bounded request/response handling, exact-number decoding, separate prepare/execute, current witness recheck, and retained recovery identifiers. This requires the current commissioned backend; historical 206-migration proofs are insufficient. |
| Controlled counts → corrections/reconciliation → review | `controlled-drugs/count/{count-client,count-management-wire,count-operation-controller}`, record-review adapters | Distinct write/read/closure operations, response and request bindings, bounded single-call deadlines, no automatic mutation retry. Current database installation and business-profile results belong in the backend audit. |
| Manual diagnostics → reviewed PDF → numbered record package | `diagnostics/PatientDiagnostics.tsx`, PDF job/review/scope APIs, record-request workspace | Patient/panel identity, versioned correction/history, immutable reviewed PDF identity and explicit extra-panel sharing scope. Diagnostics already invalidated release candidates. Rendering/download/provider enablement is separately gated. |
| Imaging → private patient document → viewer/report | `imaging/{PatientImaging,api,model}` | Actor/session and patient/source identity, current document version, private signed URL, interrupted-save recovery. Manual study linking is not automatic VetRocket/IDEXX/Antech acceptance. |
| Dental, anesthesia, QOL/body map, vaccines, certificates | Respective Patient 360 sections and mutation adapters | Existing local chart/history flows were retained; source-cache propagation was repaired. Clinical approvals and hosted runtime verification remain separate gates. |

Paths in the table are relative to `src/hub/features` unless named as a migration, edge function, or workspace elsewhere.

## Checks performed

- Reviewed the current route-to-patient workspace composition, query retention, mutation success/recovery paths, clinical API adapters, relevant SQL contracts, and current CI definitions.
- Scanned 145 literal call-site names across clinical, diagnostic, imaging, prescription, controlled, and release areas. All 137 actual RPC names had SQL declarations; the other eight were local generic method names. This is an existence check, not proof that every deployed signature or privilege matches.
- Ran 276 current-source Node tests across clinical editor state, dictation/audio, templates, recap, calls, diagnostics/PDFs, and imaging: **276 passed, zero failures**.
- Ran the three new release-refresh tests: **3 passed, zero failures**.
- Focused ESLint of all changed application/test files: **passed**.
- `git diff --check`: **passed** at the audit checkpoint.
- Parent audit owns the complete lint/type/build/unit/browser run and current database rehearsals; consult its final results for the integrated checkout.

## Beta acceptance still needs explicit evidence

The checked-in `clinical-staff-acceptance-register.json` is dated September 24 and contains **12 clinical decisions, all Pending**. This audit did not invent or record Susan's approval. Clinical audio, templates, recap, calls, controlled rules and current manual-diagnostics flows also need acceptance for the actual beta scope; older checklist coverage should not be treated as automatic approval of later features.

The repository contains **209 migrations**. Older clinical/diagnostic disposable runners call `owned_canonical_bootstrap.py` and hard-pin the 206-migration source; current CI explicitly materializes historical application commit `217a8e97bb32bdaafc555b16a196450a57a5d1bd` for those jobs. That is useful historical regression evidence, not a current-209 end-to-end result. Do not edit away migration seals or relabel those proofs. Use the current installation/business acceptance path for the current backend, and retain this distinction in release notes.

No live clinical provider request, email/SMS, payment, policy activation, hosted data mutation, or deployment was performed by this clinical audit. A synthetic/mock browser result proves client behavior against the tested responses; it does not establish hosted RLS, edge deployment freshness, external device compatibility, or clinical correctness of generated text.
