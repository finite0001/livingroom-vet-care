do $cr_fixture$
declare refused boolean; actual_code text; actual_message text; returned jsonb; case_input jsonb; expected_value jsonb; expected_text text; item record;
begin
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/schema_version';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/schema_version','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/kind';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/kind','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/scope';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/scope','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/version';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/version','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/predecessor_id';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/predecessor_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/predecessor_hash';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/predecessor_hash','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/enabled';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/enabled','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/body';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/body','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/approval_reference';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/approval_reference','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/missing/calendar_observation';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/missing/calendar_observation','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/extra';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/extra','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/scope/missing/product_id';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/scope/missing/product_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/scope/missing/site_id';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/scope/missing/site_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/scope/missing/event_kind';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/scope/missing/event_kind','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/scope/missing/capability';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/scope/missing/capability','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/scope/extra';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/scope/extra','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/missing/effective_from';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/missing/effective_from','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/missing/calendar_id';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/missing/calendar_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/missing/routing_id';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/missing/routing_id','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/missing/native_deadline_kind';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/missing/native_deadline_kind','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/missing/rules';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/missing/rules','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/extra';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/extra','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/receive_inventory';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/receive_inventory','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/adjust_inventory';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/adjust_inventory','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_patient_treatment';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_patient_treatment','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_anesthesia_drug_administration';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_anesthesia_drug_administration','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_pickup';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_pickup','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return:intake';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return:intake','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return:dispose';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return:dispose','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return:restock';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return:restock','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:intake';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:intake','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:dispose';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:dispose','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:restock';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:restock','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:retract_intake';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:retract_intake','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:retract_disposal';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:retract_disposal','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:retract_restock';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_dispense_return_v2:retract_restock','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:report';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:report','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:note';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:note','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:resolve_corrected';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:resolve_corrected','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:resolve_confirmed_original';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/record_native_return_discrepancy:resolve_confirmed_original','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/append_native_dispense_correction:clinical_annotation';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/append_native_dispense_correction:clinical_annotation','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/append_native_dispense_correction:operational_annotation';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/append_native_dispense_correction:operational_annotation','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/missing/append_native_dispense_correction:pickup_amendment';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/missing/append_native_dispense_correction:pickup_amendment','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/extra';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/extra','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/enabled';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/enabled','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/adapter_version';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/adapter_version','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/meaning';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/meaning','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/quorum';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/quorum','23514_configuration_pair_invalid');
select c.argument_value,c.expected_value,c.expected_text into strict case_input,expected_value,expected_text from pg_temp.cr_cases c where c. id='nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/deadline_mode';
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
insert into pg_temp.cr_proof(id,outcome)values('nested-keys/policy-enabled-first/configuration/document/body/rules/receive_inventory/missing/deadline_mode','23514_configuration_pair_invalid');

end
$cr_fixture$;
select pg_temp.cr_conserved();
