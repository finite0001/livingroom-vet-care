# Website inquiry triage

`/hub/inquiries` is an active-staff workspace linked from the unified inbox and desktop navigation. New public submissions get an atomic triage row; migration backfills prior submissions. Original contact fields are immutable. An inquiry is a request, never a confirmed appointment or verified inbound client message.

The list uses bounded `(created_at,id)` keyset pages; history uses the same ordering. Queries are actor-keyed, the list polls, and the inbox entry displays a server count of open requests. Status, assignment, household/destination review and handoff actions have authenticated actor history. Conflicting versions reject edits and leave the draft intact with explicit reload.

Household search is bounded to eight results. A selected household remains visible when the search changes. Staff must explicitly confirm the household and its current primary destination, with review evidence. This does not prove who submitted the form, and never records SMS opt-in. A review can be replaced with another authored review. There is no automatic matching by claimed email or phone.

The fixed-channel reply composer reuses the existing durable queue and saved-request recovery panel. It calls `authorize_website_inquiry_reply` immediately before queue preparation; authorization checks the inquiry revision/status, reviewed current household destination and communication suppression. The existing enqueue and worker checks still validate current recipient and permission. Handoff itself only creates/reuses a conversation and writes an audit event: no synthetic client-authored message, automatic send, appointment or clinical record is created. Queue acceptance does not imply provider delivery. An unresolved saved draft is recovered under actor + inquiry scope, with only an opaque request UUID persisted in the browser. Recovery never automatically queues a message.

## Staff RPCs

- `list_website_inquiries(status='open', search='', assigned_to_id=null, before_at=null, before_id=null, limit=25)`: filters open/all/exact status, optional staff assignment and search; returns original summary + current triage version.
- `website_inquiry_open_count()`: aggregate new/in-progress count, active staff only.
- `read_website_inquiry(id)`: original submission, triage and current reviewed household label. History is separately paginated under staff RLS.
- `update_website_inquiry(actor_id,id,expected_version,status,assigned_to_id,reason)`: authored versioned triage update.
- `review_website_inquiry_household(actor_id,id,expected_version,client_id,channel,recipient,confirmed,evidence)`: explicit review against current household contact; no consent mutation.
- `authorize_website_inquiry_reply(actor_id,id,expected_version)`: returns conversation/client/channel/recipient after current checks, without dispatching.

## Public submission boundary and remaining launch gate

The existing direct anonymous insert remains compatible: only name/email/phone/subject/message columns may be inserted, server defaults own ID and timestamp, and anonymous reads remain denied. Server-side required/length/email validation matches the existing form's limits. Original rows cannot be updated or deleted, and staff cannot directly mutate triage/history.

**Not production spam protection:** authenticated and anonymous callers can still submit repeated valid records through the public Data API. A trusted Edge entry point with validated CAPTCHA and rate limits, followed by revocation of direct anonymous insert, is a separate required public-launch change. Do not claim rate limiting from browser validation or untrusted forwarded headers. No CAPTCHA provider/account has been configured here. The current website catch message also cannot distinguish a rejected write from a committed write whose response was lost; stable submission UUID recovery should accompany that endpoint cutover.

No provider requests, cloud migrations or real sends were performed. SQL fixtures cover access boundaries, immutable originals/history, field/privileged-column rejection, version conflicts, independent review, missing SMS permission, destination changes and keyset boundaries. Browser fixtures cover paging, retained household selection, explicit review, blocked handoff and retained conflict drafts.
