# Owned imaging verification

Run `python3 -B tests/imaging/disposable.py --run-synthetic-local --include-sql-regression` from the repository root with Docker, Supabase CLI, Node22.12+ and installed npm dependencies.

The runner creates a uniquely owned local Auth/PostgREST/Storage/Postgres stack on ports65020–65024 and Vite on65081. It replays197 migrations and runs the canonical SQL regression, then exercises real staff sessions, concurrent duplicate saves and competing corrections, cancel/save terminal ordering, wrong-patient sources, private PDF upload/finalization, interrupted browser save and recovery after reload, phone/desktop layouts and a full Auth/Storage/public/extensions dump/restore comparison. A browser viewer launch is fulfilled by a synthetic local stub; it is not VetRocket account acceptance. Raw browser/provider credentials are not printed.

Outputs stay under `tmp/` and a private system temporary evidence directory. The runner removes only its identity-labelled containers/volumes/work, and the restore clone is checked with an ownership marker before removal. It neither reads nor writes hosted practice records, changes clinical policies, nor calls an external image provider.

`model.test.ts` covers strict URL/date/source/action boundaries, response identity, receipts, durable cancellation outcomes and persisted uncertain requests. Root `npm run check` includes these tests. A real practice study, supported interface and actual iPhone/vendor access test remain separate acceptance work.
