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
