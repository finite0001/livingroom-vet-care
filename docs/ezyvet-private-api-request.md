# ezyVet API questions — owner-managed correspondence

Update: existing credentials have now passed read-only OAuth and a contact read without a partner ID. Any partner-ID/authentication question in this earlier draft is resolved; Dr. Edler’s inquiry about two-way capabilities and the setup fee remains separate.

Status: Dr. Susan Edler will send the questions to her ezyVet representative. Do not send this draft from Codex. No service, agreement or fee accepted.

Subject: Clarification of existing API access and setup options

Hello,

We currently use an API integration to bring read-only information from our ezyVet site, **greentree.usw2.ezyvet.com**, into our own internal application. We are developing another internal application and would like to clarify our options.

- Can we use our existing API registration and credentials for the additional application, or would it require a separate integration?
- Does the advertised **$500 setup fee** include two-way access—both reading information from ezyVet and writing updates back—or is it limited to read-only access?
- If two-way access requires additional setup, approval or recurring fees, what would those requirements and costs be?
- Where can we obtain the partner ID associated with our existing integration?

Please leave our current integration unchanged. We are requesting clarification only and are not authorizing a new service or charge.

Thank you.

## Implementation decision

The owner instructed us to continue building on the premise that read-only access will be available. Living Room Vet remains the primary record system; ezyVet is an import source. No write-back synchronization is planned or required for current development. The representative’s response may inform a later scope decision, but does not block local implementation of read-only intake, review and reconciliation. Live connection validation and sample acceptance remain pending.
