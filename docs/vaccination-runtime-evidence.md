# Consult-scoped vaccination runtime evidence

2026-09-13: **43 checks passed** through actual disposable Supabase Auth and PostgREST, the real import handler behind local HTTP, and a synthetic local ezyVet upstream. No hosted project or real provider requests were used. The wrapper verified removal of its containers, volumes, Auth identity and fixture rows.

Run from the repository:

```sh
python3 tests/ezyvet/vaccination-disposable.py --run-synthetic-local
```

The wrapper creates a uniquely named local project on ports 60320/60321/60322/60324, applies the checked-out migrations, refuses existing destination resources and writes a sanitized receipt. CI runs the same TypeScript harness against its explicitly configured disposable project. Neither runner resets an existing shared foundation.

## What was proved

- A real signed-in administrator stages a scoped consult, then imports two vaccination pages using the server-derived consult filter and maximum ten items. OAuth works without an optional partner ID.
- Anonymous and authenticated non-administrator access is denied. Direct vaccination receipt tables are inaccessible to anonymous, authenticated and service API roles.
- A mixed-consult upstream response is rejected. An independent direct PostgREST mixed-consult page also leaves no partial snapshots or cursor advancement.
- A lost stage acknowledgement retains its committed cursor. The original UUID resumes from that cursor, terminal retries avoid upstream calls, and a different mapping cannot take over that UUID.
- Server run discovery and candidate reads preserve approved patient mapping, exact consult provenance, raw source date strings, null values and untrusted text.
- Advancing the consult source head leaves historical vaccination association visible and ineligible. Exact terminal recovery and committed-page replay still work without a lease; altered completion flags fail.
- Generic vaccination claims and legacy generic terminal UUID rebinding fail.
- Treatment, stock, inventory movements, invoice, certificate, reminder, encounter and outbox data do not change.

## Exact synthetic receipt

Receipt: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-vaccination-6061e45a22ae-result.json`.

| Input | SHA-256 |
| --- | --- |
| Runtime harness | `9a54633ffcf53089e2ff44220a62ed95c8ee52b8ef885cf7305b0fef134ddf92` |
| Disposable wrapper | `a6591d2b9e536414f4596dd3444df74be8223bcb236375cb482a736446a0e5bc` |
| Migration 20260913520000 | `f5e52dffeb5e074d8f09496e968cb4392d098d27cad983600b88746115d11238` |

The receipt records source revision `b26d9048f9eb32c525ea625dbb94e827f4b3b91c` and hashes all 72 migrations. The final run used all 72 checked-out migrations, including the committed vaccination migration; the hash above identifies its tested bytes. The harness hash was checked unchanged across execution.

An earlier run exposed numeric-string IDs accepted by the adapter but rejected by SQL. The final run used the aligned number/string contract. A fixture-only timing issue was corrected by advancing the owned synthetic consult run's two-second cooldown before its next observation; production pacing code was unchanged.

This is synthetic runtime evidence, not production-source acceptance, hosted Edge acceptance, interpreted vaccine history, certificate eligibility or clinical approval. The matching 72-migration restoration evidence is recorded below.


## Database and private Storage upgrade/restore

The final rehearsal passed using the same committed vaccination migration. It upgraded the observed 51-migration ordering to canonical 72, reproduced and corrected the prior direct-grant drift, and compared application routines, grants and triggers against a fresh canonical destination.

After upgrade, the owned synthetic source creates one scoped consult and one vaccination through the real claim/staging RPCs. The fixture temporarily adds an administrator role only when necessary, removes it in the same transaction, and checks that the existing clinical, billing, Auth and Storage snapshot is unchanged. Twelve import/provenance tables are captured before backup and compared exactly after restoration, including the vaccination context, page fingerprint, observation revision, consult and source snapshots.

- Vaccination contexts/pages/observations restored: **1 / 1 / 1**, with all captured source and receipt rows identical.
- Fresh Auth login, signed SOAP/addendum immutability, invoice/credit and stock balances, original private file bytes, anonymous/public denial, empty outbox and absent cron: **passed**.
- Owned source and destination containers/volumes: **cleanup verified**.
- Total rehearsal: **163.85 seconds**; backup: **15.17 seconds**; restore and verification: **5.70 seconds**.

Result: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-restore-synthetic-mafkb8uk/result.json`.

| Evidence | SHA-256 |
| --- | --- |
| Restore runner | `a3f76dad718f91b9f2dd030e38a3afb4fe165751feb61c58bae1c38581d33bd9` |
| Database archive | `f5be931552792ddf53d1b38e81bea2425c6b4e576fa85c14126106f5d559bf53` |
| Vaccination source/receipt fixture | `8435204f22c54da669cd5ba84ef6e8f6336e1e76a35e4d625a71e0e1580f6853` |

```sh
python3 scripts/restore-rehearsal/run.py --run-synthetic-local-rehearsal --rehearse-observed-hosted-gaps
```
