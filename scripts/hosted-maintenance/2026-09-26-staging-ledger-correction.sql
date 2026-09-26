-- One-time correction for staging kothoqicubowyhwfsrte only, before its 32-file upgrade.
-- The two hosted statement arrays match the correspondingly named local +1 files
-- verbatim. Preserve the stored statements while moving their version receipts.
-- The preconditions refuse a changed ledger, SQL body, or baseline schema.
begin;
lock table supabase_migrations.schema_migrations in exclusive mode;
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 119 then
    raise exception 'Staging migration ledger changed';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('20260916100001','20260916110001')) then
    raise exception 'Corrected conversation versions already exist';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version='20260916100000' and name='conversation_attachment_uploads'
        and array_length(statements,1)=24
        and md5(array_to_string(statements,E'\n'))='7eb2051ef3c1851b78ce0dd32915d1f7') then
    raise exception 'Attachment receipt differs from reviewed SQL';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
      where version='20260916110000' and name='conversation_email_preparation'
        and array_length(statements,1)=44
        and md5(array_to_string(statements,E'\n'))='1909a2150e8e7c7d4551cef2fba77bf6') then
    raise exception 'Email receipt differs from reviewed SQL';
  end if;
  if to_regclass('public.conversation_attachment_uploads') is null
     or to_regclass('public.conversation_email_artifacts') is null
     or to_regclass('public.native_return_events') is not null
     or to_regclass('public.native_dispense_finance_operations') is not null then
    raise exception 'Staging schema no longer matches reviewed collision state';
  end if;
  update supabase_migrations.schema_migrations set version='20260916100001' where version='20260916100000';
  update supabase_migrations.schema_migrations set version='20260916110001' where version='20260916110000';
end $$;
commit;
