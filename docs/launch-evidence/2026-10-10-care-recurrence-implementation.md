# Recurring care implementation — October 10, 2026

Package 2B builds on merged Daily communications PR #235 (`979135b54c1eb9163dccc871977657045c8d5425`). Branch: `feat/care-recurrence-20261010`. This receipt records engineering work; hosted installation, practice configuration and clinical acceptance remain pending the new PR's specific approval.

## Result

- **Care reminders:** reviewed wellness, bloodwork, vaccine follow-up and custom defaults; separate upcoming, overdue and review queues. No clinical interval is seeded.
- **Patient Medical:** proposed/current/paused/retired plans, versioned default snapshots, patient overrides, calendar previews and paged history. Changing a default does not change existing plans; adopting it requires explicit review.
- **Completion:** a named active DVM selects actual native service, vaccine administration or collected/resulted lab evidence for this patient and reviews the server's next-date preview. Bloodwork uses collection date. Historical imports and corrected sources cannot fulfill a new completion. Completion creates no second treatment, stock movement or invoice charge.
- **Governance:** staff may propose, pause and retire; active named DVMs approve/resume clinical plans and confirm completion. Administrators configure delivery separately. Existing native vaccine/lab permissions remain unchanged.
- **Recovery:** immutable exact-action receipts; unchanged retry or read-only recovery after lost acknowledgment. Source ID/version remains fixed until explicit re-selection. Existing navigation guards retain the editor across patient tabs.
- **Delivery:** the existing canonical outbox/dispatcher, reviewed email/text policies and Denver send windows. Outside-window work is deferred without a provider attempt. The occurrence identity prevents metadata/wording changes from creating a second automatic send after an attempt or unknown outcome.
- **Death and correction:** routine eligibility is serialized before attempt authorization; in-flight provider outcomes remain recordable. Death/archive, changed completion evidence, pause and retirement invalidate old routine work. Correcting a death flag leaves new care plans awaiting DVM review. Siblings are independent. There is no birthday scheduler in this package.
- **Visibility:** Patient 360 next steps, Operations candidates/blocks and safe Daily communications labels/deferred status. Delivery summaries expose no bodies, capabilities or raw provider errors.

## Migration and release order

Migration: `20261010170259_care_plan_recurrence.sql`; canonical inventory **172**.
SHA-256: `600e69817b2caab68738aea7be94e04a5dc70c568e51264e82a8074733cf857b`.

1. After approval, verify staging **kothoqicubowyhwfsrte** and primary **mgadheotkdnrsatfivjy** against the reviewed migration inventory. Legacy Lovable **ugpyjacqganaqtsiekay** is not the target.
2. Apply migration 172 to staging first; verify private table/function ACLs and existing frozen policy contexts. Test using genuine staff, named DVM and administrator accounts, with synthetic patients and delivery disabled.
3. Validate the preview against staging: default review, patient override, completion/receipt recovery, quiet-window deferral, source correction, death and live-sibling independence. Do not infer clinical acceptance from engineering tests.
4. Apply the identical migration to primary before the merged frontend reaches it; coordinate the database-first release. Verify the reviewed merge commit's Vercel deployment and keep the stable staging alias on the chosen staging build.
5. The dispatcher already handles a pending deferral response; this package changes no Edge Function entry point. Verify deployed dispatcher inventory rather than treating a git commit as an Edge Function deployment.
6. Practice reviewers provide actual clinical intervals and reviews. An administrator separately reviews wording, send hours and activation. Preserve existing commissioned provider settings and financial gates. This package performs no real send, provider activation, role assignment, credential change or hosted write.

If care needs to stop, turn the recurring-care policies off and pause patient plans. Preserve the migration, completed-care evidence and delivery history; do not drop records as a rollback.

## Verification

All local work used an explicitly owned disposable localhost Supabase project; keys remained in memory/private CLI logs. Other local stacks and hosted data were not reset.

- Clean replay of all 172 migrations; **139 SQL files / 5,651 assertions passed**, including **105** new recurrence, delivery and source assertions.
- **52** observed PostgreSQL race assertions: both death/start and source-correction/start orderings, completion replay/payload conflict, pause/wording changes, lease expiry while waiting, scheduler deduplication, and provider outcome recording while the eligibility lock is held.
- Adjacent service completion/correction, outbox retry (**24**), important-alert snapshots, inventory locking (**32**), record-release and Operations visibility (**15**) checks passed. Corrected harness cleanup disables only its synthetic policy and preserves unfinished simulated attempt evidence as uncertain.
- Genuine local Auth/PostgREST: **33 assertions passed**, with separate DVM/STAFF/ADMIN accounts, strict response schemas, optimistic versions, paged history, exact receipt recovery, inactive/anonymous denial and no outbox messages/provider requests. Test accounts were deactivated, banned and signed out.
- `npm run check`: lint/typecheck, **1,291 unit tests** and production build passed. Four pre-existing Fast Refresh warnings and the existing large Patient bundle warning remain.
- Browser verification: all ten new care cases passed, including mobile default configuration, exact completion retry/read-only recovery, explicit lab-version re-selection and explicit default adoption. Existing policy write assertions were preserved while their fixture learned the new read-only calls. A first broader run exposed four outdated fixture assertions and three loading/navigation failures; the focused **33** and policy **6** cases passed after review. The final complete browser run passed **505 tests**, with **one pre-existing skip**. Exact-head CI remains authoritative in the PR checks/body.

Required CI must pass on the head Dave approves. Clinical/staff acceptance and hosted rollout are separate remaining gates.
