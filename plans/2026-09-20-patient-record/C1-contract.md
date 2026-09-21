# C1 contract — the patient record screen

Status: **for implementation.** Date: 2026-09-20. Author: the stronger-model seat, per `plans/2026-09-19-commercial-readiness-map/MAP.md` §6, which marks C1 as `S→K`: *"a stronger model writes a short design contract first… Do not start without the contract."*

This document is the contract. The executor implements it; the executor does not redesign it. If something here does not fit the code, stop and escalate — do not improvise.

**Precondition, run before starting:**

```
git fetch origin && git merge-base --is-ancestor 024fd13 origin/main \
  && echo "OK: main is the product" || echo "STOP: main is not the product"
```

**Tier:** the tab shell and the rail are K. The one shared-file change (the navigation guard) is **K+R** — it is used by two other screens. No migration, no RPC, no RLS, no edge function, no secret, no hosted operation. If you find yourself editing `supabase/`, you have left this contract.

---

## 1. The problem, measured

`src/hub/features/patients/PatientPage.tsx` is 99 lines and mounts **16 feature components in one scroll**, plus four more blocks — the alert block, the allergy note, the patient details card and the weight history. In render order (lines 79–97): alerts, allergies, details, weight history, prescriptions, treatments, vaccine-due plans, care charts, documents, API attachments, imported vaccinations, imported prescriptions, imported history, external records, certificates, lab work, dental chart, anesthesia records, record releases — and `ClinicalWorkspace` (the SOAP editor) **last**.

Every one of those is imported eagerly, so the whole screen is one chunk: `PatientPage` builds at **542.45 kB** (136.62 kB gzip) — the second largest chunk in the build, on a product whose users are on housecall mobile connections.

The clinician's complaint is not that the features are missing. It is that the note — the thing they open the record to write — is at the bottom of a long scroll, and that nothing gives them a persistent sense of who the patient is.

## 2. Target shape

A **persistent summary rail** on the left that never scrolls away, and a **tabbed main pane** on the right, with the tabs addressable by URL so a tab is a real, linked place.

```
┌────────────────────────┬──────────────────────────────────────────────┐
│  ← household           │  Notes · Summary · Vaccines · Medications …   │
│  Juniper  (Dog · 4y)   ├──────────────────────────────────────────────┤
│  ⚠ Important history   │                                              │
│  ⚠ Allergies: …        │   the active tab's panels                    │
│  Latest weight 18.4 kg │                                              │
│  Household · phone     │                                              │
│  [Edit patient]        │                                              │
└────────────────────────┴──────────────────────────────────────────────┘
```

**Layout rules**

- Rail: fixed width (~280 px), full height, its own scroll if needed, never scrolls with the main pane. Below `lg` (1024 px) it collapses into a stacked header block above the tabs — the current breakpoint behaviour of the page's `lg:grid-cols-2` is the precedent.
- Main pane: scrolls independently. The tab bar is sticky at its top.
- The page keeps `h-full` and must not introduce a second outer scroll container; the shell currently relies on `<section className="h-full overflow-y-auto">` (line 75).

## 3. The tabs

`?tab=` values are lowercase and singular. Each tab lazy-loads its own content.

