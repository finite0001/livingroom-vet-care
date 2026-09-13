# Consult-scoped vaccination intake

Active administrators can inspect ezyVet vaccination evidence from **Tools → ezyVet imports → Import source vaccinations**. Select an approved patient mapping, then a current patient-scoped consult. Stale consult observations remain visible but cannot start a new scan.

Each request freezes the mapping and exact consult snapshot, hash and observed revision. The browser stores this context with the UUID before making a page request. Every continuation first recovers that original UUID; an uncertain response never silently creates a replacement. Server scan history also restores the original context after browser storage loss. Session intent pointers are cleared on signout or identity change. One imports-page navigation blocker combines clinical and vaccination pending work, while each panel retains its own patient-selection lock. Cancelling navigation preserves the open workspaces; confirming navigation retains their saved request references.

Each explicit page reads at most ten source objects. A finished consult scan is not a complete patient migration. Source access, permissions, cooldowns and legacy context failures are surfaced without displaying raw server exceptions. Source commissioning remains required.

Read-only candidate inspection displays source product, `date_of_administration`, `date_of_next_administration`, quantity, outside clinician reference, description, notes and active status as raw values. Missing values are explicitly unknown. Full JSON remains available as escaped text. Vaccination freshness and the pinned consult's freshness are displayed independently; a changed consult retains the historical association.

This screen creates no treatments, adopted due dates, certificates, inventory movements, invoice charges or reminders. It contains no clinical-approval controls. Product mapping, date interpretation, clinical adoption and Dr. Edler's approval belong to later work.

## Synthetic verification

Browser coverage verifies lost-response recovery; discovery after local pointer loss; exact UUID retry after disabled access or denied scope; wrong recovered identity rejection; provider cooldown; stale consult source display; escaped raw content; and late consult responses after patient selection changes. All 21 targeted browser tests pass: nine vaccination tests, six unchanged clinical-import tests and six reviewed-history tests. The combined-panel test selects both workspaces, confirms a clean panel cannot override another pending panel, exercises cancel and leave, and checks that no duplicate-blocker warning occurs. The session-retention unit test verifies vaccination pointers follow existing actor/signout rules.

These tests use intercepted synthetic browser responses. They are UI evidence, not authorized production-source acceptance or proof of hosted RPC deployment. Database, actual local Auth/HTTP, contention and restore evidence is maintained in the integration contract.
