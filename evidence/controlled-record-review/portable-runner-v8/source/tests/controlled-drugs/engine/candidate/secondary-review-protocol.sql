-- Candidate-only retrospective review protocol. The independent assembler owns
-- exact signatures, privileges and metadata; no hosted installation is implied.
-- BEGIN FUNCTION request|jsonb|plpgsql|p_request jsonb
declare k text;
begin
 perform public.controlled_stock_keys(p_request,array['actor_id','operation_id','event_id','definition_id','decision','reason']);
 if octet_length(p_request::text)>131072 then
  raise exception 'Review request exceeds 128 KiB' using errcode='23514';
 end if;
 foreach k in array array['actor_id','operation_id','event_id','definition_id'] loop
  perform public.controlled_stock_uuid(p_request->k);
 end loop;
 if jsonb_typeof(p_request->'decision') is distinct from 'string' or p_request->>'decision' not in('approve','reject') then
  raise exception 'Review decision must be approve or reject' using errcode='23514';
 end if;
 perform public.controlled_stock_text(p_request->'reason',4000,true);
 return p_request;
end
-- END FUNCTION
-- BEGIN FUNCTION entry|void|plpgsql|p_request jsonb
declare actor uuid:=public.controlled_stock_uuid(p_request->'actor_id');
begin
 perform public.controlled_stock_actor(actor);
 perform pg_advisory_xact_lock_shared(90271040,0);
 perform public.controlled_stock_actor(actor);
 perform controlled_review.required();
end
-- END FUNCTION
-- BEGIN FUNCTION current_definition|jsonb|plpgsql|p_request jsonb
declare d controlled_review.definitions;
begin
 select * into d from controlled_review.definitions
 where product_id=public.controlled_stock_uuid(p_request->'product_id')
 and site_id=public.controlled_stock_uuid(p_request->'site_id')
 and event_kind=p_request->>'event_kind' and capability=p_request->>'capability'
 order by version desc limit 1;
 if not found or not d.enabled then return null; end if;
 return to_jsonb(d);
end
-- END FUNCTION
-- BEGIN FUNCTION execution_definition|jsonb|plpgsql|p_request jsonb
declare e public.controlled_stock_events; d jsonb; site_id uuid;
 actor uuid:=public.controlled_stock_uuid(p_request->'actor_id');
begin
 perform public.controlled_stock_actor(actor);
 select * into e from public.controlled_stock_events where id=public.controlled_stock_uuid(p_request->'event_id');
 if not found or not e.secondary_review_required or e.actor_id=actor then
  raise exception 'Independent configured review target required' using errcode='42501';
 end if;
 site_id:=controlled_review.site(e.id);
 d:=controlled_review.current_definition(jsonb_build_object('product_id',e.product_id,'site_id',site_id,
  'event_kind',e.event_kind,'capability','review'));
 if d is null or d->>'id' is distinct from p_request->>'definition_id' or not exists(
  select 1 from public.user_roles r where r.user_id=actor
  and r.role::text in(select jsonb_array_elements_text(d->'roles'))) then
  raise exception 'Current exact review definition and role required' using errcode='42501';
 end if;
 return d;
end
-- END FUNCTION
-- BEGIN FUNCTION operation_gate|void|plpgsql|p_request jsonb
declare req jsonb:=controlled_review.request(p_request->'request');
 actor uuid:=(req->>'actor_id')::uuid; op uuid:=(req->>'operation_id')::uuid;
 stage integer; needs_execution boolean;
begin
 -- Each wait is followed by a new command snapshot for live identity and,
 -- for unsaved signing/new preparation, current execution entitlement.
 perform controlled_review.entry(req);
 for stage in 0..2 loop
  if stage=1 then
   perform pg_advisory_xact_lock(hashtextextended('controlled-review-operation:'||op::text,0));
  elsif stage=2 then
   perform pg_advisory_xact_lock(hashtextextended('controlled-review-event:'||(req->>'event_id'),0));
  end if;
  perform public.controlled_stock_actor(actor);
  needs_execution:=(p_request->>'action'='execute' and not exists(
   select 1 from controlled_review.decisions d join controlled_review.preparations p using(operation_id)
   where d.operation_id=op and p.actor_id=actor and p.canonical_request=req))
   or (p_request->>'action'='prepare' and not exists(
    select 1 from controlled_review.preparations where operation_id=op));
  if needs_execution then perform controlled_review.execution_definition(req); end if;
 end loop;
end
-- END FUNCTION
-- BEGIN FUNCTION operation_state|jsonb|plpgsql|p_request jsonb
declare p controlled_review.preparations; result jsonb; saved jsonb; definition jsonb; visible_packet jsonb;
 actor uuid:=public.controlled_stock_uuid(p_request->'actor_id');
