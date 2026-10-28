"""Actual owned B sign-out and replacement login, after the six-grant proof.

Pinned GoTrue v2.197.0 logout deletes only the selected session, cascading its
refresh token and password AMR, and adds one logout audit without traits.
See supabase/auth v2.197.0 internal/api/logout.go and internal/models/sessions.go.
No owner writes Auth rows; the existing six-grant validator stays unchanged.
"""
from copy import deepcopy
import hashlib
from http.client import HTTPConnection
import time

import receiver_auth as receiver


def one_added(before,after,table):
    values=set(after['tables'][table])-set(before['tables'][table])
    if len(values)!=1:raise ValueError('Exactly one source-declared Auth addition required: '+table)
    return next(iter(values))


def original_rows(before,after,*,login_actor=None):
    if before['stable_users']!=after['stable_users']:raise ValueError('Stable original user fields changed')
    for table,rows in before['tables'].items():
        if not set(rows)<=set(after['tables'][table]):raise ValueError('A retained Auth row disappeared')
        for identifier,value in rows.items():
            if table=='users'and identifier==login_actor:continue
            if after['tables'][table][identifier]!=value:raise ValueError('A retained Auth row changed')


def other_auth_rows(before,after):
    accounted={'auth.'+name for name in receiver.TABLES}
    if {name:value for name,value in before['relations'].items()if name not in accounted}!={name:value for name,value in after['relations'].items()if name not in accounted}:
        raise ValueError('Logout or replacement login changed an unaccounted Auth/domain relation')


def auth_projection(data):
    return {kind:{name:value for name,value in data[kind].items()if name.startswith('auth.')}for kind in ('relations','sequences')}


def clock(runtime,label):
    return runtime.selected_query(label,"SELECT jsonb_build_object('at',to_char(clock_timestamp()at time zone'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'));")['at']


