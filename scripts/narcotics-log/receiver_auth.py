"""Fixed populated-receiver password grants; no user creation or Auth writes.

The caller first proves the restored snapshot equals its external source
capsule. These observations account for real GoTrue logins; they cannot supply
an application identity, create a JWT, or authorize a stock operation.
"""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / 'workflows'))
import auth_effects as auth

TABLES = auth.TABLES
HASH = re.compile(r'^[0-9a-f]{64}$')
BOUND = "DO $auth_observation_bound$BEGIN " + ''.join(
    "IF(SELECT count(*)FROM auth." + table + ")>10000 THEN RAISE EXCEPTION 'Auth observation bound exceeded';END IF;"
    for table in TABLES) + "END $auth_observation_bound$;\n"
OBSERVATION_SQL = BOUND + "SELECT jsonb_build_object('schema_version',1,'tables',jsonb_build_object(" + ','.join(
    auth.literal(table) + ",(SELECT coalesce(jsonb_object_agg(id::text,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')),'{}'::jsonb)FROM auth." + table + ' t)'
    for table in TABLES) + "),'stable_users',(SELECT coalesce(jsonb_object_agg(id::text,encode(sha256(convert_to((to_jsonb(u)-ARRAY['last_sign_in_at','updated_at'])::text,'UTF8')),'hex')),'{}'::jsonb)FROM auth.users u));"


def snapshot(value):
    if type(value) is not dict or set(value) != {'schema_version', 'tables', 'stable_users'} or type(value['schema_version']) is not int or value['schema_version'] != 1:
        raise ValueError('Exact populated Auth snapshot required')
    tables = value['tables']
    if type(tables) is not dict or set(tables) != set(TABLES):
        raise ValueError('Complete six-table Auth snapshot required')
    auth.admitted_initial({table: sorted(rows) for table, rows in tables.items() if type(rows) is dict})
    for table in TABLES:
        if any(type(h) is not str or HASH.fullmatch(h) is None for h in tables[table].values()):
            raise ValueError('Exact original Auth row hashes required')
    stable = value['stable_users']
    if type(stable) is not dict or set(stable) != set(tables['users']) or any(type(h) is not str or HASH.fullmatch(h) is None for h in stable.values()):
        raise ValueError('Complete stable-user bindings required')
    return value


def capture(runtime, label):
    return snapshot(runtime.selected_query(label, OBSERVATION_SQL))


def prerequisites(runtime):
    defaults = auth.effective_defaults(runtime)
    observed = runtime.selected_query('receiver-auth-update-trigger-check', "SELECT jsonb_build_object('unexpected_update_triggers',count(*))FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal AND(tgtype::integer&16)<>0;")
    if observed != {'unexpected_update_triggers': 0}:
        raise ValueError('Unexpected Auth update trigger can alter application rows')
    return {**defaults, 'unexpected_user_update_triggers': 0, 'public_rows_require_separate_exact_comparison': True}


def password_grant(http, original):
    """Actual owned GoTrue endpoint; return secrets only to the private runner."""
    status, signed = http.post('/auth/v1/token?grant_type=password',
        dict(email=original['email'], password=original['private_password']))
    if status != 200 or signed['user']['id'] != original['id']:
        raise ValueError('Actual restored-user password grant failed')
    token = signed['access_token']
    if type(token) is not str or len(token) > 16384 or len(token.split('.')) != 3:
        raise ValueError('Actual GoTrue token shape differs')
    payload = token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    if claims.get('sub') != original['id'] or claims.get('role') != 'authenticated':
        raise ValueError('Actual restored principal differs')
    refresh = signed['refresh_token']
    if type(refresh) is not str or not 1 <= len(refresh) <= 16384:
        raise ValueError('Original refresh-token response required')
    return {**original, 'token': token, 'session_id': auth.uuid_value(claims['session_id']),
        'auth_amr': claims.get('amr'), 'auth_aal': claims.get('aal'),
        'auth_last_sign_in_at': signed['user']['last_sign_in_at'], 'auth_updated_at': signed['user']['updated_at'],
        'private_refresh_hash': hashlib.sha256(refresh.encode()).hexdigest()}


