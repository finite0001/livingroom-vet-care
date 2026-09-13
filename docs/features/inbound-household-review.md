# Reviewed household assignment for incoming messages

The inbox links to `/hub/inbox/review` for active staff to review messages that were received but could not be assigned automatically. The queue reads actual unassigned `communication_inbound` rows, ordered by received time and ID with a bounded cursor. No placeholder messages are created.

Both reads and the assignment RPC response explicitly project plain-text message fields. Raw HTML, attachment metadata, provider payloads and remote-image URLs are excluded. The original sender, recipient, subject, body, received time and version are displayed as text; message content is never rendered as HTML or linkified.

Staff search actual households and select a conversation returned under that household ID. The UI requires a matching reason and explicit confirmation. `assign_inbound_communication` independently verifies the authenticated actor, original message version, unassigned state and conversation ownership before creating its one original inbound message and audit assignment. The workflow does not update contact information, set consent, or send a reply.

Before submission, the exact six RPC arguments are saved under `inbound-assignment-intent:`. Recovery reads the same original inbound row and its assignment audit. Success requires the expected next version, a real message ID, exact household/conversation, and matching actor/reason in the audit row. Merely finding an assigned message is not proof that this draft committed. A competing staff assignment disables retry and remains visible as a conflict. An unchanged unassigned message may be retried with the original arguments; a local request can only be cleared after a second authoritative read confirms an uncreated request or a conflict.

The route guards unsaved review navigation. Submitted work remains recoverable after reload; signout and account change remove local intent data and invalidate late responses. The saved assignment remains discoverable through the real conversation and original inbound record. No body, raw HTML or attachments are persisted in session storage.

Synthetic browser checks cover lost acknowledgment after commit/reload, unchanged retry after a pre-commit failure, conflicting staff assignment, actual household-scoped conversation selection, plain-text rendering, navigation protection and auth cleanup. Focused state tests require exact assignment proof and reject added write authority. The backend integration runner separately checks real PostgREST projection semantics.
