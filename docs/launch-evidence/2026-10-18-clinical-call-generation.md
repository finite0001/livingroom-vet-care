# Guarded call drafting and private clinical review

Phase 3B.2 is implemented and locally verified; the new PR is pending review. Real call processing remains disabled. No real provider requests, hosted database writes, practice policy approvals or clinical activation were performed for this increment.

## Delivered behavior

An active administrator opens a retained household call for its saved patient and encounter, chooses an approved template and explicitly requests generation. The result remains private. Every clinical claim has exact retained segment support, original speaker labels and patient attribution. Other-patient and unassigned claims cannot fill proposed SOAP fields. Missing findings remain empty.

The reviewer selects and edits proposed sections, compares them with saved wording and explicitly accepts or rejects. Acceptance replaces selected sections once through the native unsigned encounter writer. Unselected sections remain unchanged; signing remains separate. Current authorized reviewers can accept completed drafts after the generating doctor signs out. Active provider processing still requires its original live operator session.

Reservation, processing and review acknowledgements can be lost without repeating provider work or chart writes. Recovery keeps only identifiers, versions, hashes and controlled retry reason codes in tab storage. It restores the exact outstanding source after reload and reloads the latest saved encounter before adopting a recovered acceptance.

## Implementation boundary

- Migration `20261018032610_clinical_call_note_generation.sql` is migration 203. It adds one private immutable policy/review action journal and 24 dedicated functions: 13 guarded authenticated RPCs, three service-only transitions and eight private helpers. It does not replace any existing routine or modify historical migrations.
- Existing source bindings, note jobs/attempts, generations, proposals and reviews retain the private relationship. All 16 earlier legacy guard replacements remain unchanged. Typed/audio readers cannot expose calls through generic history or review receipts.
- SQL independently validates the pinned manifest, payload keys/order/statuses, claim/support/byte budgets, source hashes and exact UTF-16 ranges. Only selected-patient proposed wording is assembled for review; complete evidence remains private.
- New admission uses the shared 12/hour and 100/day note-job budget, six attempts per job and two active note attempts per operator. The latest 100 audit events are explicitly bounded with `events_has_more`; older events remain retained. Historical results remain readable after policy changes.
- `clinical-call-note-process` requires JWT verification plus both `CLINICAL_NOTE_PROCESSING_ENABLED` and `CLINICAL_CALL_NOTE_PROCESSING_ENABLED`. Its request and response bodies are bounded, redirects are refused and each admitted attempt sends at most one provider request. Only an identical received result may be resubmitted to confirm a lost database acknowledgement.

## Verified locally

| Check | Actual result |
| --- | --- |
| Repository check | Lint: zero errors, four existing warnings; all three TypeScript projects; **1,643/1,643 unit tests**; production build passed. Existing bundle-size warning remains. |
| Canonical database replay | **203 migrations, 166 suites, 7,315 assertions passed** against unchanged bound inputs; owned runtime removed. |
| Dedicated SQL cases | **204 assertions** across three call suites, including independent hourly/daily limits, Unicode author names, UTF-16 evidence, cancellation, review recovery and private access. |
| Actual Auth/PostgREST | **136 checks**, including authorized historical reads, selected-only chart acceptance, fresh-reviewer handoff, policy journals and ordinary staff chart access without private-source access. |
| Real observed lock barriers | **Eight**: administrator demotion during private read; accepting reviewer ban; original call event change; inbound version change; worker session removal; template retirement; competing encounter edit; later draft general policy. |
| Actual worker over local HTTP | **15 assertions**; one direct synthetic provider request; two identical finish confirmations after a lost acknowledgement; replay sends no second request. |
| Actual Patient 360 | **21 assertions**, desktop 1280px and mobile Chromium 390px; three committed acknowledgement losses, reload recovery, explicit edits/acceptance/rejection, navigation protection, same-user role loss and **zero STAFF private RPCs**. Screenshots inspected. |
| Populated restore | **Eight checks**, 17 populated relation families, 17 table security catalogs and **1,355 public routine definitions/owners/effective grants**. RLS, table grants, policies, triggers, constraints, immutable receipts and source bindings preserved. Historical read and recovery require no regeneration. |
| Baseline upgrade compatibility | Migration **201 → 203**: 144 Auth/API checks, two observed read races, 27 actual frontend parses, nine review checks and exact legacy JSON/wire-byte preservation. Separate restore of 20 populated relation families and all 1,355 public routines passed seven checks. |
| Local security advisors | Baseline 201 and current 203 returned identical warning artifacts and exit zero: the existing `pg_net` extension-in-public warning, with no additions. This is local CLI evidence, not a hosted advisor claim. |
| Existing browser suite | Initial run: 515 passed, nine failures and one existing skip. All nine failed cases passed on a serial rerun without application changes: **524 cases passed across the two runs, one skipped**. Initial traces and failures preserved. |
| Edge verification | All committed entrypoints and shared contracts passed frozen Deno checks; five drafting/capture endpoints checked and bundled without root Node dependency resolution. |

The owned end-to-end run used three labeled in-process provider stub responses in total, including browser actions, and **zero real provider requests**. Temporary Auth input files and owned containers/volumes were removed. Failed diagnostic runs remain preserved separately; they are not represented as successful receipts. See the accompanying [machine-readable receipt](2026-10-18-clinical-call-generation.json) for hashes and reproducible commands.

## Release and remaining work

PR 273 was specifically approved and merged at `2df9a1c84f1fd9c8df4e374ffcfe6f5e7e306f73`. GitHub's successful Vercel status identifies deployment `dpl_2DuGBqY4fs7nmBgKY3JQAu6ppLmi`; native CLI inspection verified that exact deployment `READY`, production, on `thelivingroom.vet`, `www.thelivingroom.vet` and the project alias. That release contained pure contracts, so no database or Edge rollout was required.

This new increment has not been applied to staging or primary. After specific approval of its PR, use an additive database-first rollout: verify project identity and migration/source parity; apply 203 to staging and verify the guards and disabled gates; deploy only the new JWT-protected function with processing off; repeat the verified migration/function rollout on primary; then merge the approved frontend and verify the exact Vercel commit and aliases. Preserve existing secrets and other processing/delivery gates.

Phase 3B.3 remains: independently reviewed call-fidelity evaluation with a separately bounded real-provider decision, Susan's call-processing/retention approval, authorized CloudTalk commissioning and real iPhone/Safari acceptance. Synthetic exact-quote validation establishes source membership, not medical entailment or production clinical readiness.
