# CloudTalk transcript contract: official documentation findings

Investigated 2026-10-16 using the Firecrawl skill and public official CloudTalk documentation only. No authenticated account requests, provider credentials, real call records or external messages were used. This is documentation verification, not an executed account integration or clinical-fidelity evaluation.

## Decision

**A complete observed transcript enumeration is documented and implementable. An atomic, revision-pinned provider snapshot is not established by the reviewed contract.** Capture and retain the exact complete result under our own immutable source identity, recording retrieval boundaries and pagination proof. Do not describe that local capture as a vendor-guaranteed immutable or forever-current transcript.

The developer-domain reference redirects to CloudTalk's official Help Center. The public documentation index identifies the OpenAPI specification at `https://help.cloudtalk.io/api-reference/openapi.json`; its info version is `1.7` and OpenAPI version `3.0.1`. These identify the retrieved specification, not a transcript resource revision. [Documentation index](https://help.cloudtalk.io/llms.txt), [official OpenAPI specification](https://help.cloudtalk.io/api-reference/openapi.json).

## Endpoint, schema and identifiers

The documented operation is `GET https://api.cloudtalk.io/v1/ai/calls/{callId}/transcription`, authenticated using HTTP Basic with the account API key ID/secret. It takes optional integer `limit >= 1` and `offset >= 0`, default offset zero. The transcript endpoint documents no maximum or default limit. Its response uses top-level `data` and `pagination`, unlike the core API's `responseData` envelope. [Transcription endpoint](https://help.cloudtalk.io/api-reference/conversation-intelligence/transcription), [response envelope guide](https://help.cloudtalk.io/guides/response-envelopes).

The OpenAPI `CallTranscription`, `Caller` and `Pagination` schemas require:

| Location | Documented fields/types | Implementation consequence |
| --- | --- | --- |
| `data` | `callId`: number; `segments`: array; `callers`: array; `language`: string | Validate selected provider call identity and stable repeated metadata |
| Each segment | `start`, `end`: numbers measured in seconds; `caller`, `text`: strings | Preserve both time boundaries, original speaker identifier and exact text |
| Each caller | `type`: `agent` or `contact`; `id`: integer or null; `localIdentifier`: string | Retain local speaker mapping; null identity must remain unresolved |
| `pagination` | `limit`, `offset`, `total`: integers | Check exact coverage and bounded integer/count semantics |

