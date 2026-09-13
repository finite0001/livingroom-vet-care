# Reviewed ezyVet clinical history

Implemented and locally verified at `ddf3d80` on `codex/ezyvet-reviewed-history`, based on PR106. This document describes the staff workflow for the integrated increment. CI, hosted acceptance, real ezyVet access and Dr. Susan Edler's clinical review remain pending; see the [acceptance evidence](../release-imported-history-artifacts.md).

Living Room Vet owns the local clinical record. Imported history is evidence from another system, with its original wording and references preserved. Importing it does not sign a SOAP note, infer a diagnosis, resolve a problem or establish a complete migration.

## Source review by an administrator

Use the patient-scoped clinical import workflow after reviewing the ezyVet animal mapping. Inspect the exact history observation, patient identity and consultation context before preparing an approval. An unresolved consultation remains explicitly unresolved. A known consultation belonging to another patient cannot be approved by relabeling it unresolved.

Review the prepared operation, then explicitly approve it. The resulting approved history is available to clinical staff without exposing unrelated administrator staging data. The original source date, category, clinician reference and active value remain literal source information. Administrator approval is recorded separately.

## Clinical decision by a veterinarian

Open the approved imported history in the patient chart. Search existing problems before choosing between creating a distinct finding and linking evidence to an existing problem.

- **Create:** deliberately enter or review the title, notes, onset, status and importance. Source prose does not automatically set these fields. An unknown onset may remain unknown.
- **Link:** review the exact existing problem and version. Linking preserves its fields. Make any desired clinical edit through the ordinary problem editor as a separate action.

Several distinct findings may use the same source history. Each decision retains its own source references and reviewer. Later local edits preserve the original extraction fields and attribution.

## Changed outside evidence

A later source revision creates discrepancy work without overwriting the local finding. A veterinarian reviews the newly administrator-approved source version for each original source identity. This records review of those exact observations; it does not edit or resolve the local problem. Another source change requires another review, including when the outside text changes and then returns to an earlier value.

Clinical importance is a local decision. A source becoming inactive must not silently remove an important reaction from the patient's local problem history.

## Interrupted work

If preparation or approval returns an uncertain result, recover the existing operation. Saved operations are discoverable even when the browser's local pointer is lost. Check the recovered status and frozen review details before taking another action.

Explicit abandonment prevents a delayed preparation from reviving the discarded operation. A committed receipt is evidence of the original action; recovering it does not authorize a new delivery or bypass current staff permissions.

## Sharing selected records

The schema6 release format includes all extraction references for each selected local problem. Full imported narratives are selected separately. When a full narrative is omitted, the report says so; source references alone are not the original record.

Compare the synthetic examples [with full narratives](../clinical-review/imported-history-example.html) and [with references alone](../clinical-review/imported-history-references-example.html). Neither is an approved form or a real patient record. Earlier frozen release formats remain unchanged. Current source and delivery checks still apply to new sharing actions.

Dr. Edler's [C11 checklist](../clinical-review/imported-history-and-problems.md) covers the clinical and recipient-facing decisions. Vaccine and prescription imports, source attachments and full migration reconciliation remain separate required work.
