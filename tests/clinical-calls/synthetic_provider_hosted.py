"""Protected staging orchestration. Tests inject every CLI/HTTP boundary.

No import-time I/O. Native account operations exist only behind run_hosted's
fixed-input/budget/explicit-authorization preflight or narrowly scoped cleanup.
"""
from __future__ import annotations
import base64
import hashlib
import fcntl
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

PROJECT = "kothoqicubowyhwfsrte"
BASE = "https://" + PROJECT + ".supabase.co"
VERSION = "lrv-call-provider-run-v2"
OUTER_LIMIT = 1500000
FLAG_NAMES = ["CLINICAL_CALL_CAPTURE_ENABLED", "CLINICAL_CALL_NOTE_PROCESSING_ENABLED", "CLINICAL_AUDIO_PROCESSING_ENABLED", "CLINICAL_NOTE_PROCESSING_ENABLED", "CLINICAL_RECAP_PROCESSING_ENABLED"]
sha = lambda value: hashlib.sha256(value).hexdigest()
packed = lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def validate_service_jwt_identity(value):
    """Claims/shape check only, NOT signature verification.

    The captured CLI credential must subsequently pass the independently verified
    project JWT gateway. Runtime-inherited service keys need not equal CLI keys.
    """
    def unique_object(pairs):
        result = {}
        for key, item in pairs:
            if key in result: raise ValueError("duplicate_jwt_claim")
            result[key] = item
        return result
    try:
        if not isinstance(value, str) or len(value) > 16384 or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value): raise ValueError()
        encoded = value.split(".")[1]
        claims = json.loads(base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True).decode("utf-8"), object_pairs_hook=unique_object)
        if not isinstance(claims, dict) or claims.get("role") != "service_role" or claims.get("ref") != PROJECT: raise ValueError()
    except Exception:
        raise ValueError("staging_service_jwt_identity_unconfirmed") from None


def rows(value):
    if isinstance(value, list): return value
    if isinstance(value, dict):
        for key in ("rows", "data", "result", "functions", "secrets", "keys", "api_keys", "projects"):
            if isinstance(value.get(key), list): return value[key]
    raise ValueError("metadata_rows_shape")


def functions(value):
    result = []
    allowed = ("id", "version", "status", "verify_jwt", "created_at", "updated_at", "entrypoint_path", "import_map_path", "sha256", "code_sha256", "ezbr_sha256", "import_map")
    for row in rows(value):
        name = row.get("slug") or row.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", name): raise ValueError("function_identity_shape")
        result.append({"name": name, **{key: row[key] for key in allowed if key in row}})
    if len({r["name"] for r in result}) != len(result): raise ValueError("duplicate_function_metadata")
    return sorted(result, key=lambda r: r["name"])


def secret_metadata(value):
    result = []
    for row in rows(value):
        name, digest = row.get("name"), row.get("digest", row.get("value"))
        if not isinstance(name, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,199}", name) or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("secret_names_digests_only_required")
        result.append({"name": name, "digest": digest})
    if len({r["name"] for r in result}) != len(result): raise ValueError("duplicate_secret_metadata")
    return sorted(result, key=lambda r: r["name"])


def buckets(value):
    result = []
    for row in rows(value):
        name = row.get("id", row.get("name"))
        if not isinstance(name, str) or not name or "/" in name: raise ValueError("bucket_identity_shape")
        result.append({"name": name, **{k: row[k] for k in ("public", "file_size_limit", "allowed_mime_types", "created_at", "updated_at") if k in row}})
    if len({r["name"] for r in result}) != len(result): raise ValueError("duplicate_bucket_metadata")
    return sorted(result, key=lambda r: r["name"])


