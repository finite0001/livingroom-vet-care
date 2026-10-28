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

One PostgREST pre-request gate runs before the main query. The same catalog-only
admission runs first in BOTH current source frontier acquisition helpers
(shared121 and exclusive stock-workflow121), before old practice locks or user
relations. This protects writers even when a PostgREST instance has no hook or
has stale configuration. Installation precedes controlled-stock activation or
drains old API work; NOTIFY cannot retire an already-running old call.

Dedicated admission advisory key precedes every stock/count lock. Read durable
nonsecret mode/head/hash from the COMMENT on the NEW postgres-owned recovery
schema, using only pg_namespace and pg_description (exact class and objsubid).
An initial source-owned head and a canonical domain/version envelope distinguish
this control record from arbitrary text. Missing, malformed, wrong-owner or
mismatched projections refuse. Never trust current_setting or a caller flag.
A monotonic immutable head/hash binds every transition expected_head_id/hash,
preventing delayed commands across idle/armed/idle cycles. Owned-schema COMMENT
and immutable audit append commit atomically under exclusive admission. No extra
role-admin/parameter grants are needed. The earlier self-role setting design was
rejected after a real authenticated native permission failure.

After actual complete121, verify the immutable head/audit agrees with the raw
comment and verify the complete own module before any physical command. The
before-lock part stays catalog-only: reading an audit table there would trip
old any_user_held. Source-own and seal this post-frontier checker; source/root
checks and all original writer/authority semantics remain mandatory.

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
  configuration installed/verified and the restored armed schema comment agreeing
  with its immutable audit (pg_dump retains schema comments).
  Recheck complete metadata/ledger/rows/sequences and actual armed HTTP refusal.
- Missing-history evidence preserves original supplied bytes/references with real
  staff attribution and distinct second-user acknowledgment of the exact digest.
  Do not pretend a staff-reported document is an authentic lost server record.
- On the fresh receiver, a real administrator begins a recovery epoch bound to
  actual receiver boot, server clock, current arm and current head/hash. The
  receiver boot differs from the arm's source boot. A dedicated start wrapper
  requires both count ID and operation ID absent, calls the unchanged count-start
  API, validates the complete new graph/receipt, and appends its epoch marker in
  the same transaction. Exact marked retries recover the original; unmarked old
  cycles cannot be relabeled. The start wrapper uses admission/practice int2 + complete121 and reads its own
  epoch before entering unchanged start. It takes NO product or hashed operation
  lock first: the old fresh-start guard rejects all preheld int8 advisory locks.
  Held121 serializes absence checks and marker insertion. Do not compare tuple xmin with the top transaction
  ID: PL/pgSQL exception handlers may create subtransactions.
- Release only after fresh independent real Auth sessions and physical statements
  recorded/observed after the current epoch. Require the wrapper's actual current
  epoch/boot marker for every count; do not trust caller timestamps or flags. Actual associated
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

Version rest_defaults to require the exact reviewed pgrst.db_pre_request on
its supported authenticator setting, rejecting other forbidden overrides. The
mode is an owned schema comment, not a custom role setting. Verify ordinary
COMMENT ownership through a real authenticated definer call with a deliberate
subtransaction rollback before adoption. Hook registration uses reviewed config
reload; actual mode changes are immediate raw catalog reads and do not depend
on every pool observing reload. Preserve default API scopes/search_path. Test
actual runtime enforcement both with the hook and with it deliberately absent.

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
