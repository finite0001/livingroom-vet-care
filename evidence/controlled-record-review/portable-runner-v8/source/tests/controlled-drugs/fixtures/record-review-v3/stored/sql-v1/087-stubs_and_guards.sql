do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
case_input := '{}'::jsonb;
refused := false;
begin
 perform public.prepare_controlled_record_review_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.prepare_controlled_record_review_v3','0A000_stub');
refused := false;
begin
 perform public.read_controlled_record_review_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.read_controlled_record_review_v3','0A000_stub');
refused := false;
begin
 perform public.execute_controlled_record_review_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.execute_controlled_record_review_v3','0A000_stub');
refused := false;
begin
 perform public.cancel_controlled_record_review_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.cancel_controlled_record_review_v3','0A000_stub');
refused := false;
begin
 perform public.get_controlled_record_review_event_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.get_controlled_record_review_event_v3','0A000_stub');
refused := false;
begin
 perform public.list_controlled_record_reviews_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.list_controlled_record_reviews_v3','0A000_stub');
refused := false;
begin
 perform public.publish_controlled_review_configuration_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.publish_controlled_review_configuration_v3','0A000_stub');
refused := false;
begin
 perform public.read_controlled_review_publication_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.read_controlled_review_publication_v3','0A000_stub');
refused := false;
begin
 perform public.get_controlled_review_configuration_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.get_controlled_review_configuration_v3','0A000_stub');
refused := false;
begin
 perform public.record_controlled_review_escalation_action_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.record_controlled_review_escalation_action_v3','0A000_stub');
refused := false;
begin
 perform public.get_controlled_review_backlog_v3(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:public.get_controlled_review_backlog_v3','0A000_stub');
refused := false;
begin
 perform controlled_review_v3.publish_administration(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:controlled_review_v3.publish_administration','0A000_stub');
refused := false;
begin
 perform controlled_review_v3.materialize_one(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:controlled_review_v3.materialize_one','0A000_stub');
refused := false;
begin
 perform controlled_review_v3.record_scan(case_input);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 Gate B private A1; protocol is not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('stub:controlled_review_v3.record_scan','0A000_stub');
refused := false;
begin
 insert into pg_temp.cr_guard_immutable_guard(id)values(1);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'Record-review v3 Gate B private A1 evidence is immutable' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('internal-guard:immutable_guard','23514_internal_guard');
refused := false;
begin
 insert into pg_temp.cr_guard_refuse_insert(id)values(1);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 structural Gate B private A1; operational writes are not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('internal-guard:refuse_insert','0A000_internal_guard');
refused := false;
begin
 insert into pg_temp.cr_guard_terminal_check(id)values(1);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 structural Gate B private A1; terminal semantics are not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('internal-guard:terminal_check','0A000_internal_guard');
refused := false;
begin
 insert into controlled_review_v3.operation_claims(operation_id,actor_id,claimed_at)values('d4444444-4444-4444-8444-444444444444','c3333333-3333-4333-8333-333333333333','2026-01-01T00:00:00.000000Z'::timestamptz);
exception when feature_not_supported then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '0A000' or actual_message <> 'Record-review v3 structural Gate B private A1; operational writes are not implemented' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('permanent-guard:operation_claims','0A000_refuse_insert');

end
$cr_fixture$;
select pg_temp.cr_conserved();
