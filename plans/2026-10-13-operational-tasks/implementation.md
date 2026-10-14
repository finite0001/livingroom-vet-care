# 4B implementation design

## Data model

Create an additive migration with `supabase migration new operational_tasks`; use its generated filename. All tables use explicit RLS and revoked direct PUBLIC/anon/authenticated/service write access. Use immutable-history guards and narrow authenticated RPCs; no table API workaround. Foreign keys retain clinical/resource/history identities.

| Relation | Purpose and invariant |
|---|---|
| `operational_task_templates` | Stable root, current revision and published revision pointers; optimistic version |
| `operational_task_template_versions` | Immutable definition, state, review note, actor/time and exact selector review evidence |
| `operational_task_actions` | Actor/session, operation UUID, exact request and immutable result; one identity cannot change request |
| `operational_resource_uses` | Stable actual-use occurrence, appointment/resource identity, current event/version |
| `operational_resource_use_events` | Immutable start/end/correction facts, actual times, actor and correction reason |
| `operational_task_enrollments` | Frozen template/checklist/rule and source resource/type versions at first applicability |
| `operational_tasks` | Stable logical slot and head revision; one slot per template root/resource/source occurrence |
| `operational_task_revisions` | Immutable due time, lifecycle state, source evidence, assignment and completion attribution |
| `operational_task_use_coverage` | Actual-use occurrences covered by a resource/local-day restock slot; exact deduplication |
| `operational_task_generation_policy` | Private versioned default-false policy; explicit reviewed effective range, no seeded activation |

Finalize table names against existing migrations before creating the migration. Keep current heads as the only mutable projections and immutable versions/events as source evidence. Preserve an idempotency provenance key including appointment/resource/template-version/occurrence in addition to the stable logical slot. Never rely on the version key alone for uniqueness.

## Exact template definition

Strict SQL and Zod validators share the same bounded contract: operational name/category; selected reviewed type entry IDs and published version IDs; selected reviewed resource entry IDs and version IDs; trigger/scope; due-time rule; eligible role set; assignment strategy and optional active named assignee; stable ordered checklist item IDs/required flags/text; SOP/reference; review note. Reject unknown keys, duplicates, control characters, unsupported trigger/scope combinations, nonexistent/unpublished selector versions and inactive/wrong-role assignees.

Trigger choices: before scheduled appointment, after explicit actual resource use ends, resource/local-day restock, reviewed housecall-departure check. Daily restock is one slot per resource and Denver day, not per appointment. Reviewed minute offsets are bounded; local due-time resolution must handle Denver DST deterministically and reject ambiguous/nonexistent times unless an explicit reviewed resolution is supplied. Never ship clinical preparation content or cleaning product/contact times as defaults.

Save draft first. DVM/ADMIN publication requires the exact unchanged saved definition, expected version and review attestation. STAFF can view operational templates and use tasks but cannot publish clinical preparation/operating instructions. Retiring stops future enrollment and preserves existing instances/history. Selector republishing must not silently change frozen task rules; require an explicit new review where changed source semantics affect applicability.

## RPC boundaries and recovery

Separate template, actual-use and task operations with operation-specific strict DTOs. Reads/paginated lists expose only needed operational context. Every mutation validates current staff/live session, `p_actor_id=auth.uid()`, exact operation/action UUID and optimistic source/task version. New live sessions for the same actor can recover saved work; another account cannot.

Use a task-specific private review/receipt contract for prepare/read/execute/cancel. Persist only actor/action/operation pointers in browser storage, never checklist/clinical payloads. Recover exact saved receipt before changed-state, expiry or cancellation validation. A late response cannot cross an actor-generation boundary. Cancellation after commit returns the saved result; a cancellation marker blocks late preparation. Freeze unknown submissions and support Check saved action/Retry unchanged action/release after checked receipt.

Actual use is an explicit staff assertion with appointment/resource stable IDs and actual time. Start requires an appropriate existing source and active reviewed resource; arbitrary overlapping physical uses require explicit review rather than silent room readiness. Ending an open use remains available after appointment cancellation or resource reassignment. Corrections append events and explain changed time/resource evidence; never rewrite completed checklist records. Workers may not attest actual use or completion.

## Atomic generation and lifecycle

Use schedule lock73260123 first; care lock only when needed, then source/use/task rows in a deterministic order. Recheck staff/session after waiting. Preserve existing appointment conflict/reminder/identity protections.

