# Reviewed outside vaccination release packages

Schema 7 adds `imported_vaccination_ids` as a distinct, explicit record-release selection. A package may contain at most 20 current, latest clinician-reviewed vaccination versions. The database validates the patient/mapping identity, exact vaccination and consult observations, and latest review after acquiring the same patient/source locks used by clinical review. A vaccine-only package does not select narrative, treatment, certificate or patient-summary content implicitly.

The new preview composes schema 6 when other records are selected. Outside narratives, locally extracted problem lineage, verified laboratory and imported-document original provenance remain present. Existing schemas 1–6 keep their rendering and exact confirmation/recovery behavior; checked-in renderer fingerprints cover all six versions. Schema 7 requires separately recorded release policy acceptance. This change does not enable a hosted policy.

The immutable snapshot contains the original vaccination payload, DVM-reviewed date-only interpretation/status, optional catalog match, outside attribution and rationale. Missing historical dose, route, lot, manufacturer and clinician identity are never inferred from a current catalog product. It explicitly distinguishes outside history from local administration, active due plans and certificate eligibility.

Source provenance includes the exact vaccination/consult snapshot, payload fingerprint and observation revision, plus compact approved correction references. Unselected historical raw records are not nested into the correction chain. Source-head changes or a later approved review append invalidation events. Fresh previews reject stale/superseded reviews; existing package snapshots remain immutable and exact terminal recovery still returns the original package. New delivery must use a newly reviewed package.

Browser printing, email HTML and SMS-linked HTML use the shared renderer. The original-document byte checks also recognize schema 7 in both artifact builders and the database capture validator. New source text is HTML-escaped. The frozen clinical content is identical across those paths.

## Synthetic verification

- `supabase/tests/release_imported_vaccination.test.sql`: vaccine-only/mixed selections, policy gating, latest discovery, exact review provenance, source supersession and independent consult/vaccination observation invalidation, immutable snapshots and terminal recovery.
- `tests/record-releases/vaccination.test.ts`: mixed schema composition, schemas 5–6 byte fingerprints (existing tests retain schemas 1–4), invalid dates, wrong patient/household, catalog kind, source context, correction chain and selection mismatch, original-document tamper rejection in email and SMS builders.
- `tests/record-releases/clinical-history-local-roundtrip.ts`: actual disposable Auth/PostgREST/Storage, clinician approval, schema 7 confirmation, capture/recovery, print/email/SMS content consistency, final delivery rejection before any provider attempt, correction invalidation and old-review recovery.

All practice-source sample acceptance and Dr. Susan Edler's clinical form review remain separate. No hosted data import, clinical release activation, payment, email or SMS provider request is performed by these fixtures.
