# Estimate decisions and access grants — proposed SQL contract

Status: design only, September 16, 2026. No migration, provider operation, delivery enablement or clinical execution is implemented by this document. This is the proposed next additive contract over publication migration `20260916123017`; review and freeze it with the browser contract before implementation.

## Meaning and immutable boundaries

A decision accepts or declines the **entire exact published revision**. One terminal decision is permitted per publication, regardless of grant count or whether a client or staff witness submits it. There is no change-choice endpoint. Correction requires an explicitly published successor and a new decision; retain the original attribution. Acceptance does not establish identity, clinical informed consent, prescribing authority, performed treatment, a charge, payment or stock reservation.

Client provenance means possession of a capability plus self-reported signer details. A staff witness records what a client communicated, under their own authenticated identity. The UI must never describe either as an identity-verified electronic signature. Staff do not accept on a client's behalf merely because they can access the household.

Keep decision and grant events separate from the existing publication chain. Existing publication receipts, bytes, hashes and published/withdrawn event shapes remain historical truth. Draft edits and current catalog/contact display changes do not alter published terms. A new decision requires the publication to be current and unexpired at the time the root-serialized decision commits. An old grant cannot approve a replacement.

Grant revocation stops that access path; it does not revoke an already recorded acceptance. Publication replacement or withdrawal stops new decisions for the old publication and, when execution is implemented, must atomically freeze its unused authorizations. Already completed work and prior decisions remain. Declining does not cancel existing clinical appointments or produce a credit. Acceptance deadline governs entry of a new decision, not an automatic deadline for performing already accepted work.

## Reused foundations and deliberately separate capabilities

Reuse these existing SQL helpers, with historical verification kept separate from current authorization:

- `clinical_require_staff()` and `is_active_staff(uuid)` for authenticated staff and final post-wait checks.
- `communication_require_service()` for service-only entry points. Service credentials never become a browser identity.
- `native_estpub_lifecycle(uuid)` for verified publication history/current slot; `native_estpub_preparation(uuid)` for verified immutable snapshot and captured bytes.
- `native_estpub_hash(jsonb)`, `native_estpub_target(jsonb)`, `native_estpub_head(jsonb)` and `native_fulfillment_hash(jsonb)` for strict shape and canonical PostgreSQL JSON hashing.
- `native_estimate_verified_revision(uuid,integer)` indirectly through preparation verification. Never refresh catalog prices for a decision.
- `read_native_estimate_publication_artifact(uuid,uuid,text)` for staff historical downloads. Public retrieval needs a new service-only wrapper, not a grant on this staff RPC.
- Existing operation/closure approach in `native_estpub_record(uuid,jsonb)`, `native_estpub_receipt(uuid)` and `native_estpub_closure(uuid)` as a pattern, without putting decision operations in publication tables.

The document grant functions `prepare_document_link`, `capture_document_link`, `attest_document_link`, `revoke_document_link`, `document_link_access_context`, and `retrieve_document_link` provide lifecycle/security examples. They are NOT called to give estimate decision rights: their family/source checks and capability are read-only, and currently impose SMS/current-source semantics inappropriate for frozen estimates. The post-budget authorization recheck in `20260914110000_document_link_retrieval_wait_authorization.sql` must also exist in the new retrieval path.

`materializePaymentAccess` in `payment-access-capability.ts` demonstrates domain-separated role signing over frozen context; `materializeDocumentLink` and `constantTimeText` in `document-link-capability.ts` demonstrate fragment links and constant-time comparisons. Reuse `constantTimeText` and `sha256Hex` (`release-email-payload.ts`) where appropriate, but add a dedicated estimate materializer/config and keys. Do not feed estimate grants to document/payment materializers or reuse their tokens. Payment's separate status capability is not silently adopted: the first decision contract has one access capability, and inactive access cannot read receipts.

## Closed data shapes

