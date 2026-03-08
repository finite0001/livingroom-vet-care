

## Codebase Review: Functionality, UX/UI, and Backend Improvements

After thorough review of all hub pages, hooks, components, edge functions, and database schema, here are the issues found:

---

### Backend / Data Integrity Issues

1. **`useDeleteConversation` will fail silently** — The hook tries to `DELETE` from both `messages` and `conversations`, but RLS policies on both tables explicitly block DELETE operations for authenticated users. The delete button in `ConversationActionSheet` will always error. Fix: either remove the delete feature or add RLS policies allowing staff to delete.

2. **`use-sms-consent` upsert has incorrect `onConflict`** — The `sms_consent` table has no unique constraint on `(client_id, phone_number)`, so the `upsert` with `onConflict` will fail. The `as any` casts mask this. Fix: add a unique constraint on `(client_id, phone_number)` via migration, and remove the `as any` casts.

3. **`use-attachments` uses `as any` table casts** — `message_attachments as any` bypasses type safety. The types file should already include this table. Fix: remove `as any` casts and use proper typed queries.

4. **`use-signature` stores signatures in `app_settings`** — The `profiles` table already has an `email_signature` column. The hook should use that instead of stuffing per-user keys into a shared settings table.

5. **Missing database triggers** — The `track_response_metric` and `create_appointment_reminders` trigger functions exist but the `db-triggers` section shows "no triggers." These functions are dead code unless triggers are attached. Fix: create the triggers via migration.

6. **`useConversations` fetches all messages to find last message** — The query `limit(convIds.length * 2)` is fragile and may miss conversations with many messages. Fix: use a subquery or fetch last message per conversation more reliably.

### UX/UI Issues

7. **Signup page lacks visual polish compared to login** — Login page has gradient background, decorative blurs, card styling. Signup is plain `bg-background`. Should match login's visual treatment.

8. **ConversationDetailPage has no loading state for conversation data** — If conversations haven't loaded yet, the header shows a skeleton but the composer still renders, allowing sends to a null conversation (the `handleSend` has a guard, but it's confusing UX).

9. **No error boundary feedback in hub pages** — When data fetching fails (network error, RLS denial), queries throw but there's no visible error state — pages just show empty/loading forever. Each page should handle the `isError` state from react-query.

10. **`UserHeader` returns null when profile is null** — During initial load, the header disappears entirely, causing layout shift. Should show a skeleton instead.

11. **Conversation detail doesn't handle invalid/missing conversation ID** — If you navigate to `/hub/conversation/invalid-uuid`, it shows "No messages yet" with a working composer rather than a "not found" state.

12. **Mobile: bottom tab bar overlaps content on some views** — The padding `pb-[calc(56px+env(safe-area-inset-bottom))]` is applied in AppShell, but ConversationsPage and ConversationDetailPage use `h-full` which may not account for this correctly in all scenarios.

### Code Quality

13. **`ClientNotesCard` uses `as any` for profile join** — Line 69: `(n.profile as any)?.full_name` — the Supabase join returns a typed object but the `ClientNote` interface doesn't match. Fix the interface.

14. **`useUpdateConsent` uses `as any` twice** — For `consent_method` and `onConflict`. These should use proper types.

15. **`LoginPage` bypasses `AuthContext.signIn`** — It calls `supabase.auth.signInWithPassword` directly instead of using the `useAuth().signIn` method, duplicating auth logic.

16. **`SignupPage` bypasses `AuthContext.signUp`** — Same issue — calls `supabase.auth.signUp` directly.

---

### Implementation Plan

**Step 1 — Fix RLS for delete operations**
Add DELETE policies for `messages` and `conversations` tables (authenticated users only), or remove the delete feature from the UI if deletion should not be allowed.

**Step 2 — Fix SMS consent unique constraint**
Add migration: `ALTER TABLE sms_consent ADD CONSTRAINT sms_consent_client_phone_unique UNIQUE (client_id, phone_number);` and remove `as any` casts.

**Step 3 — Attach missing database triggers**
Create migration to attach `track_response_metric` trigger on `messages` INSERT and `create_appointment_reminders` trigger on `appointments` INSERT.

**Step 4 — Remove `as any` casts across hooks**
Clean up `use-attachments.ts`, `use-sms-consent.ts`, `ClientNotesCard.tsx` to use proper types.

**Step 5 — Fix auth flow: use AuthContext in Login/Signup**
Update `LoginPage` and `SignupPage` to use `useAuth().signIn` and `useAuth().signUp` instead of calling Supabase directly.

**Step 6 — Polish Signup page to match Login**
Add gradient background, decorative blurs, card border styling to match `LoginPage`.

**Step 7 — Add error and edge-case handling**
- `UserHeader`: show skeleton instead of returning null
- `ConversationDetailPage`: show "not found" when conversation ID is invalid
- Add `isError` handling to `ConversationsPage`, `ClientsPage`, `ClientProfilePage`
- Move signature storage from `app_settings` to `profiles.email_signature`

