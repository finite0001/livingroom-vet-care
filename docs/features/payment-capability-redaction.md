# Payment capabilities in quoted replies

Canonical `p1.` collection and `s1.` status tokens are removed from verified inbound SMS and fetched email text, HTML, subject and attachment metadata before persistence. Existing `v1.` document redaction remains unchanged. SMS signature verification and duplicate/resource hashes still use original bytes; redaction never alters signed input first.

Migration `20260913360000` expands the existing message/outbox/preparation persistence guard and adds it to payment grant/capture/event records. An old worker cannot store a literal quoted payment capability. The database rejects it instead of silently accepting a usable token in message history. Apply the migration before updated inbound workers; rejected older-worker attempts require normal recovery after the coordinated worker update.

This protects canonical plaintext tokens, not arbitrary encoded attachments or binary contents. It does not send payment links, commission mail/SMS, or claim provider acceptance.

Verification: seven inbound tests cover real signature checking and resource matching with synthetic payloads; the document SMS rollback suite checks both payment token families at message/template boundaries, and the collection suite checks payment event history. Frozen Deno checks cover the Twilio receiver and inbound worker. No hosted deployment or provider requests.
