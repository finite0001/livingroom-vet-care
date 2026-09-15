# Home-base housecall day routes

Baseline: merged PR132, `73d061f566182d8e109f35324d181fb2ec67a0b7`. Migration reconciliation remains in its separate workspace.

Build a read-only itinerary for one selected staff member and Denver date. Include SCHEDULED/CONFIRMED visits in saved appointment order, including clinic stops between housecalls. Use saved address snapshots, starting and ending at 2619 Spruce Street. No optimization, travel-time estimate, appointment mutation or automated provider call.

Implementation: pure route/address-link helpers; an expandable route panel in each day card; exact schedule row-count verification before offering routes. Unknown or truncated results disable routing. Missing selected visit addresses block route links rather than substitute current household data. Individual legs avoid platform-dependent waypoint limits; overlong links remain unavailable, with saved addresses visible.

Google contract: [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), reviewed September14,2026. Use the fixed HTTPS directions origin, `api=1`, encoded origin/destination, driving mode and the documented 2,048-character URL bound. Links open only on staff action and contain addresses, not patient/clinical details. No API key or paid routing service is introduced.

Files: scheduling `housecall-route.ts`, `HousecallDayRoute.tsx`, `SchedulePage.tsx`; unit/browser route tests and scheduling documentation.

Acceptance: staff/day/status filtering; stable appointment order; intervening clinic stops; home-base return; saved address and safe URL encoding; missing/long address handling; partial schedule refusal; desktop/mobile interaction; no external navigation before click; existing booking workflow preserved. Lint/typecheck/build and focused tests required. Actual driving routes and hosted staff acceptance remain separate.

Validation: npm run check passed with548 unit tests, lint/typecheck/build (existing Fast Refresh/bundle warnings). Five browser scenarios passed together; the mobile case passed on targeted rerun after fixing fixture count-header exposure and distinguishing Maps traffic/read-only navigation RPCs from unrelated requests. Six scenarios are covered, not a single clean six-case run. The mobile itinerary screenshot was inspected. Independent review led to preserving route selection during refresh while withholding directions. No real Maps navigation, hosted change or provider send occurred.
