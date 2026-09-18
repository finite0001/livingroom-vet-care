# Populated communications restore acceptance

Status: full isolated database/private Storage restore passed on the132-migration integration base. Six earlier failed rehearsals exposed and corrected fixture issues plus real default-privilege and Storage metadata restoration defects. Hosted restore and commercial launch acceptance remain separate.

The full owned restore runner now adds a communications fixture after the existing clinical, original-document and release-delivery fixtures. It preserves every prior fixture row before incorporating new synthetic identities, audits and objects into the exact baseline. Existing zero-outbox checks become exact full-row inventory checks: zero before communications seeding and precisely the single reviewed synthetic outbox row afterward. An extra, missing or changed outbox row fails acceptance, regardless of message family.

The new `scripts/restore-rehearsal/communications-fixture.mjs` exercises:

- Authenticated upload reservation, actual private Storage upload/readback, byte verification, immutable email capture and attested queueing through existing RPCs; original bytes and reviewed payload/outbox attribution are retained.
- Synthetic matched inbound event metadata, service claim, actual private original upload/readback and fenced finalization. No Resend or other provider request is used.
- A historical synthetic unverified upload and Storage object aged eight days, then ordinary abandonment and service cleanup with the real 168-hour grace. Aging is fixture setup; no production grace override or cleanup scheduler is introduced. The completed receipt/tombstone survives while the cleaned object remains absent.

After full database and physical Storage restore, acceptance compares all five new ledger families plus prepared requests, messages, provider events, inbound associations and the entire outbox. It verifies original SHA-256/length through owner Storage reads, shared captured-message retrieval and the inbound authorized-read handler backed by actual Auth/RPC/Storage. It checks foreign draft and anonymous denial, wrong-message denial, immutable upload protection, exact queue/capture recovery, cleanup completion replay and inability to recreate abandoned bytes. Stored provider payloads are compared exactly; verification never reconstructs them from current state.

All public function definitions/grants/configuration, table privileges/RLS/policies and triggers are now compared directly with the source on every run, including fresh runs. Communications constraints, private bucket configuration and Storage policies also receive exact comparisons. Existing physical file manifests and original clinical/release artifact checks remain required.

The backup manifest and final evidence contain SHA-256 fingerprints for every restore module, shared handler dependency, migration, focused test and package manifest/lockfile. Source files must remain unchanged through backup/verification. Resume requires the same recorded source manifest; older backups without it intentionally fail this stricter acceptance gate.

Runnable command after coordinating local capacity:

```sh
python3 scripts/restore-rehearsal/run.py --run-synthetic-local-rehearsal
```

Default owned source/destination API ports are 58321 and 59321, with their existing adjacent-port reservation checks. The runner creates and cleans its own UUID-named projects; it must not be pointed at shared projects. Existing staging/observed-gap rehearsal flags remain available. Successful runtime evidence must include `communications_restore` and `source_hashes` alongside the existing full Storage manifest; static tests do not substitute for that evidence.

## First runtime failure and correction

Owned run `63958` ended unsuccessfully at the exact public-security comparison; cleanup completed. It is not restore acceptance. Protected evidence identified a real mismatch, not list ordering: the destination retained `postgres` schema-local default sequence `UPDATE` and table `MAINTAIN`/`REFERENCES`/`TRIGGER`/`TRUNCATE` grants to `anon`, `authenticated` and `service_role`. Five restored history sequences consequently exposed `UPDATE`: anesthesia record revisions, care plan revisions, communication processing history, lab work revisions and reminder automation policy history. Functions, triggers and policies matched.

The destination setup previously neutralized only `supabase_admin` creation defaults. It now also neutralizes the `postgres` schema-local defaults before archive restore, matching the existing migration's explicit creator policy. No post-restore object grants are rewritten, and the full source/restored equality assertion remains intact. Future mismatches persist `security-comparison.json` before failing; it contains section names/counts/digests only, never function bodies or configuration values. Three focused diagnostic tests verify ACL drift, ordering distinction and redaction.

This source change requires a fresh source backup because the earlier backup's source manifest is frozen. Do not resume or relabel the failed run as acceptance. A new full runtime is still required.

