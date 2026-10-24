"""Literal source-bound children of the three reviewed regression harnesses.

No production-guard permission is created. These policies apply only to real OS
launches performed by the separately classified implementation regressions.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import stat

_SHA256 = hashlib.sha256
TRANSPORT_SHA = 'b7012fb63df1a3e8dece8474c876c620308d062f71e38dd1e1a8509f85063594'
TRANSPORT_INERT_SHA = 'ad45e0730a2b29b7cc6190fc769a6808154813c686b7e930951f65698e1c4fa7'
HISTORICAL_TEST_SHA = '5991ed26159df351fa3932c9797bf9598f9702008838d451a304d8c9ecf671c3'
HISTORICAL_PORTABLE_TEST_SHA = '9b2b03221dd13db7ca0557a5028443d11cdf12b19f1660b7cadd36967e83aa18'
HISTORICAL_WORKER_SHA = '2a891488d158b62e05e11ba9d19b4eb21dca93dfdce2d4e34d08e65025730423'
GUARDED_TEST_SHA = '92a39b238df6aa998ce796162f954fadff40fef4f203c6064cbb3f074b0e69bc'
TOOL_SETUP_TEST_SHA = 'c1121f6cfe9f8dd9cd4f4a394f22868009047da97db5bef891610eb8548a285f'
POLICY_SHA = 'd7c626ca52673bafa204ffb57ca97b1cb618b08edb8659868fb9e4b0b1b27b46'
CONTRACT_SHA = '27ffe06d39e6c70051ad62fa33855d2220af94a83f26032b2d5d08fd8c65c847'
TRANSPORT_MODES = {
    'test_exact_normal_completion_actual_exit_and_exclusive_logs': ('ok',),
    'test_dual_pipe_saturation_is_drained_without_truncation': ('dual',),
    'test_stdout_cap_failure_retains_prefix_and_poison_prevents_next_launch': ('outcap',),
    'test_stderr_cap_is_independent': ('errcap',),
    'test_nonzero_exit_with_fully_written_pass_is_rejected': ('nonzero',),
    'test_missing_terminal_fails': ('missing',),
    'test_duplicate_truncated_non_utf8_terminal_fails': ('duplicate', 'truncated', 'unicode'),
    'test_timeout_uses_single_term_kill_window_and_reaps_owned_child': ('hang',),
    'test_late_final_validator_cannot_return_pass': ('ok',),
    'test_primary_failure_survives_cleanup_signal_error': ('hang',),
    'test_inherited_resource_limits_unchanged_and_constants': ('ok',),
    'test_failure_immediately_after_tentative_pass_revokes_receipt': ('ok',),
    'test_final_stream_hash_receipt_cannot_hide_late_completion': ('ok',),
    'test_log_persistence_error_refuses_after_worker_exit': ('ok',),
}
HISTORICAL_METHODS = ('test_changed_source_refused_before_import', 'test_complete_independent638_and267_profile_pass',
    'test_extra_eligible_source_is_not_projected_away', 'test_symlink_root_refuses', 'test_unknown_cli_argument_refuses')
GUARDED_MODES = {
    'test_actual_child_pair_revalidation_closes_then_credits_under_original_deadline': 'ok',
    'test_real_nonzero_child_never_credits_and_closes_reader': 'nonzero',
    'test_real_zero_exit_with_invalid_guard_never_credits': 'bad_guard',
    'test_source_recheck_after_successful_transport_can_still_refuse_credit': 'ok',
    'test_late_stream_change_in_final_source_check_is_reobserved': 'ok',
    'test_close_failure_after_valid_pair_prevents_accounting_credit': 'ok',
    'test_post_finalize_capacity_failure_prevents_credit': 'ok',
}
TOOL_SETUP_PROGRAMS = {
    'test_actual_inert_child_logs_reaps_and_uses_original_deadline': 'import os;os.write(1,b"out");os.write(2,b"err")',
    'test_real_nonzero_child_poisons_future_commands': 'raise SystemExit(7)',
    'test_output_cap_fails_without_unbounded_log': 'import os;os.write(1,b"x"*8192)',
    'test_original_deadline_does_not_renew_while_child_waits': 'import time;time.sleep(30)',
    'test_lying_log_write_is_detected_by_physical_readback_before_command_credit': 'import os;os.write(1,b"out")',
    'test_renamed_identical_log_cannot_replace_original_created_inode': 'import os;os.write(1,b"out")',
}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return _SHA256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def declaration(profile, logical_id_path, source_record):
    require(type(logical_id_path) is str and logical_id_path.startswith('implementation-regressions/'), 'literal regression namespace required')
    source_sha = source_record['sha256']
    if profile == 'transport':
        require(source_sha == TRANSPORT_SHA, 'frozen transport regression source differs')
        return {logical_id_path+'::TransportTests.'+method: {'transport-inert': len(modes)} for method, modes in TRANSPORT_MODES.items()}
    if profile == 'historical-profile':
        require(source_sha in (HISTORICAL_TEST_SHA, HISTORICAL_PORTABLE_TEST_SHA), 'frozen historical-profile source differs')
        return {logical_id_path+'::HistoricalAssertionTests.'+method: {'historical-profile': 1} for method in HISTORICAL_METHODS}
    if profile == 'guarded-job':
        require(source_sha == GUARDED_TEST_SHA, 'frozen guarded-job regression source differs')
        return {logical_id_path+'::GuardedJobTests.'+method: {'guarded-job-inert': 1} for method in GUARDED_MODES}
    if profile == 'tool-setup':
        require(source_sha == TOOL_SETUP_TEST_SHA, 'frozen tool-setup regression source differs')
        return {logical_id_path+'::InertCommandTests.'+method: {'tool-setup-inert': 1} for method in TOOL_SETUP_PROGRAMS}
    raise ValueError('unknown finite child profile')


def _physical_file(path, *, cap, check):
    path = Path(path)
    require(path.is_absolute() and str(path) == str(path.absolute()) and '..' not in path.parts, 'physical finite child path required')
    handles, leaf = [os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)], None
    try:
        for part in path.parts[1:-1]:
            check(); handles.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=handles[-1]))
        leaf = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=handles[-1])
        before = os.fstat(leaf)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.getuid()
                and 0 < before.st_size <= cap, 'owned finite child file required')
        chunks, count = [], 0
        while True:
            check(); raw = os.read(leaf, min(65536, before.st_size+1-count)); check()
            if not raw:
                break
            chunks.append(raw); count += len(raw)
            require(count <= before.st_size, 'finite child file grew')
        after = os.fstat(leaf)
        linked = os.stat(path.name, dir_fd=handles[-1], follow_symlinks=False)
        stamp = lambda st: (st.st_dev, st.st_ino, st.st_mode, st.st_uid, st.st_nlink, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
        require(count == before.st_size and stamp(before) == stamp(after) == stamp(linked), 'finite child file changed')
        return b''.join(chunks)
    finally:
        for fd in ([leaf] if leaf is not None else []) + list(reversed(handles)):
            os.close(fd)


def _physical_directory(path, check):
    require(type(path) is str and path.startswith('/') and not path.startswith('//') and '\x00' not in path
            and str(Path(path)) == path and '..' not in Path(path).parts, 'normalized physical child directory required')
    handles, edges = [os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)], []
    try:
        for part in Path(path).parts[1:]:
            check(); parent = handles[-1]
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            handles.append(child)
            edges.append((parent, part, child, os.fstat(child)))
        root = os.fstat(handles[-1])
        require(root.st_uid == os.getuid() and stat.S_IMODE(root.st_mode) == 0o700, 'owned private child directory required')
        for parent, name, child, before in edges:
            check(); linked, after = os.stat(name, dir_fd=parent, follow_symlinks=False), os.fstat(child)
            expected = lambda st: (st.st_dev, st.st_ino, st.st_mode, st.st_uid)
            require(stat.S_ISDIR(linked.st_mode) and expected(before) == expected(linked) == expected(after),
                    'child directory ancestry changed')
        check()
    finally:
        for fd in reversed(handles):
            os.close(fd)
    check()


def build(job, *, read_source, python, environment, check):
    suite, policy = job['suite'], job['suite']['child_policy']
    routes = declaration(policy['profile'], suite['logical_id_path'], suite['source'])
    require(policy['routes'] == routes, 'exact finite child route declaration differs')
    read_source(suite['source'])
    scratch = Path(policy['scratch_root'])
    repository = Path(policy['repository_root'])
    require(str(scratch) == environment.get('TMPDIR') and scratch.is_absolute()
            and scratch.is_dir() and not scratch.is_symlink(), 'actual worker scratch root required')
    _physical_directory(str(scratch), check)
    require(repository.is_absolute() and not repository.is_symlink(), 'physical declared repository root required')
    source = Path(suite['source']['path'])
    require(source.is_relative_to(repository), 'suite source must belong to declared clean repository')
    # Exactly two reviewed, same-depth placements. No arbitrary search/fallback.
    runners = (repository/'tmp/secondary-review-20261021/portable-runner-draft',
               repository/'tests/controlled-drugs/portable-runner')
    matches = [root for root in runners if source.is_relative_to(root)]
    require(len(matches) == 1, 'finite source is outside both fixed publication layouts')
    runner = matches[0]
    expected_source = runner/({'transport':'test_transport.py','guarded-job':'guarded-job-integration/test_guarded_job.py',
        'tool-setup': 'tool-setup-integration/test_tool_setup.py',
        'historical-profile': 'controller-integration/portable-regression-tests/test_historical638_assertion.py'
            if suite['source']['sha256'] == HISTORICAL_PORTABLE_TEST_SHA else 'test_historical638_assertion.py'}[policy['profile']])
    require(source == expected_source, 'finite regression source placement differs')
    inert = None
    if policy['profile'] == 'transport':
        tree = ast.parse(read_source(suite['source']))
        matches = [node.value for node in tree.body if isinstance(node, ast.Assign)
                   and any(isinstance(target, ast.Name) and target.id == 'INERT' for target in node.targets)]
        require(len(matches) == 1, 'one literal transport child program required')
        inert = ast.literal_eval(matches[0])
        require(type(inert) is str and sha(inert.encode()) == TRANSPORT_INERT_SHA, 'frozen inert child program differs')

    def admitted(arguments, identifier):
        check()
        require(type(arguments) is tuple and len(arguments) == 4, 'fixed subprocess audit event required')
        executable, argv, cwd, env = arguments
        require(type(executable) is str and executable == python and type(argv) in (tuple, list)
                and all(type(arg) is str for arg in argv) and argv[0] == python
                and (type(cwd) is str or (policy['profile'] in ('tool-setup', 'historical-profile') and type(cwd) is type(Path('/'))))
                and type(env) is dict, 'physical admitted interpreter and explicit argv/cwd/env required')
        argv = list(argv)
        cwd = os.fspath(cwd)
        cwd_path = Path(cwd)
        require(cwd_path.is_absolute() and cwd_path.is_relative_to(scratch) and '..' not in cwd_path.parts,
                'child cwd outside actual worker scratch')
        _physical_directory(cwd, check)
        method = identifier.rsplit('.', 1)[-1]
        if policy['profile'] == 'tool-setup':
            require(identifier in routes and len(argv) == 5 and argv[:4] == [python, '-I', '-B', '-c']
                    and argv[4] == TOOL_SETUP_PROGRAMS[method] and cwd_path.name.startswith('lrv-tool-command-'),
                    'exact tool-setup inert literal differs')
            expected_env = dict(PATH='/usr/bin:/bin', HOME=str(cwd_path/'home'), TMPDIR=str(cwd_path/'tmp'),
                LANG='en_US.UTF-8', LC_ALL='en_US.UTF-8', PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1',
                PYTHONHASHSEED='0', PIP_CONFIG_FILE='/dev/null', __CF_USER_TEXT_ENCODING=f'0x{os.getuid():X}:0x0:0x0')
            require(env == expected_env, 'exact tool-setup inert environment differs')
            return 'tool-setup-inert'
        if policy['profile'] == 'transport':
            require(identifier in routes and len(argv) == 7 and argv[1:5] == ['-I', '-B', '-c', inert]
                    and argv[5] in TRANSPORT_MODES[method]
                    and env == {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}, 'transport inert launch differs')
            require(cwd_path.name == method, 'transport per-test scratch differs')
            terminal_parent = cwd_path
            if method == 'test_duplicate_truncated_non_utf8_terminal_fails':
                # The frozen harness retains the method directory as OS cwd,
                # but writes each terminal into its exact literal mode child.
                terminal_parent = cwd_path/argv[5]
                _physical_directory(str(terminal_parent), check)
            require(argv[6] == str(terminal_parent/'terminal.json'), 'transport terminal placement differs')
            return 'transport-inert'
        if policy['profile'] == 'historical-profile':
            worker = runner/'historical638_assertion.py'
            require(identifier in routes and len(argv) == (9 if method == 'test_unknown_cli_argument_refuses' else 8)
                    and argv[:6] == [python, '-I', '-B', str(worker), '--repository-root', str(repository)]
                    and argv[6] == '--tree-root', 'historical-profile fixed worker invocation differs')
            require(runner.parents[2] == repository, 'preserved historical ROOT layout differs')
            require(sha(_physical_file(worker, cap=4*1024*1024, check=check)) == HISTORICAL_WORKER_SHA, 'frozen historical worker bytes differ')
            tree = Path(argv[7])
            require(tree.is_absolute() and tree.is_relative_to(cwd_path) and '..' not in tree.parts,
                    'historical tree outside this fixture parent')
            if method == 'test_symlink_root_refuses':
                require(tree == cwd_path/'tree-alias', 'exact historical alias counterexample required')
            else:
                require(tree.is_relative_to(cwd_path/'copies'), 'historical tree outside fixed copies root')
            if method == 'test_unknown_cli_argument_refuses':
                require(argv[8] == '--run-synthetic-local', 'exact unknown-argument counterexample required')
            expected_env = dict(HOME=str(cwd_path/'home'), TMPDIR=str(cwd_path/'tmp'), PATH=str(Path(python).parent),
                PYTHONDONTWRITEBYTECODE='1', PYTHONOPTIMIZE='0', PYTHONNOUSERSITE='1', PYTHONUTF8='1', LC_ALL='C', LANG='C')
            require(env == expected_env and cwd_path.name.startswith('historical638-assertion-test-'), 'historical child environment/fixture differs')
            return 'historical-profile'
        require(identifier in routes and len(argv) == 8 and argv[1:3] == ['-I', '-B'] and argv[4] == '--job'
                and argv[6] == '--job-sha256' and re.fullmatch('[0-9a-f]{64}', argv[7])
                and argv[3] == str(cwd_path/'inert_worker.py') and argv[5] == str(cwd_path/'output/job.json')
                and cwd_path.name.startswith('lrv-guarded-job-')
                and env == {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}, 'guarded-job inert invocation differs')
        raw = _physical_file(argv[5], cap=4*1024*1024, check=check)
        require(sha(raw) == argv[7], 'inner admitted job digest differs')
        program = _physical_file(argv[3], cap=65536, check=check)
        require(program == guarded_program(raw, GUARDED_MODES[method]), 'exact guarded-job inert program differs')
        return 'guarded-job-inert'
    return routes, admitted


def guarded_program(job_raw, mode):
    """Literal replica of the frozen tiny fixture builder, not executable input."""
    job_sha = sha(job_raw)
    identifier = 'test_fixed.py::Fixed.test_one'
    report = dict(kind='finite-offline-worker-guard-report-v1', suite_id='test_fixed.py', contract_sha256=CONTRACT_SHA,
        installed=True, test_ids=[identifier], active_test=None, launches=[dict(test_id=identifier, route='fixed-child', ordinal=1)],
        denial_count=0, denials=[], owned_directories=1, pending_node_permit=False, universal_descendant_containment=False)
    guard = dict(kind='portable-worker-guard-evidence-v1', status='complete', job_id='job', job_sha256=job_sha,
        suite_id='test_fixed.py', suite_tree_tag='source', source_trees_sha256='2'*64, implementation_sha256='3'*64,
        policy_envelope_sha256=POLICY_SHA, report=report)
    guard_raw = canonical(guard)+b'\n'
    result = dict(kind='portable-unittest-terminal-v1', passed=True, ids=[identifier], expected_count=1,
        expected_ids_sha256=sha(json.dumps([identifier], ensure_ascii=False, separators=(',', ':')).encode()), tests_run=1,
        started=[0], stopped=[0], succeeded=[0], problems={name: [] for name in ('failures', 'errors', 'skips', 'expected_failures', 'unexpected_successes', 'subtest_failures', 'subtest_errors')},
        guard_clean=True, guard_errors=0, protocol_errors=0)
    terminal_raw = canonical(dict(kind='portable-worker-terminal-v2', job_id='job', job_sha256=job_sha,
        guard_report_sha256=sha(guard_raw), guard_report_bytes=len(guard_raw), result=result))+b'\n'
    return ('import os,sys,hashlib\nfrom pathlib import Path\n'
        'assert len(sys.argv)==5 and sys.argv[1]=="--job" and sys.argv[3]=="--job-sha256"\n'
        'path=Path(sys.argv[2]); assert hashlib.sha256(path.read_bytes()).hexdigest()==sys.argv[4]\n'
        'def put(name,raw):\n fd=os.open(path.parent/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\n'
        ' try:\n  assert os.write(fd,raw)==len(raw)\n finally: os.close(fd)\n'
        + ('sys.exit(7)\n' if mode == 'nonzero' else '')
        + ('put("guard.json",b"{}")\n' if mode == 'bad_guard' else 'put("guard.json",'+repr(guard_raw)+')\n')
        + 'put("terminal.json",'+repr(terminal_raw)+')\n'
        + 'os.write(1,b"inert stdout");os.write(2,b"inert stderr")\n').encode()
