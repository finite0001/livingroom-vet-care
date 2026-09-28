# Go-live runbook — September 2026

One owner checklist for everything between the app and a ready state. Steps are in order: each one depends on the steps above it. It covers the ready-state train (integration branch `integration/2026-09-28-ready`): CloudTalk outbound SMS, the CloudTalk unified inbox, vaccine status and catalog, the HHHHHMM quality-of-life scale, anesthesia drug billing, the reminder pipeline, and AgentMail inbound email (with Resend outbound only and the legacy `send-email`/`send-sms` functions retired).

**Owner decision, 2026-09-27:** all text messaging goes through CloudTalk (`+1 720-764-6677`). Twilio code stays in the repository and can still be selected, but it is not used. Don't configure Twilio dashboards, and don't set `SMS_PROVIDER` to `twilio`.

**Owner decision, 2026-09-27 (email):** Resend sends app email (outbound only). An **AgentMail** inbox receives client replies and hands them to the app ([AgentMail inbound](agentmail-inbound.md)). Fastmail stays the staff mailbox provider, and the root MX doesn't change. The legacy `send-email` and `send-sms` functions are retired and must be deleted from both projects (§2).

Rules for every step:

- **Never put a secret value in this repository, a chat, a command line or shell history.** Use `read -rs VAR` for any value the shell needs. Commands below only ever show secret *names*.
- **Projects:** staging is `kothoqicubowyhwfsrte`, primary/production is `mgadheotkdnrsatfivjy`. `ugpyjacqganaqtsiekay` is retained legacy Lovable Cloud and must never be targeted.
- **Order:** staging first, then primary, for every database and Edge step.
- **Evidence:** when a step finishes, record the operator, UTC time, project ref and result in a dated note under `docs/launch-evidence/`.

## 0. Current hosted state (as of 2026-09-27)