All shapes are closed: reject extra keys, missing keys, invalid nulls, noncanonical UUID/hash/time values, nonfinite timestamps and duplicate IDs. UUIDs are lower-case canonical; hashes are lower-case SHA-256; `Head={event_id:uuid|null,version:integer,record_hash:hash|null}` uses the publication empty-head convention. JSON timestamps are canonical UTC strings. Text must use the existing Unicode edge-whitespace validation; optional text is null rather than empty. Monetary/line values are inherited from the frozen publication without recalculation.

`Target={estimate_id,client_id,pet_id}` and `PublicationBinding={target,publication_id,content_hash,artifact_hash}`.

`DecisionRequest={binding:PublicationBinding,grant_id:uuid|null,expected_publication_head:Head,choice:'accept'|'decline',signer_name:string(1..200),signer_relationship:'owner'|'authorized_agent',comment:null|string(1..2000),acknowledgment_version:1,attest_document_review:true,attest_authority:true,attest_choice:true}`.

For bearer requests grant_id is mandatory. For witnessed requests it is null. The three attestations acknowledge review of the exact document, claimed authority to decide for this patient/household, and the chosen outcome. Decline wording must not suggest agreement to perform the work. The browser displays the immutable revision's terms and disclaimer before either choice.

`WitnessRequest={decision:DecisionRequest,witness:{channel:'in_person'|'telephone'|'video'|'written',occurred_at:timestamp,note:string(1..2000),attest_direct_client_instruction:true}}`.

The server derives the witnessing actor. occurred_at cannot be future relative to the post-lock server timestamp, and cannot predate publication. The publication must still be eligible **now**, even for an earlier reported occurrence; this endpoint cannot backdate an acceptance after expiry. Written evidence attachment is a later separately scoped record, not arbitrary URL/HTML in this request.

`Principal={kind:'grant'|'staff',id:uuid}`. A grant principal is the grant ID, never its issuing staff member. `DecisionMutation={kind:'client_decision'|'witnessed_decision',request:DecisionRequest|WitnessRequest}` with exact discriminated correspondence.

`Decision={version:1,id:uuid,sequence:positive integer,binding:PublicationBinding,choice,signer_name,signer_relationship,comment,acknowledgment_version:1,provenance:{kind:'grant',grant_id:uuid}|{kind:'staff_witness',actor_id:uuid,witness:WitnessRequest.witness},publication_head:Head,decision_head:Head,recorded_at:timestamp,record_hash:hash}`. Here decision_head is the **previous** root-wide decision head. The current decision head is `{event_id:id,version:sequence,record_hash}`. No mutable decision status is stored. Staff RPC receipts remain complete; use the separate public schemas below for bearer responses.

`DecisionReceipt={version:1,id,principal:Principal,mutation:DecisionMutation,request_hash,result:Decision,created_at}`; created_at equals recorded_at. request_hash hashes `{version:1,operation:'record_estimate_decision',principal,mutation}`. Decision.record_hash hashes all Decision fields except record_hash. Root-wide sequence is assigned under the root gate, and each published revision has a unique decision constraint. This is an append-only chain across successive publications, not repeated acceptance of one publication.

`GrantIssueRequest={binding:PublicationBinding,expected_publication_head:Head,expires_at:timestamp,recipient_label:string(1..200),purpose:string(1..500),attest_recipient_authority:true}`. recipient_label documents the intended recipient but does not assert verified identity or contact ownership. A separately reviewed transport will bind normalized recipient/contact/conversation; grant issuance itself sends nothing.

`Grant={version:1,id,actor_id,request:GrantIssueRequest,request_hash,created_at,capability:null|{origin,key_version,context_hash},capture:null|{token_hash,captured_at},head:Head,state:'preparing'|'captured'|'active'|'revoked',activation:null|{id,actor_id,created_at},revocation:null|{id,actor_id,reason,created_at}}`. Public/staff projections MUST omit token_hash and the raw capability_context. Full Grant here denotes the private verifier projection; `GrantView` is Grant with capture projected as `{captured_at}`. Expiry/current-publication/issuer-active eligibility is computed separately, never overwrites immutable state.

