# Reminder delivery policy controls

The administrator section of **Care reminders** provides six independent policy slots: appointment, vaccine and lab reminders, each by email or text. Staff can review the exact active wording, email subject and scheduling behavior before saving a policy. New policies default off. No wording or clinical interval is supplied by this panel.

The existing scheduler remains separately disabled until its environment and provider configuration are commissioned. Saving a policy does not invoke an Edge Function or send a message. The provider preflight checks enabled policy, reviewed versions, active approving staff, current source/household and communication eligibility again before every attempt. A provider-accepted message cannot be recalled by turning a policy off.

## Versioning and recovery

Policy source and channel remain immutable, with one policy per slot. Writes use the authenticated administrator from the server session and an expected policy version. An unchanged retry returns the saved revision; a changed stale request cannot overwrite it. A failed response retains the draft and stable policy ID. Reload explicitly replaces the draft with the saved slot. On a full page reload, the six slot queries recover the current saved policies rather than creating another policy. Unsaved delivery settings and clinical-template settings participate independently in the page's navigation guard.

Turning an existing policy off uses `disable_reminder_automation_policy`. This retains its last reviewed wording and subject, records the administrator's reason and creates immutable history. It deliberately does not require the referenced wording template to still be active: retiring wording must never prevent stopping a policy. Re-enabling or revising wording still uses the original current-template validation.

## Validation and commissioning

The additive migration has 14 SQL assertions for retired-template disabling, actor permissions, immutable wording references, replay without duplicate history and stale-request rejection. Mounted browser coverage verifies selection, retries, conflicts, disabling and draft guards. Real clinical wording approval, authorized staff acceptance, scheduler provisioning and controlled provider delivery remain commissioning gates.
