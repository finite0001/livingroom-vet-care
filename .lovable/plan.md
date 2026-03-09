

## Pass 6: Remaining Improvements

### Issues Found

1. **Header and HeroSection still trigger forwardRef warnings** — Console logs show "Function components cannot be given refs" for both `Header` and `HeroSection` on the Index page. These need `forwardRef` wrapping.

2. **Database triggers still not attached** — The `db-triggers` section shows "no triggers." The previous migration likely created the functions but never ran `CREATE TRIGGER`. The functions `track_response_metric`, `create_appointment_reminders`, `update_updated_at_column`, `create_vaccine_wellness_reminder`, and `audit_trigger_fn` all exist as dead code. Need a migration to actually attach them.

3. **`response_time_seconds` never computed** — `track_response_metric` inserts into `response_metrics` but leaves `response_time_seconds` as NULL. The trigger should compute `EXTRACT(EPOCH FROM (NEW.created_at - _client_msg.created_at))::INT`.

4. **`ConversationListItem` long-press timer is a local variable, not a ref** — On re-render, the timer reference is lost, creating a potential memory leak and missed cleanup. Should use `useRef` for the timer.

5. **`ConversationDetailPage` fetches ALL conversations just to find one** — `useConversations()` loads every conversation + clients + pets to find a single conversation by ID. Should add a `useConversation(id)` hook that fetches a single record.

6. **No unread badge count on sidebar/tab bar** — The sidebar "Communication" item and bottom tab "Comm" show no indication of unread messages. A badge count would help staff notice new messages without navigating to the page.

---

### Implementation Plan

**Step 1 — Fix remaining forwardRef warnings**
Wrap `Header` and `HeroSection` with `React.forwardRef`.

**Step 2 — Attach all database triggers via migration**
```sql
CREATE TRIGGER trg_track_response ON messages AFTER INSERT FOR EACH ROW EXECUTE FUNCTION track_response_metric();
CREATE TRIGGER trg_appointment_reminders ON appointments AFTER INSERT FOR EACH ROW EXECUTE FUNCTION create_appointment_reminders();
CREATE TRIGGER trg_updated_at_appointments ON appointments BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_vaccine_reminder ON pet_vaccinations AFTER INSERT FOR EACH ROW EXECUTE FUNCTION create_vaccine_wellness_reminder();
```
Also update `track_response_metric` to compute `response_time_seconds`.

**Step 3 — Fix long-press timer in ConversationListItem**
Replace the local `let longPressTimer` with a `useRef<ReturnType<typeof setTimeout>>` to survive re-renders and clean up properly.

**Step 4 — Add single-conversation fetch hook**
Create `useConversation(id)` that fetches one conversation + client + pets directly, used by `ConversationDetailPage` instead of loading the full list.

**Step 5 — Add unread badge to sidebar and bottom tab bar**
Query the unread count from the existing `useConversations` data (or a lightweight count query) and display a badge on the "Communication" / "Comm" nav items.

