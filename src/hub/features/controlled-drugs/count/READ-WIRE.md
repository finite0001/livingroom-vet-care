# Count read response

`verifyCountReadReply(rawBytes, originalReadRequest)` is the prospective display
boundary for the closed count response. It makes no request and creates no
principal, policy, observation, count, receipt or write permission. No route,
hook or mounted workflow currently imports it.

The response contains captured display membership and a separate historical
state/current boundary state. Expected quantities and shared observations are
required to remain null until both participants have submitted. A reader may
see only their own earlier request/receipt before that point. Manager identity
does not bypass those field rules. Cancellation reason is also hidden before
both. Agreement describes the retained historical count, including when current
stock or policy has subsequently changed.

Raw responses first check the intrinsic typed-array brand/byte length and copy
only the actual view bytes into a private bounded buffer. Caller byteLength,
length, buffer/offset, iterator and subclass species properties cannot replace
that bound or snapshot. Responses then use the existing2MiB exact UTF8 JSON decoder, rejecting duplicate
keys, BOM/invalid Unicode and noncanonical numeric protocol tokens. All public
object shapes are strict Zod schemas, with array bounds before schema member
traversal. Quantity and signed-bigint policy versions stay strings; only the
bounded schema/finding protocol integers become JavaScript numbers. PostgreSQL
expiry strings remain display values, including special dates.

The parser checks request/count/own-actor and full visible membership relations,
complete A/B attribution, original requests, comparison flags and exact string
quantities, terminal chronology, and historical/current state separation. The
complete parsed snapshot is deeply frozen before asynchronous verification of
the reader's existing thin statement receipt. Changes to the supplied bytes,
request object or source object during that wait cannot alter the retained
snapshot. It never reconstructs private PostgreSQL hashes.

`parseCountReadReply` provides only synchronous shape/relation checks; use the
verified function when retaining a displayed saved receipt. Public digest
consistency is not server source membership or signature authority. Backend
current READ, complete historical source/graph, policy origin, immutable/deferred
guards, resources, physical observations and authenticated integration remain
separate required checks. Field selection does not semantically redact arbitrary
source text or certify unrelated APIs, owners, conversation or timing channels.
