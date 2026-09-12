# Dependency and CI baseline

Audited 2026-09-12 with `npm audit --json`; applied `npm audit fix --ignore-scripts` without force or major framework changes. Compatible updates changed 30 installed packages, including React Router DOM 6.30.6, its router 1.23.4, PostCSS 8.5.28, and Vite 5.4.21. React remains on 18, React Router on 6, Tailwind on 3, and the Lovable SWC/tagger configuration remains intact.

## Reproducible checks

Use Node 22.12 or newer and `npm ci`, then `npm run check`. The check command runs ESLint, both frontend and Vite-config TypeScript projects, the Node TypeScript tests, and the production build. GitHub Actions runs this on pull requests and main pushes with read-only repository permission and synthetic Supabase frontend values. It never receives a production database password, service-role key, or provider credentials. Edge Functions are not included in the frontend TypeScript projects; their shared-policy tests and database checks supplement this baseline.

`package-lock.json` is authoritative for CI and the npm workflow. The repository already also contains `bun.lock` and legacy `bun.lockb`; these are retained to avoid changing Lovable's package-manager behavior without a round-trip validation in Lovable. **They have not received this npm security refresh.** Do not treat a Bun install as equivalent to the verified npm install. Configure Vercel's install command as `npm ci`. Before accepting the next Lovable dependency update, synchronize the selected Bun lock with the manifest, verify the npm lock again, and remove redundant lock formats only after verifying Lovable still builds. CI catches a manifest/npm-lock mismatch.

## Toolchain hardening

The dedicated compatibility increment upgrades Vite to 7.3.6 and `@vitejs/plugin-react-swc` to 4.x while preserving React 18, Tailwind 3, the Lovable tagger and existing route behavior. Node 22.12 or newer is declared in the manifest to satisfy Vite 7's runtime requirement. Vite 7 uses a newer default browser baseline; staff browser acceptance must use currently maintained browsers. See the [official Vite 7 migration guide](https://v7.vite.dev/guide/migration).

`npm run check` passes after the upgrade. Browser evidence is recorded with the stacked PR. The npm audit now reports **two moderate affected package entries, no high or critical findings**; Vite/esbuild findings are resolved in this npm lockfile.

## Remaining advisories

| Package | Audit severity | Finding and disposition |
| --- | --- | --- |
| react-router 6.30.6 | Moderate | Untrusted navigation paths can cause external redirects; SSR error hydration can inject constructors. This frontend uses client-side rendering, but user-controlled navigation still needs validation. A patched v7 upgrade conflicts with the user's v6 convention and awaits clarification. [Redirect advisory](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [SSR advisory](https://github.com/advisories/GHSA-337j-9hxr-rhxg). |
| react-router-dom 6.30.6 | Moderate | Parent dependency affected by the react-router advisories above. |

These are affected-package counts, not independently exploitable application flaws. No audit findings are suppressed. Resolve the router upgrade decision before the clinical pilot and rerun the audit before releases because advisory status changes.

## Lint scope

Named props interfaces may extend a single existing interface without new members, matching the project's interface convention. shadcn UI files have an explicit allowlist of their conventional exported variants/hooks for Fast Refresh; the rule remains active for other exports. Hook dependencies were corrected for avatar fallback selection, marking conversations read, and consuming reply suggestions. Rejected suggestions are consumed so clearing a manually typed reply cannot unexpectedly restore an older suggestion.

Initial verification after these changes: lint has no errors (AuthContext Fast Refresh warning managed by the auth workstream), both TypeScript projects pass, production build passes, and the existing 9 auth tests pass. The build still reports a large main chunk (~891 kB minified); route/vendor splitting remains a performance follow-up, not a failed build.
