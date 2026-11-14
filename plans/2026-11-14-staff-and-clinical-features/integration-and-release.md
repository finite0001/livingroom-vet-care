# Integration, permissions and rollout

## Target and invariants
- Living Room Vet only; native standalone product. No ongoing GreenTree/ezyVet integration.
- Baseline `7329d6ae`; re-fetch before implementation and reconcile concurrent changes.
- Preserve React 18, patched Router v7, existing public/staff URLs and unsaved clinical draft protection.
- Use existing warm semantic tokens, shared navigation registry, StatusChip where appointment statuses apply,
  and Guided mode/44px targets. Use React/TypeScript/shadcn, TanStack Query and Zod patterns already present.
- Separate staff board/HR records from client communications, clinical charts and outbound archive paths.
- Repository AGENTS.md identifies primary `mgadheotkdnrsatfivjy`, staging `kothoqicubowyhwfsrte`;
  verify current project references before use. Legacy Lovable `ugpyjacqganaqtsiekay` is not the target.
- Implementation is now authorized. Hosted activation and specific PR merges remain separate gates.

## Access model
| Data/action | Employee | Assigned approver | Compensation/owner permission |
| --- | --- | --- | --- |
| Clock in/out and personal time | Own only | Review assigned scope | Explicit permission |
| Time corrections/finalization | Request own correction | Review with reason | Explicit permission |
| Leave requests/balances/reasons | Own only | Assigned scope | Explicit permission |
| Who's off | Approved dates/names | Approved dates/names | Approved dates/names |
| Pay/rates/bonuses/benefit documents | Own permitted documents | No implicit pay access | Explicit scoped access |
| Team tasks/board/events | Active staff | Active staff | Active staff |
| Peer-review responses | Submit eligible anonymous response | No implicit access | Restricted aggregated results |
| Clinical tools/charts | Existing clinical permissions | Existing clinical permissions | No implicit clinical authority |

Implement capabilities using database-enforced grants/RLS/RPCs, with route guards for navigation.
Derive the actor from session.user.id/auth.uid(); never accept a client-supplied approver identity.
A manager modifying another employee's record requires a scoped privileged RPC and recorded reason.
Keep HR/benefit files private with expiring authorized downloads; no service keys in the browser.
Use restricted HR audit records, not broad before/after JSON logs that disclose compensation or review authors.
Only durable service jobs may run without a user session; authenticate their service identity and bound their work.

## Data and automation
Use additive migrations; preserve existing time records, dental charts, patient history and source artifacts.
Store instants in UTC, evaluate clinic days/workweeks in America/Denver, and persist policy versions.
Use unique idempotency keys for accruals, automatic clock-outs, task rotations, RSVPs and payroll artifacts.
Represent errors/unknown job state visibly. Do not turn failed reads into zero balances/hours or healthy status.
Index employee/date/period/approval queries and paginate reports; calculations must not silently truncate rows.
Favor existing scheduled-worker patterns over introducing a separate queue platform.

## Recovery: automatic backups are an operational deliverable
1. Verify current hosted database backup/PITR coverage, cadence, retention, access and restoration procedure.
2. Verify physical Storage objects separately from database metadata; include employee documents and signed artifacts.
3. Identify configuration/secrets restoration procedures without exporting secrets into Git or ordinary logs.
4. Agree recovery point/time objectives, protected destination, encryption/access and job/failure ownership.
5. Automate any uncovered export/backup needs using supported hosting capabilities; implement overdue/failure alerts.
6. Extend `scripts/restore-rehearsal/` fixtures to time approvals, leave ledgers, pay periods and private files.
   Restore into an isolated destination; verify permissions, record totals, file bytes and scheduler containment.
7. Record a dated receipt. Existing synthetic restore scripts are a foundation, not proof that automatic hosted
   backups are enabled. Report unverified coverage as unverified, and avoid competing duplicate backup systems.

## Test and deployment sequence
For each slice:
1. Record feature IDs, affected records, permission tests, rollout flag and rollback behavior.
2. Verify local ignored config exists before any build; never overwrite it. Use the repo's Node/npm versions.
3. Add targeted calculation/RPC/concurrency tests and browser coverage for actual user workflows.
   Use disposable databases and synthetic records; no production fixtures in tests.
4. Run required repository checks (`npm run check`), applicable browser/edge/database suites,
   and any migration-inventory tripwires affected by the change. No application build is needed for this docs-only plan.
5. Rehearse additive migrations on staging, then dependent functions, then frontend preview.
   Follow current repository rollout scripts and verify hosted definitions/types using its own workflow.
6. Review employee, approver and owner flows at mobile and desktop widths, including keyboard/error/retry paths.
7. Pilot time/PTO with a small staff group through one full pay period and an accrual/leave cycle.
   Reconcile against the clinic's current authoritative process before treating Hub output as payroll input.
8. Prepare the PR and staging evidence. Dave merges a specific PR on his explicit go; agents do not merge.
9. Verify production schema, functions, scheduler, frontend and feature flags separately.
   Capture release SHA, test results, activation and monitoring owner in a sanitized receipt.
10. Roll back activation/worker schedules first if needed. Preserve punches, approved snapshots and ledger history;
    reconcile any finalized/exported records instead of destructive schema rollback.

## Risks and limits
- Existing hosted feature/deployment status is not established by this repository audit.
- Pay/time/leave policy and form versions must be supplied and verified before activation; no legal conclusions
  or statutory formulas are embedded in this plan.
- Anonymous review promises require schema/log/export design and a small-team disclosure decision.
- New clinical algorithms need current authoritative reference research and Dr. Edler's acceptance.
- No multi-clinic abstraction is needed for Dave's confirmed single-practice scope.
