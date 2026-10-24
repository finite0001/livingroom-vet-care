-- OWNED CLONE ONLY. Privileged corruption probes bypass selected row guards
-- inside exception subtransactions, then require independent validation to fail.
-- This does not grant application users the database owner's powers.
-- Drain the valid fixture’s deferred events before privileged test-only DDL.
set constraints all immediate;
set constraints all deferred;
create temp table engine_integrity_proof(kind text primary key);
do $$declare kind text;line_id uuid;root uuid;container uuid;cell uuid;before_value jsonb;begin
 select l.id,l.event_id,c.container_id,c.id into line_id,root,container,cell
 from controlled_stock_event_lines l join controlled_stock_cells c on c.id=l.cell_id
 where c.opening_id is not null and c.channel='available'order by l.id limit 1;
 foreach kind in array array['missing_line','forged_quantity','foreign_source','changed_opening','skipped_head',
  'broken_custody_predecessor','rolled_back_state_head','changed_unit','forged_event_hash','forged_event_frame','forged_new_container']loop
  before_value:=pg_temp.engine_full_snapshot();
  begin
   case kind
    when 'missing_line'then
     alter table controlled_stock_event_lines disable trigger immutable;
     delete from controlled_stock_event_lines where id=line_id;
    when 'forged_quantity'then
     alter table controlled_stock_event_lines disable trigger immutable;
     update controlled_stock_event_lines set quantity_delta=-quantity_delta where id=line_id;
    when 'foreign_source'then
     alter table controlled_stock_event_lines disable trigger immutable;
     update controlled_stock_event_lines set source_link_id=(select id from controlled_stock_source_links where event_id<>root order by id limit 1)where id=line_id;
    when 'changed_opening'then
     alter table controlled_stock_cells disable trigger immutable;
     update controlled_stock_cells set opening_quantity=opening_quantity+0.125 where id=cell;
    when 'skipped_head'then
     alter table controlled_stock_container_heads disable trigger controlled_guard;
     update controlled_stock_container_heads set version=version+1 where container_id=container;
    when 'broken_custody_predecessor'then
     alter table controlled_stock_container_transitions disable trigger immutable;
     update controlled_stock_container_transitions set before_custodian_id=null where container_id=container and version_before=0;
    when 'rolled_back_state_head'then
     alter table controlled_stock_states disable trigger controlled_guard;
     update controlled_stock_states set head_id=pg_temp.eid('engine_frozen')where product_id=pg_temp.eid('product');
    when 'changed_unit'then
     alter table controlled_stock_policy_versions disable trigger immutable;
     update controlled_stock_policy_versions set stock_unit='Synthetic wrong unit'where id=pg_temp.eid('engine_policy');
    when 'forged_event_frame'then
     alter table controlled_stock_events disable trigger immutable;
     alter table controlled_stock_actions disable trigger immutable;
     update controlled_stock_events set note='Forged reviewed observation'where id=root;
     update controlled_stock_events e set record_hash=controlled_stock_hash(to_jsonb(e)-'record_hash')where id=root;
     update controlled_stock_actions a set receipt=jsonb_set(a.receipt,'{event}',to_jsonb(e))from controlled_stock_events e where a.id=root and e.id=root;
    when 'forged_new_container'then
     alter table controlled_stock_containers disable trigger immutable;
     update controlled_stock_containers set label='Forged container identity'where id=pg_temp.eid('engine_box1');
     perform controlled_stock_validate_event(pg_temp.eid('dispense'));
    when 'forged_event_hash'then
     alter table controlled_stock_events disable trigger immutable;
     update controlled_stock_events set record_hash=repeat('0',64)where id=root;
   end case;
   perform controlled_stock_validate_event(root);
   perform controlled_stock_validate_product(pg_temp.eid('product'));
   raise exception 'Corrupted % history unexpectedly validated',kind using errcode='P0002';
  exception when check_violation then null;
  end;
  if pg_temp.engine_full_snapshot()is distinct from before_value then raise exception 'Corruption probe % left changes',kind;end if;
  perform controlled_stock_manifest_required();
  insert into engine_integrity_proof values(kind);
 end loop;
end $$;
