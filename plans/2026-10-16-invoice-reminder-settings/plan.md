# Invoice reminder configuration before the first invoice

PR260 is merged and production READY. Its policy editor requires an issued invoice; production has none. Add an ADMIN-only practice policy editor to Settings using the existing immutable save/recover API. Keep the invoice editor and Settings on one shared form/schema and one versioned policy history.

Additive migration192 exposes only a matched current ADMIN/session read of that policy and scheduler status. No new tables, enrollment, provider request, automatic policy seed or changed delivery gates. Keep all existing private-table ACLs and lock ordering.

Acceptance: no-invoice configuration through actual Auth/UI; staff/anonymous/service denial; wrong actor and missing-session rejection; version conflict across editors; lost save acknowledgement recovered with the same UUID; retained edits and leave confirmation; reload/mobile; existing invoice tests and canonical SQL regression; exact-head CI. Stage database before frontend release. Do not manufacture a production invoice or impersonate a staff session.

Settings owns one navigation guard combining the reminder editor and existing return-policy drafts. Preserve the latter's ADMIN+DVM authorization and explicit clinical review; the regression check edits/discards only, without saving a clinical policy. Use an explicit label association for its textarea so label identity remains stable when populated.

Rollback: restore the prior frontend if necessary; the existing issued-invoice policy editor remains available. The new reader can be revoked through a reviewed additive migration. Preserve policy versions and all invoice, money and delivery history; no data removal is required.

Configuration metadata checked against SHA-256 of known non-secret values: primary has APP_ENV=staging and OUTBOUND_DELIVERY_MODE=test; staging has APP_ENV=staging and delivery disabled. Neither has the new worker gate enabled. Preserve those values: this package does not change global email/SMS delivery or unrelated clinical policies. Actual business activation remains a distinct current-ADMIN policy and new worker/cron commissioning step after release.

Continue authorized VetRec/VetRocket reconstruction from the existing evidence plan; private account access remains outstanding.
