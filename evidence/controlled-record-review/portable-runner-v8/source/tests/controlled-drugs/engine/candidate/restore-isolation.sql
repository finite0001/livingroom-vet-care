-- OWNED RESTORE CLONE ONLY. The caller substitutes a fixed allowlisted SQL
-- isolation level, never caller-controlled text. Claims here are SQL fixtures.
begin isolation level __ISOLATION__;
create temp table restored_isolation_checks(n integer);
do $$declare r public.controlled_stock_preparations;operation text;n integer:=0;begin
 select * into r from public.controlled_stock_preparations order by created_at limit 1;
 if r.id is null then raise exception 'Populated controlled restore fixture required';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',r.actor_id,'session_id',r.session_id)::text,true);
 foreach operation in array array['read','execute','cancel','prepare']loop
  begin
   case operation
    when 'read'then perform read_controlled_stock_action(r.actor_id,r.id);
    when 'execute'then perform execute_controlled_stock_action(r.actor_id,r.id);
    when 'cancel'then perform cancel_controlled_stock_action(r.actor_id,r.id);
    when 'prepare'then perform prepare_controlled_stock_action(r.actor_id,gen_random_uuid(),r.writer,r.canonical_arguments,r.context);
   end case;
   raise exception 'Unsupported isolation accepted %',operation using errcode='P0002';
  exception when check_violation then
   if sqlerrm<>'Controlled stock requires READ COMMITTED isolation'then raise;end if;
  end;
  n:=n+1;
 end loop;
 insert into restored_isolation_checks values(n);
end $$;
select jsonb_build_object('kind','controlled-restored-isolation','level',current_setting('transaction_isolation'),'checks',n)from restored_isolation_checks;
rollback;
