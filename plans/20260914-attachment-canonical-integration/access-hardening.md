# Observed staging access drift and correction requirements

Read-only comparison on September 14, 2026 uses the observed 84-version staging ledger and a fresh, isolated local reconstruction of those same migrations. Migration names/versions agree. The query compares public relation ownership, effective anon/authenticated/service_role table and sequence privileges (including PostgreSQL17 MAINTAIN), RLS/force-RLS, complete public policy definitions and roles, and explicit global/public default ACLs.

The initial comparison found five sequence differences and three PostgreSQL-owner public default-ACL differences. All235 public RLS policies matched. At audit time the repository had no ALTER DEFAULT PRIVILEGES statements; these defaults reflect differences in the platform baseline rather than a migration-defined policy. The sanitized evidence file records the final exact comparison and source hashes.

Affected sequences:

- anesthesia_record_revisions_id_seq
- care_plan_revisions_id_seq
- communication_processing_history_id_seq
- lab_work_revisions_id_seq
- reminder_automation_policy_history_id_seq

Staging grants all three API roles USAGE/SELECT/UPDATE on these sequences. The local baseline still grants UPDATE. Local and hosted public defaults for objects created by postgres also differ for tables, sequences and functions. Even the local table defaults retain TRUNCATE, REFERENCES, TRIGGER and MAINTAIN for API roles. These are unnecessary defaults for future private objects; this observation is not proof of an exposed HTTP endpoint or leaked records.

## Additive correction to implement and validate

1. Inspect the hosted migration executor's ability to alter defaults for postgres and supabase_admin. Do not silently skip a creator role or widen role membership to make the migration pass.
2. Add a forward migration removing PUBLIC/anon/authenticated/service_role grants from the five named private history sequences. Preserve ownership and every existing table/RPC grant.
3. Normalize explicit public-schema defaults for the authorized migration creator roles: revoke ALL table, sequence and function default grants from PUBLIC/anon/authenticated/service_role. Preserve owner and unrelated-role defaults. Do not rewrite defaults in auth/storage or other managed schemas.
4. A schema-specific REVOKE cannot remove PostgreSQL's implicit global PUBLIC function EXECUTE privilege. Keep explicit per-function PUBLIC revocations in every application migration. Do not claim that schema-specific default normalization alone makes all future functions private, or change global defaults affecting other schemas without a separate impact review.
5. Reproduce both observed baselines in an owned disposable database, apply the proposed migration and require convergence. Test actual private revision creation and history preservation, sequence owner access, denied API-role sequence manipulation, and future public objects created by each supported role. Test explicit PUBLIC revocation on a new function so residual direct role defaults cannot retain access.
6. Run all SQL/runtime suites on the new migration count, including populated84-to-target upgrade and physical restore. Update frozen harness inventories deliberately. Re-run public access and routine comparisons against the intended post-migration state.
7. Coordinate hosted changes only after the additive migration and full acceptance pass. No hosted permission changes have been performed during this audit.

## Limits

This inventory does not compare column-specific grants, role memberships, schema grants, managed auth/storage policies, provider configuration or row data. Matching RLS definitions does not itself prove every user workflow. The commercial-readiness goal remains open until the correction and remaining hosted/provider/clinical gates are verified.

## Implementation scope after authority preflight

A fresh hosted read-only check identifies both current_user and session_user as `postgres`, with ability to act as postgres=true and supabase_admin=false. Migration20260914120000 therefore explicitly normalizes only postgres/public defaults and the five postgres-owned sequences. It does not silently skip a role in a conditional loop, alter membership, or claim to normalize managed defaults. A follow-up hosted ownership query confirms all191 public relations and473 application functions belong to postgres. Supabase-admin-created objects remain outside this application-owner correction; the approved deployment path must continue using postgres, and a future creator-role change requires renewed review. No additional managed-role access is required for the observed application objects. The schema-specific global-PUBLIC function limitation above remains in force.

The new SQL test checks final grants, future postgres-owned public objects, actual denied anonymous nextval/setval, owner access, and unchanged functions/table grants/RLS/other defaults. The concurrency harness additionally injects both observed local and hosted defaults before replaying the exact migration and repeating those tests. Existing full-regression cases create and preserve revisions for all five sequence families. The99-migration actual Auth/Storage and populated upgrade/restore runs supply runtime acceptance. Their outcomes are recorded in the accompanying evidence once verified. No hosted correction has been applied.

Validation passed on the99-migration stack:3,109 SQL assertions (93 hardening checks repeated on final/local-drift/hosted-drift states),162 prescription and262 attachment contention checks,171 real local API checks, and populated84→99 physical restore with exact canonical access comparisons. The first concurrency attempt missed a required wait during parallel runtime startup; the unchanged full suite passed on a serial rerun. See `docs/evidence/public-access-hardening-20260914.json` and its paired physical/restore receipts. Application of the migration to hosted staging and subsequent parity checks remain outstanding.
