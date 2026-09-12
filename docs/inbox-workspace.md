# Inbox workspace backend contract

This migration completes staff inbox reads and metadata mutations. It does not send messages, deploy functions, or render inbound HTML. Apply after the inbound delivery migration and migrate the UI in the same release: direct conversation insert/update/delete and the legacy cascade-delete RPC are disabled. History is archived rather than deleted, including through privileged delete paths.

## List and counts

`list_inbox_workspace` accepts these named arguments (all optional):

| Argument | Default | Meaning |
| --- | --- | --- |
| `p_search` | empty | Household name, phone, email, pet name or message text; at most 200 characters |
| `p_status` | `ACTIVE` | `ACTIVE`, `PENDING`, `ARCHIVED`, or null for all |
| `p_assignment` | `all` | `all`, `unassigned`, or `staff` |
| `p_assigned_to_id` | null | Required when assignment is `staff` |
| `p_priority` | null | Optional `URGENT`, `NORMAL`, `LOW` |
| `p_tags` | empty array | Require all selected tags; at most 20 |
| `p_channel` | null | Match any message of the selected `message_type` |
| `p_read` | `all` | `all`, `read`, `unread` for the authenticated staff member |
| `p_before_at`, `p_before_id` | null | Both cursor fields from the previous page’s last row |
| `p_limit` | 50 | 1–100 rows |

Rows contain `conversation_id`, `client_id`, `client_name`, `primary_phone`, `primary_email`, `updated_at` (conversation last-message time), `status`, `assigned_to_id`, `priority`, `tags`, `revision`, `latest_message_id`, `latest_content`, `latest_type`, `unread_count` and `is_unread`. Sorting is descending `(updated_at,conversation_id)`. Refresh from page one after new activity; changing filters discards the old cursor. The backing view is private; use the authenticated RPC.

`inbox_unread_totals()` returns one row with `unread_conversations` and `unread_messages` across all ACTIVE threads, independently of the currently loaded page. Manual “mark unread” adds a thread badge without inventing unseen messages, so `is_unread` can be true when `unread_count` is zero. Use actor-specific query keys and poll/refetch on focus until realtime publication is explicitly configured.

## Read and unread

`mark_conversation_read(p_actor_id,p_conversation_id,p_message_id)` marks through the exact rendered message boundary and clears the caller’s manual unread flag. The message must belong to the conversation. Existing cursors remain monotonic.

`mark_conversation_unread(p_actor_id,p_conversation_id)` sets a separate personal flag; it does not rewind another staff member’s cursor or change the actual unseen-message count.

For all ACTIVE conversations, first call `capture_inbox_read_snapshot()` to obtain a UUID. Then call `apply_inbox_read_snapshot(p_actor_id,p_snapshot_id)`. The token belongs to its capturing actor, expires after 15 minutes, and applies idempotently. It stores each conversation’s exact latest message ID and manual-read revision; later arrivals beyond that boundary remain unread, and later manual read/unread actions are preserved. It does not mark conversations created after capture. Capture at the user’s action boundary, not during an unrelated earlier page load. Snapshot rows retain evidence for operational inspection; a retention job is a later operations task.

## Compose and metadata

`ensure_active_conversation(p_client_id)` returns a full conversation row. It derives the actor from the authenticated session, locks by household, reuses a sole ACTIVE conversation, or creates an audited one. Historical households with multiple ACTIVE threads fail with SQLSTATE `23514`, requiring explicit thread selection. A trigger shares the household lock with inbound creation and prevents new duplicate active threads; conflicting inbound work remains retryable in its durable processing queue.

`update_conversation_metadata(p_actor_id,p_conversation_id,p_expected_revision,p_status,p_assigned_to_id,p_priority,p_tags)` replaces those four metadata fields atomically and returns the updated conversation row. Supply the currently loaded revision. Stale mutations fail with `40001`; refresh before another edit. Assignees must be active staff. Tags are trimmed, deduplicated, limited to 20 entries of 1–40 characters each. Actor identity is checked against the session. Successful edits increment revision and retain before/after values in `conversation_activity_audit`. Restoring an archived conversation fails if that household already has another active thread. Archive timestamps are managed by the server.

The earlier `list_communication_inbox` RPC remains available for compatibility but does not expose these new filters or the manual unread flag. New UI should use the workspace contract throughout. Existing conversation message queries still need bounded pagination and outbox/inbound status joins in the UI increment; never treat a queued item as delivered.
