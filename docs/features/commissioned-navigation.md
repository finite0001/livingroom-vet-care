# Staff navigation and unavailable legacy tools

The staff navigation now exposes implemented workflows while optional legacy surfaces remain unavailable. This is an application navigation change, not clinical approval or provider commissioning.

Desktop, mobile and home entry points retain the inbox, schedule, clients, care reminders, inventory, templates and reviewed ezyVet imports (administrator-only). The mobile primary navigation includes Schedule, while More retains Care reminders and Clients. Website-inquiry triage remains reachable. The unused Settings wellness toggle and lead-time input were replaced with a link to the implemented Care reminders settings; no legacy settings or historical values were deleted.

Campaigns, broadcast messages, surveys, Voice/voicemail and the legacy CSV importer are omitted from active navigation. Their known direct URLs render explicit unavailable pages with links to working workflows. Broadcast messages are distinct from required clinical patient alerts, which remain available in patient records. Legacy page modules are no longer mounted at those routes, so their mutations and fake delivery/status controls are not presented. The globally mounted voicemail counter hook is removed. Existing tables, messages and historical data are untouched.

The AI suggestion component is not mounted in conversation detail. The manual message composer, reviewed templates and existing message history remain intact. This does not delete historical AI annotations, audio references or client contact preferences. It does not enable any legacy provider adapter.

## Home data semantics

Home reuses `useUnreadCount` and `useConversations` from the current inbox. Totals count unread conversations for the authenticated staff member, not messages, and recent active rows use the server's personal-read projection. Home no longer reads shared `conversations.is_read` or performs unchecked client/last-message fan-out queries. The recent section displays the newest three active conversations from the bounded inbox page.

Active-conversation and open-ticket totals are scoped by actor in their cache keys and share the existing conversation/ticket invalidation prefixes. They also refresh at the inbox polling cadence. Each card distinguishes Loading, Unavailable and an actual numeric value, with retry on failure. A failed refresh does not display an old count as current. Recent-conversation errors have their own explicit retry and are not represented as an empty inbox. Existing auth identity-change cache clearing remains unchanged.

## Verification and limits

Synthetic browser coverage checks desktop/mobile entry points, all six unavailable direct routes, absence of voicemail/provider hooks on those routes, personal read labels for separate staff sessions, loading/error/retry states, the Settings link and the intact manual composer without suggestion controls. Home screenshots at 390 and 1440 px are inspected with horizontal-overflow checks. No synthetic test submits an external provider request or changes cloud data.

These changes preserve the required due-plan and inbox features. They do not claim that deployment, phone service, automated lab/anesthesia integration, payment collection or clinical acceptance is complete. Reintroducing an optional tool requires a working, reviewed end-to-end implementation and its own authorization boundaries, not merely restoring a navigation item.
