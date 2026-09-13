# Form fields and decisions — DRAFT v3

All rows await review. Patient panels live at `/hub/patient/:petId`; administration of reviewed care wording/groups is at `/hub/tools/care-reminders`. Paths below are relative to the repository root. This is an inventory of implemented choices, not a proposed clinical protocol. Each checklist is intended to produce a concrete decision in the acceptance register.

## C01 — Encounter notes, history and critical alerts

Source: `src/hub/features/clinical/ClinicalWorkspace.tsx`, `PatientProblems.tsx`, `PatientAlerts.tsx`.

The encounter editor has visit date/time (America/Denver), clinic or housecall visit type, visit location and separate Subjective, Objective, Assessment and Plan text. Clinic location comes from practice settings; housecall location needs review. Signed records retain their original content; subsequent information is an attributed addendum. Historical problems and alerts are separate from the current assessment.

- [ ] Confirm the four free-text sections and signing workflow suit the practice's housecall and clinic records.
- [ ] Decide the required documentation for vaccine reactions and other critical history; verify staff can distinguish a critical alert from an ordinary historical diagnosis.
- [ ] Verify clinician attribution, date/time, location and addenda are understandable when reopened and when selected for release.

Example: records HTML uses existing fixture text “Owner reports improvement.”, “Recorded findings.”, “Reviewed assessment.” and “Reviewed plan.” These statements are fictional, not recommended clinical documentation.

## C02 — Dental chart

Source: `src/hub/features/dental/PatientDentalChart.tsx`, `tooth-chart.ts`; technical/source notes: `docs/dental-charting.md`.

Explicit dog/cat adult or deciduous dentition selects the tooth diagram; unsupported species use manual notes. Each tooth has recorded presence (Not recorded / Present, not an assessment of health / Missing / Extracted), observations/findings, planned procedure notes, performed procedure notes and optional labeled measurements in millimeters. Dental visit time is Denver. General/manual notes, draft save, signing, historical records and addenda are available. Missing/extracted teeth remain represented in history; unrecorded teeth are not prechecked as normal.

- [ ] Review all four tooth layouts and identifiers against the referenced AVDC source, including quadrant orientation and feline absent positions; the single adult-dog example does not validate the others.
- [ ] Decide whether the label plus positive millimeter measurement supports required sites or whether a named-site form is needed before launch.
- [ ] Confirm separation of planned/performed treatment and the absence of an inferred periodontal score.
- [ ] Verify an extracted-tooth record and later addendum remain legible without overwriting the signed original.

Example: fixture tooth 101 is recorded Present with documentary notes and a labeled 2 mm measurement. No diagnosis or recommendation follows from this value.

## C03 — QOL observations

Source: `src/hub/features/care-charts/PatientCareCharts.tsx`; `docs/care-charts.md`.

Fields: observation date/time (America/Denver), observer/source, Appetite, Drinking, Mobility, Comfort, Social engagement, Good and difficult days, Clinical notes. These are qualitative text fields, not a validated numeric instrument or automatic threshold. Drafts can be reopened and signed; later changes use correction/addendum history.

- [ ] Approve or change the qualitative domains and caregiver attribution wording.
- [ ] Decide whether a named, licensed or validated instrument is separately required; no such instrument is claimed here.
- [ ] Verify signed observations and addenda preserve meaning without implying an automatic end-of-life recommendation.

## C04 — Body maps and lesion history

Source: `src/hub/features/care-charts/PatientCareCharts.tsx`, `policy.ts`.

Fields: lesion label, body view, schematic horizontal/vertical coordinates (0–1), observation date/time (America/Denver), optional length/width/depth in mm, linked patient photo and clinical notes. A correction requires a reason. Reopened lesions retain dated observations and correction history. Coordinates describe a schematic, not physical dimensions; blank dimensions differ from zero. Measurements accept finite nonnegative values.

- [ ] Review body-view orientation, keyboard marker control and whether a textual anatomical location is sufficient in notes.
- [ ] Decide if zero is a useful recorded dimension or should require an explicit reason; do not interpret missing depth as zero.
- [ ] Review how photo links, sequential measurements and corrections appear in shared output.

Example: Mass A, left view, x 0.2 / y 0.4, 12 × 10 mm and unspecified depth; the existing fixture includes a correction reason. These are test coordinates and measurements.

## C05 — Native anesthesia records

Source: `src/hub/features/anesthesia/PatientAnesthesiaRecords.tsx`, `AnesthesiaHistorySnapshot.tsx`, `model.ts`; `docs/anesthesia-records.md`.