| Item | State |
| --- | --- |
| Hosted migrations (both projects) | 152, ending at `20260926090000_cloudtalk_activity` ([CloudTalk activation receipt](launch-evidence/2026-09-26-cloudtalk-activation.md#hosted-deployment-receipt)) |
| Repository migrations after this train | 162. There are **10 pending**: `20260927120000` (contact SMS consent, already on main) plus the 9 from this train (§3). |
| Edge | The explicit 23-function set from 2026-09-26 plus `cloudtalk-webhook` and `cloudtalk-call-media` are deployed ([deployment receipt](launch-evidence/2026-09-26-hosted-repair-deployment.md)). |
| Scheduler | Six cron jobs are installed. The Vault secrets `project_url` and `scheduler_worker_key` are absent, so every job records `configuration_missing` and nothing is called. |
| Delivery | `APP_ENV=staging` and `OUTBOUND_DELIVERY_MODE=disabled` on primary. No provider message or payment has been sent. |
| Backups | Daily physical backups on both projects. No PITR. |

## 1. Merge the train

1. Wait for CI on the PR head SHA to pass: Edge, frontend and database (`supabase test db`).
2. Merge the PR into `main`. This is the owner's decision; agents never merge.
3. Write down the merged SHA. Every later deploy in this runbook must come from that SHA.

## 2. Close the hosted drift from the independent audit

These items come from the [2026-09-25 independent commercial audit](launch-evidence/2026-09-25-independent-commercial-audit.md). C2, the C1 placeholder functions and staging/primary migration parity were repaired on 2026-09-26 ([receipt](launch-evidence/2026-09-26-hosted-repair-deployment.md)). What remains:

- [ ] **C1: functions not deployed.** These local entrypoints are outside the deployed set (the 2026-09-26 set of 23 plus the two CloudTalk functions): `invite-staff`, `invoice-checkout`, `invoice-refund`, `payment-collection`, `payment-status`, `prepare-payment-collection`, `recover-payment-collection`, `verify-payment-reconciliation`, `process-stripe-events`, `stripe-webhook`, `prepare-payment-delivery`, `prepare-document-link`, `recover-document-link`, `retrieve-document-link`, `prepare-release-email`, `prepare-invoice-email`, `prepare-external-record`, `prepare-lab-report`, `capture-ezyvet-attachment`, `retrieve-reviewed-ezyvet-original`, `ezyvet-import`, `send-provider-email`, `suggest-replies`.
  - Check what is live: `supabase functions list --project-ref mgadheotkdnrsatfivjy`.
  - Nine of the ten train functions in §4 are among them (`cloudtalk-webhook` is already deployed and is redeployed in §4). Deploy the rest only when the UI that calls them is enabled (payments in §11, `invite-staff` for staff onboarding). Leave optional ones (`send-provider-email`, `suggest-replies`, ezyVet import) undeployed and shown as unavailable.
- [ ] **Delete the legacy `send-email` and `send-sms` functions from both projects.** Their source is gone from the repository. Production v8 of both still enqueues into `outbound_deliveries`, so they must not stay deployed. Every app caller already uses `enqueue-message` → `communication_outbox` → `dispatch-outbox`, and bulk campaigns stay unavailable.
  1. Check that nothing calls them. Both checks must pass:
     ```sh
     git grep -nE "functions\.invoke\(\s*['\"](send-email|send-sms)['\"]|/functions/v1/(send-email|send-sms)\b" -- src supabase/functions scripts   # expect no output
     node --experimental-strip-types --test tests/delivery/legacy-send-retired.test.ts                                                          # expect pass
     ```
     Then open each function in the dashboard (Edge Functions → `send-email` / `send-sms` → Invocations/Logs) and confirm there have been no invocations since the last frontend deploy. If there have been any, stop and find the caller first.
  2. Delete, staging first:
     ```sh
     npx supabase functions delete send-email --project-ref kothoqicubowyhwfsrte
     npx supabase functions delete send-sms   --project-ref kothoqicubowyhwfsrte
     npx supabase functions delete send-email --project-ref mgadheotkdnrsatfivjy
     npx supabase functions delete send-sms   --project-ref mgadheotkdnrsatfivjy
     ```
  3. Verify: `npx supabase functions list --project-ref <ref>` shows neither slug, and `npm run supabase:functions-inventory` reports `"retiredStillDeployed": []`.
- [ ] **C3: readiness summary trusts stale evidence.** After §3–§4, run `npm run readiness:refresh --silent && npm run readiness:summary -- --fail-on-blockers`. Treat a pass as meaningful only when it names the merged SHA and a green CI run for it.
- [ ] **W2: scheduler routes.** The scheduler targets `dispatch-outbox`, `process-inbound`, `queue-reminders`, `process-stripe-events` and `cleanup-abandoned-attachment`. `process-stripe-events` is not deployed yet (see C1). `dispatch-outbound-deliveries` has no cron job. After this train, the `enqueue_due_appointment_reminders()` path that fed it is retired, so it only settles legacy rows and needs no schedule.
- [ ] **W4: recovery and alerting.** Turn on PITR, or record an explicit decision not to, for `mgadheotkdnrsatfivjy`. Confirm restore access and who receives alerts. Point an external uptime monitor at `https://mgadheotkdnrsatfivjy.supabase.co/functions/v1/health`, which is only a liveness check.
- [ ] **Security follow-up.** Turn on leaked-password protection (Dashboard → Authentication → Passwords). Record a decision on moving `pg_net` out of `public`. Don't bulk-add permissive policies.
- [ ] **Public contact content.** `src/config/practice.ts` still has `null` for phone, email and emergency instructions. The owner must approve the values. The phone can be `+1 720-764-6677` once CloudTalk voice and SMS pass §7. Then run `npm run public:readiness`.

## 3. Apply database migrations (staging, then primary)

These are the 10 pending migrations, applied in this order:

| Version | What it does | Must land before |
| --- | --- | --- |
| `20260927120000_contact_sms_consent` | Records SMS consent from website inquiries (on main already) | the train migrations |
| `20260928100000_cloudtalk_outbound_sms` | Adds the SMS provider setting (`cloudtalk`), the provider-assignment trigger and CloudTalk sender shapes, and adds `outbound_delivery_sms_permitted` | **redeploying `dispatch-outbox`, `dispatch-outbound-deliveries` and `prepare-payment-delivery`**. Functions deployed first would fail pending Twilio-labelled rows as `sms_provider_mismatch`. |
| `20260928110000_cloudtalk_unified_inbox` | Projects CloudTalk texts, calls and voicemail into household threads, adds the review queue and the forgery guard, and backfills events since 2026-09-26 | nothing. No Edge change is needed. |
| `20260928120000_vaccine_catalog_profiles_and_status` | Adds vaccine catalog profiles, `patient_vaccine_status_summary` and the due-soon display window | the frontend |
| `20260928121000_rabies_certificate_serial_number` | Adds a separate rabies vaccine serial number | the frontend and the release-email functions |
| `20260928130000_qol_hhhhhmm_scale` | Adds QOL assessments, addenda and the reference-line setting | the frontend |
| `20260928140000_anesthesia_drug_administrations` | Adds `record_anesthesia_drug_administration` and the append-only link table | the frontend |
| `20260928150000_reminder_pipeline_readiness` | Makes one appointment reminder path, adds email reminder channel choice and per-order lab reminders | **the frontend**. The old `save_patient_lab_order` rejects the new `reminders_enabled` key. |
| `20260928180000_agentmail_inbound` | Adds provider `agentmail` to provider receipts (inbound only, with the signed inbox and message ids required), makes it an EMAIL channel in `complete_inbound_communication`, and lets attachment capture/read/list accept AgentMail rows. The capture lease now names the provider and the signed provider ids. Resend and Twilio rows are unchanged. | **deploying `agentmail-inbound-webhook`, `process-inbound` and `capture-inbound-attachment`** (§4). Without it, AgentMail receipts are refused with 23514 and AgentMail retries them. |
| `20260928160000_cloudtalk_capability_redaction` | Redacts document-link and payment-link capabilities from CloudTalk message bodies and AI summaries at ingest, redacts any already stored (audited in `cloudtalk_capability_redactions`), re-projects the texts they had blocked, and matches app-sent link texts to their outbox row | **enabling live CloudTalk SMS** (§7). Apply it before any document or payment link is texted. Redeploy `cloudtalk-webhook` (§4) right after it. |

```sh
cd ~/Developer/livingroom-vet-care && git switch main && git pull --ff-only
git rev-parse HEAD                      # must equal the merged SHA from §1

# Staging
npx supabase db push --project-ref kothoqicubowyhwfsrte --skip-vault --dry-run
#   expect exactly the 10 files above and nothing else. Stop if the list differs.
npx supabase db push --project-ref kothoqicubowyhwfsrte --skip-vault

# Primary: only after the staging probes below pass
npx supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault --dry-run
npx supabase db push --project-ref mgadheotkdnrsatfivjy --skip-vault
```

Read-only probes to run after each push (SQL editor or `psql "$LRV_DB_URL"`):

```sql
select count(*) from supabase_migrations.schema_migrations;          -- 162
select pg_get_constraintdef(oid) from pg_constraint
 where conname='communication_provider_events_provider_check';         -- lists 'agentmail'
select count(*) from public.cloudtalk_messages
 where body ~ '(v1|p1|s1|e1)\.[A-Za-z0-9_-]{43}';                -- 0
select provider from public.communication_sms_provider_setting;       -- cloudtalk
select to_regclass('public.patient_qol_scale_assessments'),
       to_regclass('public.anesthesia_drug_administrations'),
       to_regclass('public.catalog_vaccine_profiles');                -- all non-null
select column_name from information_schema.columns
 where table_name='patient_lab_orders' and column_name='reminders_enabled'; -- 1 row
```

## 4. Deploy Edge functions from the merged SHA (staging, then primary)

The train changes these function bundles, either directly or through `_shared`. Deploy exactly this list in one command, never a blanket deploy:

| Function | `verify_jwt` | Why |
| --- | --- | --- |
| `dispatch-outbox` | false (worker key) | CloudTalk SMS adapter and provider switch |
| `dispatch-outbound-deliveries` | false (dispatcher token) | CloudTalk adapter and leased-row consent check |
| `prepare-payment-delivery` | true | freezes the CloudTalk sender shape |
| `prepare-document-link` | true | shared payload/outbox modules |
| `recover-document-link` | true | shared payload/outbox modules |
| `retrieve-document-link` | false | shared payload/outbox modules |
| `prepare-invoice-email` | true | shared payload/outbox modules |
| `prepare-release-email` | true | the renderer prints the rabies serial number separately |
| `capture-conversation-email` | true | shared outbox module |
| `cloudtalk-webhook` | false (CloudTalk signature) | redacts document and payment link capabilities before ingest |
| `agentmail-inbound-webhook` | false (Svix signature) | **new**: AgentMail inbound email receipts |
| `process-inbound` | false (worker key) | fetches AgentMail messages into the canonical inbound pipeline |
| `capture-inbound-attachment` | true | captures AgentMail attachments into the private bucket |
| `read-inbound-attachment` | true | shared inbound modules |
| `resend-delivery-webhook` | false (Svix signature) | the only Resend endpoint now: canonical outbox receipts plus legacy fallback, **own secret `RESEND_DELIVERY_WEBHOOK_SECRET`** |
| `resend-webhook` | false | now an inert 410 stub (Resend receiving retired) |
| `enqueue-message` | true | shared delivery policy (Reply-To resolver) |
| `cleanup-abandoned-attachment`, `verify-conversation-attachment` | as configured | shared attachment modules; no behavior change |

```sh
F="dispatch-outbox dispatch-outbound-deliveries prepare-payment-delivery prepare-document-link recover-document-link retrieve-document-link prepare-invoice-email prepare-release-email capture-conversation-email cloudtalk-webhook agentmail-inbound-webhook process-inbound capture-inbound-attachment read-inbound-attachment resend-delivery-webhook resend-webhook enqueue-message cleanup-abandoned-attachment verify-conversation-attachment"
npx supabase functions deploy $F --project-ref kothoqicubowyhwfsrte
npx supabase functions list --project-ref kothoqicubowyhwfsrte   # check the JWT column against the table
# then the same two commands with --project-ref mgadheotkdnrsatfivjy
```

The CLI reads `verify_jwt` from `supabase/config.toml`. Check every row against the table above. The 2026-09-26 deploy once kept a stale flag, so don't assume it's right. `twilio-webhook` also imports the changed shared inbound module but is a legacy slug; leave it as is. Never deploy `send-email` or `send-sms` (§2).

## 5. Frontend

1. Vercel builds production from the merged `main` with `npm run build:deployment`. Deploy only **after §3 on primary**.
2. The browser allowlist has **six** `VITE_` names (`docs/deployment-environment.md`). Leave `VITE_CLOUDTALK_ENABLED` unset or `false` until §7 step 6.
3. Smoke test `https://thelivingroom.vet/hub`: sign in, open a patient, and check that the vaccine status card, QOL card and anesthesia drug panel render.

## 6. Server secrets (Supabase → Edge Functions → Secrets)

Set these **names** in each project. Values go in only through the dashboard or `supabase secrets set --env-file <file outside the repo>`, and the file is deleted afterwards.

| Secret | Value shape | Needed by |
| --- | --- | --- |
| `APP_ENV` | `staging` on staging. On primary, stays `staging` until §10, then `production`. | every outbound-capable function |
| `OUTBOUND_DELIVERY_MODE` | `disabled` (the current state); `test` only during §7/§8; `live` only in §10 | same |
| `OUTBOUND_TEST_PHONES` / `OUTBOUND_TEST_EMAILS` | the owner's own E.164 mobile / mailbox, exact | test mode |
| `SMS_PROVIDER` | `cloudtalk`. **Never set it blank or to any other value**, or both SMS workers return 503. | `dispatch-outbox`, `dispatch-outbound-deliveries`, `prepare-payment-delivery` |
| `CLOUDTALK_API_KEY_ID`, `CLOUDTALK_API_KEY_SECRET` | CloudTalk API key pair (already set for webhook and call media; confirm) | SMS send, call media |
| `CLOUDTALK_ALLOWED_NUMBERS` | `+17207646677`, exact E.164, no spaces or dashes | webhook and SMS sender |
| `CLOUDTALK_SMS_SENDER` | `+17207646677` (optional while there is one number) | SMS sender |
| `CLOUDTALK_WEBHOOK_SECRET` | the signing secret of that project's CloudTalk webhook endpoint | `cloudtalk-webhook` |
| `OUTBOUND_DISPATCHER_TOKEN` | a long random token | `dispatch-outbound-deliveries` |
| `SUPABASE_SECRET_KEYS` | must include the `sb_secret_` key used as `scheduler_worker_key` (§9) | all workers |
| `REMINDER_SCHEDULER_ENABLED` | `true` only in §9, after C-PILOT-08 | `queue-reminders` (also needs `APP_ENV` of `staging` or `production`) |
| `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_DELIVERY_WEBHOOK_SECRET`, (`RESEND_AUTH_FROM_ADDRESS` optional) | see §8 | outbound email and its delivery webhook |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET`, `AGENTMAIL_INBOX_ID`, `AGENTMAIL_INBOX_ADDRESS` | see §8 | inbound email. `AGENTMAIL_INBOX_ADDRESS` is also the Reply-To on every app email, and live sends fail closed without it. |
| Retired: `RESEND_WEBHOOK_SECRET`, `RESEND_INBOUND_ADDRESSES`, `RESEND_REPLY_TO` | unset after §8. If `RESEND_REPLY_TO` stays set, it must equal `AGENTMAIL_INBOX_ADDRESS`, otherwise every email send fails closed. | — |
| Stripe and payment-link secrets | see §11 | payments |

Confirm afterwards with `npx supabase secrets list --project-ref <ref>`. It lists names and digests only.

## 7. CloudTalk SMS and inbox commissioning

1. [ ] **A2P 10DLC approval.** Wait for CloudTalk to approve the A2P 10DLC registration, and confirm in CloudTalk that `+1 720-764-6677` is SMS-enabled. Don't send anything before approval, because carriers filter unregistered traffic.
2. [ ] **CloudTalk webhook** (if not already done). In CloudTalk → Account → Webhooks, add `https://<ref>.supabase.co/functions/v1/cloudtalk-webhook` with only `call.ended`, `call.recording_ready`, `transcript.ready`, `cidata.ready`, `message.sent` and `message.received`. Save that endpoint's signing secret as `CLOUDTALK_WEBHOOK_SECRET`. Send a test event and confirm HTTP 200 in the delivery log.
3. [ ] **Controlled one-message test on staging**, to the owner's phone only, following [the CloudTalk outbound SMS note](launch-evidence/2026-09-28-cloudtalk-outbound-sms.md#owner-steps):
   1. Start with `OUTBOUND_DELIVERY_MODE=disabled`. Create a synthetic household whose primary phone is the owner's mobile, and record SMS consent for it.
   2. Set `OUTBOUND_TEST_PHONES=<owner mobile>` and then `OUTBOUND_DELIVERY_MODE=test`.
   3. Queue one short SMS from `/hub/chats`. Invoke the worker once, without enabling the scheduler:
      ```sh
      read -rs LRV_WORKER_KEY   # an sb_secret_ key listed in SUPABASE_SECRET_KEYS
      curl -sS -X POST "https://kothoqicubowyhwfsrte.supabase.co/functions/v1/dispatch-outbox" \
        -H "apikey: $LRV_WORKER_KEY" -H "Content-Type: application/json" -d '{}'
      unset LRV_WORKER_KEY
      ```
      The worker accepts the managed secret key only in the `apikey` header (`docs/service-worker-authentication.md`).
   4. Expect the outbox row to be `accepted`, with `provider=cloudtalk`, `provider_config={"from":"+17207646677","provider":"cloudtalk"}` and `provider_message_id=local-accepted:<id>`. The phone should receive the text, and a `message.sent` row should appear in `cloudtalk_messages`. **The thread shows the message once, not twice** (inbox echo absorption).
   5. Reply `STOP`. `communication_suppressions` should gain the number. A second queued SMS should either be refused at enqueue or end `failed` without a CloudTalk request.
   6. Set `OUTBOUND_DELIVERY_MODE=disabled` again and record the evidence.
4. [ ] **Inbox live check.** Text in from a household's primary phone and from an unknown number. Make a missed call, leave a voicemail and send a text from CloudTalk Phone. The expected results are the household thread, `/hub/inbox/review`, *Missed*/*Voicemail* labels and a "Sent from CloudTalk Phone" entry. Confirm that staff can't play recordings and administrators can. Confirm that live `call.ended` includes `talking_time`, numbers with a leading `+`, and timestamps with an offset.
5. [ ] Repeat steps 3–4 on primary only if the owner wants production evidence before §10. Otherwise primary is first exercised at go-live.
6. [ ] **`VITE_CLOUDTALK_ENABLED=true`.** Set it in Vercel Production after steps 3–4 pass, then redeploy the frontend. This shows `/hub/call`, where projection failures are listed.

## 8. Email: Resend outbound, AgentMail inbound

Full contract, options and documentation citations: [AgentMail inbound](agentmail-inbound.md).

1. [ ] **Resend sender.** The sending domain is verified in Resend (done). Set `RESEND_FROM` on that domain.
2. [ ] **Resend delivery and status webhook.** In Resend → Webhooks, keep **one** endpoint, `https://<ref>.supabase.co/functions/v1/resend-delivery-webhook`, with only `email.delivered`, `email.bounced`, `email.complained` and `email.failed` (not `email.received`). Save that endpoint's signing secret as `RESEND_DELIVERY_WEBHOOK_SECRET`. Delete any Resend endpoint that points at `resend-webhook`. Once the new secret is set, unset `RESEND_WEBHOOK_SECRET` and `RESEND_INBOUND_ADDRESSES`. Don't configure Resend receiving or any Resend MX for receiving.
3. [ ] **AgentMail receiving address.** Recommended: add the custom domain `reply.thelivingroom.vet` in AgentMail and publish its generated MX, SPF and DKIM records in GoDaddy, **only on the `reply` subdomain**. The root MX stays on Fastmail. Wait for Verified, then create the inbox `care@reply.thelivingroom.vet`. (For a quick first test before DNS is ready, an AgentMail-hosted `…@agentmail.to` inbox works. Don't forward Fastmail `care@` into AgentMail without a separate test; see the options table in the doc.)
4. [ ] **AgentMail webhook.** Create a webhook scoped to that inbox (`inbox_ids`) with only `message.received`, at `https://<ref>.supabase.co/functions/v1/agentmail-inbound-webhook`. Copy its `whsec_…` secret.
5. [ ] **AgentMail secrets.** Set `AGENTMAIL_WEBHOOK_SECRET`, `AGENTMAIL_API_KEY` (least privilege for reading that inbox), `AGENTMAIL_INBOX_ID` (exactly as the webhook payload reports it) and `AGENTMAIL_INBOX_ADDRESS` (the bare inbox address). Unset `RESEND_REPLY_TO`, or set it to the same address. Then send AgentMail's test event, or one real email, and confirm HTTP 204 (or 202 for an ignored type) in the AgentMail delivery log.
6. [ ] **Controlled round trip** in `OUTBOUND_DELIVERY_MODE=test`, with `OUTBOUND_TEST_EMAILS=<owner's own mailbox>` and a synthetic household whose primary email is that mailbox:
   1. Queue one email from `/hub/chats` and run `dispatch-outbox` once (same `curl` as §7 step 3). The received email must show `Reply-To: care@reply.thelivingroom.vet`.
   2. Reply from the owner's mailbox. Run `process-inbound` once:
      ```sh
      read -rs LRV_WORKER_KEY
      curl -sS -X POST "https://kothoqicubowyhwfsrte.supabase.co/functions/v1/process-inbound" \
        -H "apikey: $LRV_WORKER_KEY" -H "Content-Type: application/json" -d '{}'
      unset LRV_WORKER_KEY
      ```
      The reply must appear **in the same thread** in `/hub/chats`. `communication_inbound` should have one `provider='agentmail'` row with `client_id` and `conversation_id` set.
   3. Reply again with a small PDF. Capture it from the thread (this needs `INBOUND_ATTACHMENT_CAPTURE_ENABLED=true` on `capture-inbound-attachment`), open it, and confirm a SHA-256 is shown.
   4. Email the inbox from an address that isn't on file. The message must land in `/hub/inbox/review`.
   5. Confirm the Resend delivery receipt reached the outbox (`delivered`), then set `OUTBOUND_DELIVERY_MODE=disabled` again and record the evidence. Note what AgentMail's attachment endpoint returned (JSON or raw bytes) and the `download_url` host. These are unverified items in the doc.
7. [ ] Supabase Auth SMTP: configure the sender and test invite and recovery on staging. Signup stays disabled. If `RESEND_AUTH_FROM_ADDRESS` is set, it must differ from `RESEND_FROM` and from `AGENTMAIL_INBOX_ADDRESS`; otherwise the delivery webhook returns 503.

## 9. Scheduler (after §4, §6 and C-PILOT-08)

Follow [scheduler commissioning](scheduler.md):

```sh
read -rs LRV_DB_URL                    # session pooler URL for the project
read -r  LRV_PROJECT_URL               # https://<ref>.supabase.co  (no trailing slash)
read -rs LRV_SCHEDULER_WORKER_KEY      # sb_secret_... listed in SUPABASE_SECRET_KEYS
export LRV_DB_URL LRV_PROJECT_URL LRV_SCHEDULER_WORKER_KEY
LRV_DRY_RUN=1 psql "$LRV_DB_URL" -X -f scripts/scheduler/commission-vault-secrets.sql
psql "$LRV_DB_URL" -X -f scripts/scheduler/commission-vault-secrets.sql
psql "$LRV_DB_URL" -X -f scripts/scheduler/verify-scheduler.sql     # read-only
unset LRV_SCHEDULER_WORKER_KEY LRV_DB_URL
```

- Expect `ok`/2xx within two minutes for the one-minute jobs. `process-stripe-events` returns 404 until it is deployed.
- Then set `REMINDER_SCHEDULER_ENABLED=true`, and enable the reviewed reminder policies (SMS, and EMAIL for email-preferring households) in the admin reminder settings.
- **Kill switch:** `delete from vault.secrets where name in ('project_url','scheduler_worker_key');`

## 10. Live outbound (primary; separate owner go decision)

Prerequisites: §7 staging test evidence, §8 email round-trip evidence (AgentMail reply threaded), §9 verified, and C-PILOT-08 accepted. `AGENTMAIL_INBOX_ADDRESS` must be set on primary: in `live` mode every email send fails closed without it.

1. `APP_ENV=production`. `live` is refused for any other value.
2. `OUTBOUND_DELIVERY_MODE=live`.
3. Watch `/hub/admin/operations` and the first real reminder batch. To roll back, set `OUTBOUND_DELIVERY_MODE=disabled`.

## 11. Stripe and payment links (after a full test payment and refund)

Every switch defaults to off. In **test mode** (`STRIPE_LIVEMODE=false`, test keys), on staging:

1. Set `STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_ID`, `STRIPE_LIVEMODE=false`, `STRIPE_RETURN_ORIGIN=https://thelivingroom.vet`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_ACCESS_ORIGIN`, `PAYMENT_ACCESS_ACTIVE_KEY_VERSION` and `PAYMENT_ACCESS_KEYS`.
2. Deploy the payment functions if they are missing (§2 C1): `invoice-checkout`, `invoice-refund`, `payment-collection`, `payment-status`, `prepare-payment-collection`, `recover-payment-collection`, `verify-payment-reconciliation`, `process-stripe-events` and `stripe-webhook`.
3. Register the Stripe webhook at `https://<ref>.supabase.co/functions/v1/stripe-webhook`.
4. Turn on, in order: `STRIPE_WEBHOOK_ENABLED`, `STRIPE_EVENT_PROCESSING_ENABLED`, `STRIPE_PAYMENTS_ENABLED`, `STRIPE_COLLECTIONS_ENABLED`, `PAYMENT_COLLECTION_ENABLED`, `PAYMENT_STATUS_ENABLED`, `PAYMENT_DELIVERY_STAFF_ENABLED` and `STRIPE_REFUNDS_ENABLED`, plus `STRIPE_RECONCILIATION_ENABLED` for admin reconciliation.
5. Run one full round trip: invoice → payment link by SMS (CloudTalk, test mode) → test card payment → webhook → paid status → **refund** → reconciliation. Record the evidence.
6. Only then, on primary, repeat with live keys and `STRIPE_LIVEMODE=true`. This needs C-PILOT-07 accepted and an explicit owner go.

## 12. Clinical sign-offs — Dr. Susan Edler

These are the pending decisions in `docs/clinical-staff-acceptance-register.json`. Each one is recorded by a named human. Don't infer or model-generate any of them.

| ID | Review area | What it unlocks |
| --- | --- | --- |
| C-PILOT-01 | SOAP, signing and addenda for housecall visits | clinical charting on real patients |
| C-PILOT-02 | Serious alerts and critical-history display | relying on the alert banners and treatment alert review |
| C-PILOT-03 | Vaccine and treatment administration records | recording real administrations |
| C-PILOT-04 | Preventive due, overdue, unknown, suppressed and completed states | preventive due plans and vaccine reminders |
| C-PILOT-05 | General vaccine and rabies certificate templates | activating a `certificate_issuers` row (below) |
| C-PILOT-06 | Record-release selection and client disclosure | inserting `record_release_policy` (below) and record-release email |
| C-PILOT-07 | Invoice and payment wording, refunds, voids, credits (owner) | Stripe live mode (§11 step 6) |
| C-PILOT-08 | Reminder wording and delivery labels, **email appointment reminder subject and body**, when to turn on **per-order lab reminders** | enabling reminder policies, `REMINDER_SCHEDULER_ENABLED`, live outbound (§9–§10) |
| C-PILOT-09 | HHHHHMM QOL scale: wording, Villalobos citation, sign and addendum policy, optional reference line | clinical use of the QOL card. The reference line stays off unless she specifies a total and wording, which an ADMIN then enters. |
| C-VACCINE-01 | Vaccine status summary: which date wins, source labels, due-soon window | relying on the status card. Save a window in Settings → Vaccine status display, or accept the 30-day display default. |
| C-VACCINE-02 | Vaccine catalog metadata, due-date pre-fill, separate rabies serial field | the catalog profiles (none are seeded; she enters or approves each product under Inventory → Edit) and the pre-fill button |
| C-PILOT-ANES-01 | Anesthesia drugs charged from stock, lock after signing, correction path | charging anesthesia drugs from the record. **Separately decide whether controlled drugs need a DEA log module** before any controlled anesthetic is recorded; this feature is not a DEA log. |

The staff acceptance run (S-PILOT-01…) also needs operator, date, frontend URL and deployed SHA filled in.

### Certificate issuer and record-release policy (trusted operator SQL, after C-PILOT-05 / C-PILOT-06)

There is no RPC for these tables. A trusted database operator runs the SQL in the dashboard SQL editor on primary. Use real, verified values only: look up Dr. Edler's Colorado license in the DORA license lookup and record it as the verification reference. Never enter placeholders.

```sql
-- after verifying the current Colorado license (DORA) and recording Dr. Edler's acceptance of C-PILOT-05
insert into public.certificate_issuers
  (user_id, full_name, license_number, license_state, license_expires_on,
   practice_name, practice_address, practice_phone,
   verified_at, verification_reference, clinical_acceptance_at, active)
values ('<Dr. Edler auth.users id>', '<exact legal name>', '<CO license #>', 'CO', '<expiry date>',
        '<practice name>', '<practice address>', '<practice phone>',
        now(), '<DORA lookup reference/date>', '<acceptance timestamp>', true);

-- after C-PILOT-06; accepted_schema_version must match the release panel (currently 13)
insert into public.record_release_policy (enabled, accepted_by, accepted_at, acceptance_reference, accepted_schema_version)
values (true, 'Dr. Susan Edler', '<acceptance timestamp>', '<where the signed acceptance is recorded>', 13);
```

Both tables are audited. To revoke, set `active=false` (issuer) or `enabled=false` (policy).

## 13. Known open items carried by this train

- CloudTalk returns no message ID. Accepted SMS rows store `local-accepted:<id>` and never reach `delivered`. The inbox matches app-sent texts to `message.sent` echoes heuristically (same number and exact text, from 1 hour before to 10 minutes after).
- Document-link texts sent through CloudTalk echo back with the link token in them. The projection guard rejects them and records a failure that Retry can't clear. The token text is also stored in `cloudtalk_messages` (from the 2026-09-26 migration).
- Payment-link captures made with a Twilio sender before the switch can't be sent. Staff prepare a new request. This is likely zero rows.
- In `dispatch-outbound-deliveries`, a database error from the consent check marks the row `UNKNOWN` even though nothing was sent, so it needs a manual resend.
- A reminder's channel is fixed when the appointment is saved. After a household changes its preferred channel, re-save the appointment to switch it.
- Lab care jobs that are still queued when `20260928150000` lands are blocked at the final check. Re-queue them.
- `tests/payment-access/delivery-local-roundtrip.ts` (a manual script) still uses Twilio sender shapes.
- AgentMail items that are unverified until the §8 round trip: the Get Attachment response shape (JSON vs raw bytes), the CDN host, the exact `message_id`/`inbox_id` forms, and whether forwarded mail passes AgentMail's authentication filter. See [AgentMail inbound](agentmail-inbound.md#unverified-isolated-in-_sharedinboundagentmailts-confirm-in-the-controlled-test).
- A client's first reply to an app email is threaded by household (one active conversation), not by the outbound Message-ID, because outbound RFC Message-IDs are not recorded yet.
- `b1_scheduler.test.sql` #11 and #13 fail on the long-lived local container because of accumulated `configuration_missing` receipts. They fail the same way without this train, and a fresh CI database is unaffected.
