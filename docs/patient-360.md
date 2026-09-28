# Patient 360 and household 360

Staff open one screen for a pet (`/hub/patient/:id`) or a household (`/hub/client/:id`) and see everything connected to it: contact and consent, red flags, balance, what needs doing next, and a single history across scheduling, clinical records, prescriptions, billing, messages and calls, reminders and record releases. Each item links to the screen that owns it.

## Routes

The 360 view is the default page for both routes. There are no new routes.

| URL | Opens |
| --- | --- |
| `/hub/patient/:id` | Patient 360, Overview tab |
| `/hub/patient/:id?tab=medical\|communication\|billing\|schedule\|documents` | That tab |
| `/hub/patient/:id?tab=medical&section=soap` | That tab, scrolled to and focused on the section |
| `/hub/client/:id` | Household 360, Overview tab |
| `/hub/client/:id?tab=patients\|communication\|billing\|schedule\|documents` | That tab |
| `/hub/client/:id?tab=invoices\|estimates\|messages\|consent` | Old tab names still work. They open Billing or Communication at the matching section. |
| `/hub/schedule?date=YYYY-MM-DD` | The schedule on that day |
| `/hub/schedule?book=1&client=<id>&pet=<id>` | The existing booking form, prefilled with the household and patient |

Section ids: patient Overview has `vaccines`. Medical has `soap`, `prescriptions`, `treatments`, `vaccine-plans`, `labs`, `care-charts`, `dental`, `anesthesia` and `imported`. Documents has `documents`, `attachments`, `certificates`, `releases` and `external-records`. Household Communication has `messages` and `consent`. Household Billing has `estimates` and `invoices`.

## Layout

Both views share one layout:

1. **Sticky header.** It shows the name, species, breed and age, with a link to the household. It shows red flags: allergies, active high-importance problems, and whether the patient is archived or deceased. It shows the SMS consent state, the preferred channel, and the balance due, which links to billing. Phone numbers and email addresses are one-tap `tel:`, `sms:` and `mailto:` links.
2. **Quick actions.** Each one opens the existing flow for that job:
   - **Message** opens the existing send dialog (`SendToClientDialog`), which checks consent.
   - **Book visit** opens the schedule's booking form, prefilled.
   - **New visit note** goes to Medical › `soap` (`ClinicalWorkspace`).
   - **Record vaccine / treatment** goes to Medical › `treatments`.
   - **Issue certificate** goes to Documents › `certificates`.
   - **Release records** goes to Documents › `releases`.
   - **Invoice / payment link** and **Estimate** go to household Billing.

   On the household view, the per-pet actions are on each card in the Patients tab.
3. **Next steps.** Built from live facts and sorted by priority: needs attention, then follow up, then coming up. The first four show, and "Show more" expands the rest. See the rules below.
4. **Tabs, not one long scroll.** A tab mounts the first time it is opened and then stays mounted, hidden, while other tabs are shown. An unsaved clinical, prescription, certificate, release or billing draft survives a tab switch. A dot on the tab label marks unsaved work. Switching tabs or sections never asks for confirmation. Leaving the record still does, because the navigation guards now compare pathnames.
   - **Patient:** Overview (next steps, vaccine status, details, weight, timeline; red flags are in the header), Medical (important patient history and allergy note first, then all existing clinical components with SOAP first), Communication, Billing, Schedule, Documents.
   - **Household:** Overview (next steps, details, household timeline), Patients, Communication (thread summary, timeline, SMS consent, notes), Billing (the existing `HouseholdEstimates` and `HouseholdInvoices`, mounted from the start as before, plus billing history), Schedule, Documents.
5. **Unified timeline.** Newest first, grouped by practice-time day. It has filter chips (Medical, Prescriptions, Documents, Billing, Messages & calls, Appointments), 20 entries per page, and a "Load older entries" button.

Existing components and queries are reused as they are. The 360 adds no write paths and duplicates no business logic.

## Next-step rules (`src/hub/features/patient-360/model.ts`, `deriveNextSteps`)

| Fact (server) | Step | Priority | Links to |
| --- | --- | --- | --- |
| Draft SOAP, dental, anesthesia or QOL record | "… not signed" | urgent | Medical › matching section |
| Vaccine group with `due_on` before today (from `patient_vaccine_status_summary`), active pets only | "Rabies overdue" or "N vaccines overdue" (one step per pet) | urgent | Overview › `vaccines` |
| Lab order `planned` or `ordered` past its due date, active pets only | "… overdue" | urgent | Medical › `labs` |
| Inbound call marked missed, or voicemail, since the last staff contact | "Return N missed calls and N voicemails" | urgent | household thread |
| Client message newer than the last staff message, or thread unread | "Reply to …" | urgent | household thread |
| Open native refill, or legacy refill in `REQUESTED`, `APPROVED` or `READY` | "Refill request: …" | urgent | Medical › `prescriptions` (legacy: `/hub/tools/refills`) |
| Issued invoice with outstanding balance | "Collect $X balance" | soon | household Billing › `invoices` |
| Draft invoice | "N draft invoices not issued" | soon | household Billing › `invoices` |
| Estimate never published | "Estimate not yet sent" | soon | household Billing › `estimates` |
| Estimate published, not decided, not expired | "Estimate awaiting client decision" | info | household Billing › `estimates` |
| Unsigned prescription draft | "Prescription draft not signed" | soon | Medical › `prescriptions` |
| Lab `collected` | "… awaiting results" | soon | Medical › `labs` |
| Vaccine due plan `proposed` | "… due plan awaiting review" | soon | Medical › `vaccine-plans` |
| Care reminder blocked, or reminder outbox `failed`/`uncertain`, or appointment reminder `FAILED` (last 30 days) | "… reminder blocked or failed" | soon | `/hub/tools/care-reminders` or `/hub/deliveries` |
| Preferred channel SMS but `current_sms_consent` cannot message | "Texting is blocked for this household" | soon | household Communication › `consent` |
| Record-release email `preparing` or `ready`, and not withdrawn | "Record release email not sent" | soon | Documents › `releases` |
| Next `SCHEDULED` or `CONFIRMED` appointment | "Next visit …" | info | schedule day |
| No upcoming visit while vaccines or labs are overdue (active patient) | "No visit booked for overdue care" | soon | prefilled booking form |

