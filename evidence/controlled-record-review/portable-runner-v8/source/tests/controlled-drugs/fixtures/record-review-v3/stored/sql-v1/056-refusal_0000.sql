do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/D/json-null';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/D/json-null','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/D/array';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/D/array','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/D/string';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/D/string','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/D/boolean';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/D/boolean','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/D/number';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/D/number','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/D/sql-null';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/D/sql-null','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/schema_version';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/schema_version','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/kind';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/kind','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/scope';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/scope','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/version';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/version','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/predecessor_id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/predecessor_id','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/predecessor_hash';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/predecessor_hash','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/enabled';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/enabled','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/body';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/body','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/approval_reference';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/approval_reference','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/missing/calendar_observation';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/missing/calendar_observation','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/D/extra';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/D/extra','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/R/json-null';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/R/json-null','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/R/array';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/R/array','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/R/string';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/R/string','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/R/boolean';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/R/boolean','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/R/number';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/R/number','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/R/sql-null';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/R/sql-null','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/schema_version';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/schema_version','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/kind';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/kind','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/scope';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/scope','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/version';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/version','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/predecessor_id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/predecessor_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/predecessor_hash';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/predecessor_hash','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/enabled';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/enabled','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/body';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/body','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/approval_reference';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/approval_reference','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/calendar_observation';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/calendar_observation','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/publication_operation_id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/publication_operation_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/published_at';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/published_at','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/publisher_actor_id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/publisher_actor_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/publisher_session_id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/publisher_session_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/publisher_name';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/publisher_name','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/authorization_id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/authorization_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/publication_mode';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/publication_mode','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/missing/record_hash';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/missing/record_hash','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/R/extra';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/R/extra','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/Q/json-null';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/Q/json-null','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/Q/array';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/Q/array','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/Q/string';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/Q/string','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/Q/boolean';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/Q/boolean','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/Q/number';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/Q/number','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='outer/Q/sql-null';
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
insert into pg_temp.cr_proof(id,outcome)values('outer/Q/sql-null','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='keys/Q/missing/id';
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
insert into pg_temp.cr_proof(id,outcome)values('keys/Q/missing/id','23514_configuration_record_invalid');

end
$cr_fixture$;
select pg_temp.cr_conserved();