| # | Tab id | Label | Mounts | Notes |
|---|---|---|---|---|
| 1 | `notes` | Notes | `ClinicalWorkspace` | **Default tab.** `ClinicalWorkspace` already renders `PatientProblems` internally (line 101) — do **not** mount `PatientProblems` a second time. |
| 2 | `summary` | Summary | patient details card + `WeightHistory` | The details card is currently inline in `PatientPage` (line 81). Extract it, do not duplicate it. There is **no timeline component in the repo**; see §10. |
| 3 | `vaccines` | Vaccines | `PatientTreatments`, `PatientVaccineDuePlans`, `PatientCertificates`, `PatientImportedVaccinations` | "outside vaccinations" = `PatientImportedVaccinations`. |
| 4 | `medications` | Medications | `PatientPrescriptions`, `PatientImportedPrescriptions` | "outside prescriptions" = `PatientImportedPrescriptions`. |
| 5 | `labs` | Labs | `PatientLabWork` | |
| 6 | `procedures` | Procedures | `PatientDentalChart`, `PatientAnesthesiaRecords` | |
| 7 | `charts` | Charts | `PatientCareCharts` | QOL records and body maps both live in this component. |
| 8 | `documents` | Documents | `PatientDocuments`, `PatientApiAttachments`, `PatientImportedHistory`, `PatientExternalRecords` | "outside originals" = `PatientApiAttachments`; imported history = `PatientImportedHistory`. |
| 9 | `releases` | Releases | `PatientRecordReleases` | |
| 10 | `billing` | Billing | `HouseholdEstimates`, `HouseholdInvoices` with the patient's `client_id` | Both components are **client-scoped**, not patient-scoped. Patient-level filtering is **not** in v1 — say so in the UI rather than pretending. |

**Tab bar order** is the order above, so the default tab is the leftmost one. The map lists Summary first and names Notes as the default; a default that is not the leftmost tab reads as a UI bug, so Notes leads. This is a one-line change if the owner prefers Summary first — but then the default must become Summary too.

**Messages is deliberately absent.** There is no patient- or client-scoped conversation component in `src/hub/features/communications/` (only upload helpers and `SmsConsentPanel`); the conversations UI lives on `ConversationsPage`. A Messages tab would need a new component and new reads, which is a separate task. Link out to the household's conversations instead.

## 4. The rail

Contents, top to bottom:

1. Back link to the household (`/hub/client/<client_id>`) — as today.
2. Patient name (`<h1>`), then species · breed · sex, then age (reuse `patientAge`).
3. Archived/deceased badge when `patient.archived_at || patient.deceased_at`, with the existing "History is retained…" sentence.
4. `PatientAlerts` — **exactly as it is today**, mounted once, always visible on every tab. It is read-only (it renders high-importance problems from `usePatientProblems`), so living in the rail is safe.
5. The allergies note (today line 80) — always visible on every tab. Keep `role="note"` and the existing wording.
6. Latest weight. Today `WeightHistory` receives `legacyWeight={patient.weight_lbs}`; the rail shows the same latest value the history panel shows. Do **not** add a second query: export or lift whatever `WeightHistory` already reads.
7. Household name and phone from the existing `clientQuery` (already fetched — do not add a query).
8. `PatientFormDialog` (the edit action), plus the "New visit" affordance if one exists.

**Why alerts and allergies are in the rail and not a tab:** they are the two pieces of information a clinician must never have to navigate to. Putting them behind a tab would be a clinical regression.

## 5. The URL contract

