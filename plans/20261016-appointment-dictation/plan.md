# Appointment dictation

Authorized: build appointment → confirm patient → saved encounter → explicit microphone start before VetRocket.

## Design
- Immutable, private one-to-one appointment/encounter link, retaining patient, household, actor/session and clinical appointment context.
- Read context without writes. Explicit confirmation verifies live staff session, appointment version, active patient and ownership. Repeated/concurrent confirmation reopens the same encounter; never chooses the latest patient encounter implicitly.
- Staff may explicitly link an existing unsigned patient encounter or create a blank draft using actual visit time and appointment location/type. Existing SOAP stays untouched.
- Context changes (patient, household, scheduled time, visit type/address) block reuse; signed records stay read-only. Status-only completion permits reopening an existing draft, never creation for a completed visit. Cancelled/no-show visits block recording.
- Day/week schedule action opens Medical SOAP section with appointment context. Patient confirmation remains separate from consent/source attestation and microphone start. Unsaved-change protections remain active.
- Revalidate appointment and encounter version immediately before starting the microphone. Processing policy stays draft/OFF; no provider/model changes.

## Work
1. [x] Migration + staff RPCs + SQL access/idempotency/context tests.
2. [x] Shared schedule link, patient context confirmation and recorder preflight.
3. [x] Actual Auth/HTTP concurrency and browser proof on laptop/mobile viewport; SQL regression, lint/types/unit/build.
4. [ ] PR, required CI, authorized merge, staging then primary migration, exact production deployment and read-only smoke.

## Acceptance
One appointment has one encounter across repeated/concurrent confirmations, including lost HTTP responses. Wrong patient/actor/version, inactive patient, cancelled/no-show and changed context fail closed. Existing drafts preserve text and signing. Staff attribution is the actual starter, independent of assigned doctor. No route load or preparation opens the microphone. UI remains usable at 390px and desktop.

## Limits
Actual iPhone hardware and screen-lock/background capture remain unverified. This is clinician dictation; multi-speaker ambient exam recording is a separate validation task. Susan's recording/retention policy approval still required for provider processing.

## Sources
Existing ClinicalWorkspace, ClinicalDictationAudio, scheduling catalog/care locks and clinical_dictation_actor; read-only schema scout. [Supabase database functions](https://supabase.com/docs/guides/database/functions), changelog checked 2026-10-16. No provider contract changed.

## Local validation
159 SQL suites / 6,738 assertions passed; 1,525 unit tests and lint/typecheck/build passed (four existing React refresh warnings, existing bundle-size warning). Real local Auth/HTTP/browser/restore proof: 38 API, 21 browser, seven SQL/restore assertions; 405 restored relations, two observed HTTP lock waits, three lost committed browser responses recovered (appointment preparation, audio reservation and generation), zero real provider requests. Desktop and 390px Chromium only. Final UI review also blocks AI-review actions while an appointment is opening.
