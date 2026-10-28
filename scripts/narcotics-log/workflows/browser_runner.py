"""One real SDK login and acknowledgement-loss recovery on the current backend."""
import base64
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time

import full121_effects as effects
import full121_count_pair as pair


def safe_failure_diagnostics(value):
    """Closed nonsecret projection; optional fields may be absent on failures."""
    result = []
    if type(value) is not list:
        return result
    for item in value[:8]:
        if type(item) is not dict or item.get("phase") not in ("route", "page", "workflow"):
            continue
        if item.get("error_name") not in ("Error", "AssertionError", "TimeoutError", "TypeError", "ReferenceError", "SyntaxError", "Other"):
            continue
        safe = {"phase": item["phase"], "error_name": item["error_name"]}
        for key in ("driver_line", "driver_column", "actual_integer", "expected_integer"):
            maximum = 100000 if key.startswith("driver_") else 599
            if key in item and (item[key] is None or type(item[key]) is int and 0 <= item[key] <= maximum):
                safe[key] = item[key]
        result.append(safe)
    return result


def private_json(path, cap=262144):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_mode & 0o077 or before.st_size > cap:
            raise ValueError("Private bounded browser evidence required")
        raw = stream.read(cap + 1)
        after = os.fstat(stream.fileno())
    if len(raw) > cap or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError("Browser evidence changed while reading")
    return raw


def process_state(pid):
    """Linux runner identity, including birth time to refuse a reused PID."""
    try:
        fields = Path("/proc/" + str(pid) + "/stat").read_text().rsplit(")", 1)[1].split()
    except FileNotFoundError:
        return None
    return {"state": fields[0], "parent": int(fields[1]), "birth": fields[19]}