def contains_secret(raw, protected):
    """Literal/two JSON-escape rounds + bounded parsed/base64 fields; not universal encoding detection."""
    protected = [s for s in protected if s]
    if not protected: return False
    if any(s.encode() in raw for s in protected): return True
    text = raw.decode("utf-8", errors="replace")
    def unescape(match):
        value = match.group(0)
        if value.startswith("\\u"): return chr(int(value[2:], 16))
        return {'\\"':'"', '\\\\':'\\', '\\/':'/', '\\b':'\b', '\\f':'\f', '\\n':'\n', '\\r':'\r', '\\t':'\t'}.get(value, value)
    for _ in range(2):
        text = re.sub(r'\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])', unescape, text)
        if any(s in text for s in protected): return True
    try: parsed = json.loads(raw)
    except (ValueError, UnicodeError): return False
    pending = [parsed]; visited = 0
    while pending:
        value = pending.pop(); visited += 1
        if visited > 50000: return True  # Fail closed rather than export unexamined oversized structure.
        if isinstance(value, dict):
            for key, item in value.items():
                pending.append(item)
                if key.endswith("base64") and isinstance(item, str):
                    try:
                        decoded = base64.b64decode(item, validate=True)
                        if any(s.encode() in decoded for s in protected): return True
                        plain = decoded.decode("utf-8", errors="replace")
                        for _ in range(2):
                            plain = re.sub(r'\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])', unescape, plain)
                            if any(s in plain for s in protected): return True
                    except (ValueError, UnicodeError): pass
        elif isinstance(value, list): pending.extend(value)
        elif isinstance(value, str) and any(s in value for s in protected): return True
    return False


def http_framing(stream):
    """Inspect urllib HTTPError wrappers and actual stdlib HTTPResponse framing without exposing headers."""
    objects = [stream, getattr(stream, "fp", None)]
    headers = next((getattr(obj, "headers", None) for obj in objects if obj is not None and getattr(obj, "headers", None) is not None), None)
    declared = None; error = None
    def values(name):
        if headers is None: return []
        if hasattr(headers, "get_all"): return headers.get_all(name) or []
        value = headers.get(name)
        return [] if value is None else [value]
    lengths, encodings = values("Content-Length"), values("Transfer-Encoding")
    if lengths:
        if len(lengths) != 1 or not isinstance(lengths[0], str) or not re.fullmatch(r"[0-9]{1,20}", lengths[0].strip()):
            error = "outer_content_length_malformed_or_ambiguous"
        else: declared = int(lengths[0].strip())
    if encodings:
        if lengths or len(encodings) != 1 or str(encodings[0]).strip().lower() != "chunked": error = "outer_transfer_framing_ambiguous"
    remaining = next((getattr(obj, "length", None) for obj in objects if obj is not None and type(getattr(obj, "length", None)) is int), None)
    return declared, remaining, error


def read_bounded(stream, status, protected=(), limit=OUTER_LIMIT):
    declared, _initial_remaining, framing_error = http_framing(stream)
    chunks = []; count = 0; observed = 0; complete = False; error = None
    try:
        while True:
            part = stream.read(min(8192, limit - count + 1))
            if not part: complete = True; break
            observed += len(part)
            kept = part[:max(0, limit - count)]; chunks.append(kept); count += len(kept)
            if observed > limit: error = "outer_response_oversized"; break
    except Exception as failure:
        partial = failure.partial if isinstance(failure, http.client.IncompleteRead) else b""
        if isinstance(partial, bytes):
            observed += len(partial)
            kept = partial[:max(0, limit - count)]; chunks.append(kept); count += len(kept)
        error = "outer_response_oversized" if observed > limit else "outer_body_interrupted"
    _declared_after, remaining, later_error = http_framing(stream)
    framing_error = framing_error or later_error
    if complete and (framing_error or (declared is not None and observed != declared) or (remaining is not None and remaining != 0)):
        complete = False
        error = framing_error or "outer_body_framing_incomplete"
    raw = b"".join(chunks)
    redacted = contains_secret(raw, protected)
    return {"status": status, "body": b"" if redacted else raw, "complete": complete and not redacted,
            "error": "known_secret_echo_redacted" if redacted else error, "redacted": redacted,
            "observed_bytes_lower_bound": observed, "declared_content_length": declared, "remaining_body_bytes": remaining}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args): return None


