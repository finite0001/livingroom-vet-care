do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='predecessor/hash/short';
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
insert into pg_temp.cr_proof(id,outcome)values('predecessor/hash/short','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='predecessor/hash/number';
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
insert into pg_temp.cr_proof(id,outcome)values('predecessor/hash/number','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/offset';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/offset','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/offset';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/offset','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/offset';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/offset','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/short-fraction';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/short-fraction','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/short-fraction';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/short-fraction','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/short-fraction';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/short-fraction','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/extra-fraction';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/extra-fraction','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/extra-fraction';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/extra-fraction','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/extra-fraction';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/extra-fraction','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/infinity';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/infinity','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/infinity';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/infinity','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/infinity';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/infinity','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/null-string';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/null-string','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/null-string';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/null-string','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/null-string';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/null-string','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/null';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/null','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/null';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/null','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/null';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/null','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/number';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/number','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/number';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/number','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/number';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/number','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/lowercase-z';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/lowercase-z','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/lowercase-z';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/lowercase-z','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/lowercase-z';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/lowercase-z','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/invalid-leap';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/invalid-leap','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/invalid-leap';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/invalid-leap','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/invalid-leap';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/invalid-leap','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/leap-second';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/leap-second','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/leap-second';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/leap-second','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/leap-second';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/leap-second','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/hour24';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/hour24','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/hour24';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/hour24','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/hour24';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/hour24','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/before-range';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/before-range','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/before-range';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/before-range','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/before-range';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/before-range','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/published/upper-exclusive';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/published/upper-exclusive','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/stored-policy/upper-exclusive';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/stored-policy/upper-exclusive','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='timestamp/recorded/upper-exclusive';
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
insert into pg_temp.cr_proof(id,outcome)values('timestamp/recorded/upper-exclusive','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='policy/stored-caller-object';
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
insert into pg_temp.cr_proof(id,outcome)values('policy/stored-caller-object','23514_stored_configuration_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='policy/effective-before-published';
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
insert into pg_temp.cr_proof(id,outcome)values('policy/effective-before-published','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='policy/now-other-instant-coherent-record';
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
insert into pg_temp.cr_proof(id,outcome)values('policy/now-other-instant-coherent-record','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='policy/at-request-differs';
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
insert into pg_temp.cr_proof(id,outcome)values('policy/at-request-differs','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/repeated/kind';
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
insert into pg_temp.cr_proof(id,outcome)values('row/repeated/kind','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/repeated/version';
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
insert into pg_temp.cr_proof(id,outcome)values('row/repeated/version','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/repeated/predecessor_id';
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
insert into pg_temp.cr_proof(id,outcome)values('row/repeated/predecessor_id','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/repeated/predecessor_hash';
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
insert into pg_temp.cr_proof(id,outcome)values('row/repeated/predecessor_hash','23514_configuration_record_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='row/repeated/enabled';
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
insert into pg_temp.cr_proof(id,outcome)values('row/repeated/enabled','23514_configuration_record_invalid');

end
$cr_fixture$;
select pg_temp.cr_conserved();
