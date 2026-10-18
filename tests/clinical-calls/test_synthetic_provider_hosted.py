"""Actual orchestration with injected account/CLI/storage/probe boundaries only."""
import base64
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import io
import http.client
import subprocess
import json
import re
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import test_synthetic_provider as fixture

runner = fixture.runner
SPEC = importlib.util.spec_from_file_location("call_provider_hosted", Path(__file__).with_name("synthetic_provider_hosted.py"))
hosted = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(hosted)


def flags():
    return [{"name": name, "present": name == "CLINICAL_NOTE_PROCESSING_ENABLED", "enabled": name == "CLINICAL_NOTE_PROCESSING_ENABLED", "sha256": hosted.sha(b"true") if name == "CLINICAL_NOTE_PROCESSING_ENABLED" else None} for name in hosted.FLAG_NAMES]


class FakeTransport:
    def __init__(self, core, plan, directory, operator, mode="success", clock=None):
        self.core, self.plan, self.directory, self.operator, self.mode = core, plan, directory, operator, mode
        self.protected = [operator, "offline-service-secret-long-dummy-value"]
        self.events=[]; self.installed={}; self.bucket=False; self.paid=[]
        self.original=[{"name":"original-function","version":3,"verify_jwt":True}]
        self.secrets=[{"name":"OPENAI_API_KEY","digest":"a"*64}]
    def check_local(self):self.events.append("cached_local_check")
    def verify_project(self):
        self.events.append("project")
        if self.mode == "target": raise ValueError("independent_staging_identity_unconfirmed")
    def acquire_credentials(self): self.events.append("credentials")
    def list_functions(self):
        if self.mode == "delete_uncertain" and "delete" in self.events: raise ValueError("absence_unconfirmed")
        original = deepcopy(self.original)
        if self.mode=="baseline" and self.installed:original[0]["version"]=4
        return original + [{"name":n,"version":1,"verify_jwt":self.mode!="jwt","import_map":True,"status":"ACTIVE","ezbr_sha256":"f"*64,
            "entrypoint_path":"file:///source/supabase/functions/"+n+"/index.ts","import_map_path":"file:///source/supabase/functions/"+n+"/deno.json"} for n in self.installed]
    def list_secret_metadata(self): return self.secrets
    def list_buckets(self): return [{"name":self.plan["guard_bucket"],"public":self.mode=="bucket_public"}] if self.bucket else []
    def create_guard_bucket(self):
        receipt=json.loads((self.directory/"run-receipt.json").read_bytes()); assert receipt["storage_creation_attempted"]
        self.events.append("bucket");self.bucket=True
        if self.mode=="bucket_lost": raise ValueError("storage_receipt_unconfirmed")
    def deploy(self,name):
        receipt=json.loads((self.directory/"run-receipt.json").read_bytes());assert name in receipt["deployment_attempted"]
        self.events.append("deploy");self.installed[name]=True
        if self.mode=="deploy_lost": raise ValueError("cli_receipt_unconfirmed")
    def verify_download(self,name):
        expected=hosted.expected_download(self.plan,name)
        if self.mode=="download":expected[name+"/index.ts"]="0"*64
        return expected
    def probe(self,name,action,flags_sha256=None):
        case=self.plan["cases"][self.plan["function_names"].index(name)]
        value={"contract":"lrv-call-provider-probe-v2","ticket":self.plan["ticket"],"id":case["id"],"bundle_sha256":self.plan["bundle_sha256"],"request_sha256":case["request_sha256"],"context_sha256":case["context_sha256"],"transport_source_sha256":self.plan["transport_source_sha256"],"expires_at_ms":self.plan["expires_at_ms"],"admission_sha256":self.plan["admission_sha256"],"synthetic_only":True,"hosted_clinical_reads":0,"hosted_clinical_writes":0,"flags":flags()}
        if action=="attest":
            value.update(action=action,request_body_base64=case["request_body_base64"],openai_key_present=True,jwt_verification_required=True,flags_sha256=hosted.sha(json.dumps(flags(),separators=(",",":")).encode()))
            if self.mode=="attest":value["request_sha256"]="0"*64
        else:
            ledger=json.loads((self.directory/"run-receipt.json").read_bytes())["ledger"]
            assert ledger["states"][case["id"]]=="may_have_dispatched"
            assert ledger["reserved_usd_micros"]>=18000
            assert flags_sha256==hosted.sha(json.dumps(flags(),separators=(",",":")).encode())
            assert case["id"] not in self.paid
            self.paid.append(case["id"])
            raw=b'{"synthetic":true}'
            value.update(state="response_complete",provider_call_count=1,response_complete=True,uncertain=False,billing_uncertain=False,usage_status="usable",usage={"input_tokens":100,"output_tokens":40,"total_tokens":140},http_status=200,raw_body_base64=base64.b64encode(raw).decode(),raw_body_sha256=hosted.sha(raw),retained_bytes=len(raw),provider_request_id="req_fixture",provider_request_id_truncated=False)
            if self.mode=="run_invalid":value["request_sha256"]="0"*64
            if self.mode=="503":value.update(http_status=503,uncertain=True,billing_uncertain=True)
            if self.mode=="usage":value.update(usage_status="missing_or_unusable",usage=None,uncertain=True)
            if self.mode=="usage_over":value["usage"]["input_tokens"]=1001
            if self.mode=="outer_partial":return {"status":200,"body":b'{"unfinished":"\xff',"complete":False,"redacted":False,"error":"outer_body_interrupted"}
            if self.mode=="outer_oversize":return {"status":200,"body":b"x"*(hosted.OUTER_LIMIT+1),"complete":True,"redacted":False,"error":None}
            if self.mode=="secret":return {"status":200,"body":json.dumps({"error":self.protected[1]}).encode(),"complete":True,"redacted":False,"error":None}
        return {"status":200,"body":json.dumps(value).encode(),"complete":True,"redacted":False,"error":None}
    def delete_function(self,name):
        journal=json.loads((self.directory/"run-receipt.json").read_bytes())["cleanup_mutation_attempts"]
        assert journal[-1]["resources"]==[name]
        self.events.append("delete")
        if self.mode=="delete_uncertain":raise ValueError("delete_ack_unconfirmed")
        self.installed.pop(name,None)
    def delete_guard_object(self,bucket,path):
        assert bucket==self.plan["guard_bucket"] and path in self.plan["object_paths"]
        self.events.append("delete_object")
    def delete_guard_bucket(self,bucket):assert bucket==self.plan["guard_bucket"];self.bucket=False;self.events.append("delete_bucket")


class HostedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.OfflineTransportTests.setUpClass()
        cls.frozen=fixture.OfflineTransportTests.frozen
        cls.bundle=fixture.OfflineTransportTests.bundle_path
        cls.expiry=fixture.OfflineTransportTests.expiry
    @classmethod
    def tearDownClass(cls):fixture.OfflineTransportTests.tearDownClass()
    def prepared(self,directory):
        with patch.object(runner,"local_bundle_plan",return_value=deepcopy(self.frozen)):
            plan=runner.prepare(self.bundle,directory,"c"*20,"2033-05-18T03:33:20Z",fixture.profile(self.frozen))
        return plan, fixture.authority(plan,self.expiry-30*60000)
    def run_mode(self,mode="success"):
        owned=tempfile.TemporaryDirectory();directory=Path(owned.name)/"candidate";plan,authorization=self.prepared(directory)
        objects=[]
        def factory(*args):
            instance=FakeTransport(*args,mode=mode);objects.append(instance);return instance
        with patch.object(runner,"local_bundle_plan",return_value=deepcopy(self.frozen)):
            result=hosted.run_hosted(runner,directory/"plan.json",self.bundle,authorization,transport_factory=factory,clock=lambda:self.expiry-30*60000)
        return owned,directory,plan,result,objects[0]
    def test_preflight_rejects_before_factory_credentials_or_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)/"candidate";plan,authorization=self.prepared(directory);authorization["candidate_sha256"]="0"*64
            with patch.object(runner,"local_bundle_plan",return_value=deepcopy(self.frozen)):
                with self.assertRaises(ValueError):hosted.run_hosted(runner,directory/"plan.json",self.bundle,authorization,transport_factory=lambda *_:self.fail("credentials before admission"),clock=lambda:self.expiry-30*60000)
                self.assertFalse((directory/"run-receipt.json").exists())
                (directory/"supabase/functions"/plan["function_names"][0]/"index.ts").write_text("tampered")
                with self.assertRaises(ValueError):hosted.run_hosted(runner,directory/"plan.json",self.bundle,fixture.authority(plan,self.expiry-30*60000),transport_factory=lambda *_:self.fail("credentials before source verification"),clock=lambda:self.expiry-30*60000)
    def test_success_serial_exact_ten_and_duplicate_receipt_never_reacquires_credentials(self):
        owned,directory,plan,result,transport=self.run_mode()
        try:
            self.assertEqual(transport.paid,list("ABCDEFGHIJ"));self.assertEqual(result["ledger"]["reserved_usd_micros"],180000)
            self.assertEqual(result["flags_before"],result["flags_after"]);self.assertIsNone(result["error"])
            self.assertFalse(result["cleanup"]["complete"]);self.assertTrue(transport.bucket)
            with patch.object(runner,"local_bundle_plan",return_value=deepcopy(self.frozen)):
                with self.assertRaises(FileExistsError):hosted.run_hosted(runner,directory/"plan.json",self.bundle,fixture.authority(plan,self.expiry-30*60000),transport_factory=lambda *_:self.fail("duplicate credentials"),clock=lambda:self.expiry-30*60000)
            imported=runner.read_json(directory/"raw-import.json");self.assertTrue(all(c["outcome"]["kind"]=="http" for c in imported["cases"]))
        finally:owned.cleanup()
    def test_target_jwt_download_attestation_failures_stop_before_paid(self):
        for mode in ("target","jwt","download","attest","baseline","bucket_public"):
            owned,directory,plan,result,transport=self.run_mode(mode)
            try:self.assertEqual(transport.paid,[]);self.assertIsNotNone(result["error"])
            finally:owned.cleanup()
    def test_storage_and_deployment_ack_loss_are_journaled_and_finally_cleaned(self):
        for mode in ("bucket_lost","deploy_lost"):
            owned,directory,plan,result,transport=self.run_mode(mode)
            try:
                self.assertTrue(result["storage_creation_attempted"]);self.assertEqual(transport.paid,[])
                if mode=="deploy_lost":self.assertEqual(len(result["deployment_attempted"]),1);self.assertIn("delete",transport.events)
                self.assertTrue(transport.bucket);self.assertFalse(result["cleanup"]["complete"])
            finally:owned.cleanup()
    def test_complete_503_usage_uncertainty_stop_but_full_http_bytes_survive(self):
        for mode in ("503","usage","usage_over"):
            owned,directory,plan,result,transport=self.run_mode(mode)
            try:
                self.assertEqual(transport.paid,["A"]);self.assertEqual(result["ledger"]["reserved_usd_micros"],18000)
                self.assertTrue(result["cases"][0]["uncertain"])
                self.assertEqual(runner.read_json(directory/"raw-import.json")["cases"][0]["outcome"]["kind"],"http")
            finally:owned.cleanup()
    def test_outer_partial_oversize_and_secret_echo_stop_without_losing_safe_prefix(self):
        for mode in ("outer_partial","outer_oversize","secret"):
            owned,directory,plan,result,transport=self.run_mode(mode)
            try:
                self.assertEqual(transport.paid,["A"]);self.assertEqual(result["cases"][0]["state"],"dispatch_uncertain")
                raw=(directory/"case-A-run-outer.bin").read_bytes()
                if mode=="outer_partial":self.assertEqual(raw,b'{"unfinished":"\xff')
                if mode=="outer_oversize":self.assertEqual(len(raw),hosted.OUTER_LIMIT)
                if mode=="secret":self.assertEqual(raw,b"");self.assertNotIn(transport.protected[1],(directory/"run-receipt.json").read_text())
                self.assertEqual(runner.read_json(directory/"raw-import.json")["cases"][0]["outcome"]["kind"],"transport_error")
            finally:owned.cleanup()
    def test_cleanup_only_after_expiry_never_attests_dispatches_or_reserves(self):
        owned,directory,plan,result,transport=self.run_mode("delete_uncertain")
        try:
            self.assertFalse(result["cleanup"]["complete"]);self.assertTrue(transport.bucket)
            transport.mode="success";transport.events=[]
            before=deepcopy(result["ledger"])
            with patch.object(runner,"local_bundle_plan",return_value=deepcopy(self.frozen)):
                cleaned=hosted.cleanup_only(runner,directory/"plan.json",self.bundle,transport_factory=lambda *_:transport,clock=lambda:self.expiry+70001)
            self.assertTrue(cleaned["cleanup"]["complete"]);self.assertFalse(transport.bucket);self.assertEqual(cleaned["ledger"],before)
            self.assertNotIn("deploy",transport.events)
        finally:owned.cleanup()
    def test_bounded_reader_partial_utf8_and_literal_escaped_base64_credential_scans(self):
        class Broken:
            calls=0
            def read(self,_n):
                self.calls+=1
                if self.calls==1:return b'prefix\xff'
                raise OSError("read lost")
        observed=hosted.read_bounded(Broken(),200)
        self.assertEqual(observed["body"],b'prefix\xff');self.assertFalse(observed["complete"])
        large=hosted.read_bounded(io.BytesIO(b"x"*11),200,limit=10)
        self.assertEqual(large["body"],b"x"*10);self.assertFalse(large["complete"])
        class Incomplete:
            def read(self,_n):raise http.client.IncompleteRead(b"abc\xff",100)
        partial=hosted.read_bounded(Incomplete(),200)
        self.assertEqual(partial["body"],b"abc\xff");self.assertEqual(partial["observed_bytes_lower_bound"],4)
        partial_large=hosted.read_bounded(Incomplete(),200,limit=2)
        self.assertEqual(partial_large["body"],b"ab");self.assertEqual(partial_large["error"],"outer_response_oversized")
        secret="dummy-service-secret"
        for raw in (secret.encode(),b'{"x":"\\u0064ummy-service-secret',json.dumps({"raw_body_base64":base64.b64encode(secret.encode()).decode()}).encode()):
            self.assertTrue(hosted.contains_secret(raw,[secret]))
    def test_native_metadata_and_strict_route_allowlist_without_account_access(self):
        self.assertEqual(hosted.functions([{"slug":"a","name":"display","verify_jwt":True}])[0]["name"],"a")
        self.assertEqual(hosted.secret_metadata([{"name":"OPENAI_API_KEY","value":"f"*64}]),[{"name":"OPENAI_API_KEY","digest":"f"*64}])
        with self.assertRaises(ValueError):hosted.secret_metadata([{"name":"OPENAI_API_KEY","value":"sk-not-a-digest"}])
        fakeplan={"guard_bucket":"owned","function_names":["owned-probe"]}
        native=hosted.NativeTransport(runner,fakeplan,Path("unused"),"operator")
        native.service="dummy-service-secret"
        for route in ("/rest/v1/pets","/auth/v1/admin/users","https://example.invalid/","//evil","/storage/v1/object/unowned"):
            with self.assertRaises(ValueError):native.request("GET",route)

    def test_nonblocking_run_cleanup_lock_and_invalid_bridge_preserve_receipt(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)/"candidate";plan,authorization=self.prepared(directory)
            with hosted.LocalRunLock(directory),patch.object(runner,"local_bundle_plan",return_value=deepcopy(self.frozen)):
                with self.assertRaisesRegex(ValueError,"already_active"):
                    hosted.run_hosted(runner,directory/"plan.json",self.bundle,authorization,transport_factory=lambda *_:self.fail("locked credentials"),clock=lambda:self.expiry-30*60000)
                with self.assertRaisesRegex(ValueError,"already_active"):
                    hosted.cleanup_only(runner,directory/"plan.json",self.bundle,transport_factory=lambda *_:self.fail("locked cleanup credentials"))
        original_bridge=runner.bridge_outcomes
        count=[0]
        def broken_bridge(*args):
            count[0]+=1
            raise ValueError("invalid_bridge_fixture")
        with patch.object(runner,"bridge_outcomes",side_effect=broken_bridge),patch.object(runner,"validate_transport_body",side_effect=ValueError("body_evidence_invalid")):
            owned,directory,plan,result,transport=self.run_mode()
            try:
                saved=runner.read_json(directory/"run-receipt.json")
                self.assertIn("raw_import_error",saved);self.assertIsNotNone(saved["cleanup"])
                self.assertEqual(saved["ledger"]["reserved_usd_micros"],18000)
            finally:owned.cleanup()

    def test_native_cli_download_exact_reachable_inventory_and_absent_remote_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)/"candidate";plan,_authorization=self.prepared(directory)
            native=hosted.NativeTransport(runner,plan,directory,"dummy-operator")
            name=plan["function_names"][0]
            def fake_command(argv,**_kwargs):
                destination=Path(argv[argv.index("--workdir")+1])/"supabase/functions"
                for relative in hosted.expected_download(plan,name):
                    source=directory/"supabase/functions"/relative
                    target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(source.read_bytes())
                return b""
            with patch.object(native,"command",side_effect=fake_command):
                verified=native.verify_download(name)
                self.assertEqual(len(verified),8);self.assertNotIn(name+"/deno.lock",verified)
                self.assertNotIn("_shared/clinical-call-handler.ts",verified)
            def decoy_command(argv,**kwargs):
                fake_command(argv,**kwargs)
                destination=Path(argv[argv.index("--workdir")+1])/"supabase/functions"
                extra=destination/"decoy/index.ts";extra.parent.mkdir();extra.write_bytes((directory/"supabase/functions"/name/"index.ts").read_bytes())
                (destination/name/"index.ts").write_text("malicious")
                return b""
            with patch.object(native,"command",side_effect=decoy_command):
                with self.assertRaisesRegex(ValueError,"exact_source_inventory"):
                    native.verify_download(name)
            commands=[]
            with patch.object(native,"command",side_effect=lambda argv,**_kwargs:commands.append(argv) or b""):
                native.check_local()
            self.assertEqual(len(commands),10);self.assertTrue(all("--cached-only" in cmd and "--frozen" in cmd for cmd in commands))

    def test_atomic_durable_receipt_updates_preserve_old_temporary_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/"receipt.json"
            with patch.object(runner.os,"fsync",wraps=runner.os.fsync) as synced:
                runner.save(path,{"state":"created"})
                stale=path.with_name(path.name+".writing-old");stale.write_text("old diagnostic")
                runner.save(path,{"state":"updated"},exclusive=False)
            self.assertGreaterEqual(synced.call_count,4);self.assertEqual(runner.read_json(path),{"state":"updated"})
            self.assertEqual(stale.read_text(),"old diagnostic");self.assertEqual(path.stat().st_mode&0o777,0o600)

    def test_native_cli_identity_metadata_preservation_and_protected_http_headers(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)/"candidate";plan,_authorization=self.prepared(directory)
            native=hosted.NativeTransport(runner,plan,directory,"dummy-operator")
            with patch.object(native,"json_command",return_value=[{"id":"wrong-project"}]):
                with self.assertRaises(ValueError):native.verify_project()
            key="dummy-service-role-key-value-at-least-forty-characters"
            with patch.object(native,"command",return_value=json.dumps([{"name":"service_role","api_key":key}]).encode()):
                native.acquire_credentials()
            self.assertEqual(native.service,key)
            metadata=hosted.functions({"functions":[{"slug":"original","ezbr_sha256":"f"*64,"import_map":True,"verify_jwt":True}]})
            self.assertEqual(metadata[0]["ezbr_sha256"],"f"*64);self.assertTrue(metadata[0]["import_map"])
            class Reply(io.BytesIO):
                status=200
            class Opener:
                def open(self,request,timeout):
                    assert request.full_url==hosted.BASE+"/functions/v1/"+plan["function_names"][0]
                    assert request.data==b"{}" and request.get_header("Authorization")=="Bearer "+key
                    assert request.get_header("X-evaluation-operator")=="dummy-operator"
                    return Reply(b'{"safe":true}')
            native.opener=Opener()
            self.assertTrue(native.probe(plan["function_names"][0],"attest")["complete"])
            self.assertIsNone(hosted.NoRedirect().redirect_request(None,None,302,None,None,None))

    def test_all_ten_final_canonical_sidecars_exist_with_actual_file_hashes_after_early_stop(self):
        for mode in ("503", "outer_partial", "target", "deploy_lost", "run_invalid"):
            owned,directory,plan,result,transport=self.run_mode(mode)
            try:
                imported=runner.read_json(directory/"raw-import.json")
                self.assertEqual(len(result["case_sidecars"]),10)
                for case in result["cases"]:
                    metadata=result["case_sidecars"][case["id"]]
                    path=directory/metadata["file"]
                    self.assertEqual(path.read_bytes(),runner.packed(case))
                    self.assertEqual(hosted.sha(path.read_bytes()),metadata["file_sha256"])
                    self.assertEqual(metadata["file_sha256"],metadata["canonical_content_sha256"])
                    outcome=next(c["outcome"] for c in imported["cases"] if c["case_id"]==case["id"])
                    if outcome["kind"]=="transport_error":
                        match=re.search(r"retain private (case-[A-J]-transport(?:-[a-f0-9]{64})?\.json) sidecar SHA256 ([a-f0-9]{64})",outcome["error"])
                        self.assertIsNotNone(match)
                        self.assertEqual(match.group(1),path.name)
                        self.assertEqual(hosted.sha((directory/match.group(1)).read_bytes()),match.group(2))
            finally:owned.cleanup()

    def test_conflicting_sidecar_is_immutable_and_final_reference_uses_content_addressed_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary)
            final=[{"id":c,"state":"not_attempted","request_sha256":"f"*64,"response_complete":False} for c in runner.CASES]
            conflict=directory/"case-A-transport.json";conflict.write_bytes(b"old conflicting evidence")
            manifest=hosted.finalize_case_sidecars(runner,directory,final,[])
            self.assertEqual(conflict.read_bytes(),b"old conflicting evidence")
            self.assertTrue(manifest["A"]["earlier_conflicting_evidence_preserved"])
            self.assertNotEqual(manifest["A"]["file"],conflict.name)
            plan={"cases":[{"id":c,"request_sha256":"f"*64} for c in runner.CASES]}
            imported=runner.bridge_outcomes(plan,final,{key:value["file"] for key,value in manifest.items()})
            for item in imported["cases"]:
                metadata=manifest[item["case_id"]]
                self.assertIn(metadata["file"],item["outcome"]["error"])
                self.assertIn(hosted.sha((directory/metadata["file"]).read_bytes()),item["outcome"]["error"])

    def test_actual_stdlib_httpresponse_silent_short_content_length_is_not_complete(self):
        class Socket:
            def __init__(self, raw):self.raw=raw
            def makefile(self,*_args):return io.BytesIO(self.raw)
        for length,body,expected in ((10,b"{}",False),(2,b"{}",True),(0,b"",True)):
            response=http.client.HTTPResponse(Socket(b"HTTP/1.1 200 OK\r\nContent-Length: "+str(length).encode()+b"\r\n\r\n"+body))
            response.begin()
            observed=hosted.read_bounded(response,200)
            self.assertEqual(observed["complete"],expected)
            self.assertEqual(observed["body"],body)
            self.assertEqual(observed["declared_content_length"],length)
            if not expected:
                self.assertEqual(observed["error"],"outer_body_framing_incomplete")
                self.assertEqual(observed["remaining_body_bytes"],8)
        for headers in (b"Content-Length: nope\r\n",b"Content-Length: 2\r\nContent-Length: 2\r\n",b"Transfer-Encoding: chunked\r\nContent-Length: 2\r\n"):
            body=b"0\r\n\r\n" if b"chunked" in headers else b"{}"
            response=http.client.HTTPResponse(Socket(b"HTTP/1.1 200 OK\r\n"+headers+b"\r\n"+body));response.begin()
            self.assertFalse(hosted.read_bounded(response,200)["complete"])
        from urllib.error import HTTPError
        response=http.client.HTTPResponse(Socket(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 10\r\n\r\n{}"));response.begin()
        wrapped=HTTPError("https://fixed.invalid",503,"Unavailable",response.headers,response)
        observed=hosted.read_bounded(wrapped,503)
        self.assertFalse(observed["complete"]);self.assertEqual(observed["body"],b"{}")
        wrapped.close()


if __name__=="__main__":unittest.main()
