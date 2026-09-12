# Dependency and CI baseline

Audited 2026-09-12 with `npm audit --json`. The validated npm lock now uses Vite 7.3.6, `@vitejs/plugin-react-swc` 4.x and React Router DOM **7.18.3**, with **zero reported vulnerabilities**. React remains on 18, Tailwind on 3, and the Lovable SWC/tagger configuration remains intact. The user explicitly approved React Router v7 for this repository; see [project instructions](../AGENTS.md).

## Reproducible checks

Use Node 22.12 or newer and `npm ci`, then `npm run check`. The check command runs ESLint, both frontend and Vite-config TypeScript projects, the Node TypeScript tests, and the production build. GitHub Actions runs this on pull requests and main pushes with read-only repository permission and synthetic Supabase frontend values. It never receives a production database password, service-role key, or provider credentials. Edge Functions are not included in the frontend TypeScript projects; their shared-policy tests and database checks supplement this baseline.

`package-lock.json` is authoritative for CI and the npm workflow. The repository already also contains `bun.lock` and legacy `bun.lockb`; these are retained to avoid changing Lovable's package-manager behavior without a round-trip validation in Lovable. **They have not received this npm security refresh.** Do not treat a Bun install as equivalent to the verified npm install. Configure Vercel's install command as `npm ci`. Before accepting the next Lovable dependency update, synchronize the selected Bun lock with the manifest, verify the npm lock again, and remove redundant lock formats only after verifying Lovable still builds. CI catches a manifest/npm-lock mismatch.

## Toolchain hardening

The dedicated compatibility increment upgrades Vite to 7.3.6 and `@vitejs/plugin-react-swc` to 4.x while preserving React 18, Tailwind 3, the Lovable tagger and existing route behavior. Node 22.12 or newer is declared in the manifest to satisfy Vite 7's runtime requirement. Vite 7 uses a newer default browser baseline; staff browser acceptance must use currently maintained browsers. See the [official Vite 7 migration guide](https://v7.vite.dev/guide/migration).

## Router security upgrade

The user authorized replacing the inherited React Router v6 convention with patched v7 while keeping existing routes and React 18. The installed version is pinned to 7.18.3 in `package.json` and the npm lock. The package's declared React/React DOM peer requirement is `>=18`; its Node requirement is `>=20`, covered by this project's Node 22.12 minimum. The existing `react-router-dom` imports remain supported, so the application route tree and `useBlocker` implementation require no source changes.

Reviewed the [official migration guidance](https://reactrouter.com/6.30.1/upgrading/future) and [7.18.3 release](https://github.com/remix-run/react-router/releases/tag/react-router@7.18.3). This application uses `createBrowserRouter` with client-side routes, module-scope lazy components and no multi-segment splat branches, router fetchers, SSR hydration or route loader/action APIs. The migration-sensitive draft navigation flow is covered by the existing browser test that keeps a SOAP draft on canceled navigation and discards it only after explicit confirmation.

Validation passed `npm run check` (44 unit/handler tests, frontend/config TypeScript and production build) plus all 14 existing browser checks on isolated port 8092, with the same synthetic backend fixtures and strict denial of unrelated network traffic. No production backend or provider calls are needed. The resolved npm audit is zero across critical/high/moderate/low levels; no findings or packages are suppressed. This is an audit snapshot, not a guarantee against future advisories: rerun before release.

## Lint scope

Named props interfaces may extend a single existing interface without new members, matching the project's interface convention. shadcn UI files have an explicit allowlist of their conventional exported variants/hooks for Fast Refresh; the rule remains active for other exports. Hook dependencies were corrected for avatar fallback selection, marking conversations read, and consuming reply suggestions. Rejected suggestions are consumed so clearing a manually typed reply cannot unexpectedly restore an older suggestion.

Initial verification after these changes: lint has no errors (AuthContext Fast Refresh warning managed by the auth workstream), both TypeScript projects pass, production build passes, and the existing 9 auth tests pass. The build still reports a large main chunk (~891 kB minified); route/vendor splitting remains a performance follow-up, not a failed build.
