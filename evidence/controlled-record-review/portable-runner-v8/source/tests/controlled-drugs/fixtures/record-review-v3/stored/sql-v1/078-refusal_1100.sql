do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/stream/kind';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/stream/kind','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/stream/product_id';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/stream/product_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/stream/site_id';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/stream/site_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/stream/event_kind';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/stream/event_kind','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/stream/capability';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/stream/capability','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/effective-mismatch';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/effective-mismatch','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/nonpolicy-effective';
refused := false;
begin
 perform controlled_review_v3.configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('row/nonpolicy-effective','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-null/publisher_actor_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-null/publisher_actor_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/owner-nonnull/publisher_actor_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/owner-nonnull/publisher_actor_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-null/publisher_session_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-null/publisher_session_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/owner-nonnull/publisher_session_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/owner-nonnull/publisher_session_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-null/authorization_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-null/authorization_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/owner-nonnull/authorization_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/owner-nonnull/authorization_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-kind/owner_bootstrap';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-kind/owner_bootstrap','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-kind/owner_recovery';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-kind/owner_recovery','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-kind/unknown';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-kind/unknown','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-kind/None';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-kind/None','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/staff-kind/True';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/staff-kind/True','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/owner-kind-staff';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/owner-kind-staff','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/bootstrap-successor';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/bootstrap-successor','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/recovery-first';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/recovery-first','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='mode/owner-name';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('mode/owner-name','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/empty';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/empty','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/leading-space';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/leading-space','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/trailing-space';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/trailing-space','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/newline';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/newline','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/tab';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/tab','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/long';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/long','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/null';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/null','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='name/boolean';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_record(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_record_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('name/boolean','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='pair/row/operation_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('pair/row/operation_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='request/field/operation_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('request/field/operation_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='pair/row/record_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('pair/row/record_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='request/field/record_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('request/field/record_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='pair/row/actor_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('pair/row/actor_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='request/field/actor_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('request/field/actor_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='pair/row/mode';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('pair/row/mode','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='pair/row/recorded_at';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('pair/row/recorded_at','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='pair/request-hash';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('pair/request-hash','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/version';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/version','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/operation_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/operation_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/request_hash';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/request_hash','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/record_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/record_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/record_hash';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/record_hash','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/publisher_actor_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/publisher_actor_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/publisher_session_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/publisher_session_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/publisher_name';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/publisher_name','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/authorization_id';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/authorization_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/publication_mode';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/publication_mode','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='receipt/binding/published_at';
refused := false;
begin
 perform controlled_review_v3.validate_configuration_pair(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'configuration_pair_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('receipt/binding/published_at','23514_configuration_pair_invalid');

end
$cr_fixture$;
select pg_temp.cr_conserved();
