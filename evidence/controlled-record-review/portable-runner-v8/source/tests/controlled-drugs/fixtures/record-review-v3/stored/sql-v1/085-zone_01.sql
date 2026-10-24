begin;
set local timezone='America/Denver';
insert into pg_temp.cr_context select pg_temp.cr_session();
do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-enabled-first/D';
returned := controlled_review_v3.validate_stored_configuration(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-enabled-first/R';
returned := controlled_review_v3.validate_configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-enabled-first/Q';
returned := controlled_review_v3.configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-enabled-first/pair';
returned := controlled_review_v3.validate_configuration_pair(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-at/D';
returned := controlled_review_v3.validate_stored_configuration(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-at/R';
returned := controlled_review_v3.validate_configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-at/Q';
returned := controlled_review_v3.configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/policy-at/pair';
returned := controlled_review_v3.validate_configuration_pair(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/calendar-fold1/D';
returned := controlled_review_v3.validate_stored_configuration(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/calendar-fold1/R';
returned := controlled_review_v3.validate_configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/calendar-fold1/Q';
returned := controlled_review_v3.configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='positive/calendar-fold1/pair';
returned := controlled_review_v3.validate_configuration_pair(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='primitive/D/version/fractional';
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
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='primitive/R/version/fractional';
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
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='primitive/Q/version-visible-fraction';
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
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='primitive/pair/receipt-version-visible-fraction';
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
if(select count(*)from pg_temp.cr_context)<>1 or(select value from pg_temp.cr_context)is distinct from pg_temp.cr_session()then raise exception 'record_fixture_zone_context_leaked';end if;

end
$cr_fixture$;
rollback;
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-enabled-first/D','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-enabled-first/R','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-enabled-first/Q','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-enabled-first/pair','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-at/D','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-at/R','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-at/Q','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/policy-at/pair','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/calendar-fold1/D','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/calendar-fold1/R','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/calendar-fold1/Q','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:positive/calendar-fold1/pair','literal_success');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:primitive/D/version/fractional','23514_stored_configuration_invalid');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:primitive/R/version/fractional','23514_configuration_record_invalid');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:primitive/Q/version-visible-fraction','23514_configuration_record_invalid');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:primitive/pair/receipt-version-visible-fraction','23514_configuration_pair_invalid');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:timestamp/stored-policy/extra-fraction','23514_stored_configuration_invalid');
insert into pg_temp.cr_proof(id,outcome)values('zone:America/Denver:timestamp/published/offset','23514_configuration_record_invalid');
select pg_temp.cr_conserved();
