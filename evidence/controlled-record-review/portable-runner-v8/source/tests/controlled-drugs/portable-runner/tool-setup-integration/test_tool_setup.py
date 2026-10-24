"""Read-only archive/profile and tiny inert-child controls; no real installation."""
from copy import deepcopy
import base64
import ast
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
import textwrap
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); sys.modules[name] = module; spec.loader.exec_module(module)
    return module


a = load('tool_admission_under_test', HERE/'tool_admission.py')
s = load('tool_setup_under_test', HERE/'tool_setup.py')
PROFILE = json.loads((HERE/'local-profile.json').read_bytes())
ARCHIVES = Path('/private/tmp/lrv-portable-archive-inspection-hwoqcze8')


class AdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.no_process = patch.object(subprocess, 'Popen', side_effect=AssertionError('No setup process allowed'))
        cls.no_network = patch.object(socket, 'socket', side_effect=AssertionError('No network allowed'))
        cls.no_process.start(); cls.no_network.start()

    @classmethod
    def tearDownClass(cls):
        cls.no_network.stop(); cls.no_process.stop()

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lrv-tool-admission-')).resolve(); self.root.chmod(0o700)
        self.deadline = time.monotonic()+60

    def read(self, path, **kw):
        return a.read_file(path, deadline=self.deadline, check=lambda: None, **kw)

    def test_existing_local_operational_inputs_match_prospective_profile_without_execution(self):
        a.admit_profile(PROFILE, deadline=self.deadline, check=lambda: None)
        self.assertEqual(PROFILE['platform']['python'], '3.14.7')
        self.assertEqual(PROFILE['pip']['version'], '26.2.1')
        self.assertEqual(len(PROFILE['pip']['files']), 805)
        self.assertTrue(any('link' in value for value in PROFILE['pip']['files'].values()))

    def test_exact_json_refuses_duplicates_nonfinite_trailing_and_caps(self):
        for raw in [b'{"x":1,"x":2}', b'NaN', b'1e999', b'{}{}', b'\xff', b'', b' '* (a.MAX_JSON+1)]:
            with self.subTest(raw=raw[:20]), self.assertRaises((ValueError, UnicodeError)):
                a.strict_json(raw)

    def test_reader_refuses_links_hardlinks_writable_files_and_special_nodes(self):
        path = self.root/'file'; path.write_bytes(b'fixed'); path.chmod(0o600)
        link = self.root/'link'; link.symlink_to(path)
        with self.assertRaises(OSError): self.read(link)
        hard = self.root/'hard'; os.link(path, hard)
        with self.assertRaises(ValueError): self.read(path)
        path2 = self.root/'writable'; path2.write_bytes(b'fixed'); path2.chmod(0o666)
        with self.assertRaises(ValueError): self.read(path2)
        fifo = self.root/'fifo'; os.mkfifo(fifo, 0o600)
        with self.assertRaises(ValueError): self.read(fifo)

    def test_zero_bytes_are_legal_only_with_exact_independent_hash(self):
        path = self.root/'zero'; path.write_bytes(b''); path.chmod(0o600)
        self.assertEqual(a.check_file(path, a.metadata(b'', 0o600), deadline=self.deadline, check=lambda: None)[5], 0)
        with self.assertRaises(ValueError): a.check_file(path, a.metadata(b'x'), deadline=self.deadline, check=lambda: None)

    def test_exact_tree_refuses_extra_startup_files_and_empty_directory_drift(self):
        path = self.root/'file'; path.write_bytes(b'x'); path.chmod(0o600)
        expected = {'file': a.metadata(b'x', 0o600)}
        a.verify_exact_tree(str(self.root), expected, deadline=self.deadline, check=lambda: None)
        (self.root/'unexpected.pth').write_bytes(b'import hostile'); (self.root/'unexpected.pth').chmod(0o600)
        with self.assertRaises(ValueError): a.verify_exact_tree(str(self.root), expected, deadline=self.deadline, check=lambda: None)

    def test_venv_expectations_come_from_frozen_templates_and_explicit_runtime_inputs(self):
        one = a.venv_expected(PROFILE, '/private/tmp/fixed-tools/environment')
        two = a.venv_expected(PROFILE, '/private/tmp/other-tools/environment')
        self.assertIn('bin/𝜋thon', one)
        self.assertEqual(one['bin/python3']['sha256'], PROFILE['python']['sha256'])
        self.assertNotEqual(one['pyvenv.cfg']['sha256'], two['pyvenv.cfg']['sha256'])
        self.assertNotEqual(one['bin/activate']['sha256'], two['bin/activate']['sha256'])
        self.assertIn('bin/activate.fish', one)

    def test_incomplete_or_extra_base_template_inventory_refuses_before_setup(self):
        profile = deepcopy(PROFILE)
        fish = next(name for name in profile['venv_sources'] if name.endswith('/scripts/common/activate.fish'))
        profile['venv_sources'].pop(fish)
        with self.assertRaisesRegex(ValueError, 'complete venv'): a.admit_profile(profile, deadline=self.deadline, check=lambda: None)
        profile = deepcopy(PROFILE); profile['venv_sources']['/foreign/activate.fish'] = PROFILE['venv_sources'][fish]
        with self.assertRaisesRegex(ValueError, 'complete venv'): a.admit_profile(profile, deadline=self.deadline, check=lambda: None)

    def test_generated_scripts_match_pinned_stdlib_replacement_dispatch_with_quoted_unicode_paths(self):
        source = next(path for path in PROFILE['venv_sources'] if path.endswith('/venv/__init__.py'))
        raw, _ = a.read_file(source, deadline=self.deadline, check=lambda: None)
        self.assertEqual(a.digest(raw), PROFILE['venv_sources'][source]['sha256'])
        namespace = {'__name__': 'pinned_venv_reference', '__file__': source}
        # Execute only this already-pinned stdlib reference's definitions; Popen
        # and sockets are forbidden throughout this class. No venv is created.
        exec(compile(raw, source, 'exec'), namespace)
        builder = namespace['EnvBuilder'](with_pip=False, symlinks=False)
        environment = "/private/tmp/quote'path/環境"
        expected = a.venv_expected(PROFILE, environment)
        for path, value in PROFILE['venv_sources'].items():
            if '/scripts/' not in path: continue
            context = SimpleNamespace(env_dir=environment, env_name='環境', prompt='環境', bin_name='bin',
                env_exe=environment+'/bin/python3.14', script_path=path)
            raw = builder.replace_variables(value['text'], context).encode()
            self.assertEqual(expected['bin/'+Path(path).name], a.metadata(raw, value['mode']))

    def test_install_map_derives_record_script_and_exact_payload_without_installed_observation(self):
        one = a.installed_expected(PROFILE, '/private/tmp/fixed-tools')
        site = 'environment/lib/python3.14/site-packages/'
        self.assertEqual(one[site+'pglast/parser.cpython-314-darwin.so']['mode'], 0o755)
        self.assertEqual(one[site+'pglast/__init__.py']['sha256'], PROFILE['wheel']['inventory']['files']['pglast/__init__.py']['sha256'])
        self.assertIn(site+'pglast-7.21.dist-info/REQUESTED', one)
        self.assertNotEqual(one[site+'pglast-7.21.dist-info/RECORD']['sha256'], PROFILE['wheel']['inventory']['files']['pglast-7.21.dist-info/RECORD']['sha256'])
        self.assertFalse(any(key.endswith(('.pth', '.pyc', 'direct_url.json')) for key in one))

    def test_generated_record_matches_independent_archive_rows_and_pinned_pip_templates(self):
        import zipfile
        root = '/private/tmp/fixed-tools'
        expected = a.installed_expected(PROFILE, root)
        with zipfile.ZipFile(ARCHIVES/PROFILE['wheel']['inventory']['filename']) as archive:
            rows = list(csv.reader(archive.read('pglast-7.21.dist-info/RECORD').decode().splitlines()))
        script = ("#!/private/tmp/fixed-tools/environment/bin/python3\nimport sys\nfrom pglast.__main__ import main\n"
            "if __name__ == '__main__':\n    sys.argv[0] = sys.argv[0].removesuffix('.exe')\n    sys.exit(main())\n").encode()
        generated = {'../../../bin/pgpp': script, 'pglast-7.21.dist-info/INSTALLER': b'pip\n', 'pglast-7.21.dist-info/REQUESTED': b''}
        for key, raw in generated.items():
            rows.append([key, 'sha256='+base64.urlsafe_b64encode(hashlib.sha256(raw).digest()).rstrip(b'=').decode(), str(len(raw))])
        stream = io.StringIO(newline=''); csv.writer(stream).writerows(sorted(rows))
        record = stream.getvalue().encode()
        self.assertEqual(expected['environment/lib/python3.14/site-packages/pglast-7.21.dist-info/RECORD'], a.metadata(record))
        self.assertEqual(expected['environment/bin/pgpp'], a.metadata(script, 0o755))

    def pip_sources(self):
        output = []
        for name in ('pip/_internal/operations/install/wheel.py', 'pip/_vendor/distlib/scripts.py'):
            value = PROFILE['pip']['files'][name]
            raw, _ = a.read_file(value['target'], deadline=self.deadline, check=lambda: None)
            self.assertEqual(a.digest(raw), value['sha256']); output.append(raw)
        return output

    def test_console_script_matches_active_pinned_installer_override_and_inherited_formatter(self):
        pip_raw, distlib_raw = self.pip_sources()
        pip_tree = ast.parse(pip_raw)
        active = next(node for node in pip_tree.body if isinstance(node, ast.ClassDef) and node.name == 'PipScriptMaker')
        declaration = next(node for node in active.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == 'script_template' for target in node.targets))
        template = textwrap.dedent(declaration.value.args[0].value)
        self.assertEqual(PROFILE['pip']['script_template'], template)
        base = next(node for node in ast.parse(distlib_raw).body if isinstance(node, ast.ClassDef) and node.name == 'ScriptMaker')
        method = next(node for node in base.body if isinstance(node, ast.FunctionDef) and node.name == '_get_script_text')
        namespace = {}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[deepcopy(method)], type_ignores=[])), '<pinned inherited script formatter>', 'exec'), namespace)
        body = namespace['_get_script_text'](SimpleNamespace(script_template=template), SimpleNamespace(prefix='pglast.__main__', suffix='main'))
        root = '/private/tmp/fixed-tools'
        expected = a.installed_expected(PROFILE, root)['environment/bin/pgpp']
        self.assertEqual(expected, a.metadata(('#!'+root+'/environment/bin/python3\n'+body).encode(), 0o755))

    def test_wrong_active_installer_dispatch_or_template_commitment_refuses_before_install(self):
        pip_raw, distlib_raw = self.pip_sources()
        wrong = pip_raw.replace(b'maker = PipScriptMaker(', b'maker = ScriptMaker(')
        self.assertNotEqual(wrong, pip_raw)
        with self.assertRaisesRegex(ValueError, 'select PipScriptMaker'): a.pip_script_template(wrong, distlib_raw)
        profile = deepcopy(PROFILE); profile['pip']['script_template'] = 'old distlib template\n'
        with self.assertRaisesRegex(ValueError, 'template commitment differs'): a.admit_profile(profile, deadline=self.deadline, check=lambda: None)

    def receipt(self, root='/private/tmp/fixed-tools'):
        paths = a.tool_paths(PROFILE, root); sha = 'a'*64
        args = [[PROFILE['python']['path'], '-I', '-B', '-m', 'venv', '--copies', '--without-pip', root+'/environment'],
            [PROFILE['python']['path'], '-I', '-B', '-m', 'pip', '--python', paths['python'], '--isolated', '--disable-pip-version-check',
             '--no-input', '--keyring-provider', 'disabled', 'install', '--no-index', '--find-links', root+'/wheelhouse', '--require-hashes',
             '--only-binary=:all:', '--no-deps', '--no-compile', '--no-cache-dir', '-r', root+'/requirements.txt'],
            [paths['python'], '-I', '-B', '/fixed/origin_probe.py', '--profile', root+'/profile.json', '--profile-sha256', sha,
             '--root', root, '--deadline', '224.0'], [paths['node'], '--version']]
        commands = []
        for i, (label, argv) in enumerate(zip(('venv', 'pip', 'origin', 'node'), args)):
            commands.append({'label': label, 'argv': argv, 'started': 100.0+i*2, 'finished': 101.0+i*2, 'deadline': 220.0+i*2,
                'returncode': 0, 'worker_reaped': True, 'descendant_cleanup_verified': False,
                'log_identity': {name: [1, 2, 0o100600, os.getuid(), 1, 0, 3, 4] for name in ('stdout', 'stderr')},
                'stream_bytes': {'stdout': 0, 'stderr': 0}, 'stream_sha256': {'stdout': a.digest(b''), 'stderr': a.digest(b'')}})
        commands[3]['stream_bytes']['stdout'] = len(b'v22.23.3\n'); commands[3]['stream_sha256']['stdout'] = a.digest(b'v22.23.3\n')
        return {'root': root, 'profile_sha256': sha, 'commands': commands, 'probe': {'kind': 'local-tool-origin-probe-v1', 'passed': True,
            'paths': paths, 'python_version': '3.14.7', 'parser_version': '7.21', 'isolated': 1, 'no_user_site': 1,
            'dont_write_bytecode': True, 'optimize': 0, 'sys_path': PROFILE['python']['sys_path_base']+[paths['site_packages']]}}

    def test_fixed_receipt_rejects_bad_command_flags_outcomes_timing_and_origin_fields(self):
        a.validate_setup_receipt(self.receipt(), PROFILE)
        mutations = [lambda r: r['commands'][0].update(returncode=False), lambda r: r['commands'][0].update(worker_reaped=1),
            lambda r: r['commands'][1]['argv'].append('--index-url=foreign'), lambda r: r['commands'][1].update(started=99),
            lambda r: r['commands'][0].update(deadline=999), lambda r: r['commands'][2]['argv'].__setitem__(9, '/other'),
            lambda r: r['commands'][3]['stream_sha256'].update(stdout='0'*64), lambda r: r['probe'].update(passed=1),
            lambda r: r['probe'].update(isolated=True), lambda r: r['probe'].update(parser_version='7.18'),
            lambda r: r['probe']['sys_path'].append('/foreign'), lambda r: r['probe']['paths'].update(python='/base/python')]
        for mutation in mutations:
            value = self.receipt(); mutation(value)
            with self.assertRaises(ValueError): a.validate_setup_receipt(value, PROFILE)

    def test_additional_startup_customization_refuses_before_any_interpreter_start(self):
        profile = deepcopy(PROFILE); profile['startup']['site_directories'].append(str(self.root))
        for name in ('evil.pth', 'usercustomize.py', 'sitecustomize.cpython-314-darwin.so'):
            path = self.root/name; path.write_bytes(b'not executed'); path.chmod(0o600)
            with self.assertRaises(ValueError): a.admit_profile(profile, deadline=self.deadline, check=lambda: None)
            path.unlink()  # Only this test-owned tiny fixture, never prior evidence.

    def test_actual_worker_identity_mismatch_cannot_reach_parser_import(self):
        paths = a.tool_paths(PROFILE, '/private/tmp/never-created')
        with patch.object(a.importlib, 'import_module', side_effect=AssertionError('No parser import allowed')):
            with self.assertRaises(ValueError): a.assert_runtime(PROFILE, paths, deadline=self.deadline, check=lambda: None)

    def test_runtime_admission_rechecks_saved_setup_logs_instead_of_hash_declarations(self):
        root = self.root/'local-portable-tools'; root.mkdir(mode=0o700); (root/'evidence').mkdir(mode=0o700)
        profile_raw = (HERE/'local-profile.json').read_bytes(); profile_sha = a.digest(profile_raw)
        (root/'profile.json').write_bytes(profile_raw); (root/'profile.json').chmod(0o600)
        receipt = self.receipt(str(root)); receipt['profile_sha256'] = profile_sha; receipt['commands'][2]['argv'][7] = profile_sha
        receipt.update(kind='local-portable-tools-receipt-v1', local_only=True, ci_acceptance=False, target_acceptance=False,
            expected_layout_sha256='b'*64, observed={}, directories={}, root_identity=list(a.stamp(root.lstat())[:4]))
        for ordinal, command in enumerate(receipt['commands'], 1):
            for name in ('stdout', 'stderr'):
                payload = b''
                if name == 'stdout' and ordinal == 3: payload = a.canonical(receipt['probe'])+b'\n'
                if name == 'stdout' and ordinal == 4: payload = b'v22.23.3\n'
                path = root/'evidence'/f'{ordinal:02d}-{command["label"]}.{name}.log'
                path.write_bytes(payload); path.chmod(0o600)
                command['stream_bytes'][name] = len(payload); command['stream_sha256'][name] = a.digest(payload)
                command['log_identity'][name] = list(a.stamp(path.lstat()))
        raw = a.canonical(receipt)+b'\n'; (root/'receipt.json').write_bytes(raw); (root/'receipt.json').chmod(0o600)
        binding = {'profile_path': str(root/'profile.json'), 'profile_sha256': profile_sha,
                   'receipt_path': str(root/'receipt.json'), 'receipt_sha256': a.digest(raw)}
        with patch.object(a, 'admit_profile', lambda *args, **kw: None), patch.object(a, 'installed_expected', side_effect=RuntimeError('reached installed-map')):
            with self.assertRaisesRegex(RuntimeError, 'reached installed-map'): a.admit_tools(binding, deadline=self.deadline, check=lambda: None)
            changed = root/'evidence/04-node.stdout.log'; changed.write_bytes(b'v22.23.4\n')
            with self.assertRaises(ValueError): a.admit_tools(binding, deadline=self.deadline, check=lambda: None)

    def test_origin_bootstrap_refuses_unpinned_source_before_executing_it(self):
        probe = load('tool_origin_bootstrap_under_test', HERE/'origin_probe.py')
        target = self.root/'tool_admission.py'
        sentinel = self.root/'executed'
        target.write_text('open('+repr(str(sentinel))+',"w").write("bad")\n'); target.chmod(0o600)
        with patch.object(probe, '__file__', str(self.root/'origin_probe.py')):
            with self.assertRaisesRegex(ImportError, 'hash differs before execution'):
                probe._load_admission(self.deadline)
        self.assertFalse(sentinel.exists())

    def test_output_parent_is_physical_owned_private_before_any_mkdir(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError): s._create_root(str(self.root), lambda: None)
        self.assertFalse((self.root/'local-portable-tools').exists())
        self.root.chmod(0o700)
        outside = self.root/'outside'; outside.mkdir(mode=0o700)
        alias = self.root/'alias'; alias.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError): s._create_root(str(alias), lambda: None)
        self.assertFalse((outside/'local-portable-tools').exists())

    def test_verified_wheel_payload_and_macho_loader_closure_without_import(self):
        raw = (ARCHIVES/PROFILE['wheel']['inventory']['filename']).read_bytes()
        files = s.verify_wheel(raw, PROFILE['wheel'], deadline=self.deadline, check=lambda: None)
        self.assertEqual(len(files), 34)
        changed = bytearray(raw); changed[-1] ^= 1
        with self.assertRaises(ValueError): s.verify_wheel(bytes(changed), PROFILE['wheel'], deadline=self.deadline, check=lambda: None)

    def test_verified_typescript_payload_without_evaluating_it(self):
        raw = (ARCHIVES/PROFILE['typescript']['inventory']['filename']).read_bytes()
        files = s.verify_typescript(raw, PROFILE['typescript'], deadline=self.deadline, check=lambda: None)
        self.assertEqual(len(files), 130)
        self.assertEqual(hashlib.sha256(files['package/lib/typescript.js']).hexdigest(), 'dd17428736a07e1db1a138d8a14295ddb2699ba780ee15038acdd2c6da5373a0')
        changed = deepcopy(PROFILE['typescript']); changed['inventory']['files'].pop('package/LICENSE.txt')
        with self.assertRaises(ValueError): s.verify_typescript(raw, changed, deadline=self.deadline, check=lambda: None)

    def test_archive_paths_and_case_collisions_are_not_generic_extraction_permissions(self):
        for value in ['../x', '/x', 'a//b', 'a\\b', 'a/./b', 'a\0b', 'a/' + '/'.join('x' for _ in range(64))]:
            with self.subTest(value=value), self.assertRaises(ValueError): s._member(value)

    def test_deadline_and_capacity_callback_are_checked_before_file_admission(self):
        path = self.root/'file'; path.write_bytes(b'x'); path.chmod(0o600)
        with self.assertRaises(ValueError): a.read_file(path, deadline=time.monotonic()-1, check=lambda: None)
        def fail(): raise OSError('space')
        with self.assertRaisesRegex(OSError, 'space'): a.read_file(path, deadline=self.deadline, check=fail)

    def test_clean_setup_environment_does_not_inherit_keys_paths_or_proxy(self):
        with patch.dict(os.environ, {'PYTHONPATH': '/foreign', 'NODE_OPTIONS': '--require foreign', 'HTTPS_PROXY': 'private', 'PIP_INDEX_URL': 'private', 'SECRET': 'private'}):
            value = s._environment(self.root)
        self.assertEqual(value['PIP_CONFIG_FILE'], '/dev/null')
        self.assertEqual(value['HOME'], str(self.root/'home'))
        self.assertFalse({'PYTHONPATH', 'NODE_OPTIONS', 'HTTPS_PROXY', 'PIP_INDEX_URL', 'SECRET'} & set(value))


class InertCommandTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='lrv-tool-command-')).resolve(); self.root.chmod(0o700)
        for name in ('home', 'tmp', 'evidence'): (self.root/name).mkdir(mode=0o700)
        self.owner = s.Setup(self.root, {}, deadline=time.monotonic()+10, check=lambda: None)
        self.admit = patch.object(s.a, 'admit_profile', lambda *args, **kw: None); self.admit.start()

    def tearDown(self): self.admit.stop()

    def command(self, code):
        # This test-only inert program is unrelated to fixed provisioning argv.
        return self.owner.command('inert', (str(Path(sys.executable).resolve()), '-I', '-B', '-c', code))

    def test_actual_inert_child_logs_reaps_and_uses_original_deadline(self):
        paths = self.command('import os;os.write(1,b"out");os.write(2,b"err")')
        self.assertEqual(paths['stdout'].read_bytes(), b'out')
        self.assertEqual(paths['stderr'].read_bytes(), b'err')
        record = self.owner.commands[0]
        self.assertEqual(record['returncode'], 0); self.assertTrue(record['worker_reaped'])
        self.assertEqual(record['deadline'], self.owner.deadline)
        self.assertFalse(record['descendant_cleanup_verified'])

    def test_real_nonzero_child_poisons_future_commands(self):
        with self.assertRaises(ValueError): self.command('raise SystemExit(7)')
        self.assertTrue(self.owner.failed)
        with self.assertRaises(ValueError): self.command('raise SystemExit(0)')

    def test_output_cap_fails_without_unbounded_log(self):
        with patch.object(s, 'LOG_CAP', 4096), self.assertRaises(ValueError):
            self.command('import os;os.write(1,b"x"*8192)')
        self.assertTrue(self.owner.failed)
        self.assertLessEqual((self.root/'evidence/01-inert.stdout.log').stat().st_size, 4096)

    def test_original_deadline_does_not_renew_while_child_waits(self):
        self.owner.deadline = time.monotonic()+0.05
        started = time.monotonic()
        with self.assertRaises(ValueError): self.command('import time;time.sleep(30)')
        self.assertLess(time.monotonic()-started, 6); self.assertTrue(self.owner.failed)

    def test_lying_log_write_is_detected_by_physical_readback_before_command_credit(self):
        original = os.write
        def lying(fd, raw):
            if stat.S_ISREG(os.fstat(fd).st_mode): return len(raw)
            return original(fd, raw)
        with patch.object(os, 'write', side_effect=lying), self.assertRaisesRegex(ValueError, 'saved setup log differs'):
            self.command('import os;os.write(1,b"out")')
        self.assertTrue(self.owner.failed); self.assertEqual(self.owner.commands, [])

    def test_renamed_identical_log_cannot_replace_original_created_inode(self):
        original = s.a.read_file; changed = [False]
        def replaced(path, **kwargs):
            if str(path).endswith('.stdout.log') and not changed[0]:
                changed[0] = True
                raw = Path(path).read_bytes(); Path(path).rename(self.root/'old-stdout.log')
                Path(path).write_bytes(raw); Path(path).chmod(0o600)
            return original(path, **kwargs)
        with patch.object(s.a, 'read_file', side_effect=replaced), self.assertRaisesRegex(ValueError, 'saved setup log differs'):
            self.command('import os;os.write(1,b"out")')
        self.assertTrue(self.owner.failed); self.assertEqual(self.owner.commands, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
