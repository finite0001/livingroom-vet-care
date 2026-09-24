# Local release-control check

Date: 2026-09-24
Scope: local release-control verification after the Stage 4 integrated workflow proof, Stage 5 acceptance package, generated readiness refresh, local release-control evidence, and typography-token commits
Commit checked: `e88b7a8`
Environment: local repository workspace

## Summary

The local release-control check passed.

Command:

```bash
npm run check
```

Result:

```text
Exit code: 0
```

`npm run check` executed:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Test result

The Node test run reported:

```text
tests 1078
pass 1078
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 4648.480666
```

After the typography-token commit, the Node test run reported:

```text
tests 1078
pass 1078
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 4701.275083
```

## Build result

The production build completed successfully:

```text
sitemap.xml written (14 entries)
vite v7.3.6 building client environment for production...
✓ 3973 modules transformed.
✓ built in 4.32s
```

After the typography-token commit, the production build completed successfully:

```text
sitemap.xml written (14 entries)
vite v7.3.6 building client environment for production...
✓ 3973 modules transformed.
✓ built in 4.30s
```

Vite emitted the existing non-failing chunk-size warning for chunks larger than 500 kB after minification. This warning did not fail the build.

## What this proves

- ESLint passed for the current repository state.
- TypeScript checking passed for both app and node configs.
- The local Node test suite passed.
- The production Vite build completed.
- Generated site artifacts can be produced from the current readiness package state.

## What this does not prove

- This is not hosted Supabase migration apply evidence.
- This is not hosted staff workflow acceptance.
- This is not Dr. Susan Edler clinical approval.
- This is not provider commissioning, live payment acceptance, live email/SMS delivery, phone, voice, voicemail, or CloudTalk evidence.
- Public phone, email, and emergency content are still owner-content blockers.
