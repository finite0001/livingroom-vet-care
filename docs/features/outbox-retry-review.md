# Reviewed outgoing-message retry

The administrator route `/hub/admin/outbox/:id` opens the exact outgoing work selected from Operations. `/hub/admin/outbox` also provides the original administrator's recorded retry history. Opening either route observes metadata only; it does not invoke delivery or a provider.

An eligible preview is limited to failed work without prior provider execution evidence. Administrators review the safe original context, choose the repair actually completed and attest to the exact work snapshot before requesting a retry. Source and recipient checks are authoritative on the server. Eligibility to return work to the queue does not establish final delivery eligibility or successful transmission.

The original action UUID, outgoing ID, work hash, reason and attestation are saved before submission. Missing responses retain that exact request. Recovery runs before retry, and a recorded receipt is accepted independently of the outgoing item's later state. History restores original receipts after the browser pointer is lost. No missing receipt or reversible source-hash change authorizes clearing an uncertain request. Local cleanup requires a strictly newer outbox revision than the separately saved reviewed revision, followed by another exact receipt recovery. The saved revision is not added to the RPC arguments.

The page keeps review drafts and uncertain targets fixed, guards navigation, and clears actor-specific pending storage on account changes or sign-out. Usable message capabilities, private payloads and provider credentials are never stored or rendered. Provider-attempted, accepted, uncertain or otherwise ineligible work remains unavailable in this workflow and requires its separate evidence-based handling.

A recorded retry returns the original work to pending. It does not create a new message, establish non-acceptance by a provider or claim that anything was sent. Actual provider recovery and commercial commissioning remain separate work.