Create one private materializer shared by appointment/use hooks and later reconciliation. Trigger relevant source changes across canonical slim/full/custom/catalog/editor/cancel paths. Verified current managed booking writes its reviewed binding before the canonical appointment save. An appointment AFTER hook therefore sees the final binding inside the same transaction; prove this order in native acceptance. If a future save path changes that order, add a final binding hook rather than generating from an incomplete snapshot. No canonical-function patch is needed for this package. Exclude notes-only version changes from new enrollment.

- Before scheduled work: enroll the exact reviewed type/resource. Rescheduling revises outstanding deadlines using the frozen rule; completed work remains historical evidence.
- Cancel/no-show before physical use: supersede untouched preparation with attribution/reason. Started work becomes Needs review rather than disappearing.
- After-use cleanup: enroll from explicit use-end evidence. Cancellation or source room change cannot remove it; it stays attached to the actually used resource.
- Open/disputed use: Needs review; neither appointment cancellation nor elapsed booking time ends use.
- Daily restock: group ended uses by stable resource/Denver date; record covered occurrence IDs idempotently. Later use after a completed restock creates explicit additional work requiring review, preserving the finished checklist and original coverage.
- Resource/template changes: revise or explicitly supersede unfinished work; keep completed snapshots intact. A different resource never moves old physical-use evidence to the newly booked room.
- Generation off: no new scheduled enrollments. Existing outstanding tasks still receive cancellation/reschedule/use safety updates; disabling must not hide obligations.
- Activation: reviewed effective start/end prevents backfilling every historical appointment. No seed or implicit activation from publication.

Do not call inventory adjustment, change vaccines/lab due dates or dispatch communication from task completion. Future notifications use the canonical outbox only after separately accepted notification rules.

## UI and files

Create `src/hub/features/daily-tasks/task-model.ts`, `task-api.ts`, `use-task-action.ts`, `OperationalTaskTemplatesPage.tsx`, `TaskTemplateEditor.tsx`, `ResourceUseDialog.tsx` and a minimal source use/obligation summary. Register `/hub/tools/task-templates` in the existing protected route tree and `src/hub/components/layout/nav-items.ts`. Keep the role-aware server boundary independent of nav visibility.

Template UI lists drafts/published/retired states and exact saved reviewer/version. Show selected catalog human labels plus published revisions; loading/failed/partial pagination cannot masquerade as an empty catalog. Default system starts empty; Susan's proposals are review context only. Fieldsets freeze for unknown actions. Use brand semantic tokens,44px targets, readable Denver dates/times and explicit dirty close/Escape/outside/back/filter guards. Keep focused source-use controls distinct from appointment check-in/completion.

4C adds shared Home/Schedule daily panels, a complete `/hub/tasks` queue, role/resource/day/My tasks/Unassigned/Needs review/Overdue/Completed filters, claim/reassignment and frozen checklist completion with mandatory-item evidence. Every task transition still needs expected version and action receipt. Surface current source condition beside original task evidence; avoid diagnosis/contact details on room lists.

## Build and handoff sequence

1. Inspect latest main/AGENTS and confirm canonical definitions/binding save order. Commit the plan/research and #249 receipt with the implementation package.
2. Implement generated additive migration, strict SQL contracts/private ACL, immutable event/version model and default-off policy. Do not alter autogenerated types.
3. Implement exact review/recovery and resource-use RPCs. Finish the private materializer and final-binding/actual-use hooks before advertising generation.
4. Add strict Zod bridge, template Tools UI and narrowly integrated actual-use controls with stable action recovery/draft guards.
5. Extend owned native scheduling acceptance, SQL attack/lifecycle cases, observed lock queues and populated backup/restore. Bump all migration-count/hash tripwires and restore relation inventory.
6. Review code; run package tests, required checks and exact-head CI. Open the coherent4B PR with honest default-off scope and deployment dependencies.
7. Under Dave’s standing approval of all additional PRs for completing this plan, after review and exact-head checks: fresh canonical staging dry-run → migration → rollback proof → genuine synthetic Auth/browser acceptance and cleanup → primary migration/rollback-only acceptance → exact-head merge → exact production commit/domain smoke. Save receipts and update the plan archive.
8. Continue4C without enabling task generation/reconciliation or notifications implicitly. Register a dedicated schedule-first worker, bounded candidates, run receipts and no completion/use authority.