Fields: procedure, team, start/end date/time, preanesthetic assessment and plan, recovery notes, record source and source detail, optional same-patient original file. Monitoring rows record timestamp, label, finite value, explicit unit and notes. Event rows record timestamp, kind and description; medication events are documentary and do not issue stock or calculate billing/doses. Draft/sign/addendum history preserves the signed record. No monitoring device or vendor feed is represented as connected.

- [ ] Decide which monitoring labels/units and intervals the practice requires; currently staff enter them explicitly with no normal-value defaults.
- [ ] Review the team, recovery and source fields for handoff completeness; identify any required additional field before use.
- [ ] Verify imported/transcribed source descriptions and original-document links cannot be mistaken for live device data.
- [ ] Review timestamps and the signed observation/event sequence, including an addendum.

Example: the existing fixture has “Manual observation”, 80 bpm at a recorded time, and a documentary procedure event. The value has no clinical interpretation in this pack.

## C06 — Vaccine due plans and explicit mappings

Source: `src/hub/features/care-reminders/PatientVaccineDuePlans.tsx`, `CareReminderSettings.tsx`; `docs/care-reminders.md`.

Practice templates contain a canonical group key, reviewed name, exact catalog product IDs, interval in days and review rationale. Patient plans retain template/version, selected mapped product, actual same-patient treatment or sourced historical administration date, standard proposed due date, patient interval, reviewed next-due date, current/proposed/retired state and reminder eligibility. An override requires explanation. Existing plans do not silently adopt later template edits. Correcting an administration anchor requires renewed review.

- [ ] Approve the canonical antigen/group taxonomy and check aliases for duplicate coverage. No brand equivalence is inferred.
- [ ] Supply practice-reviewed products and intervals; synthetic test intervals are not medical defaults.
- [ ] Review historical-source evidence, patient-specific exceptions, proposed/current labels and retirement behavior.
- [ ] Verify last administration and current next due are distinct from catalog duration and certificate claims.

## C07 — Lab orders, due dates and results

Source: `src/hub/features/lab-work/PatientLabWork.tsx`, `model.ts`; `docs/lab-work.md`.

Fields include test name, lab status, optional reviewed interval template, lab due date, patient interval/anchor, override reason, collection/result dates, optional external accession, same-patient ready result document and observations/notes. Standard interval settings have name, reviewed days, active state and clinical-review rationale. Historical results use correction reasons rather than silent replacement. Antech selection does not imply an active vendor connection.

- [ ] Approve status transitions, date meaning and which test-specific intervals should exist; none are prescribed by this pack.
- [ ] Verify overdue work, collected work and a received result remain distinct, and a linked lab file belongs to the same patient.
- [ ] Review correction display and historical provenance. No lab-normal-range interpretation is implemented.

## C08 — Certificates and signature attestation

Source: `src/hub/features/certificates/PatientCertificates.tsx`, `print.ts`; `docs/vaccine-certificates.md`.

The UI distinguishes vaccine and rabies certificates. Rabies issuance selects an actual administration and asks for actual administrator, tag number, formulation/type, reviewed size or weight, owner business phone, USDA licensed product duration selected from the label, dose sequence, signature and explicit attestation. Due dates are reviewed; licensed duration does not calculate them. Corrections/reissues and voids preserve history. General vaccine due-plan inclusion has a separately reviewed versioned selection.

- [ ] Inspect exact rendered attestation, required identifiers, actual administrator versus signer, due dates and product metadata.
- [ ] Confirm which general-vaccine plan information may be asserted and how historical/imported evidence must be labeled.
- [ ] Review missing metadata, source correction, void and reissue behavior; decide whether any jurisdiction-specific wording needs professional review before issuance.
- [ ] Review current certificate format and the version-acknowledgment workflow in the actual UI; the supplied fixture is one schema-v1 rabies example, not every current certificate variant.

## D01 — Invoice disclosure (operational, not clinical acceptance)

Source: `src/hub/features/billing/invoice-document.ts`, billing UI in the same directory.

The rendered invoice distinguishes draft, issued and void state, line quantities/prices, total, credits and net charges. Credits are not payment confirmation; the document is not a payment receipt. Review household identity, practice contact details and charge wording independently of clinical form approval. Fixture quantities, money and escaped strings are test inputs, not a fee schedule.

- [ ] Verify draft/void copies cannot be mistaken for payable issued invoices.
- [ ] Approve charges-versus-payments disclosure and identify payment-processor activation still required.

## D02 — Record-release selection and confirmation (disclosure review)

