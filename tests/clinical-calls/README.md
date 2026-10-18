# Private complete clinical call sources (Phase 3A)

This package captures evidence for a single explicitly selected patient and unsigned encounter. It does **not** generate notes, summarize a call, write clinical sections, sign a chart, or activate real call processing. All call evidence, recovery, policy and source RPCs require a current active administrator and live Auth session; generic note/dictation reads have no new source path.

The independent policy starts draft and `CLINICAL_CALL_CAPTURE_ENABLED` defaults off. A synthetic local policy approval does not approve the practice policy or enable hosted calls.

## Provider projection

The strict supported projection comes from CloudTalk's documented GET `/v1/ai/calls/{callId}/transcription` REST contract: `data.callId`, `language`, `callers[{type,id,localIdentifier}]`, `segments[{start,end,caller,text}]`, and `pagination{limit,offset,total}`. Extra/unsupported shape changes fail closed; this strict projection is our supported adapter contract, not a claim that the vendor forbids additional keys. Provider numeric identity must be a positive JS-safe integer. No client-supplied provider URL, transcript, call identity override or AI summary is accepted.

Capture uses 100 segments/page, at most 10 pages per enumeration, 1,000 segments, 20 requests across both enumerations, 60,000 UTF16 projection characters and 240,000 UTF8 projection bytes. Each response is bounded to 512,000 bytes, each request to 10 seconds, and the complete operation to 120 seconds. There is no automatic provider retry or rate wait. Unsupported short nonterminal pages, clamped limits, gaps, changing totals, language/callers/identity changes, empty/malformed/over-budget responses and changing second-pass text are refused.

Both complete observed enumerations must match exactly. Store both sets of page hashes (SHA256 of each retained `normalized_json` exact UTF8 string; SQL reparses it and compares its complete data/pagination semantically to the retained caller list and segment slice), retrieval times and full exact segment evidence. `observed_two_pass` is **not** an atomic vendor revision, immutable remote snapshot or forever-currentness guarantee. No revision/ETag is invented. Equal starts and overlapping ranges are preserved in the supplied order, including overlap within a speaker; starts must be nondecreasing and supplied ends must not precede starts. Caller labels must match documented original `localIdentifier` values; `agent` does not imply veterinarian, and a call is not automatically attributed to a pet.

The immutable source context retains the actual canonical call start (nullable), end and last webhook event times separately from transcript capture times, plus the exact household/thread/message association. The source SHA256 covers the SQL-canonical `{context,document}` manifest; action replay hashes bind the original document independently. Browser requests cannot supply or override this context.

Full projection lines retain ordinal, JSON-escaped original caller label and exact source text. Original times in seconds remain in structured segment fields and the preview. Per-segment hashes cover exact raw text; offsets count UTF16 characters as the existing note engine does. SQL independently rebuilds the projection and validates hashes, offsets, page coverage and both-pass hash agreement and every page hash reconstructed from retained caller/segment evidence. Fractional/exponent timestamp values are checked numerically without depending on cross-runtime text formatting. The aggregate document is bounded to 2 MB.

## Offline and owned local verification

```sh
node --experimental-strip-types --test tests/clinical-calls/*.test.ts
python3 -B tests/clinical-calls/disposable.py --run-synthetic-local
```

The disposable runner uses uniquely owned local ports 65320/65321/65322/65324/65381. It copies committed migrations into its own temporary runtime, verifies Docker ownership before accessing keys, disables its local cron scheduler, exercises real Auth/PostgREST/handler HTTP against stubbed CloudTalk pages, and checks a populated dump/restore. No real provider, call, recording, AI request or hosted secret is accessed. `--include-sql-regression` adds all SQL tests; `--sql-only` skips HTTP/browser/restore. Evidence is private under `tmp/<evidence-prefix>-*`; the input hash inventory and runtime cleanup are part of the final receipt. Do not modify proof inputs during a final run.

The native CloudTalk projection is seeded with fictional calls to exercise household authorization; this is not a real CloudTalk webhook/account acceptance test. Provider API commissioning and authorized practice samples remain separate launch work.

## Offline call-note fidelity evaluation (Phase 3B.3)

This preparation freezes ten wholly fictional calls before any paid request. Scenarios cover household attribution, ambiguous speakers/pets, negation and corrections, historical/current reports, exact drug decimals and units, unmeasured vitals, discussed/declined/planned/not-given treatment, midnight, DST, unknown call start, hostile transcript commands and compound comparisons. Required meanings concern the selected patient; other-pet history may be omitted and must stay private if included. Veterinary vocabulary remains the exact production prompt context, not custom model training.

```sh
node --experimental-strip-types --test tests/clinical-calls/evaluation-offline.test.ts
mkdir -p tmp
node --experimental-strip-types tests/clinical-calls/evaluation-cli.ts export tmp/call-fidelity-frozen
```