class NativeTransport:
    """Only fixed staging management CLI, guard storage and owned probe paths."""
    def __init__(self, core, plan, directory, operator):
        self.core, self.plan, self.directory, self.operator = core, plan, Path(directory), operator
        self.service = None
        self.opener = build_opener(NoRedirect())
    @property
    def protected(self): return [self.operator, self.service or ""]
    def command(self, argv, timeout=180):
        try: result = subprocess.run(argv, cwd=self.core.ROOT, capture_output=True, timeout=timeout)
        except Exception: raise ValueError("cli_receipt_unconfirmed") from None
        if result.returncode: raise ValueError("cli_command_failed")
        return result.stdout  # Never log CLI output: key acquisition and debug output may contain credentials.
    def json_command(self, args):
        raw = self.command(["supabase", *args, "--output", "json", "--agent", "no"])
        if contains_secret(raw, self.protected): raise ValueError("cli_metadata_secret_echo_refused")
        return json.loads(raw)
    def check_local(self):
        for name in self.plan["function_names"]:
            entry = self.directory / "supabase/functions" / name
            self.command(["deno", "check", "--cached-only", "--frozen", "--config", str(entry / "deno.json"), str(entry / "index.ts")])
    def verify_project(self):
        found = [r for r in rows(self.json_command(["projects", "list"])) if r.get("id", r.get("ref")) == PROJECT]
        if len(found) != 1 or self.plan["staging_project"] != PROJECT: raise ValueError("independent_staging_identity_unconfirmed")
    def acquire_credentials(self):
        # The OpenAI key is NEVER requested. This is solely the permitted staging admin JWT.
        raw = self.command(["supabase", "projects", "api-keys", "--project-ref", PROJECT, "--output", "json", "--agent", "no"])
        keys = rows(json.loads(raw))
        key = next((r.get("api_key") for r in keys if r.get("name") == "service_role"), None)
        if not isinstance(key, str) or len(key) < 40 or key.startswith("[REDACTED"): raise ValueError("staging_admin_credential_unavailable")
        validate_service_jwt_identity(key)
        self.service = key
    def list_functions(self): return functions(self.json_command(["functions", "list", "--project-ref", PROJECT]))
    def list_secret_metadata(self): return secret_metadata(self.json_command(["secrets", "list", "--project-ref", PROJECT]))
    def request(self, method, path, body=None, action=None, flags_sha256=None):
        allowed = path == "/storage/v1/bucket" and method in ("GET", "POST")
        allowed |= path == "/storage/v1/bucket/" + self.plan["guard_bucket"] and method == "DELETE"
        allowed |= path == "/storage/v1/object/" + self.plan["guard_bucket"] and method == "DELETE"
        allowed |= path in ["/functions/v1/" + name for name in self.plan["function_names"]] and method == "POST"
        if not allowed or not self.service: raise ValueError("fixed_staging_route_refused")
        headers = {"Authorization": "Bearer " + self.service, "apikey": self.service, "Content-Type": "application/json"}
        if action is not None:
            if action not in ("attest", "run") or body != b"{}": raise ValueError("fixed_probe_request_refused")
            headers.update({"x-evaluation-action": action, "x-evaluation-operator": self.operator})
            if flags_sha256 is not None: headers["x-evaluation-flags-sha256"] = flags_sha256
        req = Request(BASE + path, method=method, data=body, headers=headers)
        try:
            try: reply = self.opener.open(req, timeout=90)
            except HTTPError as failure: reply = failure
            with reply:
                return read_bounded(reply, reply.status if hasattr(reply, "status") else reply.code, self.protected)
        except Exception:
            return {"status": None, "body": b"", "complete": False, "redacted": False, "error": "outer_dispatch_outcome_unconfirmed", "observed_bytes_lower_bound": 0}
    def json_request(self, method, path, body=None):
        observed = self.request(method, path, body)
        if not observed["complete"] or observed["status"] not in (200, 201, 204): raise ValueError("storage_receipt_unconfirmed")
        return json.loads(observed["body"] or b"null")
    def list_buckets(self): return buckets(self.json_request("GET", "/storage/v1/bucket"))
    def create_guard_bucket(self):
        return self.json_request("POST", "/storage/v1/bucket", packed({"id": self.plan["guard_bucket"], "name": self.plan["guard_bucket"], "public": False, "file_size_limit": 1, "allowed_mime_types": ["application/octet-stream"]}))
    def deploy(self, name):
        if name not in self.plan["function_names"]: raise ValueError("owned_function_required")
        self.command(["supabase", "functions", "deploy", name, "--project-ref", PROJECT, "--workdir", str(self.directory), "--use-api", "--agent", "no"])
    def verify_download(self, name):
        if name not in self.plan["function_names"]: raise ValueError("owned_function_required")
        owned = Path(tempfile.mkdtemp(prefix="lrv-call-probe-download-"))
        try:
            (owned / "supabase").mkdir(mode=0o700)
            (owned / "supabase/config.toml").write_text('project_id = "' + PROJECT + '"\n')
            self.command(["supabase", "functions", "download", name, "--project-ref", PROJECT, "--workdir", str(owned), "--use-api", "--agent", "no"])
            expected = expected_download(self.plan, name)
            function_root = owned / "supabase/functions"
            actual = {}
            if not function_root.is_dir(): raise ValueError("downloaded_functions_tree_missing")
            for path in function_root.rglob("*"):
                if path.is_symlink(): raise ValueError("downloaded_symlink_refused")
                if path.is_file(): actual[path.relative_to(function_root).as_posix()] = sha(path.read_bytes())
            if actual != expected: raise ValueError("downloaded_exact_source_inventory_differs")
            # Native CLI omits deno.lock: local frozen checks are separate; never claim a remote lock readback.
            return actual
        finally: shutil.rmtree(owned, ignore_errors=True)
    def probe(self, name, action, flags_sha256=None): return self.request("POST", "/functions/v1/" + name, b"{}", action, flags_sha256)
    def delete_function(self, name):
        if name not in self.plan["function_names"]: raise ValueError("owned_function_required")
        self.command(["supabase", "functions", "delete", name, "--project-ref", PROJECT, "--workdir", str(self.directory), "--yes", "--agent", "no"])
    def delete_guard_object(self, bucket, path):
        if bucket != self.plan["guard_bucket"] or path not in self.plan["object_paths"]: raise ValueError("owned_guard_required")
        self.json_request("DELETE", "/storage/v1/object/" + bucket, packed({"prefixes": [path]}))
    def delete_guard_bucket(self, bucket):
        if bucket != self.plan["guard_bucket"]: raise ValueError("owned_guard_required")
        self.json_request("DELETE", "/storage/v1/bucket/" + bucket)


