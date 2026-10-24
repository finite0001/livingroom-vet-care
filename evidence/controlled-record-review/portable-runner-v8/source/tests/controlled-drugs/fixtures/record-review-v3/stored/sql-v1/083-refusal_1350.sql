do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/row/version/string';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/row/version/string','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/stream-type/kind';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/stream-type/kind','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/stream-type/product_id';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/stream-type/product_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/stream-type/site_id';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/stream-type/site_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/stream-type/event_kind';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/stream-type/event_kind','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/stream-type/capability';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/stream-type/capability','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/approval/empty';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/approval/empty','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/approval/leading-space';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/approval/leading-space','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/approval/trailing-space';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/approval/trailing-space','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/approval/newline';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/approval/newline','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/approval/tab';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/approval/tab','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/approval/too-long';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/approval/too-long','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/policy/now-at-not-null';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/policy/now-at-not-null','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/policy/at-null';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/policy/at-null','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/policy/effective-mode-unknown';
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
insert into pg_temp.cr_proof(id,outcome)values('supplement/policy/effective-mode-unknown','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/staffed-type';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/staffed-type','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/fold-out-of-range';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/fold-out-of-range','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/offset-null';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/offset-null','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/offset-string';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/offset-string','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/offset-too-negative';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/offset-too-negative','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/closed-with-close_local';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/closed-with-close_local','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/closed-with-close_fold';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/closed-with-close_fold','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='supplement/calendar/closed-with-close_utc';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('supplement/calendar/closed-with-close_utc','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/publisher-name-0';
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
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/publisher-name-0','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/approval-reference-0';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/approval-reference-0','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/publisher-name-201';
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
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/publisher-name-201','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/approval-reference-201';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/approval-reference-201','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/owner-reason-0';
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
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/owner-reason-0','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/owner-reason-4001';
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
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/owner-reason-4001','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/roster-administration-101';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/roster-administration-101','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/roster-administration-enabled-zero';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/roster-administration-enabled-zero','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/roster-eligibility-101';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/roster-eligibility-101','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/roster-eligibility-enabled-zero';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/roster-eligibility-enabled-zero','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/roster-routing-101';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/roster-routing-101','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/roster-routing-enabled-zero';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/roster-routing-enabled-zero','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/policy-lower-minus-microsecond';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/policy-lower-minus-microsecond','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/policy-at-minus-one-microsecond';
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
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/policy-at-minus-one-microsecond','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/policy-now-resolved-plus-one-microsecond';
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
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/policy-now-resolved-plus-one-microsecond','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/fractional-offset-20699';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/fractional-offset-20699','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/negative/fractional-offset-20701';
refused := false;
begin
 perform controlled_review_v3.validate_stored_configuration(case_input);
exception when check_violation then
 get stacked diagnostics actual_code = returned_sqlstate, actual_message = message_text;
 if actual_code <> '23514' or actual_message <> 'stored_configuration_invalid' then
  raise exception 'record_fixture_wrong_primary_error: % %',actual_code,actual_message;
 end if;
 refused := true;
end;
if not refused then raise exception 'record_fixture_expected_refusal';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/negative/fractional-offset-20701','23514_stored_configuration_invalid');

end
$cr_fixture$;
select pg_temp.cr_conserved();