Grant expiry must be future and no later than publication.expires_at; activation rechecks both. Multiple grants can exist for a publication; there is still one decision. No automatic renewal, expiry extension, or revocation of sibling grants on issue. A resend of the same grant recovers the same capability; issuing another is explicit.

`GrantMutation` is a closed union:

- `{kind:'issue',request:GrantIssueRequest}`. Operation ID is also grant ID.
- `{kind:'activate',request:{grant_id,expected_grant_head:Head,expected_publication_head:Head,expected_context_hash,attest_review:true}}`.
- `{kind:'revoke',request:{grant_id,expected_grant_head:Head,reason:string(1..2000),attest_review:true}}`.

`GrantReceipt={version:1,id,actor_id,mutation:GrantMutation,request_hash,result:GrantView,created_at}` freezes the result at that event, independent of later revocation. request_hash hashes `{version:1,operation:'record_estimate_decision_grant',actor_id,mutation}`. Grant event record hashes include their prior hash, sequence, operation ID, actor, kind and frozen request/result basis. Capture is immutable separate evidence with its own verified hash and timestamp, not a user-editable event.

### Exact public projections

`PublicDecision={version:1,id,sequence,binding:PublicationBinding,choice,signer_name,signer_relationship,comment,acknowledgment_version:1,attribution:'link_holder'|'practice_staff_witness',recorded_at,record_hash}`. This exposes no staff UUID, witness note/channel, other grant ID, mutation, or internal chain metadata. Its record_hash is the opaque hash of the full immutable Decision, not a claim that rehashing the redacted projection reproduces it.

`PublicDecisionReceipt={version:1,id,grant_id,request:DecisionRequest,request_hash,result:PublicDecision,created_at}` is returned only for the original grant-bound operation. The exact request and binding must match pending intent. `PublicDecisionClosure={version:1,id,grant_id,request:DecisionRequest,request_hash,closed_at,record_hash,closed_by:'link_holder'|'practice_staff'}` omits staff ID/reason. `PublicResolution` substitutes these projections into the recorded/closed/unrecorded union. Public record returns PublicDecisionReceipt, public recover returns PublicResolution, public close excludes unrecorded. Staff endpoints keep full receipts.

`PublicReview={version:1,grant_id,binding:PublicationBinding,publication_head,publication_status:'open'|'expired'|'superseded'|'withdrawn',decision:PublicDecision|null,review:{practice:{name,address,domain},household_name,patient:{name,species,breed:null|string},title,total_cents,currency:'usd',accept_by,expires_at,acknowledgment_version:1,scope:'entire_exact_revision',not_clinical_consent:true,not_payment:true},artifact,content_base64}`. Retrieve returns this shape, NEVER the full stored preparation/snapshot. Exact HTML bytes remain the already approved client-facing artifact; audit the existing renderer to ensure it includes no private actor/preparation internals. Do not rewrite those bytes to sanitize a newly discovered issue: invalidate eligibility and republish a properly rendered artifact instead.

## Storage and private verifiers

Immutable business tables: `native_estimate_decision_grants`, `native_estimate_decision_grant_captures`, `native_estimate_decision_grant_events`, `native_estimate_decisions`, `native_estimate_decision_operations`, `native_estimate_decision_closures`. Operations unify staff grant mutations, staff witnesses and bearer decisions so an ID cannot switch action family. Original decision request and principal are immutable. Closing another principal's uncertain request never rewrites its provenance.

Every business table has RLS enabled, no raw grants to public/anon/authenticated/service_role, immutable update/delete/truncate guards and deferred integrity validation. Security-definer functions use fixed search_path and explicit execute revocations. Audit grant/decision/closure IDs, actor and action, not tokens, capability_context or rendered bytes. A dedicated audit helper is required for grant-principal actions; blindly using auth.uid() as client identity would be incorrect.