def validate(runtime, original, users, grants, before_sequences, after_sequences, receiver_boot, epoch_at):
    """Exactly A-before-epoch, A-after-epoch, B-after-epoch; never signup effects."""
    before = snapshot(original)
    receiver_boot = auth.login_timestamp(receiver_boot)
    epoch_at = auth.login_timestamp(epoch_at)
    if epoch_at <= receiver_boot:
        raise ValueError('Actual receiver epoch must follow native startup')
    if type(grants) is not list or len(grants) != 3 or type(users) is not list or len(users) != 2:
        raise ValueError('Fixed populated receiver login schedule required')
    base = before_sequences.get('auth.refresh_tokens_id_seq')
    if type(base) is not dict or set(base) != {'last_value', 'is_called'} or base['is_called'] is not True or type(base['last_value']) is not int or not 1 <= base['last_value'] <= 9223372036854775804:
        raise ValueError('Capsule-derived populated refresh sequence required')
    expected_sequences = {**before_sequences, 'auth.refresh_tokens_id_seq': dict(last_value=base['last_value'] + 3, is_called=True)}
    if after_sequences != expected_sequences:
        raise ValueError('Only three fixed password grants may allocate sequences')
    sessions = []
    for index, grant in enumerate(grants):
        selected = 0 if index < 2 else 1
        pair = [grant, users[1]] if selected == 0 else [users[0], grant]
        principal = auth.user_values(pair)[selected]
        if any(grant[k] != users[selected][k] for k in ('id', 'email', 'name')):
            raise ValueError('Receiver grant principal differs from restored source user')
        if grant['session_id'] in before['tables']['sessions'] or grant['session_id'] in {p['session_id'] for p in sessions}:
            raise ValueError('Every receiver grant needs a genuinely new session')
        if not HASH.fullmatch(grant['private_refresh_hash']):
            raise ValueError('Original refresh response hash required')
        principal.update(refresh_id=base['last_value'] + index + 1, refresh_hash=grant['private_refresh_hash'],
            grant_index=index,
            minimum_created_at=receiver_boot if index == 0 else epoch_at,
            latest_login=auth.login_timestamp(grant['auth_last_sign_in_at']),
            latest_updated=auth.login_timestamp(grant['auth_updated_at']))
        sessions.append(principal)
    after = capture(runtime, 'receiver-final-auth-snapshot')
    if set(after['tables']['users']) != set(before['tables']['users']) or after['stable_users'] != before['stable_users'] or after['tables']['identities'] != before['tables']['identities']:
        raise ValueError('Restored users, identities or stable user fields changed')
    admitted_users = {p['user_id'] for p in sessions}
    new_ids = {}
    for table in TABLES:
        previous, current = before['tables'][table], after['tables'][table]
        if not set(previous) <= set(current):
            raise ValueError('A preexisting Auth row disappeared')
        for identifier, digest in previous.items():
            if table == 'users' and identifier in admitted_users:
                continue
            if current[identifier] != digest:
                raise ValueError('A preexisting Auth row changed')
        new_ids[table] = sorted(set(current) - set(previous))
    expected = dict(users=0, identities=0, sessions=3, refresh_tokens=3, mfa_amr_claims=3, audit_log_entries=3)
    if any(len(new_ids[table]) != expected[table] for table in TABLES):
        raise ValueError('Exact receiver login row deltas differ')
    if set(new_ids['sessions']) != {p['session_id'] for p in sessions} or set(new_ids['refresh_tokens']) != {str(p['refresh_id']) for p in sessions}:
        raise ValueError('Actual session/serial identities differ from original grants')
    latest = [sessions[1], sessions[2]]
    ctes = ['expected_sessions AS(SELECT *FROM jsonb_to_recordset(' + auth.jsql(sessions)
        + ')AS e(user_id uuid,session_id uuid,email text,name text,amr_timestamp bigint,refresh_id bigint,refresh_hash text,grant_index integer,minimum_created_at timestamptz,latest_login timestamptz,latest_updated timestamptz))',
        'expected_users AS(SELECT *FROM jsonb_to_recordset(' + auth.jsql(latest)
        + ')AS e(user_id uuid,latest_login timestamptz,latest_updated timestamptz))']
    for table in TABLES:
        ctes.append('new_' + table + ' AS(SELECT *FROM auth.' + table + ' WHERE id::text=ANY(ARRAY['
            + ','.join(auth.literal(i) for i in new_ids[table]) + ']::text[]))')
    ctes += [
        "valid_users AS(SELECT u.id FROM auth.users u JOIN expected_users e ON u.id=e.user_id WHERE u.last_sign_in_at=e.latest_login AND u.updated_at=e.latest_updated)",
        "valid_sessions AS(SELECT s.id FROM new_sessions s JOIN expected_sessions e ON s.id=e.session_id AND s.user_id=e.user_id WHERE s.aal='aal1'AND s.factor_id IS NULL AND s.oauth_client_id IS NULL AND s.not_after IS NULL AND s.scopes IS NULL AND isfinite(s.created_at)AND s.created_at>e.minimum_created_at AND s.created_at>" + auth.literal(receiver_boot) + "::timestamptz AND(e.grant_index>0 OR s.created_at<" + auth.literal(epoch_at) + "::timestamptz))",
        "valid_refresh_tokens AS(SELECT r.id FROM new_refresh_tokens r JOIN expected_sessions e ON r.id=e.refresh_id AND r.session_id=e.session_id AND r.user_id::uuid=e.user_id WHERE NOT r.revoked AND coalesce(r.parent,'')=''AND encode(sha256(convert_to(r.token,'UTF8')),'hex')=e.refresh_hash)",
        "valid_mfa_amr_claims AS(SELECT a.id FROM new_mfa_amr_claims a JOIN expected_sessions e ON a.session_id=e.session_id WHERE (SELECT count(*)FROM new_mfa_amr_claims x WHERE x.session_id=e.session_id)=1 AND a.authentication_method='password'AND a.created_at=a.updated_at AND isfinite(a.created_at)AND floor(extract(epoch FROM a.updated_at))::bigint=e.amr_timestamp AND(to_jsonb(a)-ARRAY['id','session_id','created_at','updated_at','authentication_method'])='{}'::jsonb)",
        "expected_audit AS(SELECT jsonb_build_object('actor_id',e.user_id,'actor_via_sso',false,'actor_username',e.email,'actor_name',e.name,'action','login','log_type','account','traits',jsonb_build_object('provider','email'))payload FROM expected_sessions e)",
        "expected_audit_counts AS(SELECT payload,count(*)expected_count FROM expected_audit GROUP BY payload)",
        "valid_audit_log_entries AS(SELECT a.id FROM new_audit_log_entries a JOIN expected_audit_counts e ON a.payload::jsonb=e.payload WHERE(SELECT count(*)FROM new_audit_log_entries x WHERE x.payload::jsonb=e.payload)=e.expected_count AND a.ip_address=''AND isfinite(a.created_at))"]
    sql = 'WITH ' + ','.join(ctes) + ' SELECT jsonb_build_object(' + ','.join(
        auth.literal(table) + ',(SELECT count(*)FROM valid_' + table + ')' for table in ('users', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'audit_log_entries')) + ');'
    valid = runtime.selected_query('receiver-source-login-effects', sql)
    if valid != dict(users=2, sessions=3, refresh_tokens=3, mfa_amr_claims=3, audit_log_entries=3):
        raise ValueError('Source-derived actual receiver login effects differ')
    return dict(password_grants=3, new_sessions=3, no_new_Auth_users_or_identities=True, original_Auth_rows_preserved=True,
                only_user_login_timestamps_changed=True, exact_refresh_response_hashes=True, all_other_sequences_exact=True,
                public_domain_rows_require_separate_exact_comparison=True)
