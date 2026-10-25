# Shared staff review workspace

The workspace connects the verified queue, opened record details and existing
guarded signing/recovery dialog. Opening a record is read-only. Preparing,
acknowledging the evidence and signing remain separate deliberate actions.
Terminal and unavailable records retain their readable status and evidence.

`createReviewWorkspace` requires the real staff session source, narrow read RPC,
owned lifecycle and a complete source-specific detail admission. It supplies no
default admission, connection, roster, policy or backend installation. No route
mounts it in this change. Use `RecordReviewWorkspace` inside a data router so the
existing dialog's draft, durable-operation and navigation protections apply.

The controller subscribes during `connect()` and clears the signing model before
notifying queue observers or adopting a new identity. Session changes and
disconnects invalidate pending detail work. Refresh and pagination preserve the
original intent: a synchronous observer cannot rebase a read onto a later
generation of the same staff session. Construction, subscription, reconnection
and opening details cannot prepare, sign, cancel or remove recovery storage.

Detail must match every field of its opened queue row and the exact product,
site and event-kind scope. Only the five IDs returned by admitted detail become
a new preparation selection. Recovery uses the original stored operation and
needs no fresh selection. Exact evidence numbers remain lossless display text.

Changing product/site/kind/view masks a prior queue, detail, loading/error copy
and preparation selection synchronously. Loading the new scope is explicit.
An existing owned operation keeps its original recovery controls and a visible
scope distinction. Page size is navigation sizing. Hosts must guard or remount
programmatic scope changes while a draft dialog is open; ordinary filter clicks
are blocked by the modal. No effect performs a scope-change RPC.

Verification includes race/admission unit controls and separate 375/1280px browser
controls for explicit reads, complete detail display, guarded draft dismissal,
refresh and session loss while the dialog is open. Their synthetic DTO broker is
not genuine Auth or backend acceptance. Real SDK login and server signing are
tested separately; this composition still needs that integrated acceptance and
the completed commissioned backend before production mounting.
