# Planning review evidence

Source revision: `50a27d7`. Three read-only audits inspected native refill UI, clinical roles/alerts, inventory/billing, historical prescription release and test contracts. No provider access, patient data, configuration changes or tests occurred in this planning pass.

Findings incorporated:

- Existing refill statuses/browser timestamps do not confer prescribing authority; preserve legacy records and close direct transition bypasses.
- General SOAP signing is active-staff authorized. Native prescribing must require configured DVM authority; ADMIN alone does not suffice.
- Actual treatment lock order includes the later alert-review patch: patient SHARE precedes invoice UPDATE. Preserve modes and inspect all shared writers rather than relying on the original migration alone.
- Separate initial/refill slots from partial quantities, and preserve exact uncertain-request recovery.
- Cancellation, clinical correction, physical returns, credits and refunds remain separate attributed events.
- Freeze external versus practice-stock fulfillment mode; prohibit local fills against external authorizations and require explicit replacement/reconciliation for a mode change.
- Native prescriptions and fills require a separate release section; signing must never appear as administration.

The final bounded database review found no further blocking design errors after the locking/mode corrections. This is a planning review, not code, clinical, regulatory or launch acceptance. Implementation must verify the complete acceptance checklist against actual SQL, UI, provider artifacts and restore behavior.
