# Beta dependency triage — November 6, 2026

Read-only audit against source baseline `b8767ff2e560f23d884194b5e9f875c0c647532a`. [Full and production-filtered npm reports](evidence/beta-dependency-audit-2026-11-06.json) preserve exact dependency nodes, advisories and suggested fix metadata. No package, lockfile, proof pin or hosted state changed.

`npm audit --json` reports **18 vulnerable package entries: 6 high, 12 moderate, 0 critical**. `npm audit --omit=dev --json` reports **8 entries: 4 high, 4 moderate**. These are affected package counts, not distinct advisory counts or proven exploit paths. The September zero-result in [dependency-baseline.md](dependency-baseline.md) is superseded.

## Prioritized findings

| Package / installed version | Reachability observed in this repo | Remediation and evidence needed |
| --- | --- | --- |
| `zod` 3.25.76 — high | Direct runtime dependency used throughout frontend and Edge validators, plus diagnostic renderer. Nested Sandbox Zod is separately 4.6.6. | Audit reports patched line 4.6.6+. Major-version migration needs schema/type/handler regression checks; verify early collection/body limits before parsing untrusted content. Existing `.max()` schema declarations alone are not proof of bounded parsing cost. No exploit was attempted. |
| `undici` 7.30.0 — high | `@vercel/sandbox` 3.6.1 dependency; Sandbox is used by diagnostic renderer and private PDF proof tooling. | Evaluate a compatible resolution at least 7.30.1 and rerun renderer/transport checks. Several advisories apply to specific HTTP/WebSocket/cache APIs; the audit is not proof those vulnerable modes are used. |
| `vite` 7.3.6 — high | Dev/build tool; `vite.config.ts` defaults to host `::`. Vercel publishes built static assets, not the dev server. | Assess a patched compatible 7.x release (7.3.7 fixes the reviewed file-serving advisory), then rerun browser/build/worker checks and current advisory audit. Until patched, keep dev-server access controlled; do not expose it to beta users. |
| `follow-redirects` 1.16.0 — high | `twilio` 6.1.1 → `axios` 1.20.0 dependency in the full npm tree. Twilio is retained/unselected provider code. | 1.16.2 fixes the reviewed cross-realm sensitive-header issue. Check root and Deno resolution separately; root npm audit cannot certify deployed Edge bundles. |
| `brace-expansion` 1.1.18 and 2.1.4 — high | ESLint/minimatch and Tailwind → sucrase → glob chains. | Resolve affected 1.x/2.x versions and verify build/lint/config parsing. Audit suggests an available update; preserve parent dependency compatibility. |
| `source-map-js` 1.2.1 — high | PostCSS/build chain. Included in omit-dev because production `tailwindcss-animate` retains Tailwind as a peer. | Evaluate patched 1.2.2+ with production build and source-map handling checks. Production-filtered install presence does not prove browser execution. |
| Remaining moderate entries | `glob`, `minimatch`, `postcss-selector-parser`, `qs`; propagated parent findings in typography, typescript-eslint family and sucrase | Use the recorded report to update compatible leaves/parents. Do not blindly apply `npm audit fix --force`: suggestions include major changes or downgrades (typography 0.5.4, typescript-eslint 8.36.0). Rerun audit and relevant regressions after a reviewed dependency plan. |

The upstream Zod correction checks collection size before parsing elements; see [maintainer PR 6652](https://github.com/colinhacks/zod/pull/6652). The [Vite maintainer advisory](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) describes dev-server exposure and specific path conditions, so it does not establish a vulnerability in the deployed static site. The [Undici maintainer advisory](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26) requires a particular redirect/shared-cache composition; no such configuration was established in this audit. The [follow-redirects maintainer advisory](https://github.com/follow-redirects/follow-redirects/security/advisories/GHSA-mrwp-f3q8-3g9p) documents cross-realm sensitive-header behavior and its patched version. These sources were checked November 6; later release candidates need a fresh audit.

## Why the lock was not silently refreshed

Current narcotics proof machinery binds package/source bytes: `tests/controlled-drugs/narcotics-finalize-browser-bindings.json` records `package-lock.json` and `package.json` hashes; `scripts/narcotics-log/operational_browser.py` includes the lockfile in its source set. A dependency update is valid work, but previous proof does not automatically carry over. Keep archived evidence intact, generate new exact-candidate evidence, and inspect current proof admission rather than rewriting historical hashes merely to make a check pass.

The root npm lock and `deno.lock` describe different resolution contexts. Hosted Edge source/bundles and the separate diagnostic-renderer deployment must be verified after upgrades. Passing a root-only audit cannot establish that a deployed service uses the patched dependency.

## Acceptance for the dependency repair

1. Select compatible patched versions and review any Zod migration behavior, especially error shapes, strict objects, refinements and collection parsing.
2. Run the current lint/typechecks/unit/build/browser checks, Edge `deno check --frozen` and isolated handler/renderer tests.
3. Re-run current narcotics proof for the changed candidate without altering historical receipts.
4. Re-run full and omit-dev audits; document any residual advisory with its exact usage/mitigation instead of suppressing it.
5. Publish/deploy only the reviewed artifact and verify deployed runtime resolution where applicable.
