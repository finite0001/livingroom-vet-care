# Reviewed ezyVet contact and patient imports

Living Room Vet is the primary system. The read-only adapter stages observations; this separate administrator workflow may create a reviewed household/patient or link an existing record. It never copies later source changes over local fields, transfers existing patient ownership, deletes absent records, or writes back to ezyVet.

## Operator workflow

Open the administrator-only ezyVet review page at `/hub/tools/ezyvet`. Source staging is unavailable unless the server's documented configuration permits it. The page exposes no credentials and reports disabled/provider failures explicitly; a completed scan only means records are staged.

Select a paginated snapshot and review the named source fields. For contacts, correct the name and enter verified contact/address values; addresses and contact details are not guessed from unrelated source IDs. For animals, resolve the source `contact_id` to an approved local household first. Choose species, breed, sex and neuter status from verified information rather than interpreting foreign reference IDs. Suggested epoch birth/death dates use UTC calendar dates and must be reviewed. No weight, SOAP history, diagnoses or vaccine administrations are created by this workflow.

Choose either:

- **Create a reviewed record:** confirm corrected values, household identity and duplicate checking, then provide a reason and explicitly approve.
- **Link an existing record:** select the local record and confirm identity. Patients are limited to the mapped household. All existing fields remain unchanged.

A lost response keeps the approval UUID and input values. Use **Recheck approval status** to discover a committed result before editing or retrying. Server idempotency also prevents duplicate creation. Existing links expose the local record and approval provenance. Source snapshots and earlier review proposals remain readable; later observations cannot overwrite an approved mapping.

## Database invariants

Migration `20260913040000_ezyvet_review_import.sql` adds `ezyvet_identity_heads` and `ezyvet_record_links`. Each observed page item updates its external identity's head only if the snapshot changed. This works when the source reverts to an older deduplicated payload as well as when it creates a new snapshot.

Approval supplies the expected snapshot hash and observation version. A row lock serializes approval against concurrent source observations. The RPC independently checks canonical active-admin status and uses `auth.uid()` for the actor. Source host, site, resource and external ID uniquely identify the approved link; trial and production identities remain separate. Retry UUID plus request fingerprint prevents altered retries. Staff cannot mutate link/history tables directly, and the service role cannot execute the approval RPC.

The RPC calls existing `save_client` / `save_patient` validators when creating records. Linking uses the reviewed local version and never calls an update operation. An animal's source owner must resolve through a contact link in the same source host/site. A patient in another local household is rejected rather than transferred. The immutable approval stores snapshot, head version, local version, action, reason and staff actor. An already-linked source identity cannot be approved again to overwrite a record.

## Verification and remaining work

Synthetic unit checks cover safe field suggestions, preservation of microchip leading zeros, and avoiding invented species/sex/contact details. SQL checks cover active-admin access, stale source/hash/local versions, actor provenance, duplicate requests, source/site and ownership mismatches, immutable links, and preservation of local fields on later source observations. Browser checks cover corrected contact creation, lost-response recovery, patient linking, server-disabled staging and nonadministrator denial.

The admin route must be wired with an ADMIN `ProtectedRoute` before rollout; the component also independently disables all queries for nonadmins. Apply both ezyVet migrations and regenerate Supabase types before enabling the UI. Real-credential source validation, field mapping acceptance and supervised migration rehearsal remain commissioning requirements. Reference and clinical resources are retained as staged snapshots only. This increment does not implement diagnosis/record/attachment promotion or historical chart conversion; those need separately reviewed mappings and clinical acceptance by Dr. Susan Edler.
