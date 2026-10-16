# Clinical note verification

The model/handler tests exercise template/status/source boundaries, trusted field assembly, policy and audio gates, provider response limits and one-shot dispatch/persistence recovery. Literal quotes are not a clinical entailment validator; synthetic canned output is labeled as stubbed.

From this worktree, run:

```sh
node --experimental-strip-types --test tests/clinical-notes/*.test.ts
python3 scripts/verify-clinical-audio-edge-isolation.py
python3 tests/clinical-notes/disposable.py --run-synthetic-local --include-sql-regression
```

The disposable runner uses ports 65120/21/22/24/81 and a unique `lrv-clinical-notes-*` identity. It copies committed migration/test sources into a private temporary project, checks Docker ownership labels, disables local scheduled jobs, and runs real local Auth/PostgREST/browser plus a Node bridge using the actual function handler with a synthetic provider dependency. A marked database clone proves populated dump/restore equality. Cleanup removes only the owned runtime/clone; unrelated Docker projects remain untouched.

Browser verification drops committed source and generation responses, recovers exact identities, checks that raw source is absent from pending sessionStorage, inspects field evidence and accepts only reviewed SOAP content. Provider and database checks cover duplicate concurrent requests, cancellation tombstones, exact-result persistence replay and originating-session revocation during an observed dispatch lock wait.

Receipts and screenshots go under ignored `tmp/clinical-notes-*`. No credentials, real patient data or hosted test fixtures belong in this directory. Preserve input hashes and state whether real or stubbed provider calls occurred when reporting validation.