Proposed concrete columns (UUID/time/hash checks and immutable foreign keys required):

- grants: `id PK, actor_id, estimate_id, publication_id, request jsonb, request_hash, expires_at, created_at`.
- grant_captures: `grant_id PK/FK, origin, key_version, capability_context text, context_hash, token_hash, captured_at, record_hash`.
- grant_events: `id PK, grant_id FK, estimate_id, sequence integer, grant_version integer, previous_hash, document jsonb, created_at`; unique `(estimate_id,sequence)` for pagination and `(grant_id,grant_version)` for grant-head verification. Issue is version1, capture remains separate immutable evidence, activate/revoke append events.
- decisions: `id PK, estimate_id, publication_id UNIQUE, sequence integer, principal jsonb, request_hash, document jsonb, created_at`; unique `(estimate_id,sequence)`.
- operations: `id PK, family text, principal jsonb, mutation jsonb, request_hash, receipt jsonb, created_at`; family is grant or decision. Deferred verifier requires exact linked event ID/receipt and prevents action reclassification.
- closures: `id PK, family text, principal jsonb, mutation jsonb, request_hash, closed_by jsonb, reason text NULL, closed_at, record_hash`; deferred verifier prohibits an operation/event with the same ID.

`GrantEventView={id,grant_id,target,sequence,grant_version,previous_hash,kind:'issued'|'activated'|'revoked',actor_id,created_at,request,record_hash,grant:GrantView,eligibility:'active'|'preparing'|'captured'|'revoked'|'expired'|'publication_unavailable'|'already_decided'|'issuer_inactive'}`. The stored hashed event excludes the computed grant/eligibility projections. History grants are projected as of that event; eligibility is explicitly current. Capture changes preparing to captured without a new grant-head version; activation binds expected_context_hash and verified capture, so a stale missing capture cannot activate.

Private helpers to implement: `native_estdec_verified_grant(uuid)`, `native_estdec_verified_state(uuid)`, `native_estdec_verified_operation(uuid)`, `native_estdec_verified_closure(uuid)`, `native_estdec_access(uuid,text,text,text,boolean)` and a strict shared mutation validator. The access helper's final boolean requests current-publication eligibility; it does not bypass grant expiry/revocation/issuer authority. All helper execute rights revoked from application roles.

Historical verification checks frozen exact publication/preparation hashes, grant scope and activation prefix, authority attribution, source publication prefix, recorded-time deadlines, chain order and operation/closure exclusivity. It does not reject a previously valid receipt because its issuer is now inactive or the publication has since expired/changed. Compare new authorization against current state only at mutation/access boundaries. Validate complete chains once per call; never re-fold full history for each prefix. No global 100-event limit that makes a staff workflow inoperable.

A seventh private operational table, `native_estimate_decision_access_budget(grant_id PK/FK, window_started_at timestamptz, used integer)`, supports bounded reads. It has RLS and no raw role grants but permits service-helper-only counter updates; it is not immutable decision evidence. Rate checks run after the root gate, then recheck access after any counter wait. Use a documented finite window and limit, never a lifetime counter that permanently locks out an active grant. Restore the table and its access restrictions without treating usage counters as clinical evidence.

## SQL RPC surface

Authenticated staff only:

