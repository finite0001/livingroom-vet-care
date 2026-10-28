# Phase 2h — populated restore with post-backup physical reconciliation

Status: source design complete; implementation and fresh receiver proof pending.
This is application recovery for source-supported stock footprints, not proof of
full-cluster binary/PITR or Storage objects. Unsupported footprints stay held.

## State and enforcement

New private `narcotics_recovery_v1` immutable arms/evidence/decisions/releases and
own source-derived metadata descriptor. No FK/index/trigger on old relations.
Public fixed `narcotics_recovery_*_v1` facades; actual current ADMIN and configured
source authority, current real sessions, exact operation recovery. No owner
clinical seeding, fake claims, caller skip flag, or old record replacement.

One PostgREST pre-request gate runs before the main query. Dedicated admission
advisory key precedes every stock/count lock: shared ordinary requests, exclusive
arm/source-resume/release endpoints. Read the mode from raw global authenticator
`pg_db_role_setting.setconfig` only: `narcotics_recovery.mode=idle:<head_uuid>` or
`armed:<arm_uuid>:<head_uuid>`. A monotonic immutable head/hash binds every
transition expected_head_id/hash, preventing delayed commands across an idle/armed/idle cycle. Never trust current_setting for this value. Owner-only lifecycle
functions atomically append immutable audit and ALTER ROLE under the exclusive
admission lock. New functions compare the exact projection with immutable history
AFTER taking the original complete121 frontier. This is durable owner-protected
state, not a cached lock certificate. Any unknown/duplicate/database-scoped mode
projection refuses. No mutable caller GUC grants authority.

Catalog-only hook reads are required: reading a new mode table first would trip
old any_user_held and break ordinary cold ingress. Do not pre-acquire all stock
locks in the hook or classify every existing business endpoint. All existing
frontiers/writer signatures/metadata checks retain their source meanings.

Idle mode returns after catalog/role/origin checks. Armed mode permits read-only
GET/HEAD plus a fixed POST count/reconciliation/recovery allowlist. Refuse all
other POST/PATCH/PUT/DELETE, including normal managed/direct physical writers,
configuration, table and GraphQL writes and service-role mutations. Existing
per-endpoint Auth/role/independence/hold checks still run. GoTrue password grants
remain a separate service. Pin actual local request.path spellings in real proof.

## Control protocol

Every mutation, including evidence and independent acknowledgment, claims its own
immutable operation/kind/request hash. An exact saved retry returns its original
receipt WITHOUT reapplying the mode. ID-only recovery returns saved/not_found/
abandoned. Not_found never clears a pending pointer. Close under admission
EXCLUSIVE returns saved or creates a permanent tombstone; delayed original calls
refuse. No shared-to-exclusive upgrade, no new ID substituted for an uncertain save.

- Arm BEFORE backup: exclusive admission then original exclusive practice barrier
  and121 frontier; full current modules/authority. Capture complete ever-managed
  product/site inventory, original full physical boundary/digest, actual database
  name+postmaster start, actor/session/time/reference. Append arm and armed mode.
- Backup holds SHARED admission in an exported-snapshot transaction for complete
  pg_dump; verify the committed arm inside snapshot. Exclusive release cannot race
  dump. Dump full required app/private/clinical/Auth/migration/sequence/ACL state.
- Source-resume only same actual source boot/database AND unchanged full boundary.
  A restored/restarted source cannot use this shortcut. Append exact decision and
  idle mode atomically. Original source can then post a real synthetic movement
  after backup; retain its original HTTP bytes outside the database.
- Fresh receiver stays inaccessible until dump restored AND exact reviewed hook
  and armed role projection installed/verified (pg_dump omits global role settings).
  Recheck complete metadata/ledger/rows/sequences and actual armed HTTP refusal.
- Missing-history evidence preserves original supplied bytes/references with real
  staff attribution and distinct second-user acknowledgment of the exact digest.
  Do not pretend a staff-reported document is an authentic lost server record.
- Release only after fresh independent real Auth sessions and physical statements
  recorded/observed after both arm and actual receiver boot. Actual associated
  auth.sessions.created_at must also be after receiver boot/arm. Require actual
  receiver boot strictly after the bound server backup capture instant; a receiver
  started before the backup is not this accepted restore. Every captured scope
  needs a current agreeing count; any variance needs existing prepare/independent
  approve/execute/independent confirm plus newer agreement and cause resolution.
  Validate all original graphs/current authorization/complete composed causes;
  don't accept booleans or restored preexisting counts as proof. Reviewed missing
  history and full source scope inventory must match. Append release+idle atomically.

Existing correction adapter only supports one onsite available cell/container.
Synthetic recovery proves that footprint with complete current application history.
Prepared/return-held/multi-cell discrepancy remains held explicitly rather than
bypassing this source restriction. Ordinary access never clears expiry, quarantine,
stock-state or unrelated investigation holds.

## Settings and proof

Version rest_defaults to require exact `pgrst.db_pre_request` and valid protected
mode projection; reject every other existing forbidden setting. Initial hook
registration uses reviewed ALTER ROLE plus config reload. Mode reads raw catalog,
so changes do not depend on a config reload reaching all pooled connections.
Preserve default API scopes/search_path. Test actual runtime hook enforcement.

Fresh source and receiver owned clusters/volumes, same original600/work540/cleanup55,
owner30/app8/lock5 deadlines (no renewal). Populate real current reviews/counts,
backup while armed, resume source, post+1 AFTER backup; restore frozen20, enter
independent physical21, investigate/correct/confirm/recount/resolve/release.
Check complete source snapshot and current modules, original rows, new Auth effects,
sequences, and only prospective additions. Wrong actor/session/source boot, self
signing, stale boundary, unresolved causes, unsupported footprint, late rollback
and revocation after waiting all refuse without stock effects. Normal bounded
cleanup removes only owned source/receiver resources; other builds continue.

Official protocol sources: [PostgREST configuration](https://docs.postgrest.org/en/stable/references/configuration.html),
[transaction and request settings](https://docs.postgrest.org/en/stable/references/transactions.html),
[Supabase API pre-request](https://supabase.com/docs/guides/api/securing-your-api).
Named PR approval remains required before hosted changes/merge/deployment.
