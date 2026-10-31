-- Owned synthetic catalog controls only. Every DDL change rolls back.
BEGIN;
SET LOCAL quote_all_identifiers=false;
SET LOCAL search_path=pg_catalog,public,pg_temp;
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO,YMD';
SET LOCAL IntervalStyle='postgres';
SET LOCAL extra_float_digits=3;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='5s';
CREATE TEMP TABLE client_constraint_control_baseline ON COMMIT DROP AS
 SELECT controlled_count_entry_v1.module_ordinary_relations() AS value;
DO $validated$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.clients'::regclass
 AND conname='clients_required_contacts_check' AND convalidated)
 THEN RAISE EXCEPTION 'validated_fixture_required';END IF;
END $validated$;

SAVEPOINT unvalidated;
ALTER TABLE public.clients DROP CONSTRAINT clients_required_contacts_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_required_contacts_check
 CHECK (client_contacts_complete(primary_phone,primary_email)) NOT VALID;
DO $unvalidated$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.clients'::regclass
 AND conname='clients_required_contacts_check' AND NOT convalidated)
 OR controlled_count_entry_v1.module_ordinary_relations() IS DISTINCT FROM
 (SELECT value FROM pg_temp.client_constraint_control_baseline)
 THEN RAISE EXCEPTION 'original_unvalidated_form_rejected';END IF;
END $unvalidated$;
ROLLBACK TO SAVEPOINT unvalidated;
RELEASE SAVEPOINT unvalidated;

SAVEPOINT altered_expression;
ALTER TABLE public.clients DROP CONSTRAINT clients_required_contacts_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_required_contacts_check
 CHECK (client_contacts_complete(primary_phone,primary_email) OR true);
DO $altered_expression$ BEGIN
 IF controlled_count_entry_v1.module_ordinary_relations() IS NOT DISTINCT FROM
 (SELECT value FROM pg_temp.client_constraint_control_baseline)
 THEN RAISE EXCEPTION 'changed_expression_accepted';END IF;
END $altered_expression$;
ROLLBACK TO SAVEPOINT altered_expression;
RELEASE SAVEPOINT altered_expression;

SAVEPOINT renamed_check;
ALTER TABLE public.clients RENAME CONSTRAINT clients_required_contacts_check TO unrelated_contact_check;
DO $renamed_check$ BEGIN
 IF controlled_count_entry_v1.module_ordinary_relations() IS NOT DISTINCT FROM
 (SELECT value FROM pg_temp.client_constraint_control_baseline)
 THEN RAISE EXCEPTION 'renamed_check_accepted';END IF;
END $renamed_check$;
ROLLBACK TO SAVEPOINT renamed_check;
RELEASE SAVEPOINT renamed_check;

SAVEPOINT missing_check;
ALTER TABLE public.clients DROP CONSTRAINT clients_required_contacts_check;
DO $missing_check$ BEGIN
 IF controlled_count_entry_v1.module_ordinary_relations() IS NOT DISTINCT FROM
 (SELECT value FROM pg_temp.client_constraint_control_baseline)
 THEN RAISE EXCEPTION 'missing_check_accepted';END IF;
END $missing_check$;
ROLLBACK TO SAVEPOINT missing_check;
RELEASE SAVEPOINT missing_check;

SAVEPOINT other_table;
ALTER TABLE public.pets ADD COLUMN primary_phone text, ADD COLUMN primary_email text;
ALTER TABLE public.pets ADD CONSTRAINT clients_required_contacts_check
 CHECK (client_contacts_complete(primary_phone,primary_email)) NOT VALID;
CREATE TEMP TABLE other_client_constraint_control ON COMMIT DROP AS
 SELECT controlled_count_entry_v1.module_ordinary_relations() AS value;
ALTER TABLE public.pets VALIDATE CONSTRAINT clients_required_contacts_check;
DO $other_table$ BEGIN
 IF controlled_count_entry_v1.module_ordinary_relations() IS NOT DISTINCT FROM
 (SELECT value FROM pg_temp.other_client_constraint_control)
 THEN RAISE EXCEPTION 'other_table_validation_was_normalized';END IF;
END $other_table$;
ROLLBACK TO SAVEPOINT other_table;
RELEASE SAVEPOINT other_table;

SELECT jsonb_build_object('cases',7,
 'raw_client_check_still_validated',EXISTS(SELECT 1 FROM pg_constraint
 WHERE conrelid='public.clients'::regclass AND conname='clients_required_contacts_check' AND convalidated),
 'same_original_metadata',controlled_count_entry_v1.module_ordinary_relations()=
 (SELECT value FROM pg_temp.client_constraint_control_baseline));
ROLLBACK;
