# Independent record-review dialog review

Reviewed the new unmounted dialog, optional presentation-only workflow callback, synthetic host, browser cases and Playwright match configuration against C2c privacy, explicit lifecycle, focus and navigation requirements. No implementation edits, live API, backend, real Auth or production mounting were performed by this reviewer.

## Findings and resolution

**Privacy warning, corrected by author:** the original workflow keyed its local draft form only by the lifecycle identity revision. Replacing model A with distinct model B at the same revision retained A's unsubmitted reason and decision in React state; the dialog correctly ignored the old model's dirty marker, leaving that retained text without a warning. The author added a WeakMap presentation identity combined with revision as the form key. Source inspection confirms replacement now remounts the form synchronously, without using that presentation identity as authorization. The new explicit synthetic replacement case checks both normal editing and an open warning, no requests or pointers. The parent reported all11 browser cases passing in14.7s, including this same-revision replacement case; that full-suite result was parent-executed, not independently rerun here.

The author's earlier warning-focus bug was corrected with AlertDialog's onCloseAutoFocus restoring the connected prior active element or the workspace title. Independent actual browser actions confirmed Stay restores textarea focus at both inspected widths. A subsequent source-only cleanup copies the focus target locally and clears the retained ref before restoring it; review found no behavior or identity regression in that cleanup. The parent will rerun the final11 cases after it.

No remaining source blocker found in the reviewed delta.

## Ownership and lifecycle checks

- Closing/leaving changes presentation only: no RPC, cancellation, signature or pointer deletion is invoked by close, stay, leave, dialog dismissal or effects.
- Dirty and pending-close markers bind both model object and identity revision. Durable/in-flight/recovery-attention warnings remain distinct from unsent local edits; local text is never persisted by the callback.
- Navigation remains an explicit blocked proceed/reset action. Completion or changed identity never resumes an old navigation automatically. beforeunload registration is removed when warning state clears. Browser native unload text remains browser-controlled; custom warning wording applies to in-app navigation/dialog dismissal.
- Existing workflow action publication guards and lifecycle pointer handling remain intact. No auto prepare/sign/retry/recovery was added. Selection and actual Auth admission remain host responsibilities.
- shadcn/Radix supplies modal focus containment; title initial focus and return behavior are explicit. Semantic tokens and existing components are used. The new main/alert buttons use at least44px heights; close also has44px width.

## Independent browser observations

A separate loopback-only Vite host on47687 and fresh Chromium context per width were used with all non-loopback origins blocked. These observations concern the synthetic unmounted host only.

| Viewport | Workspace width | Warning width | Horizontal overflow | Button heights | Stay focus |
|---|---:|---:|---|---|---|
|375×900|356.25px|375px|none in dialog or document|Prepare/Close/Stay/Discard44px|textarea restored|
|1280×900|896px|512px|none in dialog or document|Prepare/Close/Stay/Discard44px|textarea restored|

The close target was44×44px at both widths. Both inspected dialogs remained within viewport bounds. An initial inspection attempt timed out while closing during concurrent HMR/source editing; it is excluded from acceptance evidence. A clean second inspection with isolated contexts completed successfully. The parent separately owns the full browser-suite run, prepared-evidence375px/1280px geometry and44px assertions/screenshots, lint and type checks. Independent measurements above cover the editable dialog and local warning; prepared-evidence coverage is separately parent-executed.

## Scope limits

These source and synthetic browser checks do not substitute for C2c's genuine two-user Auth, actual backend accepted packet/receipt, post-wait revocation, stock-delta or provider-isolation proofs. The feature remains unmounted. New5dialog cases and existing6workflow cases are presentation tests; parent-reported11-pass result precedes the final focus-ref cleanup, and final parent-run results must be reported separately. No broader C2c acceptance is claimed.

0 critical,0 unresolved warnings,0 suggestions. One privacy warning was found and corrected during review.
