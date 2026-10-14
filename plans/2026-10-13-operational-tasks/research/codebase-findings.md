# Verified codebase findings

Read-only research on #249 head `8da836534664784c883b708ff8fb7df63e35f9f3`, now merged unchanged into main. Database and UI researchers inspected current source; no hosted operations or code edits were delegated.

## Existing foundations

- `src/hub/pages/TicketsPage.tsx`, `TicketDetailPage.tsx` and `hooks/use-tickets.ts`: clinical intake, patient/contact forms and clinician review. No durable facilities tasks or actual-use evidence.
- `HubHomePage.tsx`: Guided StartYourDayChecklist is derived clock/outbox guidance, not operational task history.
- `features/scheduling/AppointmentCatalogPage.tsx`, `catalog-model.ts`, `catalog-api.ts`: exact draft→publication, stable type/resource identities, reviewed versions and paginated access. Reuse the interaction and actor-scoped RPC bridge.
- `20261013181721_appointment_catalog_and_bindings.sql`: reviewed catalog entries, versions, resource aliases and immutable appointment bindings. Preserve frozen booking labels/versions.
- `20261013220500_next_visit_outcomes.sql`: schedule lock73260123 → care eligibility → appointment rows; completion occurrence is durable but proves visit transition only. The slim scheduling wrapper already obeys this order.
- `20261013233839_next_visit_staff_recovery.sql`: current live Auth session, exact actor, immutable private reviews/action recovery, cancellation markers and expiry. Reuse the architecture, not its next-visit-specific operation allowlist.
- `features/clinical/use-unsaved-changes.ts`: Router7 pathname/back/unload guard; local date/filter/dialog switches also need explicit dirty confirmation.
- `components/layout/nav-items.ts`: protected Tools route is visible to DVM reviewers; ADMIN-only settings would hide Susan's template publication workflow. Server RPC authorization remains authoritative.

## Important gaps

No operational task template, facilities task instance or actual resource-use model exists. CONFIRMED means checked in/on-site; COMPLETED means visit completion. Neither identifies physical resource use or an actual end time. Add explicit use events before promising after-use cleanup automation.

`useProfiles()` exposes a singular profile role, while authoritative authorization uses `user_roles`. Return eligible active assignees from an RPC so staff with multiple roles are handled correctly.

The scheduler currently whitelists five jobs in `scheduler_job_runs.job` and `scheduler_dispatch()`. 4C worker registration needs an explicit additive change. Do not attach generation to `queue_due_reminders` or `reminder_delivery_context`: that chain enters care first and would invert scheduling locks. Task reconciliation needs a separate schedule-first RPC and run receipts.

## Design choices and alternatives

Reusing intake tickets is smaller initially but mixes clinical permissions and patient data into facilities work and lacks immutable checklist/usage history. A separate operational model provides truthful room and task evidence.

Inferring usage from booked duration would avoid a new control but cannot distinguish no-show, reassignment, overrun or cancellation after actual use. Explicit use events are required; unfinished or disputed use remains Needs review.

A unique appointment/resource/template-version key alone duplicates work when a new version is published. Keep that provenance key and also a stable logical slot by source occurrence/resource/template root. Changing an unfinished task's template version is an explicit supersession, never silent regeneration.

Synchronous materialization uses the canonical appointment/use transaction for consistency. A later bounded worker repairs missed enrollment using the same internal materializer; it cannot record physical use or complete a checklist. Disable new generation by default while retaining safety updates on existing work.
