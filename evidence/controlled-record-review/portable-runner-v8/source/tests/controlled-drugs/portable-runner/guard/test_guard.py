"""Small offline policy tests: no target children, Node, Docker or databases.

Synthetic Python/Node identities are policy fixtures, not tool provenance.
Expected target hashes and Node arrays come from the fixed policy, not execution.
"""
import copy
from dataclasses import replace
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import launch_guard as g
import physical

HERE = Path(__file__).resolve().parent
ROOT = next(parent for parent in HERE.parents if (parent/'tests/controlled-drugs/harness/historical-manifest.json').is_file())
POLICY = HERE / 'policy'


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def file_receipt(path):
    b = path.read_bytes()
    return {'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()}


def tool(path, version):
    path = path.resolve()
    s = path.stat()
    return dict(path=str(path), **file_receipt(path), dev=s.st_dev, ino=s.st_ino, version=version)


class GuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = Path(tempfile.mkdtemp(prefix='guard-unit-', dir=HERE)).resolve()
        cls.home = cls.scratch / 'home'; cls.home.mkdir(mode=0o700)
        cls.tmp = cls.scratch / 'tmp'; cls.tmp.mkdir(mode=0o700)
        cls.routes = json.loads((POLICY/'child-routes.json').read_text())
        cls.node = json.loads((POLICY/'node-input-declaration.json').read_text())
        names = dict(cls.routes['source_pins'])
        names.update(cls.node['independent_authority_pins'])
        files = {}
        for name, sha in names.items():
            pin = file_receipt(ROOT/name)
            assert pin['sha256'] == sha, name
            files[name] = pin
        # Policy unit tests never execute these two synthetic tools. Real worker
        # provisioning is independently parent-owned, outside this unit fixture.
        cls.bin = cls.scratch/'bin'; cls.bin.mkdir(mode=0o700)
        for name in ('python', 'node'):
            (cls.bin/name).write_bytes(b'INERT POLICY FIXTURE: never execute\n')
            (cls.bin/name).chmod(0o700)
        ts = Path(os.environ.get('CONTROLLED_REVIEW_TYPESCRIPT', ROOT/'node_modules/typescript/lib/typescript.js'))
        cls.tools = {
            'python': tool(cls.bin/'python', 'synthetic-policy-fixture'),
            'node': tool(cls.bin/'node', 'v22.0.0'),
            'typescript': dict(tool(ts, '5.8.3'), package_version='5.8.3'),
        }
        cls.env = dict(HOME=str(cls.home), TMPDIR=str(cls.tmp), PATH=str(Path(cls.tools['node']['path']).parent),
                       LC_ALL='C.UTF-8', LANG='C.UTF-8', PYTHONDONTWRITEBYTECODE='1',
                       PYTHONNOUSERSITE='1', PYTHONUTF8='1', PYTHONOPTIMIZE='0', CONTROLLED_REVIEW_TYPESCRIPT=cls.tools['typescript']['path'])
        cls.env.update(g.platform_environment())
        cls.kw = dict(contract_root=str(POLICY), source_trees=[dict(tag='fixture', root=str(ROOT), files=files, profile='offline-test-selected-fixed-files')],
                      tools=cls.tools, clean_env=cls.env, worker_cwd=str(ROOT),
                      suite_id='supabase/tests/test_controlled_secondary_review_release_harness.py', suite_tree_tag='fixture')
        cls.config = g.admit_config(**cls.kw)
        cls.test_number = 0

    def folder(self):
        return Path(tempfile.mkdtemp(prefix='case-', dir=self.tmp)).resolve()

    def guard(self, suite, *, clsname=None, test_id=None):
        conf = replace(self.config, suite_id=suite)
        instance = g.Guard(conf)
        ids = [i for i in conf.inventory if i.startswith(suite+'::') and (clsname is None or i.split('::')[1].startswith(clsname+'.'))]
        instance.begin_test(test_id or ids[0])
        return instance

    def route_guard(self, route):
        source = route.get('caller', route['source']).split('::')[0]
        return self.guard(source, test_id=route.get('caller'))

    def node_request(self, array='unicode'):
        rows = []
        for e in self.node['source_arrays'][array]:
            if 'body' in e:
                body = e['body']
            else:
                body = (ROOT/'supabase/migrations'/e['name']).read_bytes().decode('utf-8')
            raw = body.encode('utf-8')
            self.assertEqual((len(raw), g.digest(raw)), (e['body_utf8_bytes'], e['body_sha256']))
            rows.append({'name': e['name'], 'body': body})
        return dict(sources=rows, typescript=self.tools['typescript']['path'], vendor=str(ROOT/g.VENDOR_SUFFIX))

    def node_guard(self):
        route = next(r for r in self.config.routes if r['id'] == 'official-cli-statement-parser')
        return self.route_guard(route), route

    def node_call(self, guard, payload, *, delegate=None, **changes):
        route = next(r for r in guard.config.routes if r['id'] == 'official-cli-statement-parser')
        argv = guard._literal_argv(route)
        kwargs = dict(input=payload, text=True, capture_output=True, check=True, timeout=120)
        kwargs.update(changes)
        def consume(args, **kw):
            guard.audit('subprocess.Popen', ('node', args, None, None))
            return 'inert-result'
        guard._run_delegate = delegate or consume
        with patch.dict(os.environ, self.env, clear=True), patch('os.getcwd', return_value=str(ROOT)):
            return guard.run(argv, **kwargs)

    def test_compact_envelope_exact_three_files_and_independent_lineage(self):
        self.assertEqual(len(self.config.contract[1]), 3)
        self.assertEqual(len(self.config.inventory), 867)
        self.assertEqual((len(self.config.routes), len(self.config.literals)), (22, 14))
        self.assertEqual(g.digest((POLICY/'policy-envelope.json').read_bytes()), g.POLICY_ENVELOPE_SHA)

    def test_config_is_deeply_frozen(self):
        with self.assertRaises(TypeError): self.config.clean_env['HOME'] = 'changed'
        with self.assertRaises(TypeError): self.config.node['limits']['request_utf8_bytes'] = 0
        with self.assertRaises(TypeError): self.config.routes[0]['argv'][0] = 'sh'

    def test_admission_refuses_changed_tool_digest_and_unsafe_environment(self):
        for mutation in ('hash', 'inode', 'env', 'extra'):
            with self.subTest(mutation=mutation):
                kw = copy.deepcopy(self.kw)
                if mutation == 'hash': kw['tools']['node']['sha256'] = '0'*64
                elif mutation == 'inode': kw['tools']['python']['ino'] += 1
                elif mutation == 'env': kw['clean_env']['NODE_OPTIONS'] = '--inspect'
                else: kw['tools']['node']['unknown'] = True
                with self.assertRaises((ValueError, OSError)): g.admit_config(**kw)

    def test_source_admission_digest_is_not_observed_resealed(self):
        kw = copy.deepcopy(self.kw)
        kw['source_trees'][0]['files'][self.config.suite_id]['sha256'] = '0'*64
        with self.assertRaises(physical.AdmissionError): g.admit_config(**kw)

    def test_physical_leaf_parent_and_tool_symlinks_refuse(self):
        f = self.folder(); (f/'real').mkdir(); (f/'real'/'x').write_bytes(b'x')
        (f/'link').symlink_to(f/'real', target_is_directory=True)
        (f/'real'/'y').symlink_to(f/'real'/'x')
        for path in (f/'link'/'x', f/'real'/'y'):
            with self.subTest(path=str(path)), self.assertRaises(OSError): physical.read_file(path, limit=1)
        kw = copy.deepcopy(self.kw)
        (f/'python').symlink_to(self.tools['python']['path'])
        kw['tools']['python']['path'] = str(f/'python')
        with self.assertRaises(OSError): g.admit_config(**kw)

    def test_file_identity_substitution_even_equal_bytes_refuses(self):
        folder = self.folder(); path = folder/'x'; path.write_bytes(b'fixed')
        pin, _ = physical.read_file(path, limit=5)
        (folder/'other').write_bytes(b'fixed'); os.replace(folder/'other', path)
        with self.assertRaises(physical.AdmissionError): pin.verify()

    def test_owned_directory_identity_cross_test_and_suite_scope(self):
        guard = g.Guard(self.config); suite = self.folder(); guard.register_owned_directory(suite)
        ids = [x for x in self.config.inventory if x.startswith(self.config.suite_id+'::')]
        guard.begin_test(ids[0]); owned = self.folder(); guard.register_owned_directory(owned)
        self.assertEqual(guard._owned_for(str(owned)).path, str(owned))
        guard.end_test(ids[0]); guard.begin_test(ids[1])
        self.assertEqual(guard._owned_for(str(suite)).path, str(suite))
        with self.assertRaises(ValueError): guard._owned_for(str(owned))
        replacement = self.folder(); old = replacement.with_name(replacement.name+'-old')
        guard.register_owned_directory(replacement); replacement.rename(old); replacement.mkdir(mode=0o700)
        with self.assertRaises(ValueError): guard._owned_for(str(replacement))

    def test_strict_test_ids_nested_duplicate_and_end_identity(self):
        guard = g.Guard(self.config)
        with self.assertRaises(PermissionError): guard.begin_test('missing::Test.test_x')
        self.assertEqual(guard.snapshot_report()['denial_count'], 1)
        guard = self.guard(self.config.suite_id)
        active = guard._active
        with self.assertRaises(PermissionError): guard.end_test(active+'x')
        guard.end_test(active)
        with self.assertRaises(PermissionError): guard.begin_test(active)
        self.assertEqual(guard.snapshot_report()['denial_count'], 2)

    def test_all_worker_socket_and_unlisted_process_events_sticky(self):
        for event in ('socket.__new__','socket.connect','socket.getaddrinfo','os.system','os.fork','os.forkpty','os.exec','os.spawn','pty.spawn','os.posix_spawn'):
            with self.subTest(event=event):
                guard = self.guard(self.config.suite_id)
                with self.assertRaises(PermissionError): guard.audit(event, ())
                guard.end_test()
                with self.assertRaises(ValueError): guard.assert_clean()
                self.assertEqual(guard.snapshot_report()['denial_count'], 1)

    def test_no_active_test_has_no_launch_permission(self):
        guard = g.Guard(self.config)
        with self.assertRaises(PermissionError): guard.audit('subprocess.Popen', ('sh',['sh'],None,self.env))

    def test_python_finite_literal_and_script_routes_positive(self):
        seen = []
        for route in self.config.routes:
            if route['id'] in ('official-cli-statement-parser', 'owned-inert-docker-name-script', 'historical-materializer:worker'):
                continue
            classes = list(route['class_profiles']) if 'class_profiles' in route else [None]
            for cls in classes:
                with self.subTest(route=route['id'], cls=cls):
                    guard = self.guard(route['source'], clsname=cls)
                    argv = guard._literal_argv(route)
                    cwd = str(ROOT)
                    if route['id'].startswith('session:'):
                        f = self.folder(); guard.register_owned_directory(f); cwd = str(f)
                        argv[5:7] = ['normal', str(f/'child-received.log')]
                        argv[7:] = list(route['class_profiles'][cls]['suffix']) if cls else []
                    guard.audit('subprocess.Popen', (argv[0], argv, cwd, dict(self.env)))
                    guard.end_test(); self.assertEqual(len(guard.assert_clean()['launches']), 1)
                    seen.append(route['id'])
        self.assertEqual(len(set(seen)), 19)

    def test_session_single_property_mutations_refuse(self):
        route = self.config.routes[0]
        for mutation in ('code','flag','mode','journal','cwd','env','extra','tool'):
            with self.subTest(mutation=mutation):
                guard = self.route_guard(route); f=self.folder(); guard.register_owned_directory(f)
                argv=guard._literal_argv(route);argv[5:7]=['normal',str(f/'child-received.log')];cwd=str(f);env=dict(self.env)
                if mutation=='code':argv[4]+='\n'
                elif mutation=='flag':argv[1]='-I'
                elif mutation=='mode':argv[5]='unlisted'
                elif mutation=='journal':argv[6]=str(f/'different.log')
                elif mutation=='cwd':cwd=str(ROOT)
                elif mutation=='env':env['NODE_OPTIONS']='--inspect'
                elif mutation=='extra':argv.append('extra')
                else:argv[0]='/usr/bin/python3'
                with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',(argv[0],argv,cwd,env))

    def test_a2_class_profile_suffix_cannot_swap(self):
        route=next(r for r in self.config.routes if r['id']=='session:test_session')
        for cls in route['class_profiles']:
            guard=self.guard(route['source'],clsname=cls);f=self.folder();guard.register_owned_directory(f)
            argv=guard._literal_argv(route);argv[5:7]=['normal',str(f/'child-received.log')]
            other=next(x for x in route['class_profiles'] if x!=cls);argv[7:]=route['class_profiles'][other]['suffix']
            with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',(argv[0],argv,str(f),self.env))

    def test_route_call_limit_and_caught_denial_stay_terminal(self):
        route=next(r for r in self.config.routes if r['id']=='evidence:success')
        guard=self.route_guard(route);argv=guard._literal_argv(route)
        guard.audit('subprocess.Popen',(argv[0],argv,str(ROOT),self.env))
        with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',(argv[0],argv,str(ROOT),self.env))
        guard.end_test()
        with self.assertRaises(ValueError):guard.assert_clean()
        self.assertEqual(len(guard.snapshot_report()['launches']),1)

    def test_fake_docker_exact_script_not_executed(self):
        route=next(r for r in self.config.routes if r['id']=='owned-inert-docker-name-script')
        guard=self.route_guard(route);f=self.folder();guard.register_owned_directory(f)
        (f/'docker').write_text(route['template'].replace('${PINNED_PYTHON}',self.tools['python']['path']));(f/'docker').chmod(0o700)
        env=dict(self.env,PATH=str(f),DOCKER_HOST='unix:///local/docker.sock')
        guard.audit('subprocess.Popen',('docker',list(route['argv']),str(f),env))
        self.assertEqual(guard.snapshot_report()['launches'][0]['route'],route['id'])

    def test_fake_docker_body_permissions_real_binary_and_env_refuse(self):
        route=next(r for r in self.config.routes if r['id']=='owned-inert-docker-name-script')
        for mutation in ('body','mode','link','env','argv'):
            with self.subTest(mutation=mutation):
                guard=self.route_guard(route);f=self.folder();guard.register_owned_directory(f)
                data=route['template'].replace('${PINNED_PYTHON}',self.tools['python']['path'])
                (f/'docker').write_text(data+('\n' if mutation=='body' else ''));(f/'docker').chmod(0o755 if mutation=='mode' else 0o700)
                if mutation=='link':
                    (f/'docker').rename(f/'old');(f/'docker').symlink_to(f/'old')
                env=dict(self.env,PATH=str(f),DOCKER_HOST='unix:///local/docker.sock');argv=list(route['argv'])
                if mutation=='env':env['DOCKER_CONTEXT']='default'
                if mutation=='argv':argv[-1]='create'
                with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',('docker',argv,str(f),env))

    def test_node_all_three_independent_arrays_consume_one_use(self):
        guard,_=self.node_guard()
        for name in ('prefix205','private206','unicode'):
            self.assertEqual(self.node_call(guard,encoded(self.node_request(name))),'inert-result')
            self.assertIsNone(guard._permit)
        self.assertEqual(len(guard.snapshot_report()['launches']),3)
        guard.end_test();guard.assert_clean()

    def test_node_direct_popen_without_stdin_permit_refuses(self):
        guard,route=self.node_guard();argv=guard._literal_argv(route)
        with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',('node',argv,str(ROOT),self.env))

    def test_node_payload_single_property_mutations(self):
        for mutation in ('extra','missing','body','name','key','type','order','typescript','vendor','noncanonical','duplicate','surrogate','cap','count'):
            with self.subTest(mutation=mutation):
                guard,_=self.node_guard();body=self.node_request();payload=None
                if mutation=='extra':body['extra']=0
                elif mutation=='missing':del body['sources']
                elif mutation=='body':body['sources'][0]['body']+=' '
                elif mutation=='name':body['sources'][0]['name']='other'
                elif mutation=='key':body['sources'][0]['extra']='x'
                elif mutation=='type':body['sources'][0]['body']=False
                elif mutation=='order':body['sources']*=2
                elif mutation=='typescript':body['typescript']+='.other'
                elif mutation=='vendor':body['vendor']=str(self.folder())
                elif mutation=='noncanonical':payload=json.dumps(body)
                elif mutation=='duplicate':payload='{"sources":[],"sources":[],"typescript":"x","vendor":"x"}'
                elif mutation=='surrogate':body['sources'][0]['body']='\ud800'
                elif mutation=='cap':payload='x'*(self.node['limits']['request_utf8_bytes']+1)
                elif mutation=='count':body['sources']*=206
                with self.assertRaises(PermissionError):self.node_call(guard,payload if payload is not None else encoded(body))
                self.assertIsNone(guard._permit)
                self.assertFalse(guard.snapshot_report()['launches'])

    def test_node_keywords_and_argv_are_closed(self):
        for changes in ({'shell':False},{'env':dict(self.env)},{'stdin':None},{'timeout':True},{'timeout':120.0},{'text':1},{'check':False}):
            with self.subTest(changes=changes):
                guard,_=self.node_guard()
                with self.assertRaises(PermissionError):self.node_call(guard,encoded(self.node_request()),**changes)
        guard,route=self.node_guard();argv=guard._literal_argv(route);argv.append('extra')
        with self.assertRaises(PermissionError):guard.run(argv,input=encoded(self.node_request()),text=True,capture_output=True,check=True,timeout=120)

    def test_node_permit_not_consumed_reused_changed_or_wrong_thread(self):
        for mutation in ('missing','reused','changed','thread'):
            guard,_=self.node_guard()
            def delegate(argv,**kwargs):
                if mutation=='missing':return 'no-event'
                event=('node',argv,None,None)
                if mutation=='changed':event=('node',list(argv)+['x'],None,None)
                if mutation=='thread':
                    guard._permit['thread']+=1
                guard.audit('subprocess.Popen',event)
                if mutation=='reused':guard.audit('subprocess.Popen',event)
                return 'result'
            with self.subTest(mutation=mutation),self.assertRaises(PermissionError):self.node_call(guard,encoded(self.node_request()),delegate=delegate)
            self.assertIsNone(guard._permit)
            self.assertGreater(guard.snapshot_report()['denial_count'],0)

    def test_node_wrapper_copies_mutable_argv_and_clears_on_delegate_error(self):
        guard,route=self.node_guard();argv=guard._literal_argv(route)
        def delegate(args,**kwargs):
            self.assertIsInstance(args,tuple)
            argv.append('changed outside')
            guard.audit('subprocess.Popen',('node',args,None,None))
            raise RuntimeError('inert original run failed')
        guard._run_delegate=delegate
        with patch.dict(os.environ,self.env,clear=True),patch('os.getcwd',return_value=str(ROOT)),self.assertRaisesRegex(RuntimeError,'inert original'):
            guard.run(argv,input=encoded(self.node_request()),text=True,capture_output=True,check=True,timeout=120)
        self.assertIsNone(guard._permit)
        self.assertEqual(guard.snapshot_report()['denial_count'],0)

    def test_non_node_run_delegate_unchanged(self):
        guard=self.guard(self.config.suite_id);observed=[]
        guard._run_delegate=lambda *a,**k:observed.append((a,k)) or 'mock'
        self.assertEqual(guard.run(['mock-only'],capture_output=True),'mock')
        self.assertEqual(observed,[((['mock-only'],),{'capture_output':True})])

    def test_historical_tree_exact_keys_hashes_and_nofollow(self):
        # Small fixture template exercises the same exact physical traversal;
        # public admission independently requires the real638/669 cardinalities.
        f=self.folder();(f/'a').write_bytes(b'a');pins={'a':file_receipt(f/'a')}
        guard=self.guard(self.config.suite_id);guard.config=replace(guard.config,historical_templates=g.freeze({'stored638':pins}));guard.register_owned_directory(f)
        guard._verify_historical_tree(str(f),'stored638')
        (f/'b').write_bytes(b'b')
        with self.assertRaises(ValueError):guard._verify_historical_tree(str(f),'stored638')
        (f/'b').rename(f/'b-old')
        (f/'a').write_bytes(b'x')
        with self.assertRaises(ValueError):guard._verify_historical_tree(str(f),'stored638')

    def test_registration_mode_and_symlink_refuse(self):
        for mutation in ('mode','symlink'):
            guard=self.guard(self.config.suite_id);f=self.folder()
            if mutation=='mode':f.chmod(0o755)
            else:
                link=f.with_name(f.name+'-link');link.symlink_to(f,target_is_directory=True);f=link
            with self.assertRaises(PermissionError):guard.register_owned_directory(f)

    def test_denial_log_is_bounded_but_count_is_not_lost(self):
        guard=self.guard(self.config.suite_id)
        for _ in range(70):
            with self.assertRaises(PermissionError):guard.audit('socket.connect',())
        self.assertEqual((guard.snapshot_report()['denial_count'],len(guard.snapshot_report()['denials'])),(70,64))


    def test_deep_json_is_sticky_validation_failure(self):
        guard,_=self.node_guard()
        with self.assertRaises(PermissionError):self.node_call(guard,'['*2000+'0'+']'*2000)
        self.assertEqual(guard.snapshot_report()['denial_count'],1)

    def test_owned_vendor_copy_is_pinned_and_altered_member_refuses(self):
        import shutil
        guard,_=self.node_guard();f=self.folder();guard.register_owned_directory(f)
        vendor=f/g.VENDOR_SUFFIX;vendor.parent.mkdir(parents=True)
        shutil.copytree(ROOT/g.VENDOR_SUFFIX,vendor)
        request=self.node_request();request['vendor']=str(vendor)
        self.assertEqual(self.node_call(guard,encoded(request)),'inert-result')
        (vendor/'sql-split.ts').write_bytes(b'changed')
        with self.assertRaises(PermissionError):self.node_call(guard,encoded(request))

    def test_unregistered_and_symlink_vendor_refuse(self):
        guard,_=self.node_guard();f=self.folder();vendor=f/g.VENDOR_SUFFIX
        vendor.parent.mkdir(parents=True);vendor.symlink_to(ROOT/g.VENDOR_SUFFIX,target_is_directory=True)
        request=self.node_request();request['vendor']=str(vendor)
        with self.assertRaises(PermissionError):self.node_call(guard,encoded(request))
        guard,_=self.node_guard();guard.register_owned_directory(f)
        with self.assertRaises(PermissionError):self.node_call(guard,encoded(request))

    def test_request_and_body_caps_refuse_without_launch(self):
        # These are deliberately malformed inputs; exact source arrays impose
        # narrower reachable sizes. No legal-cap-edge claim is made.
        for size in (self.node['limits']['aggregate_body_utf8_bytes'],self.node['limits']['aggregate_body_utf8_bytes']+1):
            guard,_=self.node_guard();request=self.node_request();request['sources'][0]['body']='x'*size
            with self.assertRaises(PermissionError):self.node_call(guard,encoded(request))
            self.assertFalse(guard.snapshot_report()['launches'])
        guard,_=self.node_guard();request=self.node_request();request['vendor']='/'+'a'*4096
        with self.assertRaises(PermissionError):self.node_call(guard,encoded(request))

    def test_materializer_route_requires_exact_profile_tree_and_no_extra_args(self):
        route=next(r for r in self.config.routes if r['id']=='historical-materializer:worker')
        f=self.folder();(f/'source').write_bytes(b'independent')
        inventory=dict(self.config.inventory)
        tid=route['source']+'::IndependentGuardRouteTest.test_exact'
        inventory[tid]={'original_id':tid}
        for wrong in (None,'profile','extra','file'):
            with self.subTest(wrong=wrong):
                config=replace(self.config,suite_id=route['source'],inventory=g.freeze(inventory),historical_templates=g.freeze({'stored638':{'source':file_receipt(f/'source')}}))
                guard=g.Guard(config);guard.begin_test(tid);guard.register_owned_directory(f)
                argv=guard._literal_argv(route);argv[5:]=[str(f),'stored638'];
                if wrong=='profile':argv[6]='future'
                elif wrong=='extra':argv.append('extra')
                elif wrong=='file':(f/'source').write_bytes(b'changed')
                if wrong:
                    with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',(argv[0],argv,str(ROOT),self.env))
                else:
                    guard.audit('subprocess.Popen',(argv[0],argv,str(ROOT),self.env));self.assertEqual(guard.snapshot_report()['launches'][0]['route'],route['id'])

    def test_new_historical_assertion_route_is_exact_caller_script_and_tree(self):
        route_path=HERE.parent/'historical638-route-v1.json'
        declaration=json.loads(route_path.read_text())
        hp,_=physical.read_file(route_path,limit=16384,expected_sha=g.HISTORICAL_ROUTE_SHA)
        wp,_=physical.read_file(HERE.parent/'historical638_assertion.py',limit=declaration['worker_bytes'],expected_sha=declaration['worker_sha256'])
        f=self.folder();(f/'source').write_bytes(b'fixed')
        suite=declaration['allowed_original_test_ids'][0].split('::')[0]
        # The real selected suite file is independently pinned by the parent's
        # source map; this focused fixture adds its current exact file receipt.
        tree=self.config.trees['fixture'];files=dict(tree.files)
        files[suite],_=physical.read_file(ROOT/suite,limit=1024*1024)
        for wrong in (None,'script','repository','flag','caller'):
            with self.subTest(wrong=wrong):
                trees=dict(self.config.trees);trees['fixture']=replace(tree,files=g.freeze(files))
                conf=replace(self.config,suite_id=suite,trees=g.freeze(trees),historical_templates=g.freeze({'stored638':{'source':file_receipt(f/'source')}}),
                             historical_route=g.freeze({'declaration':declaration,'pin':hp,'worker':wp,'repository_tag':'fixture'}))
                guard=g.Guard(conf)
                tid=declaration['allowed_original_test_ids'][0]
                if wrong=='caller':tid=next(i for i in conf.inventory if i.startswith(suite+'::') and i!=tid)
                guard.begin_test(tid);guard.register_owned_directory(f)
                argv=[self.tools['python']['path'],'-I','-B',wp.path,'--repository-root',str(ROOT),'--tree-root',str(f)]
                if wrong=='script':argv[3]+='.other'
                elif wrong=='repository':argv[5]=str(f)
                elif wrong=='flag':argv[1]='-u'
                if wrong:
                    with self.assertRaises(PermissionError):guard.audit('subprocess.Popen',(argv[0],argv,str(ROOT),self.env))
                else:
                    guard.audit('subprocess.Popen',(argv[0],argv,str(ROOT),self.env));self.assertEqual(guard.snapshot_report()['launches'][0]['route'],declaration['id'])

    def test_physical_bootstrap_foreign_origin_refuses_before_execution(self):
        import types
        fake=types.ModuleType('physical');fake.__file__='/foreign/physical.py'
        namespace={'__file__':str(HERE/'launch_guard.py'),'__name__':'probe_guard_bootstrap'}
        # The exact foreign module is installed already; the guard must refuse
        # it before reading any symbol, not execute a fallback file on sys.path.
        with patch.dict(sys.modules,{'physical':fake}),self.assertRaisesRegex(ImportError,'foreign origin'):
            exec(compile((HERE/'launch_guard.py').read_bytes(),str(HERE/'launch_guard.py'),'exec'),namespace)


    def test_production_historical_route_admission_uses_full639_support_inventory(self):
        route_path=HERE.parent/'historical638-route-v1.json'
        hd=json.loads(route_path.read_text())
        manifest=json.loads((ROOT/'tests/controlled-drugs/harness/historical-manifest.json').read_text())
        expected={p:{'bytes':manifest['files'][p]['bytes'],'sha256':manifest['files'][p]['sha256']}for p in manifest['profiles']['stored638']['paths']}
        self.assertEqual(len(expected),639)
        kw=copy.deepcopy(self.kw);suite=hd['allowed_original_test_ids'][0].split('::')[0]
        kw['suite_id']=suite
        kw['source_trees'][0]['files'][suite]=file_receipt(ROOT/suite)
        worker_relative=str((HERE.parent/'historical638_assertion.py').relative_to(ROOT))
        kw['source_trees'][0]['files'][worker_relative]={'bytes':hd['worker_bytes'],'sha256':hd['worker_sha256']}
        kw['historical_templates']={'stored638':expected}
        kw['historical_route']=dict(declaration_path=str(route_path),declaration_sha256=g.HISTORICAL_ROUTE_SHA,
                                  worker_tree_tag='fixture',worker_relative=worker_relative,repository_tree_tag='fixture')
        admitted=g.admit_config(**kw)
        self.assertEqual(len(admitted.historical_templates['stored638']),639)
        self.assertEqual(admitted.historical_route['worker'].sha256,hd['worker_sha256'])
        # A collector-only projection silently loses a real support file.
        kw['historical_templates']['stored638'].pop(next(iter(expected)))
        with self.assertRaises(ValueError):g.admit_config(**kw)


    def test_nonzero_python_optimization_refuses_admission(self):
        for value in ('1', '2', '', '00'):
            kw=copy.deepcopy(self.kw);kw['clean_env']['PYTHONOPTIMIZE']=value
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'assertions'):
                g.admit_config(**kw)


    def test_darwin_platform_value_is_uid_derived_not_inherited(self):
        with patch.object(sys, 'platform', 'darwin'), patch('os.getuid', return_value=501), patch.dict(os.environ, {'__CF_USER_TEXT_ENCODING': 'foreign'}):
            self.assertEqual(g.platform_environment(), {'__CF_USER_TEXT_ENCODING': '0x1F5:0x0:0x0'})
        with patch.object(sys, 'platform', 'darwin'), patch('os.getuid', return_value=1000):
            self.assertEqual(g.platform_environment(), {'__CF_USER_TEXT_ENCODING': '0x3E8:0x0:0x0'})
        with patch.object(sys, 'platform', 'linux'), patch.dict(os.environ, {'__CF_USER_TEXT_ENCODING': '0x1F5:0x0:0x0'}):
            self.assertEqual(g.platform_environment(), {})

    def test_darwin_exact_value_admitted_missing_wrong_or_foreign_refused(self):
        with patch.object(sys, 'platform', 'darwin'), patch('os.getuid', return_value=501):
            kw=copy.deepcopy(self.kw);kw['clean_env']['__CF_USER_TEXT_ENCODING']='0x1F5:0x0:0x0'
            self.assertEqual(g.admit_config(**kw).clean_env['__CF_USER_TEXT_ENCODING'], '0x1F5:0x0:0x0')
            for value in (None, '0x1F4:0x0:0x0', '0x1f5:0x0:0x0', '0x1F5:0x1:0x0', '0x1F5:0x0:0x1', '', False):
                bad=copy.deepcopy(kw)
                if value is None:del bad['clean_env']['__CF_USER_TEXT_ENCODING']
                else:bad['clean_env']['__CF_USER_TEXT_ENCODING']=value
                with self.subTest(value=value),self.assertRaises(ValueError):g.admit_config(**bad)
            bad=copy.deepcopy(kw);bad['clean_env']['__CF_FOREIGN_VALUE']='arbitrary'
            with self.assertRaises(ValueError):g.admit_config(**bad)

    def test_linux_exact_base_environment_rejects_darwin_extra(self):
        with patch.object(sys, 'platform', 'linux'):
            kw=copy.deepcopy(self.kw);kw['clean_env'].pop('__CF_USER_TEXT_ENCODING', None)
            self.assertNotIn('__CF_USER_TEXT_ENCODING',g.admit_config(**kw).clean_env)
            kw['clean_env']['__CF_USER_TEXT_ENCODING']='0x1F5:0x0:0x0'
            with self.assertRaises(ValueError):g.admit_config(**kw)


if __name__ == '__main__':
    unittest.main(verbosity=2)
