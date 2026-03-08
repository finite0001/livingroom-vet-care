

## Pass 4: Remaining Cleanup and Fixes

### Issues Found

1. **Console warnings still active** — `ServicesSection`, `CTASection`, and `WhyDifferentSection` still trigger "Function components cannot be given refs" warnings. They were missed in the previous `forwardRef` pass. `ScrollReveal` passes refs to its children, and these section components need `forwardRef` wrapping.

2. **Two remaining `as any` casts**:
   - `CreateClientSheet.tsx` line 33: `preferred_channel: channel as any` — unnecessary since the enum type `channel_type` accepts `"SMS" | "EMAIL" | "VOICE" | "VOICEMAIL"`. Fix: type the `channel` state properly.
   - `use-client-files.ts` line 53: `category: category as any` — the `file_category` enum is a known type. Fix: type the parameter properly.

3. **`useDeleteConversation` still references DELETE on messages/conversations** — The last migration only added triggers, not DELETE RLS policies. The schema context confirms conversations and messages still have "Can't DELETE" restrictions. Need a migration to add DELETE policies or remove the delete functionality from the UI.

4. **`useConversations` fragile last-message fetch** — `limit(convIds.length * 2)` assumes at most 2 messages per conversation. With even a few active conversations with history, this will miss. Fix: use a `DISTINCT ON` query via `.rpc()` or fetch last message per conversation individually (batched).

5. **No `document.title` per page** — SEO and screen readers benefit from page-specific titles. None of the marketing or hub pages set `document.title`.

6. **Conversation delete from `ConversationActionSheet`** — Even if RLS is added, deleting messages then the conversation is not atomic. If the messages delete succeeds but conversation delete fails, orphaned state results. Should use a database function for transactional delete.

### Implementation Plan

**Step 1 — Fix remaining ref warnings**
Wrap `ServicesSection`, `CTASection`, and `WhyDifferentSection` with `React.forwardRef`.

**Step 2 — Remove final `as any` casts**
- `CreateClientSheet.tsx`: type `channel` state as `Database["public"]["Enums"]["channel_type"]`
- `use-client-files.ts`: type `category` parameter as `Database["public"]["Enums"]["file_category"]`

**Step 3 — Add DELETE RLS policies via migration**
Add DELETE policies for `messages` and `conversations` (authenticated users). Create an `rpc` function `delete_conversation_cascade(conv_id uuid)` that transactionally deletes messages then the conversation.

**Step 4 — Fix last-message fetch**
Replace the fragile `limit(convIds.length * 2)` approach with a database function using `DISTINCT ON (conversation_id)` to reliably get the last message per conversation.

**Step 5 — Add page titles**
Create a small `usePageTitle(title)` hook and apply it across all marketing pages and hub pages.

