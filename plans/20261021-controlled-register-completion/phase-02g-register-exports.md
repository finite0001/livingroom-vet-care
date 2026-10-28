# Phase 2g — bounded register exports and supporting originals

Status: source design complete; implementation and current runtime proof pending.
Owner: Living Room Vet. GreenTree / VetConnect / ezyVet remain separate.

## Scope and source

Complete phase02 item5 without altering original205/206/269 records or sealed
relations. New private `narcotics_register_v1` schema; no FK/index/trigger on an
existing table. New public facades use `narcotics_*` names. Compare the complete
208 base metadata before/after, not a selected subset.

Historical classification is `controlled_stock_policy_versions.draft_version_id`
→ `controlled_draft_versions.definition.schedule`. Quantities come from immutable
cell opening quantities plus event lines, ordered by event sequence. Custody
comes from initial container facts plus immutable transitions. Original source
packets/preparations, source links, review decisions and witness receipts remain
original evidence. Current patient/owner labels, if included, are explicitly
capture-at-export display. Never invent absent historical facts.

## Contract

- Create: `create_narcotics_register_v1({schema_version:1,actor_id,operation_id,
  product_id,site_id,from_at,to_at})`; period uses recorded UTC time [from,to),
  <=31 days and end<=server now. One product/site per report. Require one supported
  captured schedule across contributing history; refuse mixed classification.
- Read: `read_narcotics_register_v1({schema_version:1,actor_id,operation_id})`;
  own current-authorized operation, saved/not_found/abandoned. Not_found retains
  the recovery pointer: a delayed original request may still save.
- `close_narcotics_register_operation_v1` serializes with creation/preservation on
  the exact operation lock. Saved returns the original receipt; absent creates a
  permanent immutable abandonment tombstone; delayed original create/preserve
  refuses. Operation kind is bound; one ID cannot change between report and form.
- Saved result echoes original request and canonical dataset_text (PostgreSQL
  JSONB text as exact UTF8 bytes), dataset/CSV SHA256 and byte counts. Browser hashes
  returned original text bytes before parsing, never JS object reserialization.
  Immutable captured_at labels reviews/counts/forms as-of capture, separately
  from the movement interval. Include registered-site/scope forms present at
  capture even when older than from, plus event-linked forms for included events.
  Later-added evidence never changes an existing report snapshot.
- <=250 product events before site filtering; <=512 cells; <=32 relevant terminal
  counts; <=4MiB dataset; <=8MiB response. Capacity/ambiguous provenance refuses
  completely and asks for a shorter period. No truncated success.
- Each cell gets exact decimal opening/running/closing quantities; channels and
  custody remain separate. Zero-line events remain visible. Exclude cells born
  after cutoff. Require proven site membership, never silently omit ambiguity.
- Never export pending blind count statements/snapshots/private nonces. Use only
  existing authorized terminal/revealed count projection. Preserve current count
  READ authority when including its evidence; ordinary register access need not
  require a count policy when no count exists.
- CSV UTF8/no BOM/CRLF, fixed headers, quote every cell/double quotes, prefix every
  data value with apostrophe (including exact quantities). No spreadsheet formulas.
  Print with React text escaping, visible schedule/period/scope/hashes, repeated
  table headings. ScheduleII separate; III/IV/V separately generated/retrievable.

## Private supporting documents

New `form_contents` and immutable `form_records` have only new-schema FK links.
`preserve_narcotics_form_v1` accepts strict actor/operation/scope/event(optional),
kind/title/original filename/obtained_at/MIME/canonical base64. Decode <=2MiB,
server-verify length/hash and PDF/PNG/JPEG magic; preserve exact original bytes.
Obtained time is staff-reported, recorded time server-generated. Actual event
hash is read/validated server-side. No caller hash proves association.
`read_narcotics_form_operation_v1` is own ID-only metadata recovery;
`download_narcotics_form_v1` reauthorizes scope and returns exact bytes/hash/length.
Report includes immutable document references/hashes, not the base64 payload.
Current authority is mandatory on every download. No public object URL.

## Locks and authority

Before any user-table read: raw exclusive practice advisory90271040/0, then existing
complete121 shared frontier, full bound208 check. Do not call stock_actor first.
New operation/admission locks follow old frontier. Actual current Auth/session,
ADMIN and configured audit authority plus event-kind READ for every exported kind;
compare current fingerprints before returning. Private tables RLS/no app grants;
all helpers owner-only; public facades authenticated-only, service/anon revoked.
New schema requires source-derived full metadata/ACL/function/trigger descriptor;
no observed catalog becomes an expectation. APIs set8s/5s limits. Uncertain save
retains only actor/operation pointer and recovers original result without resending.

## Acceptance

Real two-user GoTrue/HTTP: fractional quantities, return-held custody, zero-line
annotation, historical late observations, sequence ties, opening-only intervals,
separate schedules, current name edits, blind-count privacy, later supporting
forms, formula-leading text, changed retry/current revocation/cross-account
refusal, overflow and late rollback. Exact old rows/stock/Auth/sequence/metadata
preservation plus declared new report/form rows. Browser download verifies original
hash, print/mobile/keyboard/recovery workflow. Independent source and exact-head
runtime review precedes release; real supplier/registration facts stay unseeded.
