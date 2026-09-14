# Attachment history: scoped implementation audit

Scope: `AttachmentScanHistory.tsx` and its insertion into the existing ezyVet import page. This is an Operate surface. The incumbent tokens, shadcn components, fonts and existing route layout are the visual authority. No product/design manifest was created and no redesign was performed.

**Implementation integrity: pass within this scope.** The addition uses existing components and semantic tokens, preserves other controls, keeps source observations separate from medical-record approval, and validates patient/run/revision identity before display. The Impeccable mechanical detector returned `[]`; this is not proof of visual quality or accessibility compliance.

| Dimension | Provisional score | Evidence and limits |
| --- | --- | --- |
| Accessibility | 3/4 | Labeled input, native buttons, `aria-pressed`, heading/region structure, loading/status and alert feedback; escaped source text. Screen-reader and full keyboard/zoom audits remain unperformed. |
| Performance | 3/4 | Patient search starts after two characters; query cache keys include actor/patient/run/cursor; observation pages cap at10; no new packages, images or animation. Existing application bundle warning remains. |
| Responsive | 3/4 |375px browser case has no section overflow; flexible wrapping and word breaks; existing buttons use44px default height. Full device/zoom matrix is not claimed. |
| Theming | 3/4 | Semantic tokens throughout. Static color calculations cover light/dark text and badge/control pairs; rendered dark-theme acceptance remains unperformed. |
| Implementation integrity | 4/4 | No mechanical findings; source-specific copy, immutable observation identifiers, explicit incomplete-scan/source-change states and no implied approval. |
| Total |16/20 | Good within the measured implementation scope; not a WCAG certification. |

One verified P1 issue was resolved: the originally selected shared outline button had primary-on-background text contrast about2.88:1 in the light palette; its hover foreground/background pair was about3.06:1. Only the new history controls now use the existing secondary variant. Secondary foreground/background contrast is about5.39:1 light and4.57:1 dark. Both exceed the normal-text4.5:1 threshold in [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Calculations use the actual HSL tokens and relative-luminance formula, not pixel antialiasing. Body foreground/background pairs are about10.03:1 light and14.74:1 dark; muted text/background pairs about6.73:1 and8.39:1. Ratios are rounded here for reporting; threshold comparisons use unrounded values.

No verified new P0/P1 issue remains in the inspected code and tested states. One P2 inherited concern remains outside this component: the application build reports a large App chunk. Investigate measured loading cost before choosing a split; this small history addition does not justify a broad unsolicited route refactor. Unperformed screen-reader, keyboard/zoom and rendered dark-mode checks are coverage limits, not asserted defects.

Positive findings: existing44px controls and palette are preserved; unsupported file types stay visible; server-provided download URLs are not rendered; wrong-patient responses hide prior data and show a recovery message; changing patients clears selected history. Seventeen focused/neighbor browser cases pass after the contrast change. No new motion was introduced.

Possible later work: `$impeccable optimize` for a measured bundle investigation, then `$impeccable polish` when the full attachment action/review workflow is ready. These are not additional work launched by this audit. You can request them individually or together; rerun the audit after any substantive visual changes.
