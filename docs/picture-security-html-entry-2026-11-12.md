# App HTML transform boundary

The fresh-main baseline `bdc40db68b7747d5fcb65e4b23f992a45e8b4eb2` failed 78 browser tests in CI run `42965191085` before the security changes. The Vite public-discovery plugin applied the app SEO replacement to standalone HTML fixtures, which do not contain the app template markers. The log recorded 161 occurrences of `Missing public SEO template markers`. A local independent-witness test reproduced HTTP 500 before any witness UI could load.

The plugin now transforms only the resolved root `index.html`. Vite retains that source filename for public and private SPA fallbacks. Standalone entries are returned without app metadata. The app still rejects missing SEO markers, and private routes retain noindex/nofollow with no public canonical or structured data. The production bundle construction, authorization guards, raw RPC protocol and browser assertions are unchanged.

A real Vite dev-server regression checks the home, index, public service, private fallback, independent fixture and broken app template. All five independent-witness browser tests pass after the correction. The normal npm check passed: 2,811 unit tests, all three TypeScript projects, production build, and no lint errors (seven pre-existing Fast Refresh warnings). The full browser run passed 615 tests, skipped the deliberately gated CloudTalk provider case, and retained four local timing failures under concurrent compilation. An unchanged single-worker rerun passed all four; three additional unchanged repetitions each passed (12 of 12). No deadlines or assertions were changed. All 150 source-control tests and exact source admission passed.

The new immutable source closure is `scripts/narcotics-log/picture-security-html-entry-candidate-source.json`, with a separate `picture-security-html-entry-browser-source-proof.json`. Every earlier candidate manifest and proof remains unchanged. The current native suite must re-admit this closure; the preceding green recovery result alone is not acceptance of these new bytes.

Source validation commands (Node 22 on PATH):

```sh
python3 -I -B scripts/narcotics-log/beta_browser_source.py --check-source
python3 -I -B scripts/narcotics-log/beta_rehearsal.py --check-source
python3 -B -m unittest discover -s scripts/narcotics-log -p 'test_*.py'
npm run check
E2E_PORT=44820 E2E_NO_TURNSTILE_PORT=44821 npm run test:e2e -- --workers=4
```