def run(context, modules, runtime, save):
    if sys.platform != "linux":
        raise ValueError("This owning browser launcher is admitted only on its Linux CI runner")
    if runtime.remaining(120) < 120:
        raise TimeoutError("The original browser120 phase does not fit the parent's remaining work budget")
    started = time.monotonic()
    deadline = started + 120
    handoff = context["browser_handoff"]
    base = Path(tempfile.mkdtemp(prefix="lrv-genuine-count4-v2-")).resolve()
    base.chmod(0o700)
    folder = base / "browser-count-finalize-proof"
    folder.mkdir(mode=0o700)
    save(folder, "input", handoff["private_input"])
    save(runtime.folder, "browser-owned-folder", {"path": str(folder)})
    root = Path(__file__).resolve().parents[3]
    driver = root / "tests/controlled-drugs/run-local-authenticated-count-finalize.mjs"
    environment = {key: os.environ[key] for key in ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL") if key in os.environ}
    environment.update(TZ="UTC", CI="true")
    argv = ["node", "--experimental-strip-types", str(driver), str(folder)]
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, start_new_session=True, close_fds=True, cwd=root, env=environment)
    logs = {"stdout": bytearray(), "stderr": bytearray()}
    released = set()
    sdk = None
    chrome = None
    failed = True
    try:
        with selectors.DefaultSelector() as selector:
            for name in logs:
                pipe = getattr(process, name)
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            while True:
                left = min(deadline - time.monotonic(), runtime.remaining(120))
                if left <= 5:
                    raise TimeoutError("Original parent-owned browser120 deadline exhausted")
                owner = folder / "browser-owner.json"
                if chrome is None and owner.exists():
                    raw = private_json(owner)
                    if raw:
                        value = runtime.decode(raw)
                        if value["node_pid"] != process.pid or type(value["browser_pid"]) is not int or value["browser_pid"] <= 1:
                            raise ValueError("Owned browser producer differs")
                        state = process_state(value["browser_pid"])
                        if state is None or state["parent"] != process.pid or os.getpgid(value["browser_pid"]) != value["browser_pid"]:
                            raise ValueError("Actual browser process parent/group differs")
                        executable = Path("/proc/" + str(value["browser_pid"]) + "/exe").resolve()
                        if executable != Path(value["executable"]).resolve():
                            raise ValueError("Actual browser executable differs from the fixed launcher")
                        chrome = {"pid": value["browser_pid"], "birth": state["birth"]}
                for label in ("auth-phase", "read-phase"):
                    ready = folder / (label + "-ready.json")
                    if label in released or not ready.exists():
                        continue
                    raw = private_json(ready)
                    if not raw:
                        continue
                    value = runtime.decode(raw)
                    if chrome is None:
                        raise ValueError("Actual browser ownership must precede every barrier")
                    if label == "auth-phase":
                        reference = value["evidence"]["auth_response"]
                        if reference["file"] != "auth-response-private.json":
                            raise ValueError("Fixed original SDK Auth response required")
                        raw_auth = private_json(folder / reference["file"], 2097152)
                        if len(raw_auth) != reference["bytes"] or hashlib.sha256(raw_auth).hexdigest() != reference["sha256"]:
                            raise ValueError("Original SDK Auth response bytes changed")
                        signed = runtime.decode(raw_auth)
                        claims = runtime.decode(base64.urlsafe_b64decode(signed["access_token"].split(".")[1] + "=" * (-len(signed["access_token"].split(".")[1]) % 4)))
                        original = context["users"][0]
                        if signed["user"]["id"] != original["id"] or claims["sub"] != original["id"] or claims["role"] != "authenticated" or claims["session_id"] != value["session_id"] or value["actor_id"] != original["id"]:
                            raise ValueError("Real SDK same-A login scope differs")
                        sdk = {**original, "token": signed["access_token"], "session_id": claims["session_id"],
                            "auth_aal": claims.get("aal"), "auth_amr": claims.get("amr"),
                            "auth_last_sign_in_at": signed["user"]["last_sign_in_at"]}
                        extra_b = context["current_actors"][context["users"][1]["id"]]
                        modules.auth.validate(runtime, context["auth_before"], context["users"], [extra_b, sdk])
                        profile_rows, roles = [], []
                        for item in value["profile_calls"]:
                            ref = item["evidence"]
                            if Path(ref["file"]).name != ref["file"]:
                                raise ValueError("Private SDK profile basename required")
                            data = private_json(folder / ref["file"])
                            if len(data) != ref["bytes"] or hashlib.sha256(data).hexdigest() != ref["sha256"]:
                                raise ValueError("Original SDK staff projection changed")
                            rows = runtime.decode(data)
                            rows = rows if isinstance(rows, list) else [rows]
                            if item["relation"] == "profiles":
                                profile_rows += rows
                            elif item["relation"] == "user_roles":
                                roles += rows
                            else:
                                raise ValueError("Unlisted SDK staff relation")
                        if not profile_rows or any(row["id"] != original["id"] or row["is_active"] is not True or row["full_name"] != original["name"] for row in profile_rows) or {row["role"] for row in roles} != {"ADMIN", "DVM"}:
                            raise ValueError("Actual SDK active staff profile/roles differ")
                        runtime.verify_module("browser-Auth-module-properties")
                    else:
                        if sdk is None or value["actor_id"] != sdk["id"] or value["session_id"] != sdk["session_id"] or value["count_id"] != handoff["private_input"]["countId"]:
                            raise ValueError("Actual browser READ belongs to a different session or count")
                        effects.verify(runtime.selected_query, "browser-before-finalize-count-state", "browser_lost_finalize", "before_browser")
                        runtime.verify_module("browser-READ-module-properties")
                    save(folder, label + "-continue", {"kind": value["kind"], "passed": True})
                    released.add(label)
                exited = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                if exited is not None and not selector.get_map():
                    break
                for key, _ in selector.select(min(.05, left)):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if chunk:
                        logs[key.data].extend(chunk)
                        if len(logs[key.data]) > 2097152:
                            raise ValueError("Browser process log cap exceeded")
                    else:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
        code = process.wait(timeout=min(1, max(.001, deadline - time.monotonic())))
        result = runtime.decode(private_json(folder / "result.json"))
        # Retain only fixed phase flags/statuses for a failed genuine browser
        # attempt. Never upload input, passwords, tokens, raw Auth or RPC bodies.
        flags = ("passed", "auth_phase_released", "read_phase_released", "review_both_explicit",
                 "actual_finalize_200_then_ack_lost_once", "unknown_UI_shown", "id_only_pointer_retained",
                 "saved_closure_observed", "storage_cleared", "agreement_UI_read",
                 "normal_browser_cleanup", "normal_vite_cleanup")
        diagnostic = {key: result.get(key) for key in flags if type(result.get(key)) is bool}
        diagnostic["candidate_not_acceptance"] = True
        for key in ("auth_calls", "options_count"):
            if type(result.get(key)) is int and 0 <= result[key] <= 100:
                diagnostic[key] = result[key]
        diagnostic["profile_statuses"] = [{"relation": call.get("relation"), "status": call.get("status")}
            for call in result.get("profile_calls", []) if type(call) is dict
            and call.get("relation") in ("profiles", "user_roles") and type(call.get("status")) is int]
        if type(result.get("blocked_origins")) is list:
            diagnostic["blocked_origin_count"] = len(result["blocked_origins"])
        diagnostic["failure_diagnostics"] = safe_failure_diagnostics(result.get("failure_diagnostics"))
        diagnostic["rpc_statuses"] = [{"rpc": call.get("rpc"), "status": call.get("status")}
            for call in result.get("calls", []) if type(call) is dict
            and call.get("rpc") in pair.RPCS and type(call.get("status")) is int]
        save(runtime.folder, "browser-candidate-diagnostic", diagnostic)
        if code != 0 or result["passed"] is not True or released != {"auth-phase", "read-phase"} or sdk is None or chrome is None or result["session_id"] != sdk["session_id"]:
            raise ValueError("Complete actual browser signing/recovery phase failed")
        state = process_state(chrome["pid"])
        if state is not None and state["birth"] == chrome["birth"] and state["state"] != "Z":
            raise ValueError("Owned browser process remains after reported normal cleanup")
        if (folder / "post-persistence-cutoff-failure.json").exists() or time.monotonic() >= deadline:
            raise TimeoutError("Browser post-persistence deadline refusal")
        effects.verify(runtime.selected_query, "browser-final-count-state", "browser_lost_finalize")
        if time.monotonic() >= deadline:
            raise TimeoutError("Original browser120 includes parent evidence checks")
        context["current_actors"][sdk["id"]] = sdk
        call = result["calls"][3]
        if call["rpc"] != "finalize_controlled_count_v1":
            raise ValueError("Exact original browser finalize call required")
        original = {}
        for name in ("request", "response"):
            ref = call[name]
            if ref["file"] != "rpc-4-" + name + ".json":
                raise ValueError("Fixed original browser finalize file required")
            raw = private_json(folder / ref["file"], 2097152)
            if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
                raise ValueError("Original browser finalize bytes changed")
            original[name] = runtime.decode(raw)
        request = original["request"]["p_request"]
        receipt = pair.receipt("finalize", request, original["response"])
        if request["operation_id"] != result["operation_id"] or request["outcome_id"] != result["outcome_id"]:
            raise ValueError("Original browser finalization result differs")
        context["browser_finalization"] = {"request": request, "receipt": receipt}
        context["count"]["agreement"]["finalize"] = context["browser_finalization"]
        save(runtime.folder, "authenticated-browser-proof", result)
        failed = False
        return result
    finally:
        primary = sys.exc_info()[1]
        problems = []
        for name, raw in logs.items():
            try:
                runtime.write("browser-process-" + name + ".bin", bytes(raw))
            except BaseException as error:
                problems.append(error)
        if failed:
            # Kill only our unreaped Node process group and the separately
            # observed browser group whose birth time still matches.
            if chrome is not None:
                state = process_state(chrome["pid"])
                if state is not None and state["birth"] == chrome["birth"]:
                    try:
                        os.killpg(chrome["pid"], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except BaseException as error:
                        problems.append(error)
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=min(5, max(.001, deadline - time.monotonic())))
                except BaseException as error:
                    problems.append(error)
        if problems:
            if primary is not None:
                for error in problems:
                    primary.add_note("Browser retention/cleanup failure: " + type(error).__name__)
            else:
                raise BaseExceptionGroup("Browser retention/cleanup failed", problems)
