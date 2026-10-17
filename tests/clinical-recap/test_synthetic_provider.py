"""Offline runner safety tests. No hosted resources, credentials or model calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("recap_synthetic_provider", Path(__file__).with_name("synthetic-provider.py"))
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def plan():
    run = "a" * 20
    return {"plan_version":"lrv-recap-fixed-probe-plan-v1","run_id":run,"staging_project":runner.PROJECT,"maximum_paid_requests":8,"function_names":["recap-eval-"+run+"-"+case.lower() for case in "ABCDEFGH"],"guard_bucket":"recap-eval-"+run,"object_paths":[case+".lock" for case in "ABCDEFGH"],"source_sha256":{},"corpus_sha256":"b"*64}


class SafetyTests(unittest.TestCase):
    def test_fixed_staging_and_owned_resource_names(self):
        value=plan()
        with patch.object(runner,"corpus_plan",return_value={"corpus_sha256":"b"*64}),patch.object(runner,"source_hashes",return_value={}):
            runner.validate_plan(value,Path("unused"))
            value["function_names"][0]="clinical-recap-process"
            with self.assertRaisesRegex(RuntimeError,"invalid_owned_resources"):
                runner.validate_plan(value,Path("unused"))
        value=plan();value["staging_project"]="production-is-forbidden"
        with self.assertRaisesRegex(RuntimeError,"invalid_frozen_plan"):
            runner.validate_plan(value,Path("unused"))

    def test_frozen_source_or_corpus_change_blocks_preflight(self):
        value=plan()
        with patch.object(runner,"corpus_plan",return_value={"corpus_sha256":"c"*64}),patch.object(runner,"source_hashes",return_value={}):
            with self.assertRaisesRegex(RuntimeError,"frozen_source_or_corpus_changed"):
                runner.validate_plan(value,Path("unused"))

    def test_cli_metadata_shapes_and_secret_digests(self):
        for key in ("rows","data","functions","secrets","api_keys"):
            self.assertEqual(runner.cli_rows(json.dumps({key:[{"name":"sample"}]}).encode()),[{"name":"sample"}])
        self.assertEqual(runner.secret_fingerprint([{"name":"FLAG","value":"digest","updated_at":"old"}]),runner.secret_fingerprint([{"name":"FLAG","digest":"digest","updated_at":"new"}]))

    def test_uncertain_deploy_still_deletes_every_attempted_owned_name(self):
        value=plan();names=value["function_names"][:2]
        original_functions=[{"id":"original","slug":"clinical-recap-process","version":3}]
        secrets=[{"name":"OPENAI_API_KEY","digest":"keydigest"}]
        baseline={"functions_sha256":runner.digest(runner.packed(runner.stable_rows(original_functions))),"secrets_sha256":runner.secret_fingerprint(secrets),"storage_sha256":runner.digest(runner.packed([]))}
        receipt={"deployment_attempted":names,"storage_creation_attempted":True,"baseline":baseline}
        commands=[]
        def command(argv,**_kwargs):
            commands.append(argv)
            raise RuntimeError("delete_receipt_unconfirmed")
        with patch.object(runner,"command",side_effect=command),patch.object(runner,"cli_list",side_effect=lambda kind:original_functions if kind=="functions" else secrets),patch.object(runner,"http",return_value=(200,{},b"{}")),patch.object(runner,"bucket_list",return_value=[]):
            result=runner.cleanup(value,receipt,"never-printed-test-secret",Path("unused"))
        self.assertEqual([cmd[3] for cmd in commands],names)
        self.assertEqual(result["functions"]["removed_names"],names)
        self.assertTrue(result["complete"])
        self.assertNotIn("never-printed-test-secret",json.dumps(result))

    def test_cleanup_verification_failure_is_not_success(self):
        value=plan();receipt={"deployment_attempted":[],"storage_creation_attempted":False,"baseline":{}}
        with patch.object(runner,"cli_list",side_effect=RuntimeError("offline")),patch.object(runner,"bucket_list",side_effect=RuntimeError("offline")):
            self.assertFalse(runner.cleanup(value,receipt,"test",Path("unused"))["complete"])

    def test_paid_receipt_is_exclusive_and_review_never_calls_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/"receipt.json"
            value={"receipt_version":runner.VERSION,"run_id":"offline","maximum_paid_requests":8,"cases":[]}
            runner.save(path,value,exclusive=True)
            with self.assertRaises(FileExistsError):runner.save(path,value,exclusive=True)
            with patch.object(runner,"http",side_effect=AssertionError("network forbidden")),patch.object(runner,"command",side_effect=AssertionError("CLI forbidden")),patch("builtins.print"):
                self.assertEqual(runner.review(path)["maximum_paid_requests"],8)

    def test_probe_one_shot_and_strict_body_and_provider_constraints(self):
        source=runner.PROBE
        self.assertIn('"x-upsert":"false"',source)
        self.assertIn('incoming.headers.get("content-length")!=="2"',source)
        self.assertIn('inputBytes>2',source)
        self.assertIn('providerCallCount!==0',source)
        self.assertIn('length+next.value.length>512000',source)
        self.assertIn('provider_response_oversized',source)
        self.assertIn('options.body!==requestBody',source)
        self.assertIn('Date.now()>fixed.expires_at',source)
        self.assertNotIn('service.rpc',source)
        self.assertNotIn('/rest/v1/',source)
        self.assertNotIn('no-verify-jwt',source)

    def test_emitted_probe_executes_real_handler_and_one_shot_finish_offline(self):
        # Exercise the emitted raw-string JS rather than asserting its spelling.
        fixture=(runner.ROOT/"tests/clinical-recap/fixtures.ts").as_uri()
        handler=(runner.ROOT/"supabase/functions/_shared/clinical-recap-handler.ts").as_uri()
        prelude="""
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {recapFixture,providerResponse} from 'FIXTURE';
import {clinicalRecapRequest as makeRequest} from 'HANDLER';
const f=recapFixture();const mode=process.argv[2]??'success';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fixtureCorpus=Buffer.from(JSON.stringify({cases:[{id:'A',context:f.context}]}));
const providerBody=JSON.stringify(makeRequest('gpt-6-luna',f.context));
const fixedData={id:'A',run_id:'offline',corpus_b64:fixtureCorpus.toString('base64'),corpus_sha256:digest(fixtureCorpus),request_sha256:digest(providerBody),context_sha256:digest(JSON.stringify(f.context)),manifest_sha256:f.context.manifest.sha256,source_sha256:{},expires_at:Date.now()+60000,auth_sha256:digest('Bearer offline-only'),guard_bucket:'owned-offline',guard_object:'A.lock',attempt_id:f.attemptId,project_url:'https://kothoqicubowyhwfsrte.supabase.co'};
globalThis.__FIXED__=fixedData;
let callback,providerCount=0,guardCount=0;
globalThis.Deno={env:{get:name=>({OPENAI_API_KEY:'synthetic-stub',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_URL:fixedData.project_url,CLINICAL_AUDIO_PROCESSING_ENABLED:'false',CLINICAL_NOTE_PROCESSING_ENABLED:'false',CLINICAL_RECAP_PROCESSING_ENABLED:'false'}[name])},serve:fn=>{callback=fn;}};
globalThis.fetch=async(url,options)=>{
  if(url===fixedData.project_url+'/storage/v1/object/owned-offline/A.lock'){
    assert.equal(options.headers['x-upsert'],'false');guardCount++;return new Response('{}',{status:guardCount===1?200:400});
  }
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.body,providerBody);providerCount++;
  if(mode==='oversized')return new Response('x'.repeat(512001),{headers:{'x-request-id':'req_offline'}});
  return new Response(JSON.stringify(providerResponse(f.payload)),{headers:{'x-request-id':'req_offline'}});
};
""".replace('FIXTURE',fixture).replace('HANDLER',handler)
        emitted=runner.PROBE.replace('__FIXED__','globalThis.__FIXED__')
        for relative in runner.SHARED:
            emitted=emitted.replace('../_shared/'+Path(relative).name,(runner.ROOT/relative).as_uri())
        after="""
