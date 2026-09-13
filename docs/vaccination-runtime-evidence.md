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

Receipt: `/var/folders/j9/dv101nxj5_xd3rjcjkq6_xd40000gn/T/lrv-vaccination-5fe6425275d5-result.json`.

| Input | SHA-256 |
| --- | --- |
| Runtime harness | `9a54633ffcf53089e2ff44220a62ed95c8ee52b8ef885cf7305b0fef134ddf92` |
| Disposable wrapper | `a6591d2b9e536414f4596dd3444df74be8223bcb236375cb482a736446a0e5bc` |
| Migration 20260913520000 | `7fd36018c0d3204c23cdd1f5593461f467836a6ffa335210d2c4c0d56ac2607c` |

The receipt records Edge dependency revision `90a7c88cf96cab8d18635889636dbf4116b47447` and hashes all 72 migrations. The new migration was supplied as an explicit development overlay; the hash above identifies the tested bytes. The harness hash was checked unchanged across execution.

An earlier run exposed numeric-string IDs accepted by the adapter but rejected by SQL. The final run used the aligned number/string contract. A fixture-only timing issue was corrected by advancing the owned synthetic consult run's two-second cooldown before its next observation; production pacing code was unchanged.

This is synthetic runtime evidence, not production-source acceptance, hosted Edge acceptance, interpreted vaccine history, certificate eligibility or clinical approval. The frozen restore inventory now expects 72 migrations; restoration evidence is tracked separately.