def expected_download(plan, name):
    return {name + "/index.ts": plan["probe_source_sha256"][name],
            name + "/deno.json": plan["transport_source_sha256"]["supabase/functions/clinical-call-note-process/deno.json"],
            **{"_shared/" + filename: digest for filename, digest in plan["probe_shared_sha256"].items()}}


class LocalRunLock:
    def __init__(self, directory): self.path = Path(directory) / "run.lock"; self.stream = None
    def __enter__(self):
        self.stream = self.path.open("a+b"); os.chmod(self.path, 0o600)
        try: fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError): self.stream.close(); raise ValueError("run_or_cleanup_already_active") from None
        return self
    def __exit__(self, *_args): self.stream.close()


class CleanupJournal:
    def __init__(self, core, path, receipt, transport, clock):
        self.core, self.path, self.receipt, self.transport, self.clock = core, path, receipt, transport, clock
    def __getattr__(self, name): return getattr(self.transport, name)
    def mutate(self, kind, resources, operation):
        self.receipt.setdefault("cleanup_mutation_attempts", []).append({"kind": kind, "resources": resources, "at_ms": self.clock()})
        persist(self.core, self.path, self.receipt, self.transport.protected)
        return operation()
    def delete_function(self, name): return self.mutate("delete_function", [name], lambda: self.transport.delete_function(name))
    def delete_guard_object(self, bucket, path): return self.mutate("delete_guard_object", [bucket, path], lambda: self.transport.delete_guard_object(bucket, path))
    def delete_guard_bucket(self, bucket): return self.mutate("delete_guard_bucket", [bucket], lambda: self.transport.delete_guard_bucket(bucket))


def validate_prepared(core, plan_path, bundle):
    plan = core.read_json(plan_path)
    core.validate_candidate(plan, bundle)
    directory = plan_path.parent
    for name in plan["function_names"]:
        path = directory / "supabase/functions" / name
        if sha((path / "index.ts").read_bytes()) != plan["probe_source_sha256"][name]: raise ValueError("prepared_probe_bytes_differ")
        for filename in ("deno.json", "deno.lock"):
            if sha((path / filename).read_bytes()) != plan["transport_source_sha256"]["supabase/functions/clinical-call-note-process/" + filename]: raise ValueError("prepared_lock_bytes_differ")
    for relative, digest in plan["source_sha256"].items():
        if "/_shared/" in relative and sha((directory / "supabase/functions/_shared" / Path(relative).name).read_bytes()) != digest: raise ValueError("prepared_shared_bytes_differ")
    expected_config = 'project_id = "' + PROJECT + '"\n' + "\n".join('[functions."' + name + '"]\nverify_jwt = true\n' for name in plan["function_names"])
    if (directory / "supabase/config.toml").read_text() != expected_config: raise ValueError("prepared_jwt_config_differs")
    operator = core.read_json(directory / "operator-receipt.json")
    if operator.get("ticket") != plan["ticket"] or sha(operator.get("operator_token", "").encode()) != plan["operator_token_sha256"]: raise ValueError("private_operator_nonce_differs")
    return plan, operator["operator_token"]