- `?tab=<id>` selects the tab. Absent → `notes`.
- An unknown or malformed `?tab=` value falls back to `notes` **and is removed from the URL** (do not leave a broken value addressable).
- Changing tabs updates the URL with `setSearchParams` (the pattern PR #177 already uses on the client screen). For the default tab the parameter is **deleted**, so the canonical URL of the default tab is clean.
- Tabs are linkable: pasting `/hub/patient/<id>?tab=labs` must open Labs, and browser Back/Forward must move between visited tabs.
- Share the `TABS`/`Tab` type shape with the client screen where practical, but do not create a shared abstraction that C6 does not use — keep the two screens independently shippable.

## 6. The dirty-state protocol — the heart of this contract

Today `PatientPage.tsx` holds **13** boolean flags, one per dirty-capable panel (lines 38–50): `nativePrescription`, `importedPrescription`, `importedVaccination`, `importedHistory`, `external`, `release`, `clinical`, `care`, `dental`, `lab`, `certificate`, `anesthesia`, `vaccineDue`. `dirty` is their OR. Each panel receives `onDirtyChange={setX}`, and **every panel is disabled while any other flag is true** — a mutual-exclusion lock, not merely a navigation guard.

Four rules. All four are required.

### 6.1 The flags stay in the page shell

All flags live in the component that owns the tab state, exactly as today. No flag moves into a tab component. The Billing tab adds **two more** — `estimateDirty` and `invoiceDirty` — because `HouseholdEstimates` and `HouseholdInvoices` already accept `onDirtyChange`. **The protocol therefore grows from 13 to 15 flags.** Update the cross-lock lists accordingly; the existing code lists the other 12 flags explicitly in each panel's `disabled` prop, so a missed list is a silent bug.

### 6.2 A dirty tab is never unmounted

Switching tabs while a draft is unsaved **must not destroy the draft**, and **must not be blocked**: the clinician switches freely and their work is still there when they come back.

Implementation: a tab whose content holds a true flag stays **mounted but hidden** while another tab is shown (shadcn `TabsContent forceMount`, or an equivalent conditional render with `hidden` + `aria-hidden`). Tabs with no dirty content unmount normally — that is what buys the chunk-size win.

Consequence, and it is deliberate: **switching away from a dirty tab does not prompt, because nothing is discarded.** What still prompts is leaving the patient page entirely.

This is a considered difference from the map's sentence *"switching tabs with an unsaved signed-record draft must prompt, never silently discard."* The map forbids the silent discard; this design removes the discard altogether, which satisfies the intent more strongly. A clinician mid-note who switches to Vaccines to check a date must not be asked to throw the note away to do it.

**Decided by the owner on 2026-09-20: keep the draft and switch freely.** The alternative — prompt, then discard on confirm, as the client screen does — is rejected, and §6.3 therefore keeps `{ ignoreSamePath: true }`.

### 6.3 Leaving the patient page still prompts

Leaving the record while dirty is blocked, exactly as today, with the same dialog — but the guard must stop treating an in-page tab change as leaving. `useUnsavedChanges` takes only a boolean today, so extend it **backwards-compatibly** in `src/hub/features/clinical/use-unsaved-changes.tsx`:

```tsx
export function useUnsavedChanges(
  dirty: boolean,
  options?: { ignoreSamePath?: boolean },   // default false = today's behaviour
): ReactElement
```

```tsx
const blocker = useBlocker(({ currentLocation, nextLocation }) =>
  dirty && !(ignoreSamePath && currentLocation.pathname === nextLocation.pathname));
```

- Default `false` keeps the current behaviour for the two other callers, `NativeReturnPolicySettings.tsx` and `RefillsPage.tsx`. **Do not change their behaviour.**
- `PatientPage` passes `{ ignoreSamePath: true }` — **confirmed by the owner on 2026-09-20** (§6.2) — so a `?tab=` change is not blocked and leaving `/hub/patient/...` still is.
- `useBlocker` with a predicate requires the data-router API. The app uses `createBrowserRouter` (`src/App.tsx:70`), so this is available.
- The `beforeunload` half (closing the tab) is unchanged and stays on `dirty`.
- The tab-change branch is settled: **the draft is preserved and a tab switch is not blocked** (§6.2, owner-confirmed 2026-09-20). Do not implement the prompt-and-discard variant.

### 6.4 Preserve the prescription certainty rules exactly

These are subtle and must **not** be "tidied":

- `useQuery({ ..., enabled: !nativePrescriptionDirty, refetchOnWindowFocus: !dirty, refetchOnReconnect: !dirty })` — a background read must not run under an uncertain prescription operation.
- The `retainedPatient` ref: while `nativePrescriptionDirty`, the rendered patient object is the retained one, so a refetch cannot unmount or re-key an uncertain operation.
- The panels that take `key={...-${petId}}` (`vaccine-due`, `certificates`, `lab`, `dental`, `anesthesia`, `release`) keep their keys, so a patient change still remounts them.
- `ClinicalWorkspace`'s `disabled` currently ORs `inactive` with only **four** of the other flags. The other panels OR twelve. Keep the existing per-panel lists unchanged in this task; do not "fix" the inconsistency here. Note it as a follow-up.

### 6.5 Make the lock visible

While a flag is true, another tab's panels are disabled. Today nothing says why. Add a persistent banner above the tab content: *"Unsaved work in Notes — finish or discard it before working elsewhere"*, with a button that switches to the dirty tab. This is informative only: it must not bypass or weaken the lock. When more than one flag is somehow true, name the first dirty tab in the fixed tab order.

## 7. Lazy loading

- One `React.lazy` per tab's content, wrapped in one `<Suspense>` with a skeleton fallback that does not shift the rail.
- The rail (`PatientAlerts`, the details card, the household fields) is **not** lazy: it must render immediately.
- Target: the `PatientPage` chunk no longer contains the panels. Record the new sizes in the pull request.

## 8. What this breaks, and the rule for fixing it

**20 of the 64 browser specs** visit `/hub/patient/…`, every one of them by `page.goto()` with a direct URL. Their first assertion after that `goto` is the panel they need, and most panels are no longer on the default tab. **This is the real cost of C1 and it is not optional work.**

**The rule:** a spec enters the tab it needs through the URL — `page.goto('/hub/patient/<id>?tab=<tab>')` — rather than clicking the tab bar. The deep link is then a tested feature, and the spec stays decoupled from the tab UI. Where a spec asserts on rail content (the patient name, alerts, allergies, weight) it needs no change.

Evidence, generated from the specs themselves:

| Spec | patient `goto`s | first assertion after the `goto` | tab it must enter |
|---|---|---|---|
| `anesthesia.spec.ts` | 2 | `button 'Add monitoring observation'` | `procedures` |
| `care-charts.spec.ts` | 2 | `button 'New QOL observation'` | `charts` |
| `care-reminders.spec.ts` | 2 | `button 'New vaccine due plan'` | `vaccines` |
| `certificate-workflow.spec.ts` | 1 | `heading 'Vaccine certificates'` | `vaccines` |
| `clinical.spec.ts` | 2 | `heading 'Synthetic Juniper'` (the patient name) | none — rail/header |
| `dental.spec.ts` | 6 | `button 'New dental chart'` | `procedures` |
| `documents.spec.ts` | 3 | `text 'Patient documents'` | `documents` |
| `external-records.spec.ts` | 1 | a `button` | `documents` (confirm by running) |
| `inventory.spec.ts` | 5 | `getByRole("tab", { name: "Treatments" })` | `vaccines` — **see the hazard below** |
| `lab-results.spec.ts` | 1 | `button 'Open lab order'` | `labs` |
| `lab-work.spec.ts` | 3 | `text /Antech selected · connection not configured/` | `labs` |
| `migration-workspace.spec.ts` | 1 | link `'Open saved patient'` (the source page) | none expected — confirm |
| `native-fulfillment.spec.ts` | 1 | `button 'View signed snapshot'` | `medications` |
| `native-prescribing.spec.ts` | 1 | `button 'New prescription draft'` | `medications` |
| `native-record-releases.spec.ts` | 1 | `checkbox /Native prescription 1 ·/` | `releases` |
| `operations.spec.ts` | 1 | `region 'Scheduler runs'` (another page) | none expected — confirm |
| `record-release-workflow.spec.ts` | 1 | a `heading` | `releases` |
| `reviewed-clinical-history.spec.ts` | 5 | none within 3 lines | `documents` (confirm by running) |
| `reviewed-prescriptions.spec.ts` | 1 | a `heading` | `medications` |
| `reviewed-vaccinations.spec.ts` | 1 | a `heading` | `vaccines` |

**The nested-tab hazard.** Some panels already contain their own tab bar — `inventory.spec.ts` queries `getByRole("tab", { name: "Treatments" })`. Adding a second tab bar to the page makes such queries ambiguous and Playwright will fail on the strict-mode violation, or match the wrong element. Every `getByRole("tab", …)` that means an inner panel's tab must be scoped with `within(...)` on that panel's container. Search for `getByRole("tab"` across `e2e/` and treat each hit as a required change. Add stable `data-testid` values to the outer tab list and tab panels so inner and outer tab bars can never be confused again.

## 9. Acceptance criteria

Every item must be checked and its real output pasted into the pull request.

1. `npm run check` passes; `npm test` reports **at least** the current 1069 passing, 0 failing. A drop means stop.
2. `npm run test:e2e` passes with the same total as before this change (413 passing was the last recorded figure; re-measure on `main` immediately before starting and quote both numbers).
3. A new spec `e2e/patient-record-tabs.spec.ts` proves, at minimum:
   - a bare `/hub/patient/<id>` opens **Notes**;
   - each of the ten tab ids is reachable by direct URL and its panel is visible;
   - `?tab=not-a-tab` falls back to Notes and the bad value is removed from the URL;
   - the patient name, the alert block and the allergy note are visible on **every** tab;
   - typing into the note editor, switching to Vaccines, and switching back **keeps the typed text** (this is the §6.2 requirement — it must fail against an implementation that unmounts a dirty tab);
   - leaving the page while dirty raises the existing confirmation dialog, and cancelling keeps you on the page;
   - while a draft is dirty, another tab's action is disabled and the banner offers the jump back to Notes.
4. `PatientPage`'s built chunk no longer contains the panels; report the before/after sizes from `npm run build`.
5. No behaviour change to `RefillsPage.tsx` or `NativeReturnPolicySettings.tsx` — run their specs, and quote that they were run.
6. No file under `supabase/`, and no new `VITE_*` variable.

## 10. Deferred, and the reason

- **Timeline** (map's "Summary (timeline)"): no timeline component exists in the repository. Building one is a new task with its own reads. v1 Summary is details + weight history.
- **Patient-filtered Billing**: `HouseholdEstimates` and `HouseholdInvoices` are client-scoped. Filtering by patient needs a new read model.
- **Messages tab**: no patient- or client-scoped conversation component exists (§3).
- **The `ClinicalWorkspace` disabled-list inconsistency** (§6.4): left untouched deliberately.

## 11. Files this task owns

- `src/hub/features/patients/PatientPage.tsx` (rewritten)
- `src/hub/features/patients/PatientRecordRail.tsx` (new)
- `src/hub/features/patients/PatientRecordTabs.tsx` (new — the tab shell and the URL contract)
- `src/hub/features/patients/PatientDetailsCard.tsx` (new — extracted from `PatientPage` line 81)
- `src/hub/features/clinical/use-unsaved-changes.tsx` (extended, backwards-compatible)
- `e2e/patient-record-tabs.spec.ts` (new)
- the twenty specs of §8 (their `goto` lines, plus the `within(...)` scoping)

**Dependencies.** C0 (`refactor/C0-shared-layout-and-nav`, PR #172) adds `src/hub/components/shared/PageShell.tsx`, `PageHeader.tsx`, `SectionCard.tsx`. If C0 has landed when C1 starts, use them for the page chrome; if it has not, **do not** create competing shell components — reuse the existing markup and leave the chrome to C0. C6 (PR #177) establishes the tab/URL pattern on the client screen; read it first and stay consistent with it, but do not refactor it as part of C1.

## 12. Open questions for the owner

1. ~~§6.2 — a tab switch with an unsaved draft~~ — **answered by the owner on 2026-09-20:** keep the draft and switch freely; the prompt-and-discard variant is rejected. Written into §6.2 and §6.3. **This question is closed and must not be reopened by the implementer.**
2. **§3** — should the rail also carry "New visit", or stay informational? Still open; the rail stays informational until answered.

## 13. Not verified in this contract

- No code was changed to write this document, and no test was run for it: the figures for the 20 specs come from reading `e2e/`, and the chunk sizes come from this machine's `npm run build` on `main` at `3f9e2c1`.
- The tab-to-panel assignments are read from the current mounts in `PatientPage.tsx`; where a spec's intended tab is marked *confirm by running*, that is because its assertion does not name a panel.
