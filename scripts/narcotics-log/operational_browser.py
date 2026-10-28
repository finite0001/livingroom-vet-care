"""Real-login operational UI on a separately owned local source installation.

The unchanged count_agreement profile finishes FIRST. One actual SDK A login
is its fixed fourth password grant. All120 browser seconds, including cleanup,
fit inside the existing original540 work phase; no deadline is renewed.
"""
from collections import Counter
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import business_rehearsal as business
import build_operational_module as operational
import receiver_auth
import bounded_archive
from receiver_rehearsal import observe, no_auth_change
from diagnose_register import pdf_fixture

ROOT = business.installation.ROOT
FIXTURES = ('operational-authenticated-fixture.html', 'operational-authenticated-fixture.tsx',
            'operational-authenticated-app.tsx', 'operational-local-transport.ts', 'run-local-operational-browser.mjs',
            'narcotics-authenticated-input.ts', 'narcotics-finalize-browser-input.ts')


def sources():
    paths = [p for p in (ROOT / 'src').rglob('*') if p.is_file() and p.suffix in ('.ts', '.tsx', '.css')]
    paths += [ROOT / 'tests/controlled-drugs' / name for name in FIXTURES]
    paths += [ROOT / 'package-lock.json']
    return {str(p.relative_to(ROOT)): dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            for p in sorted(paths) for raw in [business.installation.prefix.regular(p, 2097152)]}


def node_exit_status(process):
    """Observe completion without releasing the owned process-group leader PID."""
    ended = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG)
    if ended is None: return None
    return ended.si_status if ended.si_code == os.CLD_EXITED else -ended.si_status


def finish_owned_node(process):
    # Same reserved-leader group cleanup used by the tested binary transport.
    bounded_archive._finish_group(process)


def reference(folder, value):
    if type(value) is not dict or set(value) != {'file', 'bytes', 'sha256'} or Path(value['file']).name != value['file']:
        raise ValueError('Closed original browser response reference required')
    from browser_runner import private_json
    raw = private_json(folder / value['file'], 8388608)
    if len(raw) != value['bytes'] or hashlib.sha256(raw).hexdigest() != value['sha256']:
        raise ValueError('Original browser entity changed')
    return raw


def original_auth_rows(before, after, actor):
    if after['stable_users'] != before['stable_users']:
        raise ValueError('SDK login changed a stable original user field')
    for table, rows in before['tables'].items():
        if not set(rows) <= set(after['tables'][table]):
            raise ValueError('SDK login removed an original Auth row')
        if any(after['tables'][table][key] != value for key, value in rows.items() if not (table == 'users' and key == actor)):
            raise ValueError('SDK login changed an original Auth row')
        expected = 0 if table in ('users', 'identities') else 1
        if len(set(after['tables'][table]) - set(rows)) != expected:
            raise ValueError('SDK login has unexpected Auth row additions')


