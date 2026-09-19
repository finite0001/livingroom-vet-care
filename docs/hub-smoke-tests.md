# Hub Smoke-Test Checklist

Run through these checks after any backend or auth change. Accounts are
invitation-only: there is no self-service signup. Staff are invited through the
`invite-staff` edge function or the admin onboarding path, then an admin
activates them and assigns a role (`admin_set_staff_active`,
`admin_update_staff_role`). Do not create accounts from the Lovable Cloud
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

## Outbound messaging (`enqueue-message` + `dispatch-outbox`)

- [ ] **Recording a message enqueues one outbox row and one message.** Sending from a
      conversation calls `enqueue-message` with a stable request UUID; it inserts one
      row in `communication_outbox` and exactly one conversation `message`. The UI must
      not separately insert a second message.
- [ ] **Initial state is `pending`, never delivered.** The response reports `queued: true`,
      `accepted: false`, `delivered: false`, state `pending`. UI says "Queued", never
      "delivered".
- [ ] **Recipient mismatch is rejected.** An enqueue whose `to` address does not match
      the conversation's current household recipient is rejected.
- [ ] **Unauthorized callers blocked.** Calling `enqueue-message` without an auth header,
      or as a non-staff user, returns 401/403 and writes nothing.
- [ ] **`dispatch-outbox` is worker-only.** A browser or staff token cannot claim or
      finalize a job. With delivery disabled, `dispatch-outbox` does not even claim
      pending work.

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

- [ ] `npm run check` passes: lint, typecheck, unit tests and production build with no
      new TypeScript or ESLint errors.
