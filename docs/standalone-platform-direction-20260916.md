# Standalone Living Room Vet platform

Owner direction: finish the current local operational-decision phase, then develop Living Room Vet as an independent practice-management platform. ezyVet is a reference for functionality, not an ongoing system dependency. Incorporate Vet Connect Hub's communications capabilities into the native platform using the approved Fastmail and Resend direction.

The original requirements remain in scope: clinic and housecall scheduling; client/patient records; SOAP and highlighted diagnoses; vaccines and due dates; certificates; lab records; configurable reminders; selected record delivery; inventory, lots and expiration dates; billing and payments; dental, anesthesia, QOL and body maps; and a unified inbox. The clinic remains the home base. The broader ezyVet feature-parity audit supplements that list.

## Work order after the current phase

1. Compare the current Living Room Vet and Vet Connect Hub code with authorized ezyVet workflow inspection and public documentation. Use existing authorized API access only for bounded read-only feature discovery where useful. API endpoints alone do not establish complete feature coverage.
2. Produce a feature matrix: native implementation, actual validation evidence, missing behavior, external provider dependency and acceptance needed. Include end-to-end staff workflows, not only screens or database tables.
3. Identify ezyVet dependencies in routes, schemas, configuration, jobs, operations and launch checklists. Plan their retirement from the normal product workflow while preserving records and historical evidence. No new ezyVet registration, synchronization, write-back or migration-report work is planned.
4. Implement native gaps and integrate communications features in dependent PRs. Keep feature parity distinct from a claim of commercial readiness until the complete hosted staff workflow and clinical review are verified.

The approved non-ezyVet providers remain relevant: Supabase/Vercel, Fastmail/Resend, the dedicated practice Stripe account and Antech. Anesthesia provider choice remains open. Stripe secret setup remains deferred by the owner while software work continues.

This decision changes the integration roadmap; it does not itself prove feature parity, authorize provider purchases or change the existing ezyVet account configuration.
