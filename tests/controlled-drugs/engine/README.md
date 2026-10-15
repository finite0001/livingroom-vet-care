# Controlled stock source reconciliation

This is a **local SQL reference oracle**, used by the native prescription acceptance runner to check the source obligations for the unfinished C1b engine. It is not a hosted function, managed transaction protocol, clinical permission or controlled-drug register. No new migration, policy, opening, container or activation endpoint is installed.

Run the complete acceptance gate from the repository:

```sh
python3 -B tests/prescriptions/native-disposable.py --run-synthetic-local
```

For development, `tests/controlled-drugs/source-reconciliation.py --run-synthetic-local --project-config /absolute/path/to/owned/project/supabase/config.toml` accepts only a matching owned `lrv-prescription-*` or `lrv-controlled-engine-*` Docker project. It checks the actual project/workdir labels, creates a marked clone database, and removes that clone on success or failure. The caller remains responsible for stopping its enclosing owned runtime.

The clone contains schema, ten reviewed stock-writer manifest rows and the canonical disabled version-zero ordinary-return policy seed. It copies no source clinical records, Auth sessions, provider settings or runtime policy decisions. Four existing canonical fixtures generate synthetic ordinary medication history through the original writers. Any ordinary-return policy decisions in those fixtures remain isolated in the clone; they do not authorize controlled-drug handling.

`source-reader.sql` and `source-effects.sql` create only private `pg_temp` invoker functions inside a rolled-back transaction. The reader checks the saved canonical receipt, actor, actual stock-source membership, verified original dispense and exact allocation identities. The effects oracle describes the recorded source quantities; it never posts them or authorizes execution. Its temporary functions disappear with the connection.

| Source | Available-stock obligation | Custody obligation |
| --- | --- | --- |
| Receive, adjust, treatment, anesthesia | Preserve the original signed movement individually | None inferred |
| Native dispense | Preserve each original allocation debit | Add each exact native allocation to prepared custody |
| Pickup | None | Remove the complete original prepared package; future engine must validate actual prepared positions and heads |
| Clinic-retained intake | None | Prepared → return-held, bound to the actual intake and original allocation |
| Dispose | None | Remove return-held quantity |
| Restock | Preserve each exact positive return movement | Remove return-held quantity; future engine needs an explicit stock-container destination |
| Retract intake | None | Reverse only the asserted custody classification |
| Retract disposal | None | Restore asserted held quantity; this is a correction assertion, not a new physical return |
| Retract restock | Preserve each exact negative compensation movement | Restore held quantity; never net the original positive movement away |
| Discrepancy or annotation, including pickup amendments | None | None invented; future engine must preserve source evidence and compose holds |

The return rows above describe conditional source obligations. The oracle preserves the original intake custody and requires an original-pickup check. It does **not** make client-returned or unknown-custody medication eligible. A pickup amendment cannot prove physical return, replenish stock or bypass that check. No partial pickup quantity is invented: the native pickup source has none.

The gate covers 136 canonical operations, ten producers, all six return actions, all three annotation kinds and five distinct negative compensation movements. Its 687 SQL checks include exact source identity/membership, quantity conservation, changed-actor and changed-receipt rejection, two missing-reverse-source failures, private execution grants, and recovery after catalog price/availability changes. Every table in public/Auth/Storage/extensions is fingerprinted before and after the proof in the populated clone and source runtime. The clone is then removed. These are SQL fixture checks, **not genuine Auth/API or managed-container acceptance**; the enclosing native runner reports its existing genuine Auth/browser checks separately.

C1b still needs owned prepare/execute/read/cancel, early reservation locking, live-session checks after actual waits, reviewed policy enforcement, exact container posting/transitions, bidirectional deferred constraints and populated managed restore proof. C2 workflows and C3 real practice acceptance remain required. Susan’s rules remain draft and inactive.
