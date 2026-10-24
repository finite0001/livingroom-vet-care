"""Real Auth queue, read-scope and owned-packet acceptance scenarios.

The owned protocol runner provides genuine immutable events and Auth identities.
No source mutations, provider calls, grants or expectation capture occur here.
"""
import uuid
import copy
import json


def _q(value):
    return "'" + str(value).replace("'", "''") + "'"


def seed_not_required(ctx):
    """An actual canonical receipt with a false immutable review flag."""
    actor = ctx.actors['operator']
    source = (ctx.base.SOURCE / 'smoke.sql').read_text()
    start = source.index('insert into auth.users')
    end = source.index('insert into catalog_products', start)
    stop = source.index('do $$declare receipt jsonb:=')
    setup = ('update engine_fx set id=' + _q(actor['id']) + " where k='actor';"
             'update engine_fx set id=' + _q(actor['session_id']) + " where k='session';"
             + ctx.sql_claims(actor))
    source = source[:start] + setup + source[end:stop]
    assert source.count("'secondary_review',true") == 2
    source = source.replace("'secondary_review',true", "'secondary_review',false")
    source = source.replace('SYNTHETIC ENGINE PRODUCT', 'SYNTHETIC NONREVIEW PRODUCT')
    source += ("select public.controlled_stock_validate_event(pg_temp.engine_id('receive'));"
               "set constraints all immediate;select jsonb_build_object('fixture_ids',"
               '(select jsonb_object_agg(k,id)from engine_fx));commit;')
    output = ctx.runtime.query(source)
    observations = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
    labelled = [value for value in observations if isinstance(value, dict) and set(value) == {'fixture_ids'}]
    assert len(labelled) == 1, 'Exactly one labelled nonreview fixture observation required'
    fixture = labelled[0]['fixture_ids']
    observed = ctx.runtime.json("select jsonb_build_object('required',secondary_review_required,"
        "'site',controlled_review.site(id),'kind',event_kind)from public.controlled_stock_events where id="
        + _q(fixture['receive']) + ';')
    assert observed == {'required': False, 'site': fixture['site'], 'kind': 'receive_inventory'}
    ctx.fx['not_required'] = fixture
    ctx.save('not-required-genuine-source', {'fixture': fixture, 'observed': observed})
    return fixture


def _state_fixture(ctx, state):
    """Append one valid physical-state fixture; compare every original row."""
    assert state in ('suspended', 'retired')
    ctx.checkpoint('before-physical-fixture-' + state)
    before = ctx.parent_rows()
    product = ctx.fx['product']
    actor = ctx.actors['operator']
    head = next(row for row in before['public.controlled_stock_states'] if row['product_id'] == product)
    prior = next(row for row in before['public.controlled_stock_state_events'] if row['id'] == head['head_id'])
    stamp = ctx.runtime.json("select jsonb_build_object('stamp',clock_timestamp());")['stamp']
    new = {'id': str(uuid.uuid4()), 'product_id': product, 'version': prior['version'] + 1,
           'prior_event_id': prior['id'], 'state': state, 'policy_version_id': prior['policy_version_id'],
           'opening_id': prior['opening_id'], 'actor_id': actor['id'], 'session_id': actor['session_id'],
           'reason': 'Synthetic retrospective independence fixture', 'recorded_at': stamp}
    sql = ('begin;' + ctx.sql_claims(actor) + 'select public.controlled_stock_exclusive();'
           'insert into public.controlled_stock_state_events select * from '
           'jsonb_populate_record(null::public.controlled_stock_state_events,'
           + _q(json.dumps(new)) + '::jsonb);update public.controlled_stock_states set head_id='
           + _q(new['id']) + ' where product_id=' + _q(product) + ';set constraints all immediate;commit;')
    ctx.runtime.query(sql)
    after = ctx.parent_rows()
    assert before.keys() == after.keys(), 'Physical fixture changed the original relation inventory'
    changed = {key for key in before if before[key] != after[key]}
    assert changed == {'public.controlled_stock_states', 'public.controlled_stock_state_events'}
    normalize = lambda rows: sorted(json.dumps(row, sort_keys=True) for row in rows)
    assert normalize(after['public.controlled_stock_state_events']) == normalize(before['public.controlled_stock_state_events'] + [new])
    expected_heads = [{**row, 'head_id': new['id']} if row['product_id'] == product else row
                      for row in before['public.controlled_stock_states']]
    assert normalize(after['public.controlled_stock_states']) == normalize(expected_heads)
    ctx.save('physical-fixture-' + state, {'expected_new_state': new, 'expected_heads': expected_heads,
                                          'before': before, 'after': after})
    ctx.baseline = after