const invoke=(action='run',body='{}',credential='offline-only')=>callback(new Request('https://fixed.synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Length':String(Buffer.byteLength(body)),'Content-Type':'application/json','x-evaluation-action':action},body}));
const attest=await(await invoke('attest')).json();assert.equal(attest.request_sha256,fixedData.request_sha256);assert.equal(providerCount,0);
const first=await(await invoke()).json();assert.equal(first.provider_call_count,1);assert.equal(providerCount,1);
if(mode==='success'){assert.equal(first.parser_pass,true,JSON.stringify(first));assert.equal(first.provider_body_complete,true);assert.equal(first.handler_status,200);assert.equal(first.parsed_result.response_id,'resp_synthetic');assert.equal(first.raw_provider_response.id,'resp_synthetic');}
else{assert.equal(first.parser_pass,false);assert.equal(first.provider_body_complete,false);assert.equal(first.error,'provider_response_oversized');assert.equal(first.uncertain,true);assert.equal(Buffer.from(first.raw_provider_body_b64,'base64').length,512000);}
const duplicate=await(await invoke()).json();assert.equal(duplicate.provider_call_count,0);assert.equal(duplicate.probe_attempt_outcome,'refused');assert.equal(providerCount,1);
assert.equal((await invoke('run','{\"extra\":true}')).status,422);assert.equal((await invoke('run','{}','wrong')).status,403);
fixedData.expires_at=Date.now()-1;assert.equal((await invoke()).status,403);assert.equal(providerCount,1);
console.log('offline emitted probe handler/guard/finish passed');
"""
        with tempfile.TemporaryDirectory() as temporary:
            script=Path(temporary)/"probe.ts";script.write_text(prelude+emitted+after)
            for mode in ("success","oversized"):
                execution=subprocess.run(["node","--experimental-strip-types",str(script),mode],capture_output=True,timeout=30)
                self.assertEqual(execution.returncode,0,execution.stderr.decode())
                self.assertIn(b'offline emitted probe handler/guard/finish passed',execution.stdout)


if __name__=="__main__":unittest.main()