- `preview_native_estimate_decision_grant(p_publication_id uuid,p_client_id uuid)` -> `{version:1,binding,publication_head,expires_at,decision:Decision|null}`. Source is a verified current publication; cannot issue a decision grant after a terminal decision.
- `record_native_estimate_decision_grant(p_id uuid,p_mutation jsonb)` -> GrantReceipt.
- `recover_native_estimate_decision_grant(p_id uuid)` -> creator-bound GrantReceipt|null; history eligibility is not needed for exact recovery.
- `close_native_estimate_decision_grant(p_id uuid,p_mutation jsonb)` -> recorded/closed union below, creator-bound.
- `read_native_estimate_decision_grants(p_estimate_id uuid,p_client_id uuid,p_before_sequence integer,p_limit integer)` -> `{version:1,target,items:GrantEventView[],next_before_sequence:integer|null,has_more:boolean}`. limit 1..50, limit+1 query, no silent truncation; views include grant_id and current eligibility without exposing tokens.
- `record_native_estimate_witnessed_decision(p_id uuid,p_request jsonb)` -> DecisionReceipt.
- `recover_native_estimate_witnessed_decision(p_id uuid)` -> creator-bound DecisionReceipt|null.
- `close_native_estimate_witnessed_decision(p_id uuid,p_request jsonb)` -> recorded/closed union, creator-bound.
- `read_native_estimate_decisions(p_estimate_id uuid,p_client_id uuid,p_before_sequence integer,p_limit integer)` -> `{version:1,target,head,items:Decision[],next_before_sequence:integer|null,has_more:boolean}`.
- `read_native_estimate_decision_state(p_estimate_id uuid,p_client_id uuid)` -> `{version:1,target,publication_head,decision_head,current_publication_id:uuid|null,current_decision:Decision|null}`.
- `reconcile_native_estimate_client_decision(p_id uuid,p_request jsonb,p_close_unrecorded boolean,p_reason text)` -> resolution union below. p_request is the exact original DecisionRequest with grant_id. Requires active staff and exact existing grant/publication/household/patient binding. Reason 1..2000 mandatory; this reconciles uncertain intent, never records an acceptance.

Service only (Edge derives identities and validates proofs; anon receives no SQL grants):

- `native_estimate_decision_grant_capture_context(p_grant_id uuid,p_actor_id uuid,p_origin text,p_key_version text)` -> verified private grant + proposed canonical capability_context/context_hash. Origin/key version come only from trusted Edge environment; this service-only helper verifies exact allowed origin syntax and key-version shape. Creator binding, active staff, root checks for new capture. Existing capture returns its already-frozen context, never a rotated replacement.
- `capture_native_estimate_decision_grant(p_grant_id uuid,p_actor_id uuid,p_origin text,p_key_version text,p_context_hash text,p_token_hash text)` -> GrantView; recompute canonical context from immutable issue plus trusted service origin/keyversion and compare p_context_hash. Atomically freeze origin/keyversion/context/token hash in capture. Exact repeated capture succeeds, changed material fails. Before capture capability is null; staff issue cannot choose environment configuration.
- `native_estimate_decision_access_context(p_grant_id uuid)` -> private verified metadata for HMAC proof only. Never returned directly to browser.
- `retrieve_native_estimate_decision(p_grant_id uuid,p_token_hash text,p_origin text,p_key_version text)` -> PublicReview. Requires active grant; historical read of superseded/withdrawn publication is allowed while grant is otherwise active, explicitly read-only. Publication expiry also expires the grant by construction.
- `record_native_estimate_client_decision(p_id uuid,p_request jsonb,p_token_hash text,p_origin text,p_key_version text)` -> PublicDecisionReceipt.
- `recover_native_estimate_client_decision(p_id uuid,p_request jsonb,p_token_hash text,p_origin text,p_key_version text)` -> PublicResolution, not an ambiguous nullable receipt.
- `close_native_estimate_client_decision(p_id uuid,p_request jsonb,p_token_hash text,p_origin text,p_key_version text)` -> terminal PublicResolution recorded/closed union.

Bearer recovery/close requires a still-active capability but need not require its publication to remain current; neither endpoint can append a decision. An expired/revoked/unavailable capability returns uniform unavailable, NOT unrecorded/null. Authorized staff can reconcile after that. Creator deactivation invalidates bearer access consistently with existing document capabilities; staff historical evidence remains accessible.

