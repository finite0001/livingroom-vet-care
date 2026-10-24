do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/positive/calendar-fractional-offset-20700/D';
returned := controlled_review_v3.validate_stored_configuration(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/positive/calendar-fractional-offset-20700/D','literal_success');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/positive/calendar-fractional-offset-20700/R';
returned := controlled_review_v3.validate_configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/positive/calendar-fractional-offset-20700/R','literal_success');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/positive/calendar-fractional-offset-20700/Q';
returned := controlled_review_v3.configuration_record(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/positive/calendar-fractional-offset-20700/Q','literal_success');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='boundary/positive/calendar-fractional-offset-20700/pair';
returned := controlled_review_v3.validate_configuration_pair(case_input);
if returned is null or returned is distinct from expected_value or convert_to(returned::text,'UTF8') is distinct from convert_to(expected_text,'UTF8') then raise exception 'record_fixture_literal_output_mismatch';end if;
if returned is distinct from case_input then raise exception 'record_fixture_input_changed';end if;
insert into pg_temp.cr_proof(id,outcome)values('boundary/positive/calendar-fractional-offset-20700/pair','literal_success');

end
$cr_fixture$;
select pg_temp.cr_conserved();
