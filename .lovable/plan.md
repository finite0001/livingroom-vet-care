

## Pass 5: UX/UI, Backend, and Feature Improvements

After reviewing all hub pages, hooks, components, and edge functions, here are the remaining improvements:

---

### Issues Found

1. **Realtime not enabled on key tables** — The `messages` table has a realtime subscription in `useConversationMessages`, but `messages` was never added to the `supabase_realtime` publication. The subscription silently receives nothing. Same for `conversations` (needed for live unread badge updates on the home page). Fix: migration to add both tables to the realtime publication.

2. **`ConversationDetailPage` duplicates conversation update logic** — `handleSend` manually updates `last_message_at` on the conversation after sending, but the `send-sms` edge function already does this. The client-side update is redundant and can cause race conditions. Fix: remove the duplicate `update` call from `handleSend`.

3. **`send-sms` edge function uses `SUPABASE_PUBLISHABLE_KEY` env var** — The secret is named `SUPABASE_ANON_KEY` in the secrets list. The function references `SUPABASE_PUBLISHABLE_KEY` which may not exist as a Deno env var. Fix: use `SUPABASE_ANON_KEY` consistently.

4. **`NewMessageSheet` creates clients with empty `last_name`** — When a user enters just a phone number without selecting an existing client, a client record is created with `first_name: recipient` (a phone number), `last_name: ""`, and `full_name: recipient`. This creates garbage data. Fix: require selecting an existing client or entering proper name fields.

5. **No optimistic updates on mutations** — All conversation mutations (toggle read, archive, delete, priority) wait for server round-trip then full refetch. This makes the UI feel sluggish. Fix: add `onMutate` optimistic updates to `useToggleRead` and `useArchiveConversation` for instant feedback.

6. **`useConversations` refetches ALL data on every mutation** — Every toggle-read, archive, or priority change invalidates the entire conversations query, re-fetching all conversations + clients + pets + last messages. Fix: use optimistic cache updates and selective invalidation.

7. **Hub home page has no ticket count stat** — The home page shows "Unread messages" and "Active conversations" but no ticket count, even though tickets is a primary feature. Fix: add an open tickets stat card.

8. **`PlaceholderPage` doesn't set page title** — Missing `usePageTitle` call.

9. **Keyboard shortcut for composer** — The reply composer doesn't support Ctrl/Cmd+Enter to send. This is standard UX for messaging apps. Fix: add keyboard shortcut.

10. **No toast feedback on archive/unarchive** — Archiving and toggling read status give no visual confirmation. Fix: add toast notifications on success.

---

### Implementation Plan

**Step 1 — Enable realtime on messages and conversations**
Migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;`

**Step 2 — Fix edge function env var**
Update `send-sms` and `suggest-replies` to use `SUPABASE_ANON_KEY` instead of `SUPABASE_PUBLISHABLE_KEY`.

**Step 3 — Remove duplicate conversation update from ConversationDetailPage**
Remove the manual `last_message_at` update in `handleSend` since the edge function already does it. Keep the query invalidation via the realtime subscription.

**Step 4 — Fix NewMessageSheet client creation**
Add first/last name fields that appear when no existing client is selected. Validate that proper name data exists before creating a client record.

**Step 5 — Add optimistic updates to key mutations**
Add `onMutate`/`onError`/`onSettled` to `useToggleRead` and `useArchiveConversation` for instant UI response. Add toast confirmations for archive/unarchive/read toggle.

**Step 6 — Add Cmd+Enter to ReplyComposer**
Listen for `Cmd+Enter` / `Ctrl+Enter` on the textarea to trigger send.

**Step 7 — Small UX polish**
- Add `usePageTitle` to `PlaceholderPage`
- Add open tickets stat to `HubHomePage` (query `tickets` table where `status = 'OPEN'`)
- Add a realtime listener on `conversations` changes in the conversations list to auto-refresh when new messages arrive from other tabs/users