begin
 select * into p from controlled_review.preparations where operation_id=public.controlled_stock_uuid(p_request->'operation_id');
 if not found then
  perform public.controlled_stock_actor(actor);
  return jsonb_build_object('operation_id',p_request->>'operation_id','state','missing');
 end if;
 if p.actor_id<>actor or p.canonical_request is distinct from p_request then
  raise exception 'Review UUID belongs to different work' using errcode='23505';
 end if;
 select receipt into saved from controlled_review.decisions where operation_id=p.operation_id;
 result:=jsonb_build_object('operation_id',p.operation_id,'event_id',p.event_id,'expires_at',p.expires_at,
  'packet_hash',p.packet_hash,'receipt',saved,'state',case
   when saved is not null then 'saved'
   when exists(select 1 from controlled_review.cancellations where operation_id=p.operation_id) then 'cancelled'
   when p.expires_at<=clock_timestamp() then 'expired' else 'prepared' end);
 -- Exact state/receipt recovery does not confer continuing access to the
 -- frozen clinical packet. Only current execution authority exposes it.
 if result->>'state'='prepared' then
  definition:=controlled_review.current_definition(jsonb_build_object('product_id',p.target->'product_id',
   'site_id',p.packet->'controlling_site_id','event_kind',p.packet#>'{event,event_kind}','capability','review'));
  if definition->>'id'=p.definition_id::text and exists(select 1 from public.user_roles r where r.user_id=actor
   and r.role::text in(select jsonb_array_elements_text(definition->'roles'))) then visible_packet:=p.packet; end if;
 end if;
 result:=result||jsonb_build_object('packet',visible_packet);
 perform public.controlled_stock_actor(actor);
 return result;
end
-- END FUNCTION
-- BEGIN FUNCTION public.prepare_controlled_secondary_review|jsonb|plpgsql|p_request jsonb
declare req jsonb:=controlled_review.request(p_request); state jsonb; target jsonb; packet jsonb;
 actor uuid:=(req->>'actor_id')::uuid; op uuid:=(req->>'operation_id')::uuid;
begin
 perform controlled_review.operation_gate(jsonb_build_object('request',req,'action','prepare'));
 state:=controlled_review.operation_state(req);
 if state->>'state'<>'missing' then return state; end if;
 if exists(select 1 from controlled_review.decisions where event_id=(req->>'event_id')::uuid) then
  raise exception 'Review target already has a final decision' using errcode='23505';
 end if;
 perform controlled_review.execution_definition(req);
 perform public.controlled_stock_validate_event((req->>'event_id')::uuid);
 target:=controlled_review.target((req->>'event_id')::uuid);
 packet:=controlled_review.packet(jsonb_build_object('event_id',req->>'event_id','definition_id',req->>'definition_id'));
 perform controlled_review.execution_definition(req);
 perform public.controlled_stock_actor(actor);
 insert into controlled_review.preparations(operation_id,event_id,actor_id,session_id,definition_id,
  target,target_hash,canonical_request,request_hash,packet,packet_hash,decision,reason,meaning_text,meaning_version)
 values(op,(req->>'event_id')::uuid,actor,public.next_visit_review_session(),(req->>'definition_id')::uuid,
  target,public.controlled_stock_hash(target),req,public.controlled_stock_hash(req),packet,public.controlled_stock_hash(packet),
  req->>'decision',req->>'reason','Independent record review; no claim of personal physical observation.',1);
 return controlled_review.operation_state(req);
end
-- END FUNCTION
-- BEGIN FUNCTION public.read_controlled_secondary_review|jsonb|plpgsql|p_request jsonb
declare req jsonb:=controlled_review.request(p_request);
begin
 perform controlled_review.operation_gate(jsonb_build_object('request',req,'action','read'));
 return controlled_review.operation_state(req);
end
-- END FUNCTION
-- BEGIN FUNCTION public.execute_controlled_secondary_review|jsonb|plpgsql|p_request jsonb
declare req jsonb:=controlled_review.request(p_request); state jsonb; p controlled_review.preparations;
 actor uuid:=(req->>'actor_id')::uuid;
begin
 perform controlled_review.operation_gate(jsonb_build_object('request',req,'action','execute'));
 state:=controlled_review.operation_state(req);
 if state->>'state'='saved' then return state; end if;
 if state->>'state'<>'prepared' then
  raise exception 'Committed unexpired uncancelled preparation required' using errcode='PT409';
 end if;
 select * into strict p from controlled_review.preparations where operation_id=(req->>'operation_id')::uuid;
 if exists(select 1 from controlled_review.decisions where event_id=p.event_id) then
  raise exception 'Review target already has a final decision' using errcode='23505';
 end if;
 perform controlled_review.require_prior_commit(p.operation_id);
 perform controlled_review.validate_operation(p.operation_id);
 perform public.controlled_stock_validate_event(p.event_id);
 perform controlled_review.execution_definition(req);
 perform public.controlled_stock_actor(actor);
 if p.expires_at<=clock_timestamp() then
  raise exception 'Preparation expired while waiting; review again with a new UUID' using errcode='PT409';
 end if;
 insert into controlled_review.decisions(operation_id,event_id,actor_id,session_id,definition_id,
  target_hash,request_hash,packet_hash,decision,reason,meaning_text,meaning_version)
 values(p.operation_id,p.event_id,actor,public.next_visit_review_session(),p.definition_id,
  p.target_hash,p.request_hash,p.packet_hash,p.decision,p.reason,p.meaning_text,p.meaning_version);
 return controlled_review.operation_state(req);
end
-- END FUNCTION
-- BEGIN FUNCTION public.cancel_controlled_secondary_review|jsonb|plpgsql|p_request jsonb
declare req jsonb:=controlled_review.request(p_request); state jsonb;
 actor uuid:=(req->>'actor_id')::uuid;
begin
 perform controlled_review.operation_gate(jsonb_build_object('request',req,'action','cancel'));
 state:=controlled_review.operation_state(req);
 if state->>'state' in('saved','cancelled','missing') then return state; end if;
 perform public.controlled_stock_actor(actor);
 insert into controlled_review.cancellations(operation_id,actor_id,session_id)
 values((req->>'operation_id')::uuid,actor,public.next_visit_review_session());
 return controlled_review.operation_state(req);
end
-- END FUNCTION
-- BEGIN FUNCTION event_summary|jsonb|plpgsql|p_request jsonb
declare e public.controlled_stock_events; site_id uuid; read_definition jsonb; execution jsonb;
 saved jsonb; result jsonb; actor uuid:=public.controlled_stock_uuid(p_request->'actor_id');
begin
 select * into e from public.controlled_stock_events where id=public.controlled_stock_uuid(p_request->'event_id');
 if not found or not e.secondary_review_required then return null; end if;
 -- Unsupported historical scope is deliberately indistinguishable from an
 -- unreadable target; a queue never becomes an unsupported-target diagnostic.
 begin site_id:=controlled_review.site(e.id);
 exception when check_violation then return null; end;
 read_definition:=controlled_review.current_definition(jsonb_build_object('product_id',e.product_id,
  'site_id',site_id,'event_kind',e.event_kind,'capability','read'));
 if read_definition is null or not exists(select 1 from public.user_roles r where r.user_id=actor
  and r.role::text in(select jsonb_array_elements_text(read_definition->'roles'))) then return null; end if;
 execution:=controlled_review.current_definition(jsonb_build_object('product_id',e.product_id,
  'site_id',site_id,'event_kind',e.event_kind,'capability','review'));
 select receipt into saved from controlled_review.decisions where event_id=e.id;
 result:=jsonb_build_object('target',controlled_review.target(e.id),'site_id',site_id,'event_kind',e.event_kind,
  'status',case when saved is not null then case when saved->>'decision'='approve' then 'approved' else 'rejected' end
   when execution is null then 'blocked-unconfigured' else 'pending' end,
  'read_definition_id',read_definition->'id','read_definition_version',read_definition->'version',
  'due_at',null,'deadline_state','not_configured','decision',saved);
 return result;
end
-- END FUNCTION
-- BEGIN FUNCTION public.read_controlled_secondary_review_event|jsonb|plpgsql|p_request jsonb
declare result jsonb; actor uuid; definition jsonb;
begin
 perform public.controlled_stock_keys(p_request,array['actor_id','event_id']);
 actor:=public.controlled_stock_uuid(p_request->'actor_id');
 perform public.controlled_stock_uuid(p_request->'event_id');
 perform controlled_review.entry(p_request);
 result:=controlled_review.event_summary(p_request);
 if result is null then raise exception 'Configured readable review target required' using errcode='42501'; end if;
 definition:=controlled_review.current_definition(jsonb_build_object('product_id',result#>'{target,product_id}',
  'site_id',result->'site_id','event_kind',result->'event_kind','capability','read'));
 if definition->'id' is distinct from result->'read_definition_id'
  or definition->'version' is distinct from result->'read_definition_version'
  or not exists(select 1 from public.user_roles r where r.user_id=actor
   and r.role::text in(select jsonb_array_elements_text(definition->'roles'))) then
  raise exception 'Review read scope changed' using errcode='42501';
 end if;
 perform public.controlled_stock_actor(actor);
 return result;
end
-- END FUNCTION
-- BEGIN FUNCTION public.list_controlled_secondary_reviews|jsonb|plpgsql|p_request jsonb
declare actor uuid; product uuid; site_id uuid; kind text; filter text; page_size integer:=25;
 read_definition jsonb; binding jsonb; cursor_value jsonb; after_sequence bigint:=0;
 items jsonb:='[]'; item jsonb;
 e record; more boolean:=false; next_cursor jsonb:=null; last_sequence bigint; scanned integer:=0;
begin
 if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>131072
 or not(p_request ?& array['actor_id','product_id','site_id','event_kind'])
 or exists(select 1 from jsonb_object_keys(p_request) k where k<>all(array[
  'actor_id','product_id','site_id','event_kind','status','page_size','cursor'])) then
  raise exception 'Exact bounded review queue fields required' using errcode='23514';
 end if;
 actor:=public.controlled_stock_uuid(p_request->'actor_id');
 product:=public.controlled_stock_uuid(p_request->'product_id');
 site_id:=public.controlled_stock_uuid(p_request->'site_id');
 kind:=public.controlled_stock_text(p_request->'event_kind',100);
 filter:=p_request->>'status';
 if p_request ? 'status' and (jsonb_typeof(p_request->'status') is distinct from 'string'
  or filter not in('pending','approved','rejected','blocked-unconfigured')) then
  raise exception 'Known review queue status required' using errcode='23514';
 end if;
 if p_request ? 'page_size' then
  if jsonb_typeof(p_request->'page_size') is distinct from 'number' or p_request->>'page_size' !~ '^[1-9][0-9]{0,2}$' then
   raise exception 'Review page size must be 1 through 100' using errcode='23514';
  end if;
  page_size:=(p_request->>'page_size')::integer;
  if page_size>100 then raise exception 'Review page size must be 1 through 100' using errcode='23514'; end if;
 end if;
 perform controlled_review.entry(p_request);
 read_definition:=controlled_review.current_definition(jsonb_build_object('product_id',product,'site_id',site_id,
  'event_kind',kind,'capability','read'));
 if read_definition is null or not exists(select 1 from public.user_roles r where r.user_id=actor
  and r.role::text in(select jsonb_array_elements_text(read_definition->'roles'))) then
  raise exception 'Current explicit review read scope required' using errcode='42501';
 end if;
 binding:=jsonb_build_object('product_id',product,'site_id',site_id,'event_kind',kind,'status',filter,
  'read_definition_id',read_definition->'id','read_definition_version',read_definition->'version');
 if p_request ? 'cursor' then
  cursor_value:=p_request->'cursor';
  perform public.controlled_stock_keys(cursor_value,array['scope','sequence']);
  if cursor_value->'scope' is distinct from binding or jsonb_typeof(cursor_value->'sequence') is distinct from 'string'
   or cursor_value->>'sequence' !~ '^[1-9][0-9]{0,18}$' then
   raise exception 'Review cursor scope or version changed' using errcode='23514';
  end if;
  begin after_sequence:=(cursor_value->>'sequence')::bigint;
  exception when numeric_value_out_of_range then raise exception 'Invalid review cursor sequence' using errcode='23514'; end;
 end if;
 for e in select id,sequence from public.controlled_stock_events
  where product_id=product and event_kind=kind and secondary_review_required
  and sequence>after_sequence order by sequence,id limit 101 loop
  -- Bound work as well as output. Cursor advances over excluded candidates;
  -- an empty page can have a continuation under a sparse site/status filter.
  if jsonb_array_length(items)=page_size or scanned=100 then more:=true; exit; end if;
  scanned:=scanned+1; last_sequence:=e.sequence;
  item:=controlled_review.event_summary(jsonb_build_object('actor_id',actor,'event_id',e.id));
  if item is null or item->>'site_id'<>site_id::text or (filter is not null and item->>'status'<>filter) then continue; end if;
  items:=items||jsonb_build_array((item-'decision')||jsonb_build_object('decision',case
   when item->'decision'='null'::jsonb then null else jsonb_build_object(
    'decision',item->'decision'->'decision','actor_name',item->'decision'->'actor_name',
    'recorded_at',item->'decision'->'recorded_at') end));
 end loop;
 -- The parent's UNIQUE(product_id,sequence) is the complete continuation key.
 -- Do not disclose an excluded target UUID in a last-inspected cursor.
 if more then next_cursor:=jsonb_build_object('scope',binding,'sequence',last_sequence::text); end if;
 -- Re-evaluate scope after the traversal before returning any rows.
 if controlled_review.current_definition(jsonb_build_object('product_id',product,'site_id',site_id,
  'event_kind',kind,'capability','read')) is distinct from read_definition or not exists(
  select 1 from public.user_roles r where r.user_id=actor
  and r.role::text in(select jsonb_array_elements_text(read_definition->'roles'))) then
  raise exception 'Review read scope changed' using errcode='42501';
 end if;
 perform public.controlled_stock_actor(actor);
 return jsonb_build_object('items',items,'next_cursor',next_cursor,'traversal','live_read_committed_keyset',
  'due_at',null,'deadline_state','not_configured');
end
-- END FUNCTION