All fields listed above are marked required in their respective schema objects. The schema does not provide segment IDs, speaker confidence, pet identity, clinician qualification, transcript creation/update time or revision. The REST caller enum is distinct from webhook participant types. Additional response fields are not declared forbidden by this OpenAPI schema; a strict internal projection should validate needed fields and explicitly discard or retain bounded unknown fields rather than accidentally claim the provider forbids them. [Official OpenAPI specification](https://help.cloudtalk.io/api-reference/openapi.json).

Engineering inference: require safe integers wherever JavaScript numeric IDs must exactly match stored decimal identities. The current media proxy permits up to 18-digit call IDs; a parsed JSON number cannot preserve arbitrary 18-digit integers. Reject unsupported precision rather than round or silently associate the wrong call. Do not infer doctor/owner authority merely from `agent`/`contact`.

## Documented complete pagination

The official pagination guide has a separate Conversation Intelligence section. It specifies offset/limit paging within a single call. Increment offset by limit until offset reaches or exceeds `pagination.total`; accumulate the segments. It explicitly says `callId`, `callers` and `language` repeat across pages. The core `page/pageCount` and Dialer cursor schemes do not apply. [Conversation Intelligence pagination](https://help.cloudtalk.io/guides/pagination#conversation-intelligence-pagination).

For our clinical capture, add stricter local integrity checks: exact returned offset, positive supported effective limit, stable total/call ID/callers/language, correct segment count through the terminal offset, no holes/repeated pages, valid finite time boundaries, bounded UTF-8 bytes and complete response bodies. Validate the effective returned limit; never silently skip segments if it differs from the requested limit. Record the requested and returned paging values and fail unsupported behavior rather than claim completeness. These are application safeguards, not additional vendor guarantees.

The reviewed endpoint, referenced schemas and pagination guide do **not** document a transcript version token, ETag/If-Match protocol, Last-Modified precondition, resource immutability, stable segment ID, ordering tie-break contract or atomic multi-page snapshot. A targeted official-domain search for transcript ETag/revision/immutability returned no results. This is a bounded documentation finding; it does not prove those facilities cannot exist.

A second identical full enumeration could detect some changes and produce useful consistency evidence, but identical passes still do not prove an atomic vendor snapshot or future immutability. Prefer a single complete HTTP response when the supported source fits our chosen page/byte budget; still do not equate one response with a provider revision guarantee. A legitimately re-captured result gets a new local source identity and hash. Vendor clarification or a verified supported version protocol is needed before stronger claims.

## Readiness events are not transcript evidence

`transcript.ready` announces readiness and gives the transcript API URL; it does not carry transcript text. The webhook guide describes its `call_id`, optional `call_uuid`, language/participants and recording-length information. The full transcript must be fetched using authorized API credentials. Construct the known fixed endpoint from the validated call identity rather than following arbitrary webhook URLs. [Conversation Intelligence webhook events](https://help.cloudtalk.io/guides/webhooks/events/conversation-intelligence#transcript-ready).

`cidata.ready` carries analysis such as summary, sentiment and topics. Its `complete` flag concerns the presence of those three stages, not transcription page coverage. Webhook delivery can arrive in a different order from production. Its participant types include `contact`, `user`, `voice_agent` and `unknown`, unlike the REST transcript `agent`/`contact` enum. Neither this analysis flag nor the retained `ai_summary` establishes a complete authoritative transcript. [Conversation Intelligence webhook events](https://help.cloudtalk.io/guides/webhooks/events/conversation-intelligence#cidata-ready).

## Rate limits and failures

The rate guide documents 60 requests/minute per company for the **core** API and a separate Dialer budget. It does not explicitly establish the transcript endpoint's CI quota in the reviewed text. Do not assume the core or Dialer budget applies to CI without confirmation. Keep conservative bounded capture concurrency, handle 429 as incomplete capture, and retain sanitized operator-visible failure/recovery state. Do not automatically reissue a paid OpenAI generation as a transcript-fetch retry. [Rate limiting guide](https://help.cloudtalk.io/guides/rate-limiting).

The transcription reference lists 400, 401, 404 and 500 response categories. Treat success status, schema validity, complete body and complete pagination as separate checks. Account availability, plan entitlement, actual maximum accepted limit, observed empty/unknown language behavior, provider corrections and rate-limit headers require authorized sample/account commissioning; public schema alone establishes none of those execution outcomes. [Transcription endpoint](https://help.cloudtalk.io/api-reference/conversation-intelligence/transcription).

## Implementation consequences and remaining evidence

1. Build 3A against the fuller required schema, including `callId`, caller mapping and end times; existing browser page shape is incomplete for provenance.
2. Preserve exact fetched segments and local capture boundaries; no source substitution from `ai_summary`, readiness events or a single visible page.
3. Publish local integrity outcomes as complete observed enumeration or incomplete/refused. Explicitly retain the lack of vendor revision proof.
4. Keep ADMIN-only source/proposal access enforced in SQL and Edge. Public documentation research does not approve clinical source policy or broaden roles.
5. Use synthetic page fixtures for missing/changed metadata, gaps, duplicates, numeric precision, malformed/oversized responses and ambiguous speakers before any real account fetch.
6. Commission with an authorized representative sample, verify entitlement and actual provider behavior, obtain policy/clinical approval, and only then enable real call capture/generation through their independent gates.

Firecrawl search and scrape operations succeeded for the official sources. Two search-feedback submissions were rejected by validation and were not retried; feedback for all seven scrape retrievals was accepted. No web fallback or account API access was used.
