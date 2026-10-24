begin;
set local role service_role;
do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
case_input := '{}'::jsonb;
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.validate_calendar_observation(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.validate_configuration(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.prepare_controlled_record_review_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function prepare_controlled_record_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.read_controlled_record_review_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function read_controlled_record_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.execute_controlled_record_review_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function execute_controlled_record_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.cancel_controlled_record_review_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function cancel_controlled_record_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.get_controlled_record_review_event_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function get_controlled_record_review_event_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.list_controlled_record_reviews_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function list_controlled_record_reviews_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.publish_controlled_review_configuration_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function publish_controlled_review_configuration_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.read_controlled_review_publication_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function read_controlled_review_publication_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.get_controlled_review_configuration_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function get_controlled_review_configuration_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.record_controlled_review_escalation_action_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function record_controlled_review_escalation_action_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform public.get_controlled_review_backlog_v3(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for function get_controlled_review_backlog_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.publish_administration(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.materialize_one(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
refused := false;
begin
 perform controlled_review_v3.record_scan(case_input);
exception when insufficient_privilege then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '42501' or actual_message <> 'permission denied for schema controlled_review_v3' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;

end
$cr_fixture$;
rollback;
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.validate_stored_configuration','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.validate_configuration_record','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.configuration_record','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.validate_configuration_pair','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.validate_calendar_observation','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.validate_configuration','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.prepare_controlled_record_review_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.read_controlled_record_review_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.execute_controlled_record_review_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.cancel_controlled_record_review_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.get_controlled_record_review_event_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.list_controlled_record_reviews_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.publish_controlled_review_configuration_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.read_controlled_review_publication_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.get_controlled_review_configuration_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.record_controlled_review_escalation_action_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:public.get_controlled_review_backlog_v3','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.publish_administration','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.materialize_one','42501_privilege_boundary');
insert into pg_temp.cr_proof(id,outcome)values('acl:service_role:controlled_review_v3.record_scan','42501_privilege_boundary');
select pg_temp.cr_conserved();
