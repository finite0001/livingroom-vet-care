# Staged deployment hold — September 26, 2026 UTC

Repair implementation: `f5a6cd0be3e54663f85d89ceae91e93366356c58` on `codex/commercial-readiness-repair-20260925`, packaged with later evidence and safeguards in [PR #205](https://github.com/finite0001/livingroom-vet-care/pull/205). The Vercel preview built. Its URL requires Vercel SSO, so a browser smoke was not completed. No hosted SQL, Edge function, provider setting, or production frontend was changed during this rollout attempt.

## Fresh read-only state

- `supabase db push --project-ref kothoqicubowyhwfsrte --include-all --skip-vault --dry-run` listed 32 staging migrations, including 15 interleaved gaps.
- The same primary-project dry run listed `20260924120000`, `20260924130000`, and `20260926031324`.
- Staging has 119 recorded versions. The catalog lacks `public.native_return_events` and `public.native_reconciliation_authorization_affected(uuid)`, although the later `20260916100000` migration has a receipt. The four native dispense finance tables and sampled finance function are also absent although `20260916110000` has a receipt.
- Conversely, staging already has `public.conversation_attachment_uploads`, `public.conversation_email_artifacts`, and `public.conversation_email_outbox_links`, although the creating migrations `20260916100001` and `20260916110001` have no receipts. Presence alone does not establish full migration body, grant, trigger, or data parity.
- The two collisions are exact version renumberings. Hosted `20260916100000` is named `conversation_attachment_uploads`, while that local version is `native_return_reconciliation_releases`; hosted `20260916110000` is named `conversation_email_preparation`, while that local version is `native_dispense_finance`. All 24 and 44 stored hosted SQL statements, respectively, occur verbatim and in order in local `20260916100001` and `20260916110001`, with only statement separators between them. No other recorded migration name differs from the local file. The primary project's 148 recorded names all match local files.

## Isolated rehearsal

A private, schema-only dump of staging's `public` schema was imported into an isolated local Supabase project; no hosted rows were copied. Its 119 recorded versions were seeded into the local migration ledger. The CLI selected the same 32 migrations as the hosted dry run. Applying them stopped at `20260916100001` with `relation "conversation_attachment_uploads" already exists` after the first ten gap files. The earlier receipt-only reconstruction had independently failed while creating `native_reconciliation_authorization_affected` because `native_return_events` was absent.

For diagnosis only, the two conversation versions were marked applied **in the isolated clone**. The remaining migration files then applied. A comparison with a clean local database built from all 151 migrations still found four missing finance relations, 22 missing routines, and 16 missing triggers in the clone. Samples of these absences were confirmed against the live staging catalog. Clone ACL differences are not counted as hosted findings because the schema import did not preserve the hosted default-privilege environment; live grant checks must be used for access decisions. This rehearsal did not contain populated staging data or prove recovery.

A second isolated schema-only clone corrected the **versions** of those two receipts, preserving the SQL identity they represent. The CLI then applied all 32 missing files successfully. Its final inventory matched a clean 151-migration database for all 260 relations, 870 routines and their definitions, 428 trigger bindings, and 239 policies. The remaining ACL differences in the clone stem from its import/default-privilege environment and do not assert hosted access parity. No hosted ledger was changed.

Separately, the full synthetic restore runner replayed all 151 migrations, backed up populated clinical, communications, Auth, and private Storage fixtures, restored them into a second isolated project, and passed its routine/access and original-byte checks with cleanup verified. The native prescribing disposable suite passed its populated restore and browser checks, and the attachment suite passed its Auth/Storage checks. These establish local recovery behavior for the canonical tree; they do not restore the actual hosted staging backup or test its existing rows through the 32-file upgrade. Staging has completed daily physical backups but no PITR enabled in the CLI backup inventory.

## Release decision and next sequence

Do not run the hosted staging push before re-versioning the two proven conversation receipts in one guarded transaction. Capture current row/Storage and recovery evidence first, rehearse the populated upgrade, then re-check the raw ledger and the CLI's exact 32-file plan. Apply the staged plan and verify live effective grants, policies, triggers, records, and workflows from the [repair progress contract](2026-09-25-repair-progress.md). Only then deploy the explicit matching Edge manifest, test controlled provider round trips, and proceed to the primary project and frontend. Keep payment and live-send gates disabled throughout this release candidate.

The draft PR remains one review unit. A successful code CI run or Vercel build does not clear this hosted schema hold.
