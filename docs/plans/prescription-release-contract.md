# Frozen prescription release contract

Schema 8 extends schema 7; existing schemas 1–7 remain readable and confirmable under their existing acceptance rules. No policy is enabled by this migration.

- `preview_record_release_v8(p_pet_id uuid,p_client_id uuid,p_channel text,p_recipient text,p_selection jsonb)` returns `{snapshot,source_hash}`. Selection adds `imported_prescription_ids` (0–20 distinct UUIDs); an entirely empty package remains invalid.
- Snapshot adds `schema_version:8`, `selection.imported_prescription_ids`, and `imported_prescriptions`. Each prescription is exactly `ezyvet_imported_prescription_projection(id)` from migration 6100: immutable header/context, selected `items`, `current`, and `correction_history`. Preserve all context reconciliation, observed/omitted items and explicit partial-account disclosures. No release-only clinical interpretations.
- `list_record_release_sources_v8(p_pet_id uuid,p_offset integer default 0)` composes v7 and adds `imported_prescription_ids`, corresponding `has_more` boolean, and `policy_v8_accepted`. Each candidate has `{id,version,version_hash,recorded_at,label,source_label,completeness,partial_disclosure}`. The last two values come from `context.reviewed.completeness` and `context.reviewed.partial_reason`.
- `select_all_record_release_sources_v8(p_pet_id uuid)` composes v7 selection. More than 20 eligible prescriptions raises an error rather than truncating.
- Existing confirm/read RPCs dispatch schema 8. Public v8 APIs require active staff. Internal validator and trigger helpers are inaccessible to API roles.

Fresh releases require latest current same-patient approved versions. Patient advisory lock 4700 precedes UUID-ordered mapping locks, patient share lock and lexically ordered source-head share locks. Currentness covers parent, supplied consultation, and every observed item (including omitted items). Append-only source-change events invalidate pending packages on each source revision or correction, including changed-and-restored source values. Issued snapshot bytes are never rewritten. Mixed-package original-file verification and prior provenance invalidation include schema 8.