Billing is household-level in both views, because the balance due is the parent's.

## Database (`supabase/migrations/20260928170000_patient_360_read_model.sql`)

All four entry points are read-only `SECURITY DEFINER` functions. Execute is granted to `authenticated` only, and each one starts with `clinical_require_staff()`. That is the same gate as the underlying tables' SELECT policies and the existing `list_*` RPCs. `anon` and `service_role` have no grant.

| RPC | Returns |
| --- | --- |
| `read_patient_360(p_patient_id uuid)` | `{version, scope:'patient', patient, household, pets, sms_consent, balance, high_priority_problems, signals}` |
| `read_household_360(p_client_id uuid)` | Same shape with `patient: null`. Signals are aggregated across the household's pets. |
| `list_patient_timeline(p_patient_id, p_kinds text[] = null, p_before_at timestamptz = null, p_before_key text = null, p_limit int = 25)` | `{version, entries[], has_more, next_cursor:{before_at, before_key}}` |
| `list_household_timeline(p_client_id, …same…)` | Same |

Unknown ids raise `P0002`. Invalid kinds, page sizes outside 1–100, half cursors, infinite times and malformed cursor keys raise `23514`.

**Timeline kinds:** `appointment`, `encounter`, `chart` (dental, anesthesia, QOL, QOL scale), `treatment` (practice treatments and legacy `pet_vaccinations`), `lab` (lab orders and `lab_results`), `document` (finalized patient documents; household `client_files` on the household view), `certificate`, `prescription`, `refill` (native and legacy), `estimate`, `invoice`, `payment`, `refund`, `credit`, `message`, `call`, `voicemail`, `reminder` (care jobs, and appointment reminders that are due or sent), and `record_release`.

**Pagination:** keyset on `(at desc, sort_key desc)`, where `sort_key = kind || ':' || id`. Each source is limited to `p_limit + 1` rows after the cursor before the merge, so a page never scans a full history. New indexes support the per-patient and per-household reads: appointments by pet, invoices by client, invoice items by pet, credits by invoice, care reminder jobs by pet, and others.

**Patient scope:** the patient's own records. Appointments, estimates and legacy refills are filtered by `pet_id`. Invoices, and the payments, refunds and credits on them, appear only when the invoice has a line item for this patient. Messages, calls and voicemails are household-level and are shown on the patient too. This is deliberate: the thread belongs to the parent.

**Existing access rules are kept:**

- Patient documents appear only when finalized (`ready` or `void`). Another user's in-progress upload never appears, matching the `patient_documents` RLS.
- CloudTalk recordings, transcripts and AI summaries, `messages.audio_url` and `messages.transcription` are never returned, because recording media is administrator-only.
- Payment collection grants and checkout URLs, document-link capabilities, and rendered reminder bodies are never returned.
- `patient_360_*_internal` helpers are revoked from every API role.

**Estimate status** (`patient_360_estimate_status_internal`): no publication means `draft`. After that it is `withdrawn`, `accepted`/`declined` (from the decision `choice`), `expired`, or `awaiting_decision`. This summary is for display only. The estimate workspaces still verify the revision and publication hash chains.

## Tests

- **pgTAP:** `supabase/tests/patient_360.test.sql`, 97 assertions. Covers:
  - grants, and inactive, role-less and subject-less sessions being denied;
  - unknown ids;
  - header, red flags, SMS consent and balance after credits;
  - every signal family in patient scope versus household scope, including archived pets being excluded and sibling isolation;
  - no recordings, transcriptions, other households or in-progress uploads in any output;
  - a full keyset walk at page size 4 (no duplicates, strictly newest first, equal to the single-page result, last page has no cursor);
  - per-kind counts, patient-scope filtering, kind filters, and every validation error;
  - reads leave data unchanged.
- **Unit:** `tests/patient-360/model.test.ts`, 14 tests covering tab resolution and aliases, link building, next-step derivation and ranking for patient and household scope, the inactive-patient and consent rules, timeline deep links for every kind, display mapping, day grouping, and filter coverage.
- **Browser:** `e2e/patient-360.spec.ts`, 6 tests. They cover:
  - a mobile patient 360 with header, flags, one-tap contact, quick actions, next steps and expansion;
  - timeline links, "Load older entries" with the keyset cursor, filters sending `p_kinds`, and no horizontal overflow at 390px;
  - a next step deep-linking into Medical › SOAP with focus, and tab switching with no leave dialog;
  - household aggregation, legacy `?tab=` aliases and per-pet actions;
  - Book visit opening the prefilled booking form, and Message opening the send dialog;
  - a failed summary never hiding the record.
- Existing browser specs that open a patient and use a Medical or Documents component now open `?tab=medical` or `?tab=documents`. Specs that click household tabs use the new names: "Billing" for "Invoices & payments" and "Communication" for "Consent & notes".

## Known gaps

- There is no dedicated "record release request" object. The signal covers prepared release emails that were never sent.
- Estimate totals come from the latest draft revision. The published total can differ until the estimate is republished.
- Unread state uses the conversation's `is_read` flag, not per-user read cursors.
- A missed call counts only when CloudTalk's projection body starts with "Missed incoming call".
- The household Documents tab is a filtered timeline. Uploads and releases still happen on each patient.
