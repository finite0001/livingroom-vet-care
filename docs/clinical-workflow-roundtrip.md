# Local clinical workflow integration evidence

`tests/clinical/local-workflow.ts` connects the existing clinical modules through real local Supabase Auth and PostgREST HTTP RPCs, then checks their database identities and renders the returned artifacts. It was added against `fcdffab` to cover a gap between module-level SQL suites and browser tests that use mocked APIs.

The test does not duplicate each module's complete validation matrix. Existing suites retain detailed coverage for clinical-core versions, scheduling conflicts, alert locks, inventory accounting, certificate rules and release selection. This test verifies that the resulting records connect correctly across those boundaries.

## Observed chain

One random synthetic staff actor creates a household, a patient and an excluded sibling. The same patient is booked for a clinic visit and a housecall. The clinic booking uses the Spruce Street home base; the housecall retains its separate address and travel buffers. Reminder offsets are empty, so this fixture creates no reminder work.

An explicit encounter uses the booked patient's identity and housecall location, then signs complete synthetic SOAP text. A second unselected draft remains private. Resolved high-importance vaccine-reaction history remains in the treatment alert snapshot. Changing that history invalidates the earlier review hash. Attempting treatment with the stale hash leaves stock and invoice items unchanged.

A vaccine and medication each consume one unit from their own synthetic lot, append the patient treatment and create a charge on the same household invoice. Repeating each exact treatment request does not debit or bill twice. Both treatments retain the authenticated actor's current alert review. The issued invoice totals 4,500 synthetic cents, and its document contains exactly the two treatment charge IDs. The invoice projection intentionally does not include patient IDs; the underlying treatment and invoice-item relationships establish that link.

An actor-scoped synthetic certificate issuer allows the test to create a vaccine-history certificate from the actual vaccine treatment. Medication is excluded. The production certificate renderer displays the frozen vaccine lot; the invoice renderer displays the medication charge. No real veterinarian's credentials or clinical acceptance are represented.

A selected release contains the signed SOAP, vaccine certificate, critical problem and both treatments. It excludes the unselected draft and sibling. The actual release renderer consumes this database preview. A cross-patient selection is rejected. Exact release confirmation and its five source links are verified inside one SQL transaction with a synthetic policy gate; the transaction is rolled back, and the test verifies the original policy and absence of the temporary release afterward. No practice acceptance is saved and no message is enqueued.

## Important product boundaries

- Appointments and encounters share patient, time and location data, but there is no enforced appointment-to-encounter foreign key or automatic conversion in this workflow. The test performs explicit encounter creation; it must not be described as proving automatic visit linkage.
- Treatments bind the patient, stock and invoice. This test does not imply an encounter foreign key or automatic SOAP treatment generation.
- The invoice is issued, not paid. No Stripe operation occurs.
- The certificate and release are generated from synthetic records for software verification. Dr. Susan Edler's clinical review, issuer verification and production commissioning remain separate.
- Rendered artifacts are HTML. The test does not create PDFs, exercise browser printing, open private attachments, send records, or validate Antech/anesthesia integrations.
- Clinical creation RPCs that lack stable request IDs are not retried automatically by this runner. Exact retry assertions target the treatment operations that support durable request IDs.

## Run and isolation

After repository dependencies are installed (`npm ci`), run:

```sh
node --experimental-strip-types tests/clinical/local-workflow.ts
```

The runner uses an already-running local Supabase project. Set `PAYMENT_TEST_PROJECT` to its configuration directory when needed; the name matches the existing local harness convention. Otherwise it targets the existing `livingroom-vet-foundation` containers and creates an owned temporary status-only config if their former `/tmp` config is absent. Only localhost API URLs are accepted. There is no Supabase start, stop, reset or hosted operation.

Local Auth keys remain in memory and are never printed. Clinical operations use the synthetic user's JWT over PostgREST. Direct SQL is limited to local fixture roles/issuer setup, state verification, the rollback-only release gate, and cleanup. Cleanup targets only this run's random UUIDs, removes its Auth user and verifies the household is gone. Coordinate a short local database window before running because the release-policy assertion briefly locks the singleton inside a rolled-back transaction.

Latest verification: **26 checks passed** through actual local Auth/PostgREST/SQL and production renderers. Focused ESLint and `git diff --check` also passed. No clinical approval or provider acceptance is claimed.
