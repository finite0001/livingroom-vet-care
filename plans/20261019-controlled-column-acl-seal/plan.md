# Detect later column grants in the controlled-stock manifest

Base: released PR #286 (`a153bd9ef1b9a17a84cb1036613815e821d91515`).
Extend only the existing scoped technical manifest; keep the inactive private
artifact outside canonical migrations. Susan's approval and clinical/register
activation remain pending. CLI-owned migration/ledger atomicity is separate.

- [x] Add normalized direct column ACL records to all columns of the 51 already
  covered relations, preserving grantee, grantor, privilege and grant option.
  Sort by role names and privilege with stable collation, never role OIDs.
  NULL/empty ACL means an empty array, not invented table-owner privileges.
- [x] Preserve the released #286 expected pin verbatim as a provenance reference.
  Derive the new independent expected manifest from that pin and the reviewed
  explicit metadata delta. Verify the old function-definition rendering against
  its known hash before deriving the new hash; never capture the new installation
  as its own expected baseline. Review canonical sources for direct column grants
  on the covered relations. Preserve original trusted-189/preflight references.
- [x] Add meaningful offline mutation and strict proof tests. Add actual later
  authenticated/PUBLIC grants, grant-option and covered-source-column mutations;
  require observed grants and exact manifest refusal. Require full catalog,
  column ACL, original row, writer and migration-ledger restoration after each
  fresh-backend rollback; never reseal the injected grants. Repeat on populated
  restored state with unchanged ownership/budget guards.
- [x] Review code and independent pin before freezing all executable inputs.
  Pass focused runtime plus fresh full ordinary SQL/Auth/capacity/restore and
  genuine historical compatibility. Bind proofs to source bytes and require
  independent owned-resource cleanup. Preserve attempts privately.
- [x] Publish sanitized reviewed evidence and precise coverage limits.
- [ ] Commit and open a reviewed PR; persist until all five exact-head CI checks pass.
  Request Dave's specific approval before merging that new PR.

No canonical migration, hosted installation, live register state, public RPC
commissioning or practice-policy decision is part of this batch. Scoped column
ACL detection does not imply whole-catalog, role-membership, schema/default-ACL,
or lifetime-prevention coverage. The owner can still alter the database; the
manifest must refuse subsequent guarded operations when covered metadata drifts.