def browser(context, modules, runtime, initial_data, initial_auth):
    if sys.platform != 'linux':
        raise ValueError('Owned operational browser process supervision requires its Linux CI runner')
    if runtime.remaining(120) < 120:
        raise TimeoutError('Original browser120 phase does not fit the remaining work budget')
    from browser_runner import private_json, process_state
    started = time.monotonic(); deadline = started + 120
    base = Path(tempfile.mkdtemp(prefix='lrv-operational-browser-')).resolve(); base.chmod(0o700)
    folder = base / 'operational-browser-proof'; folder.mkdir(mode=0o700)
    actor = context['users'][0]
    raw_form = pdf_fixture(); (folder / 'original-form.pdf').write_bytes(raw_form); (folder / 'original-form.pdf').chmod(0o600)
    pinned = sources()
    private_input = dict(login=dict(origin='http://127.0.0.1:64661', anonKey=context['public_anon_key'], actorId=actor['id'],
        scope=dict(product_id=context['ids']['product'], site_id=context['ids']['site']), countId=context['count']['agreement']['count_id'],
        login=dict(email=actor['email'], password=actor['private_password'])), sources=pinned, original_form_sha256=hashlib.sha256(raw_form).hexdigest())
    business.save(folder, 'input', private_input)
    environment = {key: os.environ[key] for key in ('PATH','HOME','USER','LOGNAME','LANG','LC_ALL') if key in os.environ}
    environment.update(TZ='UTC', CI='true')
    process = subprocess.Popen(['node','--experimental-strip-types',str(ROOT / 'tests/controlled-drugs/run-local-operational-browser.mjs'),str(folder)],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, close_fds=True, cwd=ROOT, env=environment)
    chrome = None; signed_actor = None; after_login_auth = None; failed = True; logs = dict(stdout=bytearray(), stderr=bytearray())
    try:
        with selectors.DefaultSelector() as selector:
            for name in logs:
                pipe = getattr(process, name); os.set_blocking(pipe.fileno(), False); selector.register(pipe, selectors.EVENT_READ, name)
            while True:
                left = min(deadline-time.monotonic(), runtime.remaining(120))
                if left <= 5:
                    raise TimeoutError('Original operational browser120 deadline exhausted')
                owner = folder / 'browser-owner.json'
                if chrome is None and owner.exists():
                    value = business.installation.decode(private_json(owner))
                    if value['node_pid'] != process.pid or type(value['browser_pid']) is not int:
                        raise ValueError('Actual browser owner differs')
                    state = process_state(value['browser_pid'])
                    if state is None or state['parent'] != process.pid or os.getpgid(value['browser_pid']) != value['browser_pid'] or Path('/proc/'+str(value['browser_pid'])+'/exe').resolve() != Path(value['executable']).resolve():
                        raise ValueError('Actual browser process identity differs')
                    chrome = dict(pid=value['browser_pid'], birth=state['birth'])
                ready = folder / 'auth-ready.json'
                if signed_actor is None and ready.exists():
                    if chrome is None:
                        raise ValueError('Owned actual browser must precede login admission')
                    value = business.installation.decode(private_json(ready))
                    if value['kind'] != 'actual-operational-SDK-login-v1':
                        raise ValueError('Fixed real SDK login barrier required')
                    signed = business.installation.decode(reference(folder, value['auth']['response']))
                    if signed['access_token'] != value['auth']['token'] or signed['user']['id'] != actor['id']:
                        raise ValueError('SDK response principal differs')
                    claims = business.installation.decode(base64.urlsafe_b64decode(signed['access_token'].split('.')[1]+'='*(-len(signed['access_token'].split('.')[1])%4)))
                    if claims['sub'] != actor['id'] or claims['role'] != 'authenticated':
                        raise ValueError('SDK response claims differ')
                    signed_actor = {**actor, 'token': signed['access_token'], 'session_id': claims['session_id'], 'auth_aal': claims.get('aal'),
                        'auth_amr': claims.get('amr'), 'auth_last_sign_in_at': signed['user']['last_sign_in_at']}
                    other = context['current_actors'][context['users'][1]['id']]
                    modules.auth.validate(runtime, context['auth_before'], context['users'], [other,signed_actor])
                    refresh_hash=hashlib.sha256(signed['refresh_token'].encode()).hexdigest()
                    updated=receiver_auth.auth.login_timestamp(signed['user']['updated_at'])
                    bound=runtime.selected_query('operational-original-SDK-response-binding',
                        "SELECT jsonb_build_object('users',(SELECT count(*)FROM auth.users WHERE id="+receiver_auth.auth.literal(actor['id'])+"::uuid AND updated_at="+receiver_auth.auth.literal(updated)+"::timestamptz),"
                        "'refresh_tokens',(SELECT count(*)FROM auth.refresh_tokens WHERE id=4 AND session_id="+receiver_auth.auth.literal(signed_actor['session_id'])+"::uuid AND user_id::uuid="+receiver_auth.auth.literal(actor['id'])+"::uuid AND NOT revoked AND coalesce(parent,'')=''AND encode(sha256(convert_to(token,'UTF8')),'hex')="+receiver_auth.auth.literal(refresh_hash)+"));")
                    if bound!={'users':1,'refresh_tokens':1}:raise ValueError('Original SDK updated_at or refresh response hash differs')
                    after_login_auth = receiver_auth.capture(runtime,'operational-SDK-Auth')
                    original_auth_rows(initial_auth,after_login_auth,actor['id'])
                    no_auth_change(initial_data,observe(runtime,'operational-SDK-domain-data'))
                    if {item['relation'] for item in value['profiles']} != {'/rest/v1/profiles','/rest/v1/user_roles'}:
                        raise ValueError('Both actual staff profile and roles must be loaded')
                    for item in value['profiles']:
                        rows = business.installation.decode(reference(folder,item['response']))
                        if item['relation']=='/rest/v1/profiles' and (type(rows)is not list or len(rows)!=1 or rows[0].get('id')!=actor['id'] or rows[0].get('is_active')is not True):
                            raise ValueError('Actual SDK profile differs')
                        if item['relation']=='/rest/v1/user_roles' and sorted(row['role']for row in rows)!=['ADMIN','DVM']:
                            raise ValueError('Actual SDK role response differs')
                    business.save(folder,'auth-continue',dict(passed=True))
                for key,_ in selector.select(min(0.05,left)):
                    chunk = os.read(key.fileobj.fileno(),65536)
                    if not chunk: selector.unregister(key.fileobj)
                    else:
                        logs[key.data].extend(chunk)
                        if len(logs[key.data])>2097152: raise ValueError('Browser process output bound exceeded')
                if node_exit_status(process) is not None and not selector.get_map(): break
            if node_exit_status(process)!=0 or signed_actor is None or chrome is None or process_state(chrome['pid']) is not None:
                raise ValueError('Actual operational browser failed or did not clean up normally')
        result = business.installation.decode(private_json(folder/'result.json',2097152))
        if not result['passed']or not result['normal_browser_cleanup']or not result['normal_vite_cleanup']or result['elapsed_seconds']>=120:
            raise ValueError('Actual browser result is not successful within its original limit')
        if sources()!=pinned: raise ValueError('Operational frontend source changed during the actual browser')
        if receiver_auth.capture(runtime,'operational-final-Auth')!=after_login_auth:
            raise ValueError('Browser performed an unaccounted later Auth operation')
        failed=False
        return result,signed_actor,folder,deadline
    finally:
        finish_owned_node(process)
        if chrome is not None:
            state=process_state(chrome['pid'])
            if state is not None:
                if state['birth']!=chrome['birth']or os.getpgid(chrome['pid'])!=chrome['pid']:raise ValueError('Refusing cleanup of a replaced browser identity')
                os.killpg(chrome['pid'],signal.SIGTERM)
                while process_state(chrome['pid'])is not None and time.monotonic()<deadline-2:time.sleep(0.05)
                if process_state(chrome['pid'])is not None:os.killpg(chrome['pid'],signal.SIGKILL)
                failed=True
        for name,raw in logs.items():(folder/(name+'-private.log')).write_bytes(raw)
        if time.monotonic()>=deadline:failed=True
        if failed:
            business.save(runtime.folder,'operational-browser-failure',dict(passed=False,normal_cleanup_required=True))
            raise ValueError('Actual operational browser or normal owned cleanup failed')