## Unknown outcomes and durable closure

`Resolution={version:1,status:'recorded',receipt:DecisionReceipt}|{version:1,status:'closed_unrecorded',closure:DecisionClosure}|{version:1,status:'unrecorded'}`. The unrecorded variant is allowed only by recovery/reconciliation with close=false and does **not** authorize discarding the saved operation. Both close endpoints exclude it.

`DecisionClosure={version:1,id,principal:Principal,mutation:DecisionMutation,request_hash,closed_by:Principal,reason:string|null,closed_at,record_hash}`. Browser bearer closure has closed_by equal original grant principal and reason null. Staff witness creator closure has closed_by equal creator and reason null. Staff reconciliation of a bearer request has closed_by staff plus mandatory reason. Hash the full closure excluding record_hash. The exact retry returns the first closure unchanged, even when another authorized staff member inspects it. A different original principal/request must fail. Grant-operation closure uses the analogous actor-bound envelope `{version:1,id,actor_id,mutation,request_hash,closed_at,record_hash}` and result union with GrantReceipt.

All record/recover/close paths share the original operation UUID gate. A close first checks and verifies a committed receipt (recorded wins); otherwise checks and returns an exact tombstone; otherwise inserts a tombstone. The corresponding record checks the tombstone under that same gate before any write. This makes a delayed request impossible after closed_unrecorded. Closures need no current publication eligibility, so a changed head cannot trap an unknown intent. Neither a network error, stale-context error, unavailable bearer, nor empty read unlocks the browser.

Staff reconciliation with close=false reads under the same gate. Staff cannot supply another grant's request to adopt a recorded result. For a never-recorded ID, the immutable grant supplies original scope and principal; staff may close that exact grant-bound intent without pretending the client actually submitted it. Such a tombstone is an administrative prevention of a possible future request, not evidence of client action. Require the original request from the local pending record, display its outcome and ID to staff, and audit the reason.

## Lock order and publication integration

Canonical order for new writes: bare operation UUID gate `pg_advisory_xact_lock(hashtextextended(p_id::text,0))` → shared root gate `pg_advisory_xact_lock(hashtextextended('native-estimate:'||estimate_id::text,0))` → any grant/budget row locks. Resolve immutable scope before locks without trusting mutable eligibility; verify it again after acquiring the gates. Never acquire an operation gate while holding the root.

Capture uses the grant ID as its bare gate → root. Activation uses its own operation ID → root; do NOT acquire the grant-ID gate after root. Immutable capture evidence and the root suffice. Revocation likewise operation → root. Retrieval acquires root before its budget row and rechecks access after the last wait. Never introduce a grant-row → root path. Close/reconcile can use operation → root as well (even though no eligibility is required), giving staff scope checks and a single universal order.

Under the root, a new decision must re-read and verify: exact target, exact current publication ID/content/artifact, expected publication head, absence of terminal decision, active reviewed grant and captured proof (or active staff witness), and `clock_timestamp()` strictly before both deadlines. Recheck active authority at the final insert and after budget or source row waits. An exact recorded retry checks identity/request and returns historical receipt before current-publication eligibility, but bearer access must still be active. Opposing decisions with distinct UUIDs compete on the root and unique publication constraint; loser receives already-decided conflict and separately reads the winning attributed outcome.

Existing `native_estpub_record` already acquires this root before lifecycle checks and append; therefore replacement/withdrawal races serialize without changing old request/event shapes. Decision first then replacement preserves accepted evidence but makes the old publication unavailable for any new decision; replacement first makes old decision fail. Withdrawal behaves similarly. Existing draft saves also share the root but do not invalidate a published decision or grant. No need to add decision_head to existing PublishRequest merely to cancel an old decision—old decisions are never canceled.

