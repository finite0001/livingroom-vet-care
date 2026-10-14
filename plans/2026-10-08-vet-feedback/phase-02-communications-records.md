# Phase 2 — Daily communications, reminders and records requests

**Status:** 2A implemented in [PR #235](https://github.com/finite0001/livingroom-vet-care/pull/235); merged, deployed and verified on staging and primary; practice acceptance pending. Package 2B [PR #236](https://github.com/finite0001/livingroom-vet-care/pull/236) is approved and merged as `77cf8d52af68a9372a716838e260ec65ea5649c4`, deployed and verified on staging and primary. Both backends have 172 migrations; 105 rollback assertions passed on each, plus 33 genuine staging Auth assertions. Production has no configured clinical intervals or recurring delivery policies. Practice acceptance remains pending. [2B hosted rollout](../../docs/launch-evidence/2026-10-10-care-recurrence-rollout.md). Package 2C records requests and selective sharing is approved and merged in [PR #237](https://github.com/finite0001/livingroom-vet-care/pull/237), merge `3bd3f002b78b65d1eed6cccf711d355aa67ba3c4`. Staging and primary have 173 migrations, all five affected functions installed, and verified frontend/backend pairs. Hosted proof passed 52 rollback assertions on each backend and 22 genuine staging Auth/private-file/renderer assertions. No provider messages were sent; practice acceptance and disclosure commissioning remain pending. [2C hosted receipt](../../docs/launch-evidence/2026-10-11-records-requests-rollout.md). Phase 3 has a [concrete package plan](../2026-10-11-diagnostics-pdfs/plan.md) and [local 16-page PDF engine proof](../../docs/launch-evidence/2026-10-11-diagnostics-pdf-engine-proof.md); hosted worker isolation/private recovery and structured diagnostics remain to implement. [2A implementation receipt](../../docs/launch-evidence/2026-10-10-daily-communications.md). [2A hosted rollout](../../docs/launch-evidence/2026-10-10-daily-communications-rollout.md). **Priority:** high. **Requirements:** N08, N11–N13, N22; H02, H05–H06, H10, H14, H19. **Depends on:** baseline, strict contact policy; Phase 3 adds generated PDFs and Phase 6 invoice reminders.

## Implementation packages

### 2A — One accurate Daily communications view

- Preserve `/hub/deliveries`; rename navigation, page heading and mobile label to **Daily communications**.
- Replace the legacy-table-only read with a staff-safe read model across canonical `communication_outbox` and relevant retained delivery history. Deduplicate by canonical message/delivery association; retain attempts as history rather than duplicate messages.
- Default to today's America/Denver date with day/range, channel, status and patient/client filters and server pagination. Include scheduled, queued, provider-accepted, delivered, failed, uncertain and suppressed states without presenting acceptance as delivery.
- Link to the responsible thread/record and the correct existing retry mechanism. Do not create a second dispatcher or expose provider secrets, raw capabilities or privileged recordings in this view.

### 2B — Standard and patient-specific care plans

- Extend reviewed vaccine/lab infrastructure with wellness and custom recurring-care categories. Store recurrence amount/unit, anchor (e.g. completed service vs fixed due date), template version, clinician approval and patient override.
- Clinicians set annual wellness and quarterly/annual bloodwork examples as practice rules; code must not infer clinical intervals. Define completion/replacement before scheduling exactly one next occurrence.
- Use calendar-date recurrence for clinical due dates, not a fixed 365-day/90-day timer. Define month-end/leap-day behavior in the reviewed template. Store instants in UTC and interpret practice day/quiet hours in America/Denver; test DST and replay of an already-completed occurrence.
- Apply channel preferences, consent, timezone, quiet hours, deduplication, stop rules and final eligibility checks to every new reminder source. Show blocked reasons clearly and preserve staff-editable drafts after recoverable errors.
- Extend existing deceased-patient candidate, invalidation and final-attempt guards. Cover work already queued/claimed and retries. Never globally unsubscribe a household merely because one pet dies. If birthday automation is configured, it uses the same patient-specific eligibility.
- Define the cancellation boundary at the committed, final authorized attempt-start transaction. Serialize that check with relevant patient-status changes using a consistent lock order across the complete wrapper/trigger chain. Death recorded before this boundary blocks the routine attempt. Once an attempt has started, a provider call may already be in flight; preserve its actual accepted/delivered/uncertain outcome and stop subsequent routine attempts. Do not claim a started send was recalled or reset an uncertain SMS into a fresh retry. [Shared delivery contract](implementation-contracts.md).

### 2C — Records-request queue and selective sharing

- Add request records linked to household/patient, direction, requester/recipient, requested subset, assigned staff, requested/due dates and lifecycle: requested → awaiting response/preparing → received/ready → fulfilled, with cancelled/blocked states.
- Incoming fulfillment links the actual uploaded original; outgoing fulfillment links the reviewed release and delivery outcome. “Prepared” and provider acceptance are not silently labeled receipt by the recipient.
- Decide recipient scope explicitly. Existing client-contact release checks remain in force. If Dave selects authorized third parties, add a recipient-authorization record identifying the named clinic/person, exact verified destination, authority/basis, approved patient/source scope, authorizing staff and expiry/revocation where relevant. Preview that recipient with every release and audit disclosure. A free-text queue recipient must never bypass existing release permissions. Third-party sharing stays unavailable until this policy and server path are implemented.
- Surface a **Records requests** queue and links from patient Documents/household/tickets. Preserve existing ticket records; link them rather than replacing tickets with an unrelated facilities domain.
- Add vaccine-only, labs-only and full-record selection presets on top of existing explicit selection. Show exactly what is included, including any original reports, before preview/share.
- Support large charts explicitly: current record-family selections cap at 20 or 100 items and email has attachment-size limits. Enumerate the complete authorized source set with pagination into an immutable manifest, disclose unavailable/unreviewed items, and create reviewed numbered packages where needed. Prove every selected source appears exactly once across packages; never silently truncate “all records.” Use authorized document download links for packages too large for email, preserving recipient/scope controls. Do not silently raise limits without validating renderer, server and provider capacity.
- Email carries verified file attachments; texts use the existing protected document-link flow. Phase 3 adds PDF artifacts; don't promise SMS file attachment support from an email attachment path.

## Files and schema

| Action | Absolute path | Change |
|---|---|---|
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/pages/DeliveriesPage.tsx` | Daily view and filters |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/hooks/use-outbound-deliveries.ts` | Canonical read model |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/components/layout/nav-items.ts` | Shared label and queue navigation |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/care-reminders/` | General plans, recurrence and eligibility explanation |
| Modify | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/record-releases/PatientRecordReleases.tsx` | Presets and request linkage |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/src/hub/features/records-requests/` | Queue and request editor |
| Create | `/Users/davidedler/Developer/lrv-feedback-plan-20261008/supabase/migrations/<next>_care_and_records_workflows.sql` | General plans, requests and safe communication read model |

Inspect and extend the latest definitions of `reminder_delivery_context`, `care_invalidate_jobs` and `start_communication_attempt` in a new migration. New writes retain staff authorization; disclosure uses the existing release policy and recipient checks.

## Acceptance

- [ ] A current automated reminder and manual message appear on the correct Denver date with correct status and no duplicated history.
- [ ] Annual/quarterly/custom recurrence, reschedule, cancellation and patient override produce exactly the expected occurrences.
- [ ] Record death after enqueue and after claim, before final attempt start: routine message is blocked; living sibling remains eligible. A concurrent death/attempt-start test proves ordering without deadlock. Death after attempt start preserves the actual in-flight/provider result and blocks further routine work; uncertain SMS is not blindly resent.
- [ ] Stop/opt-out and invalid contacts block sends; contact presence does not bypass consent.
- [ ] Request queue persists assignments and scope; fulfillment links real evidence; selected release excludes unselected records.
- [ ] A chart exceeding current per-family and email limits exports in complete numbered packages; manifest and actual artifacts match exactly. Client-only permissions stay enforced; if third-party sharing is selected, unauthorized/changed/revoked destinations fail and the authorized destination is audited.
- [ ] Add SQL/concurrency cases around recurrence, death and retry; extend pipeline-ownership, record-release and browser suites. Test actual provider round trips only during authorized commissioning with named test recipients.

**Risks:** duplicate legacy/canonical deliveries, sending a stale plan and confusing request completion with message preparation. Use canonical message IDs, final server checks and explicit lifecycle states.