class OperationalBrowser(business.BusinessInstallation):
    def __init__(self,*args):
        super().__init__(*args,profile='count_agreement')

    def after_installation(self,runtime):
        sql,proof=operational.build(register_only=True)
        business.save(self.evidence,'operational-browser-source',proof)
        runtime.raw_query('operational-browser-install','BEGIN;\n'+sql+'\nCOMMIT;')

    def after_business(self,context,methods,runtime,proof):
        self.context=context

    def execute(self):
        super().execute()
        runtime=business.Runtime(self);modules=business.modules()
        runtime.raw_query('operational-browser-gateway','BEGIN;\n'+(operational.SOURCE/'recovery-gateway.sql').read_text()+'\nCOMMIT;')
        modules.rest.effective_defaults(runtime,recovery=True)
        before=observe(runtime,'operational-browser-before');auth=receiver_auth.capture(runtime,'operational-browser-before-Auth')
        result,actor,folder,deadline=browser(self.context,modules,runtime,before,auth)
        self.owner_end=min(deadline,self.owner_end)if self.owner_end is not None else deadline
        after=observe(runtime,'operational-browser-after')
        additions={'narcotics_recovery_v1.heads':2,'narcotics_recovery_v1.operations':2,'narcotics_register_v1.operations':3,
            'narcotics_register_v1.reports':2,'narcotics_register_v1.form_contents':1,'narcotics_register_v1.form_records':1}
        if set(before['relations'])!=set(after['relations']):raise ValueError('Browser changed the retained table inventory')
        for name,old in before['relations'].items():
            if name.startswith('auth.'):continue
            current=after['relations'][name]
            if Counter(old)-Counter(current)or len(current)-len(old)!=additions.get(name,0):
                raise ValueError('Browser changed original rows or has unexpected row additions: '+name)
        modules.sequence.final(before['sequences'],after['sequences'],4)
        modules.auth.validate(runtime,self.context['auth_before'],self.context['users'],[self.context['current_actors'][self.context['users'][1]['id']],actor])
        calls=[]
        for call in result['calls']:
            calls.append((call['rpc'],business.installation.decode(reference(folder,call['request']))['p_request'],business.installation.decode(reference(folder,call['response']))))
        arm=[x for x in calls if x[0]=='narcotics_recovery_arm_v1'];saved=[x for x in calls if x[0]=='narcotics_recovery_read_operation_v1']
        forms=[x for x in calls if x[0]=='preserve_narcotics_form_v1'];recovered=[x for x in calls if x[0]=='read_narcotics_form_operation_v1']
        reports=[x for x in calls if x[0]=='create_narcotics_register_v1']
        if len(arm)!=1 or len(saved)!=1 or saved[0][2]['receipt']!=arm[0][2]or len(forms)!=1 or len(recovered)!=1 or recovered[0][2]!=forms[0][2]or len(reports)!=2:
            raise ValueError('Original arm/form results were not recovered exactly without another mutation')
        csv=next(x for x in result['downloads']if x['kind']=='csv')
        if csv['sha256']!=reports[0][2]['data']['csv_hash']or csv['bytes']!=reports[0][2]['data']['csv_utf8_bytes']:
            raise ValueError('Actual browser CSV differs from the original saved response')
        if base64.b64decode(forms[0][1]['base64'],validate=True)!=pdf_fixture():raise ValueError('Original browser form bytes differ')
        runtime.verify_module('operational-browser-final-source')
        self.result.update(authenticated_operational_browser_verified=True,original_arm_and_form_acknowledgment_loss_recovered=True,
            actual_SDK_fourth_password_grant=True,original_source_rows_preserved=True,actual_CSV_and_original_file_downloads_verified=True)
        if time.monotonic()>=deadline:raise TimeoutError('Original browser120 evidence-admission deadline exhausted')
        business.save(self.evidence,'authenticated-operational-browser-proof',self.result)
        runtime.remaining(1)


def main():
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check-source',action='store_true');group.add_argument('--run-synthetic-local',action='store_true');args=parser.parse_args()
    os.umask(0o077);started=time.monotonic();layout,pins=business.source_admission()
    for path in [Path(__file__),HERE/'receiver_auth.py',HERE/'bounded_archive.py',HERE/'receiver_rehearsal.py',HERE/'diagnose_register.py',HERE/'recovery-observation.sql',HERE/'build_operational_module.py',HERE/'recovery_admission_source.py',*operational.SOURCE.glob('*.sql')]:
        pins[str(path.relative_to(ROOT))]=hashlib.sha256(business.installation.prefix.regular(path)).hexdigest()
    for name,value in sources().items():pins[name]=value['sha256']
    if args.check_source:print(json.dumps(dict(source_files=len(pins),database_operations=0,ready_for_deployment=False)));return
    business.installation.execute_owned(layout,pins,started,OperationalBrowser)


if __name__=='__main__':main()
