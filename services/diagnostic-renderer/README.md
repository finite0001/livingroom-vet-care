# Isolated diagnostic renderer

Package 3B2A proves rendering/admission. No API route, queue consumer, Supabase credential, clinical worker policy or patient-record artifact registration is activated here. See the [plan](../../plans/2026-10-11-diagnostic-pdf-renderer/plan.md) and [native evidence](../../docs/launch-evidence/2026-10-11-diagnostic-pdf-renderer.md).

The template accepts trusted already-frozen reviewed source data, not arbitrary public HTML. The coordinator must persist the full manifest/history/provenance and choose an approved immutable image digest before production use. Report HTML is deterministic; Chromium PDF timestamps can vary. Captured PDF recovery must therefore reuse saved bytes, never re-render them.

The image's default root user is for the Vercel SDK's trusted setup. The actual worker is invoked as `lrv-render` and fails unless UID 12001, sudo denied and effective Chromium namespace/seccomp sandboxing are observed. A direct default-root Docker invocation intentionally fails. No `--no-sandbox`, capability elevation, privileged mode or host IPC fallback is permitted.

The Docker CI harness runs natively on amd64 with read-only root, no network, dropped capabilities, no-new-privileges and bounded private scratch. Its seccomp policy is from [Playwright 1.63.0](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json), adding `chroot` for Chromium's private user namespace without adding a capability. The accompanying Playwright license is Apache 2.0. Vercel uses its own Firecracker boundary; native hosted proofs verify actual browser sandbox status and raw DNS/TCP/metadata denial separately.

PDF admission is limited to the pinned producer's observed PDF 1.4 subset. It is not a general sanitizer, digital signature, clinical approval or export authorization. Rejecting an unsupported valid PDF is intentional. Runtime upgrades require a new image digest, source/binary/font provenance and execution/admission proof; apt packages may change between Dockerfile rebuilds.
