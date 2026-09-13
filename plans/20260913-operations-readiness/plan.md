# Operational work visibility

Status: implemented and locally verified in the operations acceptance integration; hosted commissioning remains pending. Baseline8117a72. Goal: make unfinished communications, reminder scheduling and payment callbacks discoverable before commercial rollout, without changing their recovery authority.

Audit found conversation-scoped outbox status only; bounded30-row reminder views; no durable scheduler run evidence; Stripe latest100 discovery without pagination. Inbound processing and sender review already have dedicated screens. Build on these rather than introduce another recovery system.

1. [Database discovery and run evidence](phase-01-database.md) — implemented and locally verified.
2. [Worker, UI and integrated acceptance](phase-02-runtime-ui.md) — implemented and locally verified against phase1.

Use an ADMIN operations route with safe aggregate counts, bounded keyset pages, observed timestamps and links to existing workflows. Staff retain their existing permitted clinical/inbox views. The new page makes no retry, consent, financial-resolution or send mutation. Show “No recorded run” when appropriate; rows cannot prove that cron, deployment flags or provider credentials are configured.

Prefer additive RPCs over changing existing response shapes. Reuse one internal read-only reminder candidate query in both discovery and queueing to avoid divergent eligibility. Keep queue source revalidation, immutable handoff identity, worker authorization and disabled-before-database behavior intact.

Rejected alternatives: only linking current screens leaves global/older failures undiscoverable; external uptime alone cannot show durable unfinished work; a generic monitoring platform introduces unnecessary infrastructure at this stage. External uptime/notification ownership remains a commissioning gate.

Do not apply this work to hosted Supabase while the newly observed partial migration history is unexplained. Local isolated migration/tests remain available. See [fresh hosted preflight](../../docs/hosted-upgrade-preflight.md).

Unresolved commissioning inputs: deployment coordination, separate staging approval, provider accounts and staff/clinical acceptance. None is needed to implement read-only local visibility. Scheduler freshness thresholds and operational escalation ownership must be selected before alert activation; do not invent an SLA.