Source: `src/hub/features/record-releases/PatientRecordReleases.tsx`, `RecordReleaseArtifact.tsx`, `print.ts`, `charts.ts`, `history.ts` (browser re-exports), and the shared production renderers in `supabase/functions/_shared`.

Review explicit selected records, recipient/channel, included shareable originals, original-file requirements, signature/confirmation wording and saved snapshot history. Existing selectors cover signed SOAP/addenda, valid certificates, resulted labs, shareable documents, signed dental/QOL/anesthesia charts, body-map histories, problem/diagnosis revision history, allergy/legacy profile summaries, dated weights and medication/vaccine history. Schema 3 preserves available before/after diagnosis revisions, highlights high-importance problems and allergy information, and retains treatment correction reasons. Legacy weight carries an unknown measurement date; it is distinct from a dated measurement. No absent historical revision is reconstructed.

- [ ] Inspect what the actual rendered example includes and omits; verify no record is silently added by selecting another family.
- [ ] Confirm disclosure of attached originals versus structured summaries and of preview versus confirmed release.
- [ ] Review who is authorized to approve a release; clinical signing, operator sharing-policy acceptance and recipient authorization are separate decisions.
- [ ] Review the schema-4 example: resolved high-importance vaccine reaction with prior active history; allergy text; undated legacy weight versus dated kg measurement; historical medication with retained correction. Confirm that resolved does not hide important reaction history.
- [ ] Compare original ezyVet source weight `25 lb` and raw timestamp with the explicitly reviewed local `11.34 kg` measurement dated `2026-09-01`. The example is documentary, not a prescribed conversion or reference value.
- [ ] Inspect later source-review text containing `26 lb`: the local `11.34 kg` remains unchanged. Confirm that a source-discrepancy review does not imply a clinical correction and that a newer unreviewed source change is clearly labeled.
- [ ] Confirm reviewer identity/time, unknown source clinician, all source associations, and the distinction between a created historical measurement and linking an existing one. The single rendered create example does not validate every link case.
- [ ] Confirm that empty allergy text never establishes absence of allergy, imported/transcribed treatment text is not a new prescription, and missing audit evidence remains explicitly missing.
- [ ] Verify selection and history completeness against known synthetic source records before accepting D02; the rendered fixture does not prove every production record is covered. Schema-4 release confirmation requires separately recorded acceptance of that version; this pack does not provide it.

## D03 — Reminder messages (wording and operational authorization)

Source: `src/hub/features/care-reminders/CareReminderSettings.tsx`, `CareRemindersPage.tsx`; `docs/reminder-dispatch.md`.

Approved plain-text placeholders are patient_name, care_name and due_date. Appointment care_name includes actual Denver time and saved location. Policy activation is separate from wording approval; scheduler deployment defaults off. Source and consent changes are checked before attempts, including retries. Staff labels distinguish prepared, queued, provider accepted/unconfirmed, delivered, failed and uncertain outcomes.

- [ ] Approve each exact template, channel, offset and email subject; do not approve abstract wording categories.
- [ ] Verify clinic versus housecall appointment substitutions and patient-specific reminder exclusions.
- [ ] Confirm acceptable recipient/contact-consent workflow and explicit operational activation review. Template approval alone does not authorize a real message.

## D04 — Frozen email release delivery (operational review)

Source: `src/hub/features/record-releases/ReleaseEmailComposer.tsx`; [implementation contract](../release-email-delivery.md). Preparing an email freezes the rendered HTML report and selected original-file bytes for review. Queueing uses the durable outbox and does not mean delivered. Unchanged preparation/queue retries recover the original identity; current release/recipient eligibility is checked before dispatch.

- [ ] Review exact recipient, subject, body, frozen report and each original attachment before the delivery attestation. Confirm the HTML report format is acceptable to recipients and identify any PDF requirement separately.
- [ ] Verify recovery after an ambiguous preparation/queue response and confirm a second release cannot discard an active composer draft.
- [ ] Confirm delivery-status wording and the distinction between a provider's acceptance and confirmed delivery. No provider account, domain verification or live send is approved by accepting this form.

## D02 supplemental schema5 source review

- [ ] Complete [the source-provenance disclosure checklist](release-source-provenance.md) against [the separate synthetic example](sources-example.html) and the exact integrated staff workflow.
- [ ] Verify explicit source/original selection, historical version labels, local-review versus DVM-acknowledgment attribution, and old-release readability versus fresh-delivery eligibility.
- [ ] Record the exact reviewed revision and any exclusions. Schema5 confirmation remains unavailable until separately accepted; this checklist does not record acceptance.
