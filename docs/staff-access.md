# Staff access and onboarding

The hub uses Supabase Auth with invitation-only staff accounts. Authentication and staff authorization are separate: the frontend requires a loaded active profile and role; database RLS and Edge Functions enforce access independently.

## Deployment configuration

1. Apply all repository migrations in order. `20260613223600` ignores user-supplied role metadata and assigns `STAFF`; `20260614151553` requires active admins and protects the last admin.
2. In Supabase Auth, disable **Allow new users to sign up**. There is deliberately no public signup or public bootstrap endpoint.
3. Configure the production site URL and exact redirect allowlist entry `https://YOUR_DOMAIN/hub/reset-password`. Use separate project settings for staging. Include the equivalent localhost route only in development. Ensure invitation and recovery email templates preserve Supabase's `ConfirmationURL` / requested redirect.
4. Set the Edge Function secret `APP_URL=https://YOUR_DOMAIN` (origin only; no path, query, credentials, or fragment). Deploy `invite-staff` with JWT verification enabled. It additionally verifies the token with Auth and queries the caller's active admin membership. Service role secrets must remain server-side.
5. Configure a production SMTP provider in Supabase Auth (Resend SMTP is compatible with the proposed mail stack), sender domain, and Auth rate limits. Auth invitations use Supabase Auth's mail transport; they do not use the client communications sender. Test on a nonproduction project with controlled inboxes first.
6. Align the server-side Auth password policy with the form's minimum of 12 characters. Supabase's server policy remains authoritative.

## First administrator: trusted operator only

Use the project dashboard's Auth invitation workflow for the verified owner email, specifying the password setup redirect. Confirm the exact Auth user UUID and corresponding `profiles` row. From the SQL editor, as the trusted database operator, run the following transaction after replacing the placeholder UUID. Do not run this from the browser, create a public RPC for it, or identify the target through editable profile metadata.

```sql
begin;
do $$
declare
  owner_id uuid := 'REPLACE-WITH-VERIFIED-AUTH-USER-UUID';
begin
  if not exists (select 1 from auth.users where id = owner_id) then
    raise exception 'Auth user not found';
  end if;
  if not exists (select 1 from public.profiles where id = owner_id) then
    raise exception 'Staff profile not found; verify migrations';
  end if;
  update public.profiles set role = 'ADMIN', is_active = true where id = owner_id;
  delete from public.user_roles where user_id = owner_id;
  insert into public.user_roles (user_id, role) values (owner_id, 'ADMIN');
end $$;
commit;
```

Record who performed the bootstrap and when in the deployment change record. Sign out and back in after role changes. Once an active admin exists, invite staff and manage roles through **Hub → Admin → Staff**, using the existing authorized RPCs. Invitations always create `STAFF`; the invitation endpoint rejects role, user ID, and redirect fields.

## Acceptance checks before enabling staff mail

- Active admin can invite a controlled test address; non-admin, inactive admin, missing token, malformed input, and unconfigured APP_URL are denied.
- Invitation opens `/hub/reset-password`, saves a password, then enters the hub with STAFF access.
- Password recovery opens the same page. Invalid/expired links show a path back to request another link. Password mismatch, short password, and server policy errors are visible.
- Missing profile or failed roles lookup cannot render the hub. Sign-out while a lookup is pending cannot restore the old user's permissions.
- Role changes and deactivation remain enforced by RLS, including sessions issued before deactivation.
- Check mail-provider logs before retrying an uncertain invitation response to avoid duplicate invitations.

Local policy tests: `node --experimental-strip-types --test tests/auth/invitation-policy.test.ts`.

No production accounts were created and no invitations or recovery emails were sent during implementation. Live Auth redirects, SMTP delivery, and hosted Edge Function behavior still require the staging acceptance checks above.

## References

- [Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Supabase auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Supabase admin invitations](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