**Mandatory future execution integration:** before adding accepted allowances, extend publication write behavior under this existing gate to freeze old unused entitlements atomically and bind reviewed consumed-head context. The current publication implementation alone does not do that. Do not claim acceptance/line execution complete or enable two overlapping entitlements. Frozen acceptance creates no allowance or invoice in this decision slice.

## Capability and HTTP contract

Frozen capability_context is canonical SQL JSON text containing `{domain:'lrv-estimate-decision/v1',context_version:1,grant_id,actor_id,binding,expires_at,origin,key_version}`; context_hash is SHA256 of those exact UTF-8 text bytes. Edge validates the parsed closed context against the verified stored fields. Token is `e1.` plus unpadded base64url HMAC-SHA256 over UTF-8 `JSON.stringify(['living-room-vet.estimate-decision.v1',capability_context])`, using a dedicated versioned key. Persist only SHA256(token), never usable token/link/materialized message. Configuration comes from service environment, not client request. Capture stores exact context/hash/key version so rotation cannot silently issue a different capability for an old grant. Missing old keys fail unavailable.

Proposed Edge modes: staff `prepare-estimate-decision-grant` (authenticated issue→service capture→staff recovery), `recover-estimate-decision-grant` (exact recovery/materialization), and public `estimate-decision` with closed body `{action:'read',grant_id}` or `{action:'record'|'recover'|'close',id,request}`. Token travels only in dedicated `X-Estimate-Capability` header (exact `e1.` plus 43 base64url characters), never Authorization, persisted DecisionRequest, operation hash or audit. Public Edge uses verify_jwt=false with explicit capability authentication on every call; no staff Authorization/cookies are sent. CORS explicitly allows this header. Suppress this header in all telemetry. The public request is bounded, CORS origin allowlisted and no-store/no-referrer. Service argument origin/keyversion derive from trusted configuration and verified context. Response never contains capability_context, token_hash, service identity or unrelated staff history. Staff recovery only materializes active grants; historical recovery can still return metadata when no usable link may be given.

Route `/estimate/:grantId#token` strips the fragment before importing bundles, holds token in memory, has no analytics/auth bootstrap, and uses a sandboxed exact-byte document. Persist only pending ID plus exact DecisionRequest under grant scope. On reload obtain the original link again or ask staff for reconciliation; no browser-generated replacement ID until terminal resolution. Rate-limit at Edge before service calls and enforce a bounded database retrieval budget with final authorization after budget wait. Rate-limit failures are not an absent receipt.

Delivery remains a separate reviewed outbox operation: authorize recipient/channel, render exact message with this grant, capture digest, review then enqueue. Its success is not acceptance; grant issue/activation sends nothing. Provider gates remain disabled during synthetic acceptance.

## Required evidence before claiming this slice ready

SQL/strict-schema: exact accepted and declined bytes/bindings, signer/witness scopes, malformed hashes/nulls/extra keys, actor/grant swaps, changed UUID request, one decision across multiple grants, role/grant deactivation, expiry, arbitrary paginated cursor, capture retry/changed proof and revoked historical recovery. Restore must verify every frozen record without depending on current catalog/client versions or current grant eligibility; corrupted hashes/provenance/timestamps fail closed.

Observed database contention: opposing decisions, client versus witness, revoke versus decision/retrieval, replacement/withdrawal versus decision, creator revocation during a root wait, capture versus activation, and close versus record with both commit orders and both rollback orders. Post-wait timestamps must demonstrably be captured after release; ordinary expiry/DST fixtures alone must not be described as an observed midnight-crossing race.

Real owned Auth/HTTP + isolated browser: exact artifact hash review; accept and decline; witnessed entry; losing decision conflict; lost prepare/decision/close response across reload; inactive-token staff reconciliation; no unsafe local discard; no token in storage/logs/referrers. Assert no inventory, clinical, invoice, payment, outbox or provider side effects. Full accepted service/vaccine/dispense execution and delivery acceptance remain required subsequent work, not waived by passing this slice.
