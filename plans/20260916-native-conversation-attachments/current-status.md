# Current attachment readiness checkpoint

This checkpoint supersedes historical in-progress process notes in plan.md and outbound-binding.md. It does not declare commercial readiness.

## Authoritative state

- Worktree: Developer/livingroom-native-communications; branch codex/native-conversation-email.
- Draft PR153: https://github.com/finite0001/livingroom-vet-care/pull/153, based on codex/native-conversation-uploads (PR152), itself based on PR150.
- CI35089556787 completed successfully at71f1e4ed86ba1342cec59e1029e1e17e3ba1bdab. All jobs passed, including the conversation email SQL suite and29 actual local Auth/Storage checks. This proves the capture/recovery/queue and private draft inspection increment, not the later composer/history changes.
- CI35090906569 is confirmed in progress atd70691aa9f16f27e3eaf25c35107d15530762d2b. Preserve that run; do not restart because an observation times out. This candidate adds the email composer and shared queued-message history, including their expanded SQL and real-service checks.
- Local validation at the composer increment:16 communications browser cases passed, including desktop/mobile attachment selection, review, captured-file download and queueing. Later history increment: one additional history browser case, seven file/history tests, targeted ESLint and application TypeScript passed.
- No live deployment, provider send or delivery-gate activation. Canonical candidate schema116 migrations; live backend was not modified by this work.

## Implemented candidate behavior

Staff can select bounded PDF/PNG/JPEG files in the existing email composer. Upload UUIDs survive retries; verified private bytes are captured into an immutable email payload. Review and exact payload-hash attestation precede queueing. Ordinary request recovery/acknowledgment is reused. Draft downloads require original ownership. Once queued, active staff can list/download captured files through the immutable message/outbox association, consistent with current message-read policy. Browser downloads verify returned identity, metadata, byte length and SHA-256. Existing final provider guards remain in the call chain.

The browser tests mock backend responses. The actual-service integration uses real local Auth, Storage and RPCs but invokes the capture handler in-process, so it does not establish deployed HTTP-host acceptance. PDF/image signature checks are not malware scanning.

## Remaining work

1. Inspect final result/logs ofCI35090906569; fix failures and verify the exact final commit.
2. Complete inbound attachment-byte retrieval with provider-authenticated references, bounded downloads, durable capture and authorized staff access. Existing inbound metadata is not binary retrieval.
3. Define and implement lifecycle/retention for abandoned uploads, verified unqueued files and captured message evidence. No automatic deletion or purge has been activated.
4. Verify concurrent capture/abandon/queue and staff-revocation boundaries where not yet covered by current fixtures.
5. Complete deployed HTTP acceptance and staff workflow acceptance; controlled provider delivery requires commissioning authorization and remains disabled.
6. Integrate the PR stack with the standalone platform branch, resolve concurrent work cleanly, then execute approved staging/live rollout with exact backend-reference verification and rollback evidence.
7. Continue the broader standalone commercial-readiness matrix; this attachment increment does not complete clinical, operational, provider or business acceptance requirements.

All earlier local test sessions mentioned in historical attachment notes are terminal. The recent typecheck and browser sessions completed; the GitHub run above is the remaining confirmed live validation job at this checkpoint.
