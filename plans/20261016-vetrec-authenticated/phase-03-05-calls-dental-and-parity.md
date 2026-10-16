# Phases 3–5: call notes, dental dictation and remaining scribe scope

Status: planned. Implement as separate reviewable increments after shared source/template contracts. Reuse the existing native systems; vendor UI is workflow evidence, not a reason to replace them.

## Phase 3 — patient-linked call drafts

Outcome: authorized staff explicitly selects a household conversation, patient and unsigned encounter, reviews a complete permitted call transcript, then generates a source-cited clinical draft. Calls may mention several pets; phone-number matching cannot select the patient automatically.

1. Inspect current `src/hub/features/cloudtalk/{CloudTalkCallEntry,CallMediaControls,thread-entry,cloudtalk-db}.ts[x]` and `supabase/functions/cloudtalk-call-media/index.ts`. Existing media access is ADMIN-only; preserve it unless a separately approved role policy is implemented in both UI and backend.
2. Add a clinical adapter under `src/hub/features/clinical/call-drafts/` and a private migration for immutable call-to-patient source manifests/review receipts. Pin provider call identity, all required transcript pages/segments, timestamp boundaries, content hash, actual importing actor and explicit pet mapping.
3. Generate through the shared reviewed-note contract. Keep original speaker/timestamp attribution; uncertain speaker or pet attribution needs review. Provider `ai_summary` is background display, not evidence-equivalent to the complete transcript.
4. Revalidate source authority and encounter version at generation/review. Never silently promote an inbox summary into the chart or attach the same call to every pet in a household.

Acceptance: unauthorized media denied server-side; incomplete pagination detected; ambiguous pet/name/speaker is flagged; wrong household rejected; lost response and duplicate acceptance safe. Synthetic/stubbed calls only until existing provider and recording policy authorizes real clinical processing. No new outbound dialer needed for the first adapter.

Checklist: [ ] source contract/access policy; [ ] adapter + reviewed proposals; [ ] SQL/Auth/browser/concurrency proof; [ ] clinical review, CI, staging and release.

## Phase 4 — dental dictation proposals

Outcome: selected saved patient/tooth chart receives reviewable proposed tooth findings and procedures. Voice/text parsing never mutates the chart directly.

1. Reuse `src/hub/features/dental/{PatientDentalChart,tooth-chart}.ts[x]` and existing save/sign/addendum RPCs; add proposal schemas/UI under `src/hub/features/dental/dictation/` and narrowly scoped private persistence in a new migration.
2. Pin species, dentition, exact chart version, transcript/version and vocabulary/template manifest. Each tooth claim cites its spoken text and has a validated tooth ID, finding, measurement with units/site, and planned/performed status.
3. Review ambiguous tooth numbers/left-right corrections, absent versus extracted, historical versus today and planned versus performed. Unsupported tooth IDs or missing measurement context fail validation. Do not mark unmentioned teeth normal or missing.
4. Select/edit proposed changes with a clear chart diff; accepted changes call the existing unsigned chart path with expected version. Signed chart changes require existing addenda. Generate printable chart using existing document path only after review.

Acceptance fixtures: canine/feline and permanent/deciduous boundaries, 108 versus 208, corrected tooth number, millimeters/sites, missing versus extracted and proposed versus performed extraction. Wrong patient/chart/species, stale version and duplicate acceptance rejected/reconciled. Actual source-fidelity review before real use; VR-A13 preview is not dental generation evidence.

Checklist: [ ] tooth proposal contract; [ ] source-backed generator; [ ] reviewed chart diff; [ ] existing signing/recovery tests plus new browser cases; [ ] clinical review, CI, staging and release.

## Phase 5 — separate explicit acceptance work

| Capability | Next bounded work | Acceptance boundary |
| --- | --- | --- |
| Discharge draft | Separate owner-facing artifact generated from reviewed encounter facts, with patient identity and medication instructions carried exactly | Explicit review; incomplete dose/route/frequency stays flagged; delivery only through existing authorized send flow |
| Multi-pet recording | Explicit saved-patient list, source segment attribution, per-patient preview and independent review/receipts | Ambiguous segment cannot populate several charts; one patient's refusal/history never becomes another patient's fact |
| Ambient consultation | Separate diarization, speaker/owner attribution, noise and interruption evaluation; revisit duration/codec support from current canonical WAV capture | Current clinician dictation must not be marketed as validated ambient capture; require consent/retention approval and real device acceptance |
| Mobile resilience | Actual iPhone/Safari plus laptop, tab switch, interruption, mic loss, screen lock, restart and recovery tests | Chromium at a mobile viewport alone is insufficient. Visible incomplete source if recovery is partial |
| Language/detail preferences | Versioned output-language/style contract and bilingual veterinary source-fidelity fixtures | No undocumented medical translation or numeric/unit conversion; changing detail cannot add clinical facts |
| Practice glossary | Approved spelling/reference entries, conflicts and version pinning; separate transcript hints from note-only replacements | No blind drug substitution, doses or patient facts as glossary defaults; no claim that edits retrain a model |

Do not add Case Board, Rounds, Coaching, Analytics or a vendor-style collaboration suite solely because menu labels exist; these are outside the requested recording/recap/call/dental scope. VetRocket viewer and PACS ingestion remain their own workstream with separate authenticated access and supported contracts.

Cross-phase release: actual operator/session, immutable sources, audited review, no automatic signature, no real processing while policy inactive, appropriate tests/CI, staging and per-PR merge approval. No existing system deletion planned.

Open dependencies: call-media role policy; Susan's source/templates/recording-retention approval; actual iPhone acceptance; provider/sample authorization for features not yet tested.