The fresh run `54129` proved the security correction (`security-comparison.json` reported equality), then failed the legacy final fixture snapshot assertion. Its only diff was a reordered `auth_users` element: the added/removed ID, email and password-hash fields were identical. The legacy aggregation lacked `ORDER BY`; two additional fixture accounts exposed physical scan-order changes after sign-in. The Auth snapshot now orders by immutable user ID while retaining every compared field and the exact equality assertion. That run remains failed and cleaned; this correction again requires fresh-source runtime acceptance.

Run `30365` again passed the complete public-security comparison and the legacy clinical/release verification. It then failed the new communications constraint projection: PostgreSQL's non-pretty `pg_get_constraintdef` deparse retained one redundant pair of parentheses around an AND expression on the source, which disappeared when the dump was parsed on restore. The two CHECK definitions produce identical PostgreSQL parser ASTs after source-position removal; there were no other reported differences. Communications constraints now use `pg_get_constraintdef(oid,true)`, as the existing native restore harness already does. Names, validation flags and complete constraint expressions still compare exactly; no constraint is omitted or treated as generally ignorable. A fresh-source run remains required; `30365` is not a successful restore.

The fifth run reached restored communications byte access after passing public security, communications constraints/buckets/policies, exact ledger rows, outbound original hashes and captured-message reads. Incoming authorized retrieval returned404 where200 is required. Offline saved associations, active staff, source Storage metadata (`application/pdf`,65 bytes), and capture hashes are consistent; source upload readback had already passed strict MIME/hash verification. The handler's intentional generic error conceals the restored failure stage, so no underlying cause is yet proven. The fixture now includes bounded per-stage status, SQLSTATE and equality booleans in this assertion message, excluding tokens, object paths, IDs, raw errors and metadata contents. Required200 and all byte/access checks remain unchanged. A fresh diagnostic run is required; this is not a successful restore or a claimed functional fix.

## Sixth rehearsal: original Storage filesystem metadata

The protected `lrv-restore-synthetic-9zh_jue_` trace proved that Auth, exact message/capture authorization, original byte length and SHA-256 all passed. The downloaded Blob was `application/octet-stream` instead of the original `application/pdf`, correctly producing HTTP404 at the strict inbound reader. Supabase Storage v1.71.0 FileBackend reads MIME from Linux `user.supabase.content-type` and defaults to octet-stream when absent; `docker cp` preserved file bytes but lost extended attributes. This is a restore-harness defect, not an application authorization failure.

The runner now captures original `user.*` filesystem attributes using the owned Storage image's own fs-xattr dependency, binds each entry to its exact path/length/SHA-256, and records a hash of that metadata archive. Ingress/Auth/REST are stopped before capture, then Storage is stopped before the database/file backup pair. On the destination, original attributes are restored and compared before ingress/Auth/REST restart. All physical hashes, original MIME checks and access boundaries remain strict. No MIME is reconstructed from database metadata. Symlinks, inventory differences, unexpected destination attributes and malformed archived attributes fail closed. Metadata equality is checked again after authorized reads. The new helper is included automatically in the source fingerprint.

This correction has only static/offline validation pending a fresh parent-owned rehearsal. Earlier failed artifacts are unchanged and cannot be relabeled as accepted.


## Successful full rehearsal

Seventh run0mzl9_0l passed the complete owned database/private Storage restore and cleanup. [Sanitized evidence](evidence/communications-populated-restore-20260916.json) retains exact source fingerprints, full public-security equality and physical file metadata comparison. All five communications ledger families were populated; the exact single reviewed outbox row survived, two communications originals passed authorized byte/hash/MIME reads, access denials remained enforced and completed cleanup recovery was verified. All five backed-up physical files retained exact bytes and original filesystem attributes. Existing clinical, signed-history, invoice/credit, stock, release and prior original-document checks also passed.

No provider requests or hosted mutations were made. Both owned runtimes were cleaned. The execution Git head names the integration base; source fingerprints identify the then-uncommitted restore changes. This evidence does not include the later estimate-decision branch or constitute hosted disaster-recovery acceptance.
