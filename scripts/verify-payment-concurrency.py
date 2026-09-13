#!/usr/bin/env python3
"""Local-only real PostgreSQL competing-writer tests; exact generated fixtures are removed."""
import json
import subprocess
import time
import uuid

CONTAINER = 'supabase_db_livingroom-vet-foundation'
run_id = uuid.uuid4().hex
actor, client, invoice, request, request2 = (str(uuid.uuid4()) for _ in range(5))

def sql(value, check=True):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=value, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

claims = f"set local role authenticated; select set_config('request.jwt.claims','{json.dumps({'sub': actor, 'role': 'authenticated'})}',true);"
# The internal hash function is intentionally unavailable to staff: obtain the reviewed hash through the public read RPC.
prepare = lambda ident: f"select public.prepare_invoice_checkout('{ident}','{invoice}','{client}',public.read_invoice_payment_state('{invoice}','{client}')->>'source_hash',10000,'acct_concurrency',false,'https://example.test/payment/return','https://example.test/payment/cancel');"

def race(first_sql, second_sql, expected_error):
    first = subprocess.Popen(['docker','exec','-i',CONTAINER,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first.stdin.write(f"begin;{claims}{first_sql}\n\\echo LOCK_HELD\nselect pg_sleep(3);commit;\n")
    first.stdin.close()
    while True:
        line = first.stdout.readline()
        if not line:
            raise RuntimeError('First checkout failed before acquiring invoice lock: '+first.stderr.read())
        if line.strip() == 'LOCK_HELD':
            break
    second = subprocess.Popen(['docker','exec','-i',CONTAINER,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second.stdin.write(f"set application_name='payment-race-{run_id}';begin;{claims}{second_sql}commit;\n")
    second.stdin.close()
    waiting = False
    for _ in range(20):
        if sql(f"select count(*) from pg_stat_activity where application_name='payment-race-{run_id}' and wait_event_type='Lock';").stdout.strip() == '1':
            waiting = True
            break
        time.sleep(0.05)
    first.wait(timeout=15)
    second.wait(timeout=15)
    error = second.stderr.read()
    if not waiting or first.returncode or not second.returncode or expected_error not in error:
        raise RuntimeError(f'Concurrency expectation failed: observed_lock={waiting}, first_exit={first.returncode}, second_exit={second.returncode}, {error}')
    return waiting

profile_created = False
try:
    existing = sql('select count(*) from public.payment_provider_profiles;').stdout.strip()
    if existing != '0':
        raise RuntimeError('This local rehearsal requires an uncommissioned payment profile; refusing to alter existing configuration.')
    sql("select public.configure_payment_provider('acct_concurrency',false,'https://example.test');")
    profile_created = True
    sql(f"""begin;
insert into auth.users(id,email,raw_user_meta_data) values('{actor}','payment-concurrency-{run_id}@example.test','{{}}');
{claims}
insert into public.clients(id,first_name,last_name,full_name) values('{client}','Payment','Concurrency','Payment Concurrency');
select public.create_billing_invoice('{invoice}','{client}');
commit;""")
    # Use the ordinary catalog/issue RPCs; no direct ledger writes.
    sql(f"""begin;{claims}
select public.add_invoice_service(gen_random_uuid(),'{invoice}',null,(public.save_catalog_product(null,null,'Concurrency {run_id}','service','','visit',10000,true)).id,1);
select public.issue_billing_invoice('{invoice}',(select version from public.billing_invoices where id='{invoice}'));commit;""")
    race(prepare(request), f"select public.credit_billing_invoice('{request2}','{invoice}',100,'Concurrent credit');", 'Resolve existing checkout first')
    if sql(f"select count(*) from public.billing_credits where invoice_id='{invoice}';").stdout.strip() != '0':
        raise RuntimeError('Concurrent credit incorrectly persisted')
    print('PASS: real invoice row lock blocks competing credit; unresolved checkout rejects credit after lock release.')
    sql(f"select public.apply_checkout_evidence('event-expired-{run_id}','{request}','acct_concurrency',false,'session_expired','cs_test_original',null,10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{request}'));")
    next_request = str(uuid.uuid4())
    race(prepare(next_request), prepare(request2), 'Resolve existing checkout first')
    if sql(f"select count(*) from public.invoice_checkout_attempts where invoice_id='{invoice}';").stdout.strip() != '2':
        raise RuntimeError('Competing checkout incorrectly persisted')
    print('PASS: simultaneous new Checkout preparations produce exactly one new unresolved attempt.')
    sql(f"select public.apply_checkout_evidence('event-paid-{run_id}','{next_request}','acct_concurrency',false,'payment_succeeded','cs_test_next','pi_{run_id}',10000,'usd',(select source_hash from public.invoice_checkout_attempts where id='{next_request}'));")
    sql(f"begin;{claims}select public.credit_billing_invoice('{uuid.uuid4()}','{invoice}',3000,'Concurrent refund fixture');commit;")
    payment = sql(f"select id from public.invoice_payments where invoice_id='{invoice}';").stdout.strip()
    refund1, refund2 = str(uuid.uuid4()), str(uuid.uuid4())
    race(f"select public.prepare_invoice_refund('{refund1}','{invoice}','{payment}',2000,'First refund');", f"select public.prepare_invoice_refund('{refund2}','{invoice}','{payment}',2000,'Competing refund');", 'Refund exceeds credited or unreserved cash')
    if sql(f"select coalesce(sum(amount_cents),0) from public.invoice_refund_requests where invoice_id='{invoice}';").stdout.strip() != '2000':
        raise RuntimeError('Concurrent refunds oversubscribed available cash')
    print('PASS: simultaneous refund reservations cannot exceed credited excess cash.')
    # Two real workers must skip a work row held by another transaction.
    if sql("select count(*) from public.stripe_event_work where state in ('queued','processing');").stdout.strip() != '0':
        raise RuntimeError('Refusing to claim unrelated existing Stripe inbox work')
    for suffix in ('one', 'two'):
        envelope = json.dumps({'event_id': 'evt_' + run_id + suffix, 'event_type': 'checkout.session.completed', 'provider_created_at': 1790000000, 'account_id': 'acct_concurrency', 'livemode': False, 'object_id': 'cs_test_next', 'request_id': next_request, 'raw_sha256': 'a' * 64, 'disposition': 'queued', 'reason': ''})
        sql(f"select public.receive_stripe_event('{envelope}'::jsonb);")
    worker = subprocess.Popen(['docker','exec','-i',CONTAINER,'psql','-X','-At','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    worker.stdin.write("begin;select public.claim_stripe_event();\n\\echo CLAIM_HELD\nselect pg_sleep(3);commit;\n")
    worker.stdin.close()
    claimed = None
    while True:
        line = worker.stdout.readline().strip()
        if line.startswith('{'):
            claimed = json.loads(line)
        if line == 'CLAIM_HELD':
            break
        if not line and worker.poll() is not None:
            raise RuntimeError('Inbox worker failed before claim: '+worker.stderr.read())
    second_claim = json.loads(sql('select public.claim_stripe_event();').stdout.strip())
    skipped_locked_row = worker.poll() is None
    worker.wait(timeout=15)
    if not skipped_locked_row or worker.returncode or not claimed or claimed['receipt']['id'] == second_claim['receipt']['id']:
        raise RuntimeError('Workers failed to claim distinct receipts')
    print('PASS: two actual workers claim distinct receipts while the first transaction holds its work row lock.')
finally:
    # Synthetic IDs only; no table-wide cleanup and no existing environments reset.
    sql(f"""begin;set local session_replication_role=replica;
delete from public.stripe_event_work_history where receipt_id in (select id from public.stripe_event_receipts where request_id in (select id from public.invoice_checkout_attempts where actor_id='{actor}'));
delete from public.stripe_event_work where receipt_id in (select id from public.stripe_event_receipts where request_id in (select id from public.invoice_checkout_attempts where actor_id='{actor}'));
delete from public.stripe_event_receipts where request_id in (select id from public.invoice_checkout_attempts where actor_id='{actor}');
delete from public.invoice_refund_evidence where request_id in (select id from public.invoice_refund_requests where invoice_id='{invoice}');
delete from public.invoice_refunds where invoice_id='{invoice}';
delete from public.invoice_refund_requests where invoice_id='{invoice}';
delete from public.invoice_payment_evidence where request_id in (select id from public.invoice_checkout_attempts where actor_id='{actor}');
delete from public.invoice_payments where invoice_id='{invoice}';
delete from public.invoice_checkout_attempts where actor_id='{actor}';
delete from public.billing_credits where invoice_id='{invoice}';
delete from public.billing_invoice_items where invoice_id='{invoice}';
delete from public.billing_invoices where id='{invoice}' and created_by='{actor}';
delete from public.catalog_products where created_by='{actor}';
delete from public.clients where id='{client}' and full_name='Payment Concurrency';
delete from public.audit_logs where user_id='{actor}';
delete from public.profiles where id='{actor}';
delete from public.user_roles where user_id='{actor}';
delete from auth.users where id='{actor}';
{"delete from public.payment_provider_profiles where account_id='acct_concurrency' and return_origin='https://example.test';" if profile_created else ''}
commit;""")
