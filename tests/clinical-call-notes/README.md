# Private call-note source boundary — Phase 3B.1

This increment adds immutable call-source bindings and one versioned ADMIN history reader. It does not add a call reservation, generation, policy-edit, list or acceptance RPC. Existing note/dictation/audio paths must reject or filter call-derived jobs and proposals even for administrators and even with fictional approved policies. No provider request or clinical chart insertion is part of this proof.

The owner-only fictional fixture functions in `supabase/tests/clinical_call_note_sources.test.sql` deliberately seed historical jobs, attempts, proposals and reflected receipts that the current application cannot generate. They also seed valid typed, audio-backed template and direct clinician-audio history, without calling OpenAI or CloudTalk. These are security/compatibility fixtures, not clinical approval or an available call-summary workflow.

```sh
python3 -B tests/clinical-call-notes/disposable.py --run-synthetic-local --evidence-prefix clinical-calls-notes-local-unique
```

The runner refuses an existing evidence prefix before creating a runtime. Use a fresh prefix for every diagnostic and final run; preserve earlier failures. It uses uniquely owned local Supabase containers on ports 65420/65421/65422/65424, verifies Docker project/workdir ownership, reads only that runtime's Auth keys and pauses only its scheduler. No `.env`, hosted link or hosted key is read or modified. Private artifacts use the already ignored `tmp/clinical-calls-*` prefix.

The complete proof starts with 201 canonical migrations and real local Auth users, captures actual legacy RPC JSON and raw UTF8 response bytes, then applies migration 202 through the CLI's explicit local upgrade. It checks the new SQL suite and repeats legacy reads after adding newer private call rows. The unchanged frontend Zod models, field assembly, source checks and receipt verifiers consume those actual responses. Historical source authority is checked after signing, old-session loss, policy/template changes, role/session changes during observed row-lock waits, current household/provider identity changes, inactive/banned readers and direct private table attempts.

The populated restore compares relevant source/job/review/audio relation contents and all public routine definitions, owners and effective grants. Restored authenticated SQL reads are validated through the same frontend models. This is not an actual browser or iPhone acceptance test, and does not represent the new call source reader as a completed frontend generation workflow.

`--sql-only` installs the complete current 202-migration stack and runs only the targeted SQL suite. Its input inventory includes only canonical migrations, that SQL test and the runner; unused frontend/audio helper files are excluded. Full mode binds those helpers and the unchanged frontend/shared model modules too. Every successful run verifies all recorded input hashes again and checks removal of owned containers, volumes and private working files.

Local security advisors run before and after the upgrade with `--level warn --fail-on error`. Their private artifacts and exit statuses are retained separately; existing findings are not silently waived, and tests never add grants or relax RLS to clear an advisor.
