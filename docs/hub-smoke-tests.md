# Hub Smoke-Test Checklist

Run through these checks after any backend or auth change. All tests assume
self-service signup is disabled and accounts are created from the Lovable Cloud
backend.

## Access control

- [ ] **Active staff can load Hub.** Sign in as a user whose `profiles.is_active = true`
      and whose `user_roles.role` is one of `ADMIN`, `DVM`, `TECH`, `STAFF`. The Hub
      home page loads and conversation/client lists return data.
- [ ] **Inactive staff cannot access Hub data.** Set `profiles.is_active = false` for
      a test account. After re-login, list queries (conversations, clients, messages)
      return empty/forbidden and Hub pages render empty states without crashes.
- [ ] **Non-staff authenticated user cannot access Hub data.** Create an auth user with
      no `user_roles` row. Hub queries return no rows; protected mutations fail.

## Messaging (`send-sms` edge function)

- [ ] **Queueing a message inserts both rows.** Sending from a conversation creates a
      row in `messages` AND a corresponding row in `outbound_deliveries` with
      `status = 'QUEUED'`, `channel = 'SMS'`, and a `message_id` pointing at the staff
      message.
- [ ] **Provider delivery is not implied by queueing.** Function response payload
      contains `queued: true`, `accepted: false`, and `delivered: false`. UI toast says
      "SMS queued for delivery" — never "delivered".
- [ ] **Recipient mismatch is rejected.** Calling `send-sms` with a `to` phone that
      doesn't match the conversation client returns 403.
- [ ] **Unauthorized callers blocked.** Calling `send-sms` without an auth header, or
      as a non-staff user, returns 401/403 and writes nothing.
- [ ] **Outbound delivery controls are guarded.** `/hub/deliveries` shows retry only
      for `FAILED`/`UNKNOWN` rows and cancel only for `QUEUED` rows. A stale row
      action fails and asks staff to refresh instead of silently changing state.

## Smart replies (`suggest-replies` edge function)

- [ ] **Unauthorized users are blocked.** Anonymous or non-staff caller → 401/403.
- [ ] **PII is redacted before AI call.** Conversation containing an email and a phone
      number produces edge-function logs showing the redacted payload (no raw
      `user@example.com` or `303-555-0100` strings reach the gateway).

## Admin-only operations

- [ ] **Non-admin staff cannot delete conversations.** As a `DVM`/`TECH`/`STAFF` user,
      attempt a delete on `conversations` or `client_notes` → RLS denies.
- [ ] **Non-admin staff cannot update `app_settings`.** RLS denies.
- [ ] **Non-admin staff cannot change `profiles.is_active` or `profiles.role`.** The
      `protect_profile_privileges` trigger raises an exception.
- [ ] **Non-admin staff cannot read `audit_logs`.** Query returns no rows.
- [ ] **Admins can manage staff.** `/hub/admin/staff` lets an admin toggle active
      status and change role; changes persist and the affected user's Hub access
      updates on next session refresh.

## Build / lint

- [ ] `lovable build` succeeds with no new TypeScript errors.
- [ ] No new ESLint errors introduced by the change under test.
