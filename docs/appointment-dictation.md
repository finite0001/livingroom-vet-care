# Recording from an appointment

In Schedule (Day or Week), choose **Open dictation** on the visit. Confirm the patient, species, household, appointment time and location. On the first use, create a blank encounter or explicitly choose an existing unsigned encounter. Then choose **Confirm patient and open dictation**.

The recorder opens within that saved encounter. Enter the dictation source and recording permission, check the patient/permission attestation, and press **Start dictation recording**. Opening an appointment never starts the microphone. Signed-in active staff, including techs and doctors, can prepare the encounter; the actual actor is recorded separately from the scheduled doctor.

Returning through the appointment reopens its linked encounter. A lost confirmation response can be recovered with **Refresh appointment context** and another confirmation. The server serializes confirmations and retains one encounter per appointment; it never selects another visit by date or overwrites SOAP text.

If the appointment changes, refresh and confirm again. Changes to patient, household, scheduled time, clinic/housecall type or address block reuse of the link; review the original encounter through the patient's Medical tab. Cancelled/no-show visits cannot start recording. Completed visits may reopen an existing linked draft. A signed encounter stays read-only. If the saved encounter changes on another device, discard the unused recording controls, reload the latest record and confirm again.

Recording and preview happen locally. Switching apps pauses capture; return and resume deliberately. Keep the page open and preview/download the result before leaving. Phone-sized browser layout is supported; actual iPhone microphone, interruptions and screen-lock behavior still require a device acceptance check. Multi-speaker ambient exam recording is not validated by this workflow.

OpenAI processing remains controlled by the separate practice recording/retention policy and backend activation flag. This feature does not approve Susan's draft policy or enable processing.

## Maintenance

`appointment_clinical_links` is immutable and has RLS with no direct browser/service-role access. Staff RPCs validate the current authenticated actor and live session. Preparation locks schedule → care eligibility → appointment → patient/encounter, checks appointment version, and creates a link only after explicit staff confirmation. New encounter time is the actual preparation time; scheduled time is retained in appointment context. Existing linked or explicitly selected encounter text, date, location, creator and signing state are preserved.

Rollback the UI if needed; retain clinical links and encounter history. Do not delete or relink appointments to repair a historical record. No Edge Function or model contract changes are required for this package.
