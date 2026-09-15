# Hosted pilot rehearsal — September 15, 2026

Performed through the signed-in administrator browser on the stable protected staging frontend, project `kothoqicubowyhwfsrte`. No patient records from ezyVet or production were imported. All created records are explicitly labeled PILOT TEST and retained for continuing acceptance.

## Verified

- Created household `db470847-1455-4aa2-aca8-02d6e1cdb32b`, PILOT TEST Household 20260915, and dog `c55ed129-d449-474e-a22b-7c190c84048a`, PILOT TEST Scout. Phone and email are absent.
- Saved housecall `b2cf6d5a-fd68-4c89-a463-8d74c0a66761` for the same patient and administrator. September15 09:00 America/Denver persisted as15:00 UTC. Status SCHEDULED. Saved address uses the clinic base plus a staging label. Reminder offsets were cleared and verified as an empty array in the database.
- Created service PILOT TEST — Housecall rehearsal at USD1.00 per visit. Services correctly stay outside stock-receipt choices.
- Created invoice `1b1e5c16-1241-4717-b5fc-970a298f191f`, added one patient-linked service charge and issued revision3 at USD1.00. UI confirms issuance and exactly one line item. No payment, refund or outgoing client message was attempted.
- Patient chart loads the existing clinical modules. No clinical signoff or form acceptance was recorded.

## Blocking and follow-up findings

- Staging has no payment-provider profile. Invoice UI states Stripe setup is required. Both available Stripe connectors reject OAuth authorization; the account-management tool also cannot produce a reconnection link. Reconnect the Living Room Vet sandbox in Codex Apps before configuring the exact account and running payment/refund acceptance.
- The initial administrator has no display name. Staff Management falls back to an ID, but scheduling renders a blank assigned-staff option and blank appointment staff line. Add a readable fallback and complete the owner's profile before staff rehearsal.
- PR134 remains open, not merged. Hosted scheduling therefore does not include its newer day-route interface. Staging remains at99 migrations; the candidate has110. These observations do not establish release parity.
- Real service pricing, inventory lots, clinician identities, clinical review, client transport and appointment-reminder commissioning remain open. This checkpoint verifies client → patient → housecall and service → invoice paths; it does not verify a completed clinical visit, payment or receipt delivery.
