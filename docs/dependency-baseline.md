# Dependency and CI baseline

Audited 2026-09-12 with `npm audit --json`; applied `npm audit fix --ignore-scripts` without force or major framework changes. Compatible updates changed 30 installed packages, including React Router DOM 6.30.6, its router 1.23.4, PostCSS 8.5.28, and Vite 5.4.21. React remains on 18, React Router on 6, Tailwind on 3, and the Lovable SWC/tagger configuration remains intact.

## Reproducible checks

Use Node 22 and `npm ci`, then `npm run check`. The check command runs ESLint, both frontend and Vite-config TypeScript projects, the Node TypeScript tests, and the production build. GitHub Actions runs this on pull requests and main pushes with read-only repository permission and synthetic Supabase frontend values. It never receives a production database password, service-role key, or provider credentials. Edge Functions are not included in the frontend TypeScript projects; their shared-policy tests and database checks supplement this baseline.

`package-lock.json` is authoritative for CI and the npm workflow. The repository already also contains `bun.lock` and legacy `bun.lockb`; these are retained to avoid changing Lovable's package-manager behavior without a round-trip validation in Lovable. **They have not received this npm security refresh.** Do not treat a Bun install as equivalent to the verified npm install. Configure Vercel's install command as `npm ci`. Before accepting the next Lovable dependency update, synchronize the selected Bun lock with the manifest, verify the npm lock again, and remove redundant lock formats only after verifying Lovable still builds. CI catches a manifest/npm-lock mismatch.

## Remaining advisories

The post-fix npm audit reports **4 affected package entries: 1 high and 3 moderate**, with no critical findings. These counts include parent packages affected through a dependency; they are not four independently exploitable application flaws.

| Package | Audit severity | Finding and disposition |
| --- | --- | --- |
| Vite 5.4.21 | High | Development-server optimized dependency map path traversal, Windows file-deny bypass, and Windows editor UNC credential disclosure. Keep the dev server local/trusted; deploy the built static output. Upgrade Vite with its SWC/tagger integrations in a dedicated compatibility change. [Map path traversal](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), [Windows file bypass](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [UNC disclosure](https://github.com/advisories/GHSA-v6wh-96g9-6wx3). |
| esbuild 0.21.5 | Moderate | Development server cross-origin request exposure. It is Vite's build dependency, not an application production HTTP server. Resolve with the planned Vite upgrade. [Advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). |
| react-router 6.30.6 | Moderate | Untrusted navigation paths can cause external redirects; SSR error hydration can inject constructors. This frontend uses client-side rendering, but all user-controlled navigation still needs validation. Fix requires moving beyond the mandated v6 baseline. [Redirect advisory](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), [SSR advisory](https://github.com/advisories/GHSA-337j-9hxr-rhxg). |
| react-router-dom 6.30.6 | Moderate | Parent dependency affected by the react-router advisories above. |

The audit proposes Vite 8.3.0 and React Router DOM 7.18.3 with `--force`; neither was applied automatically. Schedule these upgrades before the clinical pilot. Audit is reported separately from CI rather than blanket-suppressed or made an always-failing gate. Re-run it before releases because advisory status changes.

## Lint scope

Named props interfaces may extend a single existing interface without new members, matching the project's interface convention. shadcn UI files have an explicit allowlist of their conventional exported variants/hooks for Fast Refresh; the rule remains active for other exports. Hook dependencies were corrected for avatar fallback selection, marking conversations read, and consuming reply suggestions. Rejected suggestions are consumed so clearing a manually typed reply cannot unexpectedly restore an older suggestion.

Initial verification after these changes: lint has no errors, both TypeScript projects pass, production build passes, and the existing auth tests pass. The previous AuthContext Fast Refresh warning was resolved by moving `useAuth` into a non-component context module. The build still reports a large main chunk; route/vendor splitting remains a performance follow-up, not a failed build.