The export uses production transcript capture with injected response stubs and the production OpenAI request builder. It performs **zero network requests**, reads no environment keys or hosted data, and changes no clinical policy. `bundle.json` retains complete fictional context, every exact serialized request, model/prompt/template/vocabulary receipts, code/lockfile fingerprints, mandatory/forbidden inventory and deliberately false but structurally valid negative controls. Fixture context/template hashes bind offline bytes; they do not assert PostgreSQL canonicalization, authorization or hosted provenance. Alias names do not establish immutable model snapshots. Export directories must not exist and are created privately; existing evidence is never overwritten.

`raw-import-template.json` has deliberately invalid `outcome: null` placeholders. It is not model evidence. A separately authorized future run must choose this exact bundle/model, a concrete cost ceiling and at most ten requests (one per case), with **no retries**. Use a protected server-side key boundary; do not recover keys via SQL, browser storage or logs. Preserve every outcome, including refusals, incomplete responses, provider errors and transport failures. This package includes no paid request runner.

Replace each placeholder with exactly one of these strict outcome shapes, preserving the complete HTTP entity body bytes in canonical base64 before decoding or parsing. Record a supplied provider request identifier when available; an empty identifier is permitted when unavailable. Do not put authentication headers, keys or real patient information in the import.

```json
{"kind":"http","status":200,"request_id":"req_supplied_by_provider","raw_body_base64":"BASE64_OF_COMPLETE_UNMODIFIED_RESPONSE_BODY"}
```

```json
{"kind":"transport_error","error":"Specific retained transport failure; no retry performed."}
```

Keep the template's `case_id`, `request_sha256`, `bundle_sha256` and top-level contract unchanged. Import rejects missing, duplicate, unknown or mismatched cases and any altered current-revision bundle/code/request. SHA256 binds supplied evidence bytes; it does **not** authenticate provider authorship. HTTP bodies with invalid UTF8 remain exact base64 with their original byte hash and fail parsing.

```sh
node --experimental-strip-types tests/clinical-calls/evaluation-cli.ts packet tmp/call-fidelity-frozen/bundle.json tmp/call-fidelity-results.json tmp/call-fidelity-review
```

This writes `packet.json`, a readable `review.md` and `adjudication-pending.json`. All failures and exact raw bytes remain in the packet. The Markdown contains complete transcript segments, each whole claim with its own supports, proposed selected-patient SOAP, private flags, required/forbidden meanings and stable decision IDs. Untrusted text is fenced safely. A parser/citation pass never becomes a clinical pass. Every claim dimension, each individual support and each inventory fact needs a named reviewer's explicit pass/fail, specific rationale and allowed evidence references. Passing mandatory meanings require references to the actual output claims or flags. Other-pet/unassigned claims stay outside selected-patient SOAP but are still reviewed. Do not edit the packet or import after review; even a whitespace change in raw output invalidates the adjudication binding.

```sh
node --experimental-strip-types tests/clinical-calls/evaluation-cli.ts adjudicate tmp/call-fidelity-frozen/bundle.json tmp/call-fidelity-results.json tmp/call-fidelity-review/adjudication-pending.json tmp/call-fidelity-adjudicated
```

Incomplete/duplicate/tampered decisions, blank reviewer/rationales, invented evidence or unreviewed supports are rejected. Any failed contract/transport or explicit semantic failure prevents a fidelity pass. Engineering tests deliberately judge negative controls as failures; they are not real model results or Susan's clinical approval. Real-provider fidelity, authorized provider samples and practice clinical activation remain pending.

## Offline protected transport preparation

`synthetic-provider-plan.ts` and `synthetic-provider.py` prepare the exact frozen ten-case bundle for later staging transport review. They create private generated sources, request/code/lock hashes, a fixed expiry and ticket, and an operator nonce receipt. Preparation reads local files only; it never retrieves a provider key. With no externally reviewed pricing/input-bound profile, the generated probes refuse generation. The `--run` command also always refuses because this increment has no hosted orchestrator.

```sh
node --experimental-strip-types --test tests/clinical-calls/synthetic-provider-plan.test.ts
python3 -B -m unittest discover -s tests/clinical-calls -p test_synthetic_provider.py
```

The tests inject local responses into actual generated callbacks, including duplicate dispatch, guard ambiguity, partial/oversized bodies and credential echoes. They do not contact Supabase or OpenAI. Budget calculations use exact rational arithmetic and permanently reserve uncertain requests; supplied rates/reviews are explicit assumptions, not automatically verified prices or a guaranteed provider billing cap. Only proven complete bodies enter the existing raw importer as HTTP outcomes; incomplete cases keep private sidecars and become transport errors. Cleanup tests retain one-shot guards until function absence and expiry are confirmed.

See the [transport design](../../plans/20261018-call-fidelity/provider-run-design.md) and [official pricing evidence](../../plans/20261018-call-fidelity/provider-pricing-evidence.md) for remaining hosted implementation, account/metering and clinical-review work.