def run(ctx):
    reviewer = ctx.actors['reviewer']
    competitor = ctx.actors['competitor']
    operator = ctx.actors['operator']
    product, site = ctx.fx['product'], ctx.fx['site']
    events = ctx.events
    assert len(events) >= 110, 'Sparse bounded-scan proof requires 110 genuine events'
    kind = 'adjust_inventory'
    calls = 0
    fixture = ctx.runtime.json("select jsonb_build_object('ids',jsonb_agg(id order by sequence),"
        "'first',min(sequence),'last',max(sequence),'count',count(*),"
        "'all_required',bool_and(secondary_review_required),"
        "'one_site',bool_and(controlled_review.site(id)='" + str(uuid.UUID(site)) + "'::uuid))"
        "from public.controlled_stock_events where product_id='" + str(uuid.UUID(product)) + "'::uuid"
        " and event_kind='adjust_inventory';")
    assert fixture['ids'] == events and fixture['all_required'] and fixture['one_site']
    assert fixture['last'] - fixture['first'] + 1 == fixture['count'] == len(events)
    ctx.save('queue-contiguous-genuine-scope', fixture)

    def rpc(action, actor, request, expected_code=None):
        nonlocal calls
        calls += 1
        value = ctx.rpc(action, actor, request, expected_code=expected_code)
        ctx.save(f'queue-{calls:03d}-{action}', value)
        return value

    def queue(**changes):
        request = {'actor_id': reviewer['id'], 'product_id': product,
                   'site_id': site, 'event_kind': kind}
        request.update(changes)
        return rpc('queue', reviewer, request)

    def assert_page(page, status=None):
        assert isinstance(page['items'], list) and len(page['items']) <= 100
        assert page['traversal'] == 'live_read_committed_keyset'
        assert page['due_at'] is None and page['deadline_state'] == 'not_configured'
        for item in page['items']:
            assert item['target']['product_id'] == product
            assert item['site_id'] == site and item['event_kind'] == kind
            assert item['due_at'] is None and item['deadline_state'] == 'not_configured'
            assert 'packet' not in item and 'packet_hash' not in item
            if status:
                assert item['status'] == status
        if page['next_cursor'] is not None:
            assert set(page['next_cursor']) == {'scope', 'sequence'}
            assert 'event_id' not in page['next_cursor']
        return [item['target']['event_id'] for item in page['items']]

    read_def = ctx.definition(kind, capability='read')
    disabled_def = ctx.definition(kind, enabled=False)
    blocked = queue(page_size=2, status='blocked-unconfigured')
    first_ids = assert_page(blocked, 'blocked-unconfigured')
    assert len(first_ids) == 2 and blocked['next_cursor'] is not None
    following = queue(page_size=2, status='blocked-unconfigured', cursor=blocked['next_cursor'])
    second_ids = assert_page(following, 'blocked-unconfigured')
    assert len(second_ids) == 2 and set(first_ids).isdisjoint(second_ids)
    assert len(assert_page(queue())) == 25
    assert len(assert_page(queue(page_size=100))) == 100
    blocked_event = rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': events[0]})
    assert blocked_event['status'] == 'blocked-unconfigured' and blocked_event['decision'] is None
    rpc('prepare', reviewer, ctx.request(reviewer, events[0], definition=disabled_def), '42501')

    queue_request = {'actor_id': reviewer['id'], 'product_id': product, 'site_id': site, 'event_kind': kind}
    for bad in (0, 101, '2', 1.5, None):
        rpc('queue', reviewer, {**queue_request, 'page_size': bad}, '23514')
    rpc('queue', reviewer, {**queue_request, 'unknown': True}, '23514')
    rpc('queue', reviewer, {**queue_request, 'status': None}, '23514')
    rpc('queue', reviewer, {**queue_request, 'cursor': None}, '23514')
    rpc('queue', reviewer, {**queue_request, 'actor_id': competitor['id']}, '42501')
    rpc('queue', reviewer, {**queue_request, 'product_id': str(uuid.uuid4())}, '42501')
    rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': str(uuid.uuid4())}, '42501')
    rpc('queue', reviewer, {**queue_request, 'status': 'pending', 'cursor': blocked['next_cursor']}, '23514')
    for field in ('site_id', 'product_id'):
        rebound = copy.deepcopy(blocked['next_cursor'])
        rebound['scope'][field] = str(uuid.uuid4())
        rpc('queue', reviewer, {**queue_request, 'status': 'blocked-unconfigured', 'cursor': rebound}, '23514')
    # A real retained target in a different scope is not revealed through an
    # event read or a queue with no exact read definition.
    other = {key: ctx.fx[key] for key in ('other_event', 'other_product', 'other_site', 'other_event_kind')}
    rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': other['other_event']}, '42501')
    rpc('queue', reviewer, {**queue_request, 'product_id': other['other_product'],
        'site_id': other['other_site'], 'event_kind': other['other_event_kind']}, '42501')

    # A genuine zero-container annotation has no supported historical site.
    # Look it up without using the site extractor, then prove both API denial
    # and refusal to configure its unsupported kind, with no retained changes.
    annotations = ctx.runtime.json("select jsonb_build_object('events',jsonb_agg("
        "jsonb_build_object('id',e.id,'product_id',e.product_id,'kind',e.event_kind,"
        "'required',e.secondary_review_required,'transitions',(select count(*)"
        "from public.controlled_stock_container_transitions t where t.event_id=e.id))))"
        "from public.controlled_stock_events e where "
        "event_kind='append_native_dispense_correction:clinical_annotation';")['events']
    assert len(annotations) == 1
    annotation = annotations[0]
    assert annotation['required'] and annotation['transitions'] == 0
    rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': annotation['id']}, '42501')
    denial = rpc('prepare', reviewer,
        ctx.request(reviewer, annotation['id'], definition=disabled_def), '23514')
    assert denial['message'] == 'Unsupported secondary-review historical event kind'
    from secondary_review_gate_a import failed
    review_before = ctx.review_rows()
    for capability in ('read', 'review'):
        result = ctx.runtime.sql('begin;insert into controlled_review.definitions values('
            + _q(str(uuid.uuid4())) + ',' + _q(annotation['product_id']) + ','
            + _q(other['other_site']) + ',' + _q(annotation['kind']) + ','
            + _q(capability) + ",1,true,array['DVM']);commit;", fail=False)
        failed(result, '23514', 'Exact bounded synthetic secondary-review definition required')
        assert ctx.review_rows() == review_before
    ctx.save('unsupported-zero-container-annotation', annotation)
    ctx.checkpoint('unsupported-annotation-refusals')

    # A changed read-definition version invalidates old cursors, even when the
    # new version again grants the same role. No older-version fallback occurs.
    ctx.definition(kind, capability='read', enabled=False)
    rpc('queue', reviewer, queue_request, '42501')
    rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': events[0]}, '42501')
    read_def = ctx.definition(kind, capability='read')
    rpc('queue', reviewer, {**queue_request, 'status': 'blocked-unconfigured', 'cursor': blocked['next_cursor']}, '23514')
    execution_def = ctx.definition(kind)
    pending = queue(page_size=2, status='pending')
    assert len(assert_page(pending, 'pending')) == 2

    # Genuine two-transaction preparation/signing, using different target events.
    requests, receipts = [], []
    for event, decision in zip(events[:2], ('approve', 'reject')):
        req = ctx.request(reviewer, event, decision=decision, definition=execution_def)
        prepared = rpc('prepare', reviewer, req)
        assert prepared['state'] == 'prepared' and prepared['packet'] is not None
        assert prepared['packet']['target']['event_id'] == event
        saved = rpc('execute', reviewer, req)
        assert saved['state'] == 'saved' and saved['packet'] is None
        assert saved['receipt']['decision'] == decision
        assert saved['receipt']['actor_name']
        assert rpc('read', reviewer, req)['receipt'] == saved['receipt']
        requests.append(req)
        receipts.append(saved['receipt'])
    approved = queue(page_size=1, status='approved')
    assert assert_page(approved, 'approved') == [events[0]]
    assert approved['items'][0]['decision']['actor_name'] == receipts[0]['actor_name']
    rejected = queue(page_size=1, status='rejected')
    assert assert_page(rejected, 'rejected') == [events[1]]
    read_event = rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': events[1]})
    assert read_event['decision'] == receipts[1]
    operator_read = rpc('event', operator, {'actor_id': operator['id'], 'event_id': events[0]})
    assert operator_read['decision'] == receipts[0]

    # One approved event followed by over 100 pending events forces an empty
    # continued page. Its cursor cannot expose any excluded target UUID.
    assert approved['next_cursor'] is not None
    sparse = queue(page_size=1, status='approved', cursor=approved['next_cursor'])
    assert assert_page(sparse, 'approved') == [] and sparse['next_cursor'] is not None
    assert int(sparse['next_cursor']['sequence']) - int(approved['next_cursor']['sequence']) == 100
    sparse_last = queue(page_size=1, status='approved', cursor=sparse['next_cursor'])
    assert assert_page(sparse_last, 'approved') == [] and sparse_last['next_cursor'] is None

    # Ownership is exact; even another eligible reviewer cannot read or adopt
    # this reviewer's preparation or saved operation receipt.
    foreign = {**requests[0], 'actor_id': competitor['id']}
    rpc('read', competitor, foreign, '23505')
    rpc('read', reviewer, {**requests[0], 'reason': 'Changed reason'}, '23505')
    rpc('prepare', operator, ctx.request(operator, events[2], definition=execution_def), '42501')
    own_unsaved = ctx.request(reviewer, events[2], definition=execution_def)
    initial = rpc('prepare', reviewer, own_unsaved)
    assert initial['state'] == 'prepared' and initial['packet'] is not None
    ctx.definition(kind, enabled=False)
    revoked = rpc('read', reviewer, own_unsaved)
    assert revoked['state'] == 'prepared' and revoked['packet'] is None
    repeated = rpc('prepare', reviewer, own_unsaved)
    assert repeated['state'] == 'prepared' and repeated['packet'] is None
    assert repeated['expires_at'] == initial['expires_at']
    rpc('execute', reviewer, own_unsaved, '42501')
    cancelled = rpc('cancel', reviewer, own_unsaved)
    assert cancelled['state'] == 'cancelled' and cancelled['packet'] is None
    assert rpc('read', reviewer, requests[0])['receipt'] == receipts[0]
    assert rpc('execute', reviewer, requests[0])['receipt'] == receipts[0]
    assert rpc('cancel', reviewer, requests[0])['receipt'] == receipts[0]
    assert assert_page(queue(status='approved', page_size=1), 'approved') == [events[0]]
    assert assert_page(queue(status='rejected', page_size=1), 'rejected') == [events[1]]
    blocked_again = queue(status='blocked-unconfigured', page_size=2)
    blocked_ids = assert_page(blocked_again, 'blocked-unconfigured')
    assert len(blocked_ids) == 2 and events[2] in blocked_ids
    ctx.definition(kind, capability='read', enabled=False)
    assert rpc('read', reviewer, requests[0])['receipt'] == receipts[0]
    rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': events[0]}, '42501')
    rpc('queue', reviewer, queue_request, '42501')

    # Leave fresh exact DVM streams for subsequent race/expiry scenarios. Old
    # immutable definitions, decisions and cancellation remain untouched.
    final_read = ctx.definition(kind, capability='read')
    final_execution = ctx.definition(kind)
    nonreview = ctx.fx['not_required']
    nonreview_def = ctx.definition('receive_inventory', product=nonreview['product'], site=nonreview['site'])
    ctx.definition('receive_inventory', capability='read', product=nonreview['product'], site=nonreview['site'])
    absent = rpc('queue', reviewer, {'actor_id': reviewer['id'], 'product_id': nonreview['product'],
        'site_id': nonreview['site'], 'event_kind': 'receive_inventory'})
    assert absent['items'] == [] and absent['next_cursor'] is None
    rpc('event', reviewer, {'actor_id': reviewer['id'], 'event_id': nonreview['receive']}, '42501')
    rpc('prepare', reviewer, ctx.request(reviewer, nonreview['receive'], definition=nonreview_def), '42501')
    for state, event in zip(('suspended', 'retired'), events[3:5]):
        _state_fixture(ctx, state)
        req = ctx.request(reviewer, event, definition=final_execution)
        assert rpc('prepare', reviewer, req)['state'] == 'prepared'
        saved = rpc('execute', reviewer, req)
        assert saved['state'] == 'saved' and saved['receipt']['target']['event_id'] == event
        ctx.checkpoint('review-while-physical-' + state)

    # A separately configured reviewer need not hold a physical performer role.
    # Both role lists are authoritative database observations, not JWT metadata.
    staff = ctx.actors['reader']
    role_boundary = ctx.runtime.json("select jsonb_build_object('physical_roles',"
        "p.permissions#>'{adjust_inventory,roles}','staff_roles',(select jsonb_agg(role::text order by role::text)"
        "from public.user_roles where user_id=" + _q(staff['id']) + "))"
        "from public.controlled_stock_events e join public.controlled_stock_policy_versions p"
        " on p.id=e.policy_version_id where e.id=" + _q(events[5]) + ';')
    assert role_boundary == {'physical_roles': ['DVM'], 'staff_roles': ['STAFF']}
    staff_definition = ctx.definition(kind, roles=['STAFF'])
    staff_request = ctx.request(staff, events[5], definition=staff_definition)
    staff_prepared = rpc('prepare', staff, staff_request)
    assert staff_prepared['state'] == 'prepared' and staff_prepared['packet'] is not None
    staff_saved = rpc('execute', staff, staff_request)
    assert staff_saved['state'] == 'saved'
    assert staff_saved['receipt']['actor_id'] == staff['id']
    assert staff_saved['receipt']['event_id'] == events[5]
    assert staff_saved['receipt']['definition_id'] == staff_definition
    final_execution = ctx.definition(kind)
    assert rpc('read', staff, staff_request)['receipt'] == staff_saved['receipt']
    ctx.save('review-role-independent-of-physical-permission', role_boundary)
    ctx.checkpoint('queue-privacy-complete-original-row-preservation')
    proof = {
        'real_auth_rpc_checks': calls,
        'genuine_candidate_events': len(events),
        'default25_max100_pages_and_unknown_fields': True,
        'latest_disabled_definition_no_fallback': True,
        'read_definition_cursor_version_and_filter_bound': True,
        'real_unreadable_other_scope_and_product_site_cursor_rebinding_refused': True,
        'empty_sparse_page_advances_exactly100_candidates': True,
        'genuine_zero_container_annotation_unreadable_and_unconfigurable': True,
        'cursor_does_not_expose_excluded_target_uuid': True,
        'separate_read_scope_and_original_operator_read': True,
        'approve_reject_status_survives_execution_revocation': True,
        'foreign_preparation_and_changed_request_refused': True,
        'revoked_preparation_packet_hidden_and_ttl_not_refreshed': True,
        'saved_receipt_recovery_without_execution_or_read_scope': True,
        'cancelled_preparation_packet_hidden': True,
        'deadline_never_inferred': True,
        'genuine_not_required_event_absent_despite_configured_read_scope': True,
        'new_review_while_product_suspended_and_retired': True,
        'explicit_staff_review_with_dvm_only_physical_permission': True,
        'physical_fixture_exact_enumerated_full_row_deltas': True,
        'consumed_event_ids': events[:6],
        'final_read_definition': final_read,
        'final_execution_definition': final_execution,
    }
    ctx.save('queue-privacy-proof', proof)
    return proof
