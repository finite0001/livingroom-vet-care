# Susan's inventory catalog draft import

Owner decision: import the inventory as drafts, then configure exact strengths, stock units and prices before activation. Source: the [Living Room Vet Inventory sheet](https://docs.google.com/spreadsheets/d/1O1FTZ8fjYHwyMt01I8DAyHjm-iCDfOtL7k44dSaDP6Q/edit), captured November 10, 2026; [unchanged workbook and readable tables](../inventory/README.md).

## Hosted database rollout

Migration `20261110181205_susan_inventory_catalog_setup.sql` was applied with Supabase CLI 2.118.0 to staging `kothoqicubowyhwfsrte`, then primary `mgadheotkdnrsatfivjy`. Each dry run listed this migration alone. Pushes used `--skip-vault`, without seed/role flags. No Edge Function deployment is needed.

Both projects were verified to contain 217 source rows, including eight vaccine rows, with zero source-to-product links. Primary retained its two existing catalog products; the import did not create active products. Both new tables have RLS enabled; anonymous execution of search and configure RPCs is denied. The original blank inventory counts remain source text, with no inferred stock movements or patient records.

The three new authenticated SECURITY DEFINER RPCs are intentional staff-only interfaces: every function calls `clinical_require_staff()`, and both mutation functions also compare the supplied actor to the authenticated user. Direct writes are not granted. The source-product link has its own UUID for compatibility with `audit_trigger_fn()` and a unique source/product pair. Security advisor notices about these authenticated definer interfaces were reviewed; the staff gates and denied anonymous/direct-write cases were exercised locally.

## Verification

- All 217 source rows and fields independently compared with the original Excel workbook.
- Disposable PostgreSQL acceptance: migration install, empty active catalog after seed, several variants per source, exact operation retry, existing-product linking, missing-source rejection, actor mismatch rejection, direct-write denial, anonymous/inactive-staff denial and audit records.
- Eleven focused Node tests passed (catalog setup, stock policy and Whogot model).
- TypeScript app checking, targeted ESLint and production build passed with the repository lockfile. The main clone's older installed dependencies were not reused.
- Ten inventory/Whogot Playwright checks passed, including the new 390px catalog-draft scenario, same-operation recovery after an interrupted response, preserved unknown stock fields, recipient-search links and no stock/treatment writes during catalog setup. The mobile screenshot was visually reviewed.

The browser tests use synthetic API fixtures; the SQL acceptance uses disposable PostgreSQL with the real catalog table/creator and focused auth/audit fixtures. These do not claim a genuine hosted create/dispense round trip. Existing frozen canonical restore harnesses still pin 206 migrations and their October 22 head, while main already had 211 before this change; they were not broadened as part of this import.

## Frontend release and use

The frontend change is in PR #322 and awaits Dave's merge. Until its deployment, the draft rows exist in the database but the new setup panel is not visible on the live Inventory screen.

After deployment, open Inventory → **Susan's inventory · catalog drafts**. Configure a precise medication/vaccine variant or link an existing product. Supply/retail rows can remain drafts. Receive physically verified stock separately; patient treatment uses the existing product/lot/patient ledger and Whogot search. No reorder thresholds or direct appointment association are introduced by this catalog import.

Recovery: the database change is additive. A prior frontend can continue using the original catalog. Keep source rows, source links and audit history; correct future source changes through a reviewed forward migration rather than deleting product provenance.
