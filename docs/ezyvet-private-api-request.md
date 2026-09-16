# ezyVet API questions — owner-managed correspondence

Update, September 15, 2026: Dr. Edler received a response confirming that the additional application needs a new API registration and credentials. The quoted $500 one-time setup includes read/write access; integration development and maintenance are our responsibility. The owner now prefers two-way access and is comfortable with the $500 setup; no agreement has been accepted and runtime writes remain disabled. The owner subsequently authorized temporary continued use of the existing credentials while they coordinate with the vendor; preserve the current setup and read-only scope. Keep imports disabled between bounded acceptance checks. The questions below are historical correspondence, not an unsent current inquiry. See [the current handoff decision](ezyvet-existing-connection-handoff.md).

Status: Representative response received through the owner. Dr. Susan Edler manages correspondence; do not send messages from Codex. No service, agreement or fee accepted.

Subject: Clarification of existing API access and setup options

Hello,

We currently use an API integration to bring read-only information from our ezyVet site, **greentree.usw2.ezyvet.com**, into our own internal application. We are developing another internal application and would like to clarify our options.

- Can we use our existing API registration and credentials for the additional application, or would it require a separate integration?
- Does the advertised **$500 setup fee** include two-way access—both reading information from ezyVet and writing updates back—or is it limited to read-only access?
- If two-way access requires additional setup, approval or recurring fees, what would those requirements and costs be?
- Where can we obtain the partner ID associated with our existing integration?

Please leave our current integration unchanged. We are requesting clarification only and are not authorizing a new service or charge.

Thank you.

## Historical implementation decision — superseded by the update above

The owner instructed us to continue building on the premise that read-only access will be available. Living Room Vet remains the primary record system; ezyVet is an import source. No write-back synchronization is planned or required for current development. The representative’s response may inform a later scope decision, but does not block local implementation of read-only intake, review and reconciliation. Live connection validation and sample acceptance remain pending.

## Latest follow-up draft — not sent

The owner asked to omit SMS/payment questions from this email. That editorial choice does not establish an exception to provider terms. Keep broader agreement review separate from the concise correspondence.

Hi [Name],

Thanks for the documentation—it’s helpful.

My husband and I are building a custom internal workflow application for our practice. We’d like to connect it with ezyVet to reduce duplicate entry and exchange selected clinical and administrative information.

We’re comfortable with the $500 setup for a separate two-way integration and would like to keep our existing integration unchanged.

One clarification: the documentation mentions a $50-per-location monthly fee for write-back. Would that apply in addition to the $500 setup under the arrangement you described?

Please send the applicable agreement and next steps.

Thanks!
Susan
