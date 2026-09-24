# Owner action checklist for public launch

Last updated: 2026-09-23.

This checklist records the remaining actions that require owner, registrar, or practice-policy authority. The application, hosted Supabase operating loop, Hub readiness, Vercel Production deployment, and release-control evidence are otherwise prepared for final verification.

## 1. DNS at GoDaddy — completed 2026-09-23

Current DNS now points at Vercel:

| Host/name | Type | Current value |
| --- | --- | --- |
| `@` | `A` | `216.150.1.1` |
| `@` | `A` | `216.150.16.1` |
| `www` | `CNAME` | `1115926f442091d7.vercel-dns-016.com.` |

Do not add browser secrets or service-role/provider credentials to DNS or Vercel public environment variables.

Verification completed:

- `dig +short A thelivingroom.vet` returned `216.150.1.1` and `216.150.16.1`.
- `dig +short CNAME www.thelivingroom.vet` returned `1115926f442091d7.vercel-dns-016.com.`.
- Vercel domain verification returned `configured_correctly` for both `thelivingroom.vet` and `www.thelivingroom.vet`.
- HTTP served the Vercel site on both custom domains immediately. HTTPS returned an SSL handshake error during the same run, so re-run an HTTPS smoke check after Vercel certificate provisioning catches up.

## 2. Confirm public contact content

Do not publish guessed phone, email, hours, or emergency instructions. The public site intentionally blocks launch while these values are `null` in `src/config/practice.ts`.

Owner-approved values needed:

| Field | Required decision |
| --- | --- |
| Practice phone | Public phone number to display and link with `tel:`. |
| Practice email | Public monitored mailbox to display and link with `mailto:`. |
| Emergency instructions | Public urgent/emergency phone/contact wording. Avoid implying this practice monitors emergencies unless that is operationally true. |
| Opening hours | Public hours or explicit launch/pre-opening availability wording. |

After owner approval, update `src/config/practice.ts`, then run:

```bash
npm run public:readiness
npm run readiness:refresh
```

Expected result: public website gate has zero blockers.

## 3. Provider/dashboard follow-up before live messaging

The launch-critical Supabase functions are deployed and the former conflict slugs now return disabled HTTP 410 responses. Before live provider use:

- Resend delivery webhook should point to `resend-delivery-webhook`.
- Twilio status callback should point to `twilio-message-status-callback`.
- Twilio inbound SMS webhook should point to `twilio-inbound-sms`.
- Legacy endpoints `dispatch-outbox`, `enqueue-message`, `process-inbound`, `public-contact`, `queue-reminders`, `resend-webhook`, and `twilio-webhook` should not be configured in provider dashboards or schedulers.

Keep `OUTBOUND_DELIVERY_MODE=disabled` until explicit provider round-trip tests are approved.