def validate_flags(value):
    if not isinstance(value, list) or [f.get("name") for f in value] != FLAG_NAMES: raise ValueError("flag_allowlist_differs")
    for flag in value:
        if set(flag) != {"name", "present", "enabled", "sha256"} or type(flag["present"]) is not bool or type(flag["enabled"]) is not bool: raise ValueError("flag_receipt_shape")
        if flag["sha256"] is not None and not re.fullmatch(r"[a-f0-9]{64}", flag["sha256"]): raise ValueError("flag_digest_shape")
        if flag["present"] != (flag["sha256"] is not None) or (not flag["present"] and flag["enabled"]): raise ValueError("flag_presence_differs")
        if flag["name"] in FLAG_NAMES[:2] and flag["enabled"]: raise ValueError("call_processing_gate_enabled")
    return value


def validate_attestation(plan, case, value, expected_flags=None):
    expected = {"contract": "lrv-call-provider-probe-v2", "ticket": plan["ticket"], "id": case["id"], "bundle_sha256": plan["bundle_sha256"],
                "request_sha256": case["request_sha256"], "context_sha256": case["context_sha256"], "transport_source_sha256": plan["transport_source_sha256"],
                "expires_at_ms": plan["expires_at_ms"], "admission_sha256": plan["admission_sha256"], "synthetic_only": True, "hosted_clinical_reads": 0,
                "hosted_clinical_writes": 0, "action": "attest", "request_body_base64": case["request_body_base64"], "openai_key_present": True, "jwt_verification_required": True}
    if any(value.get(k) != v for k, v in expected.items()): raise ValueError("fixed_source_attestation_differs")
    flags = validate_flags(value.get("flags"))
    # Deno hashes insertion-ordered compact JSON, not the Python sorted canonical receipt encoding.
    actual = sha(json.dumps(flags, separators=(",", ":"), ensure_ascii=False).encode())
    if value.get("flags_sha256") != actual or (expected_flags is not None and flags != expected_flags): raise ValueError("flags_changed_or_digest_differs")
    return flags, actual


def persist(core, path, receipt, protected):
    if contains_secret(packed(receipt), protected): raise ValueError("receipt_secret_echo_refused")
    core.save(path, receipt, exclusive=False)


def observe_probe(core, transport, directory, case, name, action, flags_sha=None, label=None):
    try: observed = transport.probe(name, action, flags_sha)
    except Exception: observed = {"status": None, "body": b"", "complete": False, "redacted": False, "error": "outer_dispatch_outcome_unconfirmed", "observed_bytes_lower_bound": 0}
    # Independently bound/redact injected or native observations before any persistence.
    raw = observed.get("body", b"")
    if len(raw) > OUTER_LIMIT:
        raw = raw[:OUTER_LIMIT]; observed.update(complete=False, error="outer_response_oversized")
    if contains_secret(raw, transport.protected):
        raw = b""; observed.update(complete=False, redacted=True, error="known_secret_echo_redacted")
    path = directory / ("case-" + case["id"] + "-" + (label or action) + "-outer.bin")
    with path.open("xb") as stream:
        os.chmod(path, 0o600); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    meta = {"status": observed.get("status"), "complete": observed.get("complete") is True, "error": observed.get("error"), "redacted": observed.get("redacted") is True,
            "raw_file": path.name, "raw_sha256": None if observed.get("redacted") else sha(raw), "retained_bytes": len(raw), "observed_bytes_lower_bound": observed.get("observed_bytes_lower_bound", len(raw)),
            "declared_content_length": observed.get("declared_content_length"), "remaining_body_bytes": observed.get("remaining_body_bytes")}
    if not meta["complete"] or meta["status"] != 200: return meta, None
    try: value = json.loads(raw.decode("utf-8", errors="strict"))
    except (ValueError, UnicodeError): return {**meta, "error": "outer_json_or_utf8_invalid"}, None
    if not isinstance(value, dict): return {**meta, "error": "outer_receipt_shape"}, None
    return meta, value


