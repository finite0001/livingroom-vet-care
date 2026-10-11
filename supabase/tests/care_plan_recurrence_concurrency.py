"""Observed PostgreSQL care/eligibility races in an explicitly owned synthetic local stack."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time
import tomllib
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-synthetic-local', action='store_true')
parser.add_argument('--project-config', required=True, type=Path)
args = parser.parse_args()
if not args.run_synthetic_local:
    parser.error('Explicit --run-synthetic-local required')
config = args.project_config.resolve()
project = tomllib.loads(config.read_text())['project_id']
container = 'supabase_db_' + project
labels = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['Config']['Labels']
assert labels['com.supabase.cli.project'] == project
assert Path(labels['com.supabase.cli.workdir']).resolve() == config.parent.parent
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']

def sql(query):
    result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def identity():
    return str(uuid.uuid4())

actor, client, template, wording = [identity() for _ in range(4)]
processes = []
owned_pets = []
checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1

def auth(role='authenticated'):
    claims = {'role': role, **({'sub': actor} if role == 'authenticated' else {})}
    return f"set local role {role};select set_config('request.jwt.claims',{quote(json.dumps(claims))},true);"

def transaction(query, role='authenticated'):
    return sql('begin;' + auth(role) + query + ';commit;').splitlines()[-1]

def holder(query, role='authenticated'):
    first = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(first)
    first.stdin.write(f"begin;set local statement_timeout='20s';{auth(role)}{query};\n\\echo CARE_READY\n")
    first.stdin.flush()
    while True:
        line = first.stdout.readline()
        if 'CARE_READY' in line:
            return first
        if not line:
            raise RuntimeError(first.stderr.read())

def release(first):
    first.stdin.write('commit;\n');first.stdin.close()
    check(first.wait(timeout=25) == 0, first.stderr.read())

def race(first_query, second_query, first_role='authenticated', second_role='authenticated', expected_error=None, expire=None):
    first = holder(first_query, first_role)
    tag = 'lrv_care_wait_' + uuid.uuid4().hex
    second = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(second)
    second.stdin.write(f"begin;set application_name='{tag}';set local statement_timeout='20s';set local client_min_messages='error';\\set VERBOSITY verbose\n{auth(second_role)}{second_query};commit;\n")
    second.stdin.close()
    deadline = time.monotonic() + 12
    observed = False
    while time.monotonic() < deadline:
        if sql(f"select count(*) from pg_stat_activity where application_name='{tag}' and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0;") == '1':
            observed = True;break
        if second.poll() is not None:
            break
        time.sleep(.03)
    check(observed, 'Competing operation must demonstrably wait on the first transaction')
    if expire:
        while time.monotonic() < deadline:
            if sql(f"select lease_expires_at<clock_timestamp() from communication_outbox where id='{expire}';") == 't':
                break
            time.sleep(.03)
        else:
            raise AssertionError('Lease did not demonstrably expire while waiting')
    release(first)
    code = second.wait(timeout=25);out = second.stdout.read();err = second.stderr.read()
    check(code != 0 and expected_error in err if expected_error else code == 0, err or out)

plan_values = {'template_id': template, 'template_version': 1, 'name': 'Synthetic recurring care race', 'interval_amount': 1,
               'interval_unit': 'months', 'anchor_mode': 'completed_care', 'month_end': 'clamp', 'anchor_on': '2026-01-31',
               'due_on': '2026-02-28', 'status': 'current', 'reminders_enabled': True, 'override_reason': '',
               'review_note': 'Synthetic clinical review', 'replace_anchor_evidence': False}

def save_plan(plan, pet, version, changes=None):
    values = {**plan_values, **(changes or {})}
    return f"select save_patient_care_plan('{identity()}','{plan}','{pet}',{version if version else 'null'},{quote(json.dumps(values))}::jsonb)"

def fixture():
    pet, plan = identity(), identity();owned_pets.append(pet)
    sql(f"insert into pets(id,client_id,name,species) values('{pet}','{client}','Synthetic care race dog','Dog');")
    transaction(save_plan(plan, pet, None))
    return pet, plan

def handoff(plan):
    plan_version = int(sql(f"select version from patient_care_plans where id='{plan}';"))
    wording_version = int(sql(f"select version from care_message_templates where id='{wording}';"))
    row = json.loads(transaction(f"select to_jsonb(enqueue_care_reminder('{identity()}','care_plan','{plan}',{plan_version},'{wording}',{wording_version}))", 'service_role'))
    outbox = json.loads(transaction(f"select to_jsonb(queue_reminder_outbox('care','{row['id']}','{policy}'))", 'service_role'))['outbox_id']
    claimed = json.loads(transaction('select to_jsonb(claim_communication())', 'service_role'))
    check(claimed['id'] == outbox, 'Only owned candidate is claimed')
    return outbox, claimed['lease_token']

def start(outbox, lease):
    return f"select to_jsonb(start_communication_attempt('{outbox}','{lease}','{{\"from\":\"verified@example.test\",\"reply_to\":\"reply@example.test\"}}'))"

def death(pet):
    return f"select save_patient('{pet}','{client}',1,'Synthetic care race dog','Dog',null,null,'unknown',null,'unknown','unknown',null,null,(clock_timestamp() at time zone 'America/Denver')::date)"

def source(pet):
    event, encounter, product = [identity() for _ in range(3)]
    sql(f"begin;select set_config('request.jwt.claims','{{\"sub\":\"{actor}\",\"role\":\"authenticated\"}}',true);insert into clinical_encounters(id,pet_id,visit_at,visit_type,created_by,updated_by) values('{encounter}','{pet}','2026-03-31T18:00Z','clinic','{actor}','{actor}');insert into catalog_products(id,name,kind,unit,unit_price_cents,created_by) values('{product}','Synthetic care race evidence','service','visit',100,'{actor}');commit;")
    request = {'pet_id': pet, 'encounter_id': encounter, 'product_id': product, 'clinician_id': actor, 'performed_at': '2026-03-31T18:00:00Z', 'notes': 'Synthetic actual care', 'invoice_id': None}
    transaction(f"select record_patient_service('{event}',{quote(json.dumps(request))}::jsonb)")
    return event

def complete(action, plan, pet, event, note='Synthetic completed care review'):
    request = {'source_kind': 'service', 'source_id': event, 'source_version': 1, 'review_note': note}
    return f"select complete_patient_care_plan('{action}','{plan}','{pet}',1,{quote(json.dumps(request))}::jsonb)"

def attempts(outbox):
    return int(sql(f"select count(*) from communication_attempts where outbox_id='{outbox}';"))

try:
    check(sql("select count(*) from communication_outbox where state in ('pending','claimed');") == '0', 'No unrelated claimable work')
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{actor}','synthetic-care-race-{actor}@example.test','{{}}');update profiles set is_active=true,full_name='Synthetic care race DVM' where id='{actor}';insert into user_roles(user_id,role) values('{actor}','DVM'),('{actor}','ADMIN');insert into clients(id,first_name,last_name,full_name,primary_phone,primary_email,preferred_channel) values('{client}','Synthetic','Care Race','Synthetic Care Race','+12025550173','synthetic-care-race@example.test','EMAIL');")
    values = {'care_key': 'synthetic-' + template, 'name': plan_values['name'], 'care_kind': 'wellness', 'interval_amount': 1, 'interval_unit': 'months', 'anchor_mode': 'completed_care', 'month_end': 'clamp', 'active': True, 'review_note': 'Synthetic review'}
    transaction(f"select save_recurring_care_template('{identity()}','{template}',null,{quote(json.dumps(values))}::jsonb)")
    transaction(f"select save_care_message_template('{wording}',null,'Synthetic care race wording','email',0,'{{{{patient_name}}}} {{{{care_name}}}} {{{{due_date}}}}',true,'Synthetic review')")
    existing = sql("select id||':'||version from reminder_automation_policies where source_kind='care_plan' and channel='EMAIL';")
    policy, version = existing.split(':') if existing else (identity(), 'null')
    policy_values = {'channel': 'EMAIL', 'message_template_id': wording, 'message_template_version': 1, 'subject': 'Synthetic race care', 'enabled': True, 'review_note': 'Synthetic full-day window', 'start_minute': 0, 'end_minute': 1440}
    transaction(f"select save_care_plan_delivery_policy('{identity()}','{policy}',{version},{quote(json.dumps(policy_values))}::jsonb)")

    pet, plan = fixture();outbox, lease = handoff(plan)
    race(death(pet), start(outbox, lease), second_role='service_role')
    check(attempts(outbox) == 0 and sql(f"select state from communication_outbox where id='{outbox}';") == 'failed', 'Death first blocks provider start')

    pet, plan = fixture();outbox, lease = handoff(plan)
    race(start(outbox, lease), death(pet), first_role='service_role')
    check(attempts(outbox) == 1 and sql(f"select state from communication_outbox where id='{outbox}';") == 'claimed', 'Start first retains the in-flight attempt after death')
    # Provider outcome recording must proceed even while another eligibility operation holds the gate.
    gate = holder('select care_eligibility_lock()', 'postgres')
    outcome = json.loads(transaction(f"select to_jsonb(finish_communication_attempt('{outbox}','{lease}','accepted','synthetic-email-{outbox}',null))", 'service_role'))
    check(outcome['state'] == 'accepted', 'Provider acceptance is recorded without taking the eligibility gate')
    release(gate)

    pet, plan = fixture();event = source(pet);action = identity()
    race(complete(action, plan, pet, event), complete(action, plan, pet, event))
    check(sql(f"select count(*) from care_plan_completions where plan_id='{plan}';") == '1', 'Concurrent exact completion retry records one physical completion')
    check(sql(f"select version from patient_care_plans where id='{plan}';") == '2', 'Concurrent replay advances once')
    outbox, lease = handoff(plan)
    correction = f"select correct_patient_service('{identity()}','{pet}','{event}','Synthetic correction',null)"
    race(correction, start(outbox, lease), second_role='service_role')
    check(attempts(outbox) == 0, 'Corrected completion source first blocks provider start')

    pet, plan = fixture();event = source(pet);action = identity()
    race(complete(action, plan, pet, event), complete(action, plan, pet, event, 'Changed review'), expected_error='23505')
    check(sql(f"select count(*) from care_plan_completions where plan_id='{plan}';") == '1', 'Changed action payload cannot create a second completion')
    outbox, lease = handoff(plan)
    correction = f"select correct_patient_service('{identity()}','{pet}','{event}','Synthetic correction',null)"
    race(start(outbox, lease), correction, first_role='service_role')
    check(attempts(outbox) == 1, 'Started provider attempt survives later source correction')
    transaction(f"select finish_communication_attempt('{outbox}','{lease}','uncertain',null,'Synthetic unknown result')", 'service_role')
    check(sql(f"select state from communication_outbox where id='{outbox}';") == 'uncertain', 'Source correction preserves provider uncertainty')

    pet, plan = fixture();outbox, lease = handoff(plan)
    race(save_plan(plan, pet, 1, {'status': 'paused', 'reminders_enabled': False}), start(outbox, lease), second_role='service_role')
    check(attempts(outbox) == 0, 'Pause first blocks provider start')

    pet, plan = fixture();outbox, lease = handoff(plan)
    old_wording_version = int(sql(f"select version from care_message_templates where id='{wording}';"))
    change_wording = f"select save_care_message_template('{wording}',{old_wording_version},'Changed race wording','email',0,'{{{{patient_name}}}} changed {{{{care_name}}}} {{{{due_date}}}}',true,'Synthetic wording review')"
    race(change_wording, start(outbox, lease), second_role='service_role')
    check(attempts(outbox) == 0, 'Wording revision first blocks stale frozen payload')
    version = sql(f"select version from reminder_automation_policies where id='{policy}';")
    policy_values['message_template_version'] = old_wording_version + 1
    transaction(f"select save_care_plan_delivery_policy('{identity()}','{policy}',{version},{quote(json.dumps(policy_values))}::jsonb)")

    pet, plan = fixture();outbox, lease = handoff(plan)
    sql(f"update communication_outbox set lease_expires_at=clock_timestamp()+interval '600 milliseconds' where id='{outbox}';")
    race('select care_eligibility_lock()', start(outbox, lease), first_role='postgres', second_role='service_role', expected_error='PT409', expire=outbox)
    check(attempts(outbox) == 0, 'Lease that expires behind the gate cannot authorize a provider attempt')
    sql(f"update communication_outbox set state='failed',lease_token=null,lease_expires_at=null,last_error='Synthetic lease expiry cleanup' where id='{outbox}';")

    pet, plan = fixture()
    race('select queue_due_reminders()', 'select queue_due_reminders()', first_role='service_role', second_role='service_role')
    check(sql(f"select count(*) from reminder_outbox_links l join care_reminder_jobs j on j.id=l.job_id where l.job_kind='care' and j.source_id='{plan}';") == '1', 'Competing scheduler transactions create one outbox identity per occurrence')
    print(f'Observed care recurrence PostgreSQL races passed: {checks} assertions; no provider calls.')
finally:
    for process in processes:
        if process.poll() is None:
            process.kill();process.wait(timeout=10)
    # Never delete immutable clinical evidence; stop only owned synthetic work.
    if owned_pets:
        pets = ','.join(quote(pet) for pet in owned_pets)
        inflight = sql(f"select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease',lease_token)),'[]') from communication_outbox where client_id='{client}' and state='claimed' and attempt_started_at is not null;")
        for work in json.loads(inflight):
            transaction(f"select finish_communication_attempt('{work['id']}','{work['lease']}','uncertain',null,'Synthetic unfinished fixture retired')", 'service_role')
        sql(f"update pets set archived_at=clock_timestamp() where id in ({pets});update communication_outbox set state='failed',lease_token=null,lease_expires_at=null,last_error='Synthetic local fixture retired' where client_id='{client}' and state in ('pending','claimed') and attempt_started_at is null;")
    if 'policy' in locals():
        transaction(f"select disable_reminder_automation_policy('{policy}',(select version from reminder_automation_policies where id='{policy}'),'Synthetic race fixture retired')")
    sql(f"update profiles set is_active=false where id='{actor}';")
