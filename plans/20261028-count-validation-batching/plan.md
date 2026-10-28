# Count validation batching

Status: implemented and independently reviewed; final native and CI acceptance pending. Continue narcotics-log completion in PR 314.
GreenTree and VetConnect remain outside this change. No production writes or PR
merge are authorized by this plan.

The current correction exceeds the existing eight-second statement limit on both
the development machine and the clean CI runner. Other current CI workflows,
including signing, counts, exports and interrupted browser saves, have passed.
Reusing pure grammar has preserved correctness but has not resolved the timeout.
The complete product history is repeatedly checked by row-level deferred triggers
while one operation appends several related rows.

Use a private transactional **pending-work table**, with one item per affected
product and transaction until the next explicit flush. Every original count-row
write guard remains. An immediate AFTER-row collector records mandatory work.
A deferred constraint consumes that work; its BEFORE DELETE guard always runs
the unchanged complete product validation. There is no completed/valid flag,
cached authorization, stored validity certificate or background worker.

Detailed implementation and acceptance: [phase-01-protocol.md](phase-01-protocol.md).

1. **Complete:** identify the fourteen count-context write tables and separate
   policy, abandoned-closure and installation lanes; inspect deferral/flush timing.
2. **Complete:** collector coverage, non-bypassable deletion, initial lock plans,
   explicit deferral and preservation of full final constraints.
3. **Pending:** source compiler, independently derived metadata and complete
   predecessor inverse; original migrations 205/206 and common 269 stay intact.
4. **Pending:** actual database timing/rollback/privilege controls, all genuine
   business profiles, populated recovery and staff browser acceptance.
5. **Pending:** publish the concrete reviewed update; obtain Dave's specific
   PR 314 merge/deploy approval only after all release checks pass.

Keep the existing 600/540/55 overall/work/cleanup, 30-second owner, eight-second
application and five-second lock limits. Do not stop unrelated Mac work or expand
source/output caps. Real clinic commissioning remains deferred.

PostgreSQL supports deferred AFTER-row constraint triggers and explicitly forcing
their pending checks with `SET CONSTRAINTS`. A row collector is immediate so a
forced-immediate mode can reject incomplete data but cannot validate before the
original row exists. See the official [trigger documentation](https://www.postgresql.org/docs/17/sql-createtrigger.html)
and [constraint timing documentation](https://www.postgresql.org/docs/17/sql-set-constraints.html).
