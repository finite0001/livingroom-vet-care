# Clinic and housecall scheduling

The schedule supports a day or seven-day view in America/Denver. Staff book a household's patient, assigned staff member, duration, visit reason, location, address snapshot, optional shared resource, travel buffers and reminder offsets. Clinic visits use 2619 Spruce Street, Boulder, CO. Housecalls can open their destination in Google Maps. Assignment means an active staff account; it does not certify clinical credentials.

Household searches return at most 50 name matches and retain the selected household outside the search results. Patients are loaded for the selected household. Important historical problems and legacy allergy text appear during booking; unavailable alert data prevents saving until retried.

`save_appointment` authenticates the actor and serializes schedule writes with a transaction lock. It checks patient/household membership, active assignments, durations and overlap (including travel buffers and shared resources). Edits require the expected version; conflicts retain the editor's draft. Audit events preserve changes. Archived or deceased patients cannot receive new bookings; existing appointments can still be canceled.

Each saved revision invalidates pending reminders for the previous revision and creates jobs for the selected offsets (default 48 and 24 hours). Offsets already in the past are skipped. Cancellation and patient inactivity invalidate pending jobs. These jobs are not evidence of delivery: a durable dispatcher, consent/suppression rules and provider acceptance are separate work. Staff cannot write a sent status directly.

Validation includes 19 SQL assertions, three time/reminder unit tests and a browser scenario covering housecall details, alerts, conflict draft retention and selected patient retention after a new household search. Browser calls are mocked. Recurring availability, hosted booking acceptance and actual reminder delivery remain commercial-readiness gates.
