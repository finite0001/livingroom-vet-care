# Explicit staff and consent RPC execution grants

Migration4600 corrects the six direct-role permission differences found in the read-only hosted comparison. It revokes privileges on those exact function signatures from PUBLIC, anon, authenticated and service_role, then grants the intended callers explicitly:

| RPC | Allowed application roles |
| --- | --- |
| `admin_set_staff_active(uuid,boolean)` | authenticated |
| `admin_update_staff_role(uuid,user_role)` | authenticated |
| `clock_in()` | authenticated |
| `clock_out()` | authenticated |
| `review_ezyvet_snapshot(uuid,text,uuid,uuid,text)` | authenticated |
| `get_consent_submission(text)` | anon, authenticated |

Staff and ADMIN checks inside the functions remain unchanged. Clock actions remain scoped to the authenticated staff member. Consent lookup retains its intentional public bearer-token and expiration checks. No function body, owner, security-definer setting, search path or global default ACL policy changes. Database owners retain their PostgreSQL ownership authority; this matrix describes application roles.

The correction is additive: do not rewrite migration receipts or edit already-applied historical migrations. Run it as part of the reviewed pending batch after restoring the missing older migrations. Hosted grants have not been changed by this work.

## Verification

`explicit_staff_rpc_grants.test.sql` covers the exact effective role matrix, denial of anonymous staff administration, denial of service-role calls even with an ADMIN subject, ordinary/inactive staff restrictions, self-scoped clock actions, active ADMIN operations and valid/expired/missing consent tokens. It passed46 assertions alongside54 existing staff/ezyVet regression assertions.

The standalone upgrade runner reproduces the observed direct grants, executes the exact4600 migration inside one transaction, verifies corrected permissions and unchanged metadata/default ACLs, rolls back, and verifies the original ACLs were restored. It passed28 checks with both the default owned local project and an explicit project configuration. CI runs the explicit configuration path:

```sh
python3 supabase/tests/explicit_rpc_grants_upgrade.py --project-config supabase/config.toml
```

The full gap rehearsal now has a reviewed66-migration inventory and recreates the six direct grants on its disposable source before the backfill. Its clean-install comparison must prove the correction converges to canonical permissions along with the existing record-preservation and restore checks. This remains synthetic local evidence; hosted correction and final hosted acceptance are separate gates.

The actual combined51→66 rehearsal passed at source `1112e86` plus the recorded runner changes. Its initial259-routine/168-trigger inventory matched the earlier read-only hosted inventory exactly, including the six grant differences. After all15 missing migrations, canonical function definitions/owners/security/configuration/effective grants and trigger definitions/enable modes matched. Captured records remained identical except migration history, and the full database/private-Storage restore and cleanup passed.

Protected result: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-restore-synthetic-ex8f7dsm/result.json`. Total121.00s; backup12.33s; restore/verification4.27s. Executed runner SHA256 `997e07631a58ba651df5150fc409a03019d0dc4fc4f8c2e87317261d216fbe0d`; archive SHA256 `31d84252b3f00fd6ffc20b1fbb2e066a38969650d498566c4d332134cd564b15`. New payment/scheduler/retry tables remain schema-restored but unpopulated by this clinical fixture. Independent migration and integration reviews found no blockers.