def logout_and_login(runtime,http,original_auth,original_user,current,other):
    from receiver_rehearsal import observe,no_auth_change
    auth=receiver.auth
    if http.runtime is not runtime or current['id']!=original_user['id']or current['session_id']in original_auth['tables']['sessions']:
        raise ValueError('Only the actual new receiver B session may sign out')
    before=receiver.capture(runtime,'before-reviewer-local-logout-Auth')
    domain=observe(runtime,'before-reviewer-local-logout-data')
    session=auth.uuid_value(current['session_id'])
    # Resolve only the two already source-validated FK children of this exact
    # original JWT session. Arbitrary observed removal lists are not accepted.
    selected=runtime.selected_query('source-bound-reviewer-logout-children',
        "SELECT jsonb_build_object('refresh',(SELECT coalesce(jsonb_agg(id::text),'[]')FROM auth.refresh_tokens WHERE session_id="+auth.literal(session)+"::uuid),"
        "'amr',(SELECT coalesce(jsonb_agg(id::text),'[]')FROM auth.mfa_amr_claims WHERE session_id="+auth.literal(session)+"::uuid));")
    base=domain['sequences']['auth.refresh_tokens_id_seq']['last_value']
    if selected['refresh']!=[str(base)]or len(selected['amr'])!=1:
        raise ValueError('Only the latest sixth receiver grant can be removed')
    removals={'sessions':session,'refresh_tokens':str(base),'mfa_amr_claims':auth.uuid_value(selected['amr'][0])}
    expected=deepcopy(before)
    for table,identifier in removals.items():
        if identifier in original_auth['tables'][table]:raise ValueError('Original capsule Auth rows cannot be removed')
        del expected['tables'][table][identifier]
    minimum=clock(runtime,'reviewer-local-logout-minimum-clock')
    runtime.verify();deadline=time.monotonic()+runtime.remaining(15)
    def remaining():
        left=min(deadline-time.monotonic(),runtime.remaining(15))
        if left<=0:raise TimeoutError('Original whole local logout transport deadline exhausted')
        return left
    connection=HTTPConnection('127.0.0.1',64661,timeout=remaining())
    try:
        connection.request('POST','/auth/v1/logout?scope=local',headers={
            'apikey':http.anon,'Authorization':'Bearer '+current['token']})
        connection.sock.settimeout(remaining())
        response=connection.getresponse()
        if response.status!=204 or response.getheader('Content-Length')not in(None,'0')or response.getheader('Transfer-Encoding')is not None or response.read(1)!=b'':
            raise ValueError('Actual current-session sign-out must return empty204')
        remaining()
    finally:connection.close()
    maximum=clock(runtime,'reviewer-local-logout-maximum-clock')
    after=receiver.capture(runtime,'after-reviewer-local-logout-Auth')
    audit_id=auth.uuid_value(one_added(before,after,'audit_log_entries'))
    expected['tables']['audit_log_entries'][audit_id]=after['tables']['audit_log_entries'][audit_id]
    if after!=expected:raise ValueError('Actual local logout has unexpected Auth effects')
    payload=dict(actor_id=current['id'],actor_via_sso=False,actor_username=current['email'],
                 actor_name=current['name'],action='logout',log_type='account')
    valid=runtime.selected_query('source-bound-reviewer-logout-audit',
        "SELECT jsonb_build_object('audit',count(*))FROM auth.audit_log_entries WHERE id="+auth.literal(audit_id)+"::uuid"
        " AND payload::jsonb="+auth.jsql(payload)+" AND ip_address=''AND instance_id='00000000-0000-0000-0000-000000000000'::uuid"
        " AND(to_jsonb(audit_log_entries)-ARRAY['id','payload','created_at','ip_address','instance_id'])='{}'::jsonb"
        " AND isfinite(created_at)AND created_at>="+auth.literal(minimum)+"::timestamptz AND created_at<="+auth.literal(maximum)+"::timestamptz;")
    if valid!={'audit':1}:raise ValueError('Actual local logout audit differs from pinned GoTrue source')
    after_domain=observe(runtime,'after-reviewer-local-logout-data')
    no_auth_change(domain,after_domain)
    other_auth_rows(domain,after_domain)
    if after_domain['sequences']!=domain['sequences']:raise ValueError('Local logout changed a sequence')
    replacement=receiver.password_grant(http,original_user)
    latest=receiver.capture(runtime,'after-replacement-reviewer-login-Auth')
    original_rows(after,latest,login_actor=current['id'])
    new={table:set(latest['tables'][table])-set(after['tables'][table])for table in receiver.TABLES}
    if {table:len(ids)for table,ids in new.items()}!={'users':0,'identities':0,'sessions':1,'refresh_tokens':1,'mfa_amr_claims':1,'audit_log_entries':1}:
        raise ValueError('Exact replacement password-grant additions required')
    if new['sessions']!={replacement['session_id']}or new['refresh_tokens']!={str(base+1)}or replacement['session_id']==session:
        raise ValueError('Replacement grant must have a new real session and next refresh serial')
    principal=auth.user_values([other,replacement])[1]
    session_id=auth.literal(replacement['session_id'])+'::uuid'
    user_id=auth.literal(current['id'])+'::uuid'
    login_payload={**payload,'action':'login','traits':{'provider':'email'}}
    upper=clock(runtime,'replacement-reviewer-login-maximum-clock')
    bounds=" AND isfinite(created_at)AND created_at>="+auth.literal(maximum)+"::timestamptz AND created_at<="+auth.literal(upper)+"::timestamptz"
    valid=runtime.selected_query('source-bound-replacement-reviewer-login',
        "SELECT jsonb_build_object('users',(SELECT count(*)FROM auth.users WHERE id="+user_id+
        " AND last_sign_in_at="+auth.literal(auth.login_timestamp(replacement['auth_last_sign_in_at']))+"::timestamptz AND updated_at="+auth.literal(auth.login_timestamp(replacement['auth_updated_at']))+"::timestamptz),"
        "'sessions',(SELECT count(*)FROM auth.sessions WHERE id="+session_id+" AND user_id="+user_id+
        " AND aal='aal1'AND factor_id IS NULL AND oauth_client_id IS NULL AND not_after IS NULL AND scopes IS NULL"+bounds+"),"
        "'refresh',(SELECT count(*)FROM auth.refresh_tokens WHERE id="+str(base+1)+" AND session_id="+session_id+" AND user_id::uuid="+user_id+
        " AND NOT revoked AND coalesce(parent,'')=''AND encode(sha256(convert_to(token,'UTF8')),'hex')="+auth.literal(replacement['private_refresh_hash'])+"),"
        "'amr',(SELECT count(*)FROM auth.mfa_amr_claims WHERE id="+auth.literal(one_added(after,latest,'mfa_amr_claims'))+"::uuid AND session_id="+session_id+
        " AND authentication_method='password'AND created_at=updated_at AND floor(extract(epoch FROM updated_at))::bigint="+str(principal['amr_timestamp'])+
        " AND(to_jsonb(mfa_amr_claims)-ARRAY['id','session_id','created_at','updated_at','authentication_method'])='{}'::jsonb"+bounds+"),"
        "'audit',(SELECT count(*)FROM auth.audit_log_entries WHERE id="+auth.literal(one_added(after,latest,'audit_log_entries'))+"::uuid AND payload::jsonb="+auth.jsql(login_payload)+
        " AND ip_address=''AND instance_id='00000000-0000-0000-0000-000000000000'::uuid"
        " AND(to_jsonb(audit_log_entries)-ARRAY['id','payload','created_at','ip_address','instance_id'])='{}'::jsonb"+bounds+"));")
    if valid!={'users':1,'sessions':1,'refresh':1,'amr':1,'audit':1}:raise ValueError('Replacement login differs from original GoTrue response and source effects')
    final=observe(runtime,'after-replacement-reviewer-login-data')
    no_auth_change(after_domain,final)
    other_auth_rows(after_domain,final)
    sequences=deepcopy(domain['sequences']);sequences['auth.refresh_tokens_id_seq']={'last_value':base+1,'is_called':True}
    if final['sequences']!=sequences:raise ValueError('Only the replacement grant may allocate one refresh serial')
    return replacement,dict(actual_local_logout=True,exact_new_session_children_deleted=True,
        exact_logout_audit=True,original_capsule_Auth_preserved=True,actual_replacement_password_grant=True,
        exact_original_response_binding=True,only_one_refresh_sequence_increment=True,
        logout_response_sha256=hashlib.sha256(b'').hexdigest()),auth_projection(final)