def finalize_case_sidecars(core, directory, cases, protected):
    """Write all ten immutable final receipts as EXACT canonical bytes before bridge references exist."""
    if [case.get("id") for case in cases] != core.CASES: raise ValueError("ten_exact_final_sidecars_required")
    manifest = {}
    for case in cases:
        raw = core.packed(case)
        if contains_secret(raw, protected): raise ValueError("final_sidecar_secret_echo_refused")
        digest = sha(raw)
        name = "case-" + case["id"] + "-transport.json"
        path = directory / name
        conflict = path.exists() and path.read_bytes() != raw
        if conflict:
            # Preserve conflicting/earlier evidence untouched; reference a fresh content-addressed final receipt.
            name = "case-" + case["id"] + "-transport-" + digest + ".json"
            path = directory / name
        if path.exists():
            if path.read_bytes() != raw: raise ValueError("conflicting_final_sidecar_preserved")
        else:
            with path.open("xb") as stream:
                os.chmod(path, 0o600); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            descriptor = os.open(directory, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
        if sha(path.read_bytes()) != digest: raise ValueError("final_sidecar_readback_differs")
        manifest[case["id"]] = {"file": name, "file_sha256": digest, "canonical_content_sha256": digest, "earlier_conflicting_evidence_preserved": conflict}
    return manifest


def run_hosted(core, plan_path, bundle, authorization, transport_factory=NativeTransport, clock=None):
    with LocalRunLock(Path(plan_path).parent):
        return _run_hosted_locked(core, plan_path, bundle, authorization, transport_factory, clock)


def _run_hosted_locked(core, plan_path, bundle, authorization, transport_factory, clock):
    clock = clock or core.now_ms
    plan, operator = validate_prepared(core, Path(plan_path), Path(bundle))
    admitted = core.authorize_candidate(plan, Path(bundle), authorization, clock=clock)
    directory = Path(plan_path).parent; receipt_path = directory / "run-receipt.json"
    receipt = {"contract": VERSION, "candidate_sha256": plan["candidate_sha256"], "ticket": plan["ticket"], "authorization_sha256": admitted["authorization_sha256"],
               "staging_project": PROJECT, "deployment_attempted": [], "storage_creation_attempted": False, "baseline": None,
               "ledger": {"consumed": [], "reserved_usd_micros": 0, "states": {}, "stopped": False},
               "cases": [{"id": case["id"], "request_sha256": case["request_sha256"], "state": "not_attempted", "response_complete": False, "uncertain": False} for case in plan["cases"]],
               "cleanup": None, "error": None, "hosted_clinical_reads": 0, "hosted_clinical_writes": 0,
               "preservation_scope": "Version/config/secret-digest/bucket metadata only. Privileged guard credential remains privileged; no clinical row equality proof."}
    core.save(receipt_path, receipt, exclusive=True)  # Fixed path; reruns/resume cannot reacquire credentials or dispatch.
    transport = None
    try:
        transport = transport_factory(core, plan, directory, operator)
        transport.check_local()
        transport.verify_project()
        transport.acquire_credentials()
        baseline_functions, secrets, storage = transport.list_functions(), transport.list_secret_metadata(), transport.list_buckets()
        if any(row["name"] in plan["function_names"] for row in baseline_functions) or any(row["name"] == plan["guard_bucket"] for row in storage): raise ValueError("owned_resource_collision")
        if not any(row["name"] == "OPENAI_API_KEY" for row in secrets): raise ValueError("staging_openai_key_presence_unconfirmed")
        receipt["baseline"] = {"functions_sha256": sha(packed(baseline_functions)), "secrets_sha256": sha(packed(secrets)), "storage_sha256": sha(packed(storage))}
        receipt["storage_creation_attempted"] = True
        persist(core, receipt_path, receipt, transport.protected)
        transport.create_guard_bucket()
        for name in plan["function_names"]:
            receipt["deployment_attempted"].append(name)
            persist(core, receipt_path, receipt, transport.protected)
            transport.deploy(name)
        deployed = transport.list_functions()
        for name in plan["function_names"]:
            row = next((r for r in deployed if r["name"] == name), None)
            if row is None or row.get("verify_jwt") is not True or row.get("import_map") is not True or row.get("status") != "ACTIVE" or type(row.get("version")) is not int or row["version"] < 1:
                raise ValueError("remote_jwt_version_or_status_unconfirmed")
            if not re.fullmatch(r"[a-f0-9]{64}", row.get("ezbr_sha256", "")) or not row.get("entrypoint_path", "").endswith("/source/supabase/functions/" + name + "/index.ts") or not row.get("import_map_path", "").endswith("/source/supabase/functions/" + name + "/deno.json"):
                raise ValueError("remote_entrypoint_import_map_or_bundle_identity_unconfirmed")
        receipt["download_verification"] = {}
        for name in plan["function_names"]:
            actual_download = transport.verify_download(name)
            if actual_download != expected_download(plan, name): raise ValueError("downloaded_source_or_import_map_manifest_differs")
            receipt["download_verification"][name] = actual_download
        receipt["remote_lock_available"] = False
        receipt["local_frozen_lock_checked_before_deploy"] = True
        flags = None; flag_sha = None; receipt["attestations"] = []
        for case, name in zip(plan["cases"], plan["function_names"], strict=True):
            meta, value = observe_probe(core, transport, directory, case, name, "attest")
            receipt["attestations"].append({"id": case["id"], "outer": meta})
            if value is None: raise ValueError("attestation_receipt_unconfirmed")
            flags, flag_sha = validate_attestation(plan, case, value, flags)
            receipt["attestations"][-1]["flags_sha256"] = flag_sha
        current_functions, current_secrets, current_storage = transport.list_functions(), transport.list_secret_metadata(), transport.list_buckets()
        own_bucket = [row for row in current_storage if row["name"] == plan["guard_bucket"]]
        if len(own_bucket) != 1 or own_bucket[0].get("public") is not False: raise ValueError("private_guard_bucket_readback_unconfirmed")
        readback = {"functions_sha256": sha(packed([r for r in current_functions if r["name"] not in plan["function_names"]])),
                    "secrets_sha256": sha(packed(current_secrets)), "storage_sha256": sha(packed([r for r in current_storage if r["name"] != plan["guard_bucket"]]))}
        if readback != receipt["baseline"]: raise ValueError("pre_dispatch_existing_resource_metadata_changed")
        receipt["pre_dispatch_preservation_readback"] = readback
        receipt["flags_before"] = flags
        persist(core, receipt_path, receipt, transport.protected)
        for index, (case, name) in enumerate(zip(plan["cases"], plan["function_names"], strict=True)):
            core.validate_candidate(plan, Path(bundle))
            if clock() + (len(plan["cases"]) - index) * (plan["provider_timeout_ms"] + plan["guard_timeout_ms"]) >= plan["expires_at_ms"]: raise ValueError("fixed_expiry_insufficient_remaining_lifetime")
            core.reserve_case(receipt["ledger"], plan, case["id"])
            receipt["cases"][index].update(state="may_have_dispatched", uncertain=True)
            persist(core, receipt_path, receipt, transport.protected)
            meta, value = observe_probe(core, transport, directory, case, name, "run", flag_sha)
            result = receipt["cases"][index]
            result["outer"] = meta
            if value is None:
                result.update(state="dispatch_uncertain", uncertain=True, response_complete=False, error=meta["error"] or "outer_receipt_unconfirmed")
            else:
                expected = {"contract": "lrv-call-provider-probe-v2", "ticket": plan["ticket"], "id": case["id"], "bundle_sha256": plan["bundle_sha256"], "request_sha256": case["request_sha256"], "context_sha256": case["context_sha256"], "admission_sha256": plan["admission_sha256"], "transport_source_sha256": plan["transport_source_sha256"], "expires_at_ms": plan["expires_at_ms"], "synthetic_only": True, "hosted_clinical_reads": 0, "hosted_clinical_writes": 0}
                if any(value.get(k) != v for k, v in expected.items()) or type(value.get("provider_call_count")) is not int or value["provider_call_count"] not in (0, 1): raise ValueError("fixed_run_receipt_differs")
                if validate_flags(value.get("flags")) != flags: raise ValueError("processing_flags_changed")
                result.update(value)
                usage = value.get("usage")
                input_bound = plan["external_price_profile"]["input_bounds"][index]["billable_input_tokens_upper"]
                if isinstance(usage, dict) and (usage.get("input_tokens", 0) > input_bound or usage.get("output_tokens", 0) > plan["external_price_profile"]["billable_output_tokens_upper"]):
                    result.update(uncertain=True, billing_uncertain=True, error="observed_usage_exceeds_reviewed_bound")
                # Full HTTP errors remain full HTTP evidence, but 408/5xx/missing usage consume budget and stop.
                if value.get("http_status") == 408 or (isinstance(value.get("http_status"), int) and value["http_status"] >= 500) or value.get("usage_status") != "usable":
                    result["uncertain"] = True; result["billing_uncertain"] = True
                core.validate_transport_body(result)
            core.record_outcome(receipt["ledger"], case["id"], result)
            persist(core, receipt_path, receipt, transport.protected)
            if receipt["ledger"]["stopped"]: break
        # Non-dispatch attestation gets a distinct owned filename; never repeat run.
        last_case = plan["cases"][0]
        final_meta, final_value = observe_probe(core, transport, directory, last_case, plan["function_names"][0], "attest", flag_sha, label="final-attest")
        receipt["final_attestation_outer"] = final_meta
        if final_value is None: raise ValueError("final_flag_attestation_unconfirmed")
        validate_attestation(plan, last_case, final_value, flags)
        receipt["flags_after"] = flags
    except BaseException as failure:
        code = str(failure)
        receipt["error"] = code if re.fullmatch(r"[a-z_]{1,100}", code) and not contains_secret(code.encode(), transport.protected if transport else [operator]) else "run_stopped_preflight_dispatch_or_evidence_unconfirmed"
        for case in receipt["cases"]:
            if receipt["ledger"]["states"].get(case["id"]) == "may_have_dispatched": case.update(state="dispatch_uncertain", uncertain=True, response_complete=False)
    finally:
        if transport is not None and receipt.get("baseline"):
            try: receipt["cleanup"] = core.cleanup(plan, receipt, CleanupJournal(core, receipt_path, receipt, transport, clock), clock=clock)
            except Exception: receipt["cleanup"] = {"complete": False, "error": "cleanup_outcome_unconfirmed"}
        else: receipt["cleanup"] = {"complete": not receipt["deployment_attempted"] and not receipt["storage_creation_attempted"], "scope": "no_mutation_attempted"}
        protected = transport.protected if transport is not None else [operator]
        try:
            receipt["case_sidecars"] = finalize_case_sidecars(core, directory, receipt["cases"], protected)
            core.save(directory / "raw-import.json", core.bridge_outcomes(plan, receipt["cases"], sidecar_paths={key: value["file"] for key, value in receipt["case_sidecars"].items()}))
        except Exception:
            receipt["raw_import_error"] = "raw_import_bridge_unconfirmed_original_sidecars_preserved"
            receipt["error"] = receipt["error"] or "raw_import_bridge_unconfirmed"
        persist(core, receipt_path, receipt, protected)
    return receipt


def cleanup_only(core, plan_path, bundle, transport_factory=NativeTransport, clock=None):
    with LocalRunLock(Path(plan_path).parent):
        return _cleanup_only_locked(core, plan_path, bundle, transport_factory, clock)


def _cleanup_only_locked(core, plan_path, bundle, transport_factory, clock):
    clock = clock or core.now_ms
    plan, operator = validate_prepared(core, Path(plan_path), Path(bundle))  # Deliberately no unexpired expense admission needed for deletion.
    path = Path(plan_path).parent / "run-receipt.json"
    receipt = core.read_json(path)
    if receipt.get("contract") != VERSION or receipt.get("candidate_sha256") != plan["candidate_sha256"] or receipt.get("ticket") != plan["ticket"] or receipt.get("staging_project") != PROJECT: raise ValueError("cleanup_receipt_scope_differs")
    if not receipt.get("baseline"): return receipt
    transport = transport_factory(core, plan, Path(plan_path).parent, operator)
    transport.verify_project(); transport.acquire_credentials()
    receipt["cleanup"] = core.cleanup(plan, receipt, CleanupJournal(core, path, receipt, transport, clock), clock=clock)
    persist(core, path, receipt, transport.protected)
    return receipt
