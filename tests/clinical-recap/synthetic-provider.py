"""Opt-in eight-case OpenAI probe; fixed staging only, no hosted clinical reads/writes.

Prepare offline: --corpus tmp/clinical-recap-evaluation-corpus.json --prepare
Run once after review: --corpus FILE --plan PLAN --run-synthetic-provider
Review existing receipt offline: --review-receipt RECEIPT
The existing OPENAI_API_KEY stays inside staging Edge env. Only its presence is read.
"""
from __future__ import annotations
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler
import uuid

ROOT = Path(__file__).resolve().parents[2]
PROJECT = "kothoqicubowyhwfsrte"
BASE = "https://" + PROJECT + ".supabase.co"
VERSION = "lrv-recap-provider-receipt-v1"
FILES = [
    "supabase/functions/_shared/clinical-recap-handler.ts",
    "supabase/functions/_shared/clinical-recap-model.ts",
    "supabase/functions/_shared/clinical-veterinary-context.ts",
    "supabase/functions/_shared/clinical-audio-model.ts",
    "supabase/functions/clinical-recap-process/deno.json",
    "supabase/functions/clinical-recap-process/deno.lock",
    "supabase/migrations/20261017015543_clinical_record_recap.sql",
    "supabase/migrations/20261017042009_clinical_recap_prompt_v2.sql",
    "tests/clinical-recap/synthetic-provider-plan.ts",
    "tests/clinical-recap/synthetic-provider.py",
    "tests/clinical-recap/evaluation-corpus.ts",
    "tests/clinical-recap/evaluation-capture.ts",
    "tests/clinical-recap/evaluation-local.py",
    "tests/clinical-recap/synthetic-provider-plan.test.ts",
    "tests/clinical-recap/test_synthetic_provider.py",
]
SHARED = [p for p in FILES if "/_shared/" in p]


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def packed(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def save(path: Path, value, exclusive: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if exclusive:
        with path.open("x", encoding="utf-8") as stream:
            os.chmod(path, 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    else:
        temporary = path.with_name(path.name + ".writing")
        with temporary.open("w", encoding="utf-8") as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)


def command(argv, *, cwd=ROOT, timeout=180):
    # Never emit CLI output: API-key subcommands contain credentials, and debug
    # deploy errors can contain request headers. Receipts record safe categories.
    try:
        result = subprocess.run(argv, cwd=cwd, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError("cli_outcome_unconfirmed") from None
    if result.returncode:
        raise RuntimeError("cli_command_failed")
    return result.stdout


def cli_rows(raw: bytes):
    value = json.loads(raw)
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for field in ("rows", "data", "result", "functions", "secrets", "api_keys", "keys"):
            if isinstance(value.get(field), list):
                return value[field]
    raise RuntimeError("unexpected_cli_metadata_shape")


def cli_list(kind: str):
    rows = cli_rows(command(["supabase", kind, "list", "--project-ref", PROJECT, "--output-format", "json", "--agent", "no"]))
    if kind == "secrets" and any(not re.fullmatch(r"[a-f0-9]{64}", row.get("digest", row.get("value", ""))) for row in rows):
        raise RuntimeError("secret_metadata_digest_required")
    return rows


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(NoRedirect())


def http(method: str, path: str, service: str, body: bytes | None = None, headers=None, timeout=100):
    if not path.startswith("/") or path.startswith("//"):
        raise RuntimeError("invalid_fixed_staging_path")
    request = Request(BASE + path, method=method, data=body, headers={"Authorization": "Bearer " + service, "apikey": service, **(headers or {})})
    try:
        with OPENER.open(request, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except HTTPError as failure:
        return failure.code, dict(failure.headers), failure.read()


def bucket_list(service):
    status, _, body = http("GET", "/storage/v1/bucket", service)
    if status != 200:
        raise RuntimeError("storage_metadata_unavailable")
    rows = json.loads(body)
    if not isinstance(rows, list):
        raise RuntimeError("storage_metadata_shape")
    return rows


def stable_rows(rows, key="id"):
    return sorted(rows, key=lambda row: str(row.get(key, row.get("name", ""))))


def secret_fingerprint(rows):
    return digest(packed(sorted([{
        "name": row.get("name"), "digest": row.get("digest", row.get("value"))
    } for row in rows], key=lambda row: str(row["name"]))))


def source_hashes():
    return {path: digest((ROOT / path).read_bytes()) for path in FILES}


def corpus_plan(corpus: Path):
    return json.loads(command(["node", "--experimental-strip-types", "tests/clinical-recap/synthetic-provider-plan.ts", str(corpus.resolve())]))


def prepare(corpus: Path, output: Path | None):
    frozen = corpus_plan(corpus)
    run_id = uuid.uuid4().hex[:20]
    plan = {"plan_version": "lrv-recap-fixed-probe-plan-v1", "run_id": run_id, "prepared_at": now(), "staging_project": PROJECT, "maximum_paid_requests": 8, "source_sha256": source_hashes(), **frozen}
    plan["function_names"] = ["recap-eval-" + run_id + "-" + item["id"].lower() for item in frozen["cases"]]
    plan["guard_bucket"] = "recap-eval-" + run_id
    plan["object_paths"] = [item["id"] + ".lock" for item in frozen["cases"]]
    path = output or ROOT / "tmp" / ("clinical-recap-evaluation-" + run_id) / "plan.json"
    save(path, plan, exclusive=True)
    return path, plan


def validate_plan(plan, corpus: Path):
    if plan.get("plan_version") != "lrv-recap-fixed-probe-plan-v1" or plan.get("staging_project") != PROJECT or plan.get("maximum_paid_requests") != 8 or not re.fullmatch(r"[a-f0-9]{20}", plan.get("run_id", "")):
        raise RuntimeError("invalid_frozen_plan")
    run = plan["run_id"]
    expected_names = ["recap-eval-" + run + "-" + c.lower() for c in "ABCDEFGH"]
    if plan.get("function_names") != expected_names or plan.get("guard_bucket") != "recap-eval-" + run or plan.get("object_paths") != [c + ".lock" for c in "ABCDEFGH"]:
        raise RuntimeError("invalid_owned_resources")
    frozen = corpus_plan(corpus)
    if any(plan.get(key) != value for key, value in frozen.items()) or plan.get("source_sha256") != source_hashes():
        raise RuntimeError("frozen_source_or_corpus_changed")
    return frozen


PROBE = r'''import {createClinicalRecapHandler,clinicalRecapRequest} from "../_shared/clinical-recap-handler.ts";
import {recapJobReadSchema,recapResultSchema} from "../_shared/clinical-recap-model.ts";
import {audioDigest} from "../_shared/clinical-audio-model.ts";
const fixed=__FIXED__;
const corpusBytes=Uint8Array.from(atob(fixed.corpus_b64),c=>c.charCodeAt(0));
const sha=async(value:string|Uint8Array)=>await audioDigest(typeof value==="string"?new TextEncoder().encode(value):value);
if(await sha(corpusBytes)!==fixed.corpus_sha256)throw Error("Fixed corpus bytes differ");
const corpus=JSON.parse(new TextDecoder().decode(corpusBytes));
const selected=corpus.cases.find((c:{id:string})=>c.id===fixed.id);
const original=recapJobReadSchema.parse(selected.context);
const requestBody=JSON.stringify(clinicalRecapRequest(original.policy.generation_model,original));
if(await sha(requestBody)!==fixed.request_sha256||await sha(JSON.stringify(original))!==fixed.context_sha256||original.manifest.sha256!==fixed.manifest_sha256)throw Error("Fixed input differs");
const timestamp=()=>new Date().toISOString().replace("Z","000Z");
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
const base={run_id:fixed.run_id,id:fixed.id,corpus_sha256:fixed.corpus_sha256,manifest_sha256:fixed.manifest_sha256,context_sha256:fixed.context_sha256,request_sha256:fixed.request_sha256,source_sha256:fixed.source_sha256,expires_at:fixed.expires_at,synthetic_only:true,hosted_clinical_reads:0,hosted_clinical_writes:0,guard_bucket:fixed.guard_bucket,guard_object:fixed.guard_object};
Deno.serve(async(incoming)=>{
 if(incoming.method!=="POST"||Date.now()>fixed.expires_at||await sha(incoming.headers.get("Authorization")??"")!==fixed.auth_sha256)return response({error:"forbidden"},403);
 if(incoming.headers.get("content-length")!=="2"||!incoming.body)return response({error:"fixed_empty_body_required"},422);
 const inputReader=incoming.body.getReader();let input="",inputBytes=0;
 try{for(;;){const next=await inputReader.read();if(next.done)break;inputBytes+=next.value.length;if(inputBytes>2){await inputReader.cancel();return response({error:"fixed_empty_body_required"},422);}input+=new TextDecoder().decode(next.value);}}finally{inputReader.releaseLock();}
 if(input!=="{}"||inputBytes!==2)return response({error:"fixed_empty_body_required"},422);
 const action=incoming.headers.get("x-evaluation-action");
 const envFlags=Object.fromEntries(["CLINICAL_AUDIO_PROCESSING_ENABLED","CLINICAL_NOTE_PROCESSING_ENABLED","CLINICAL_RECAP_PROCESSING_ENABLED"].map(name=>[name,Deno.env.get(name)??null]));
 if(action==="attest")return response({...base,action:"attest",request_body_b64:btoa(unescape(encodeURIComponent(requestBody))),openai_key_present:!!Deno.env.get("OPENAI_API_KEY"),env_flags:envFlags});
 if(action!=="run")return response({error:"fixed_action_required"},422);
 const start=Date.now();let providerCallCount=0,guardOutcome="not_attempted",rawBody="",rawBytesB64="",rawResponse:unknown=null,providerHttp:number|null=null,providerRequestId:string|null=null,providerError:string|null=null,providerStarted:number|null=null,providerFinished:number|null=null,providerBodyComplete=false;
 let context=structuredClone(original);const results:unknown[]=[],failures:unknown[]=[];
 const attempt={id:fixed.attempt_id,job_id:context.job.id,actor_id:context.actor_id,model:"gpt-6-luna",state:"claimed",intent:{job_id:context.job.id,retry_of:null,reason:"",ack_cost:false},lease_until:new Date(Date.now()+90000).toISOString().replace("Z","000Z"),result_hash:null,error_code:null,failure_details:null,provider_request_id:null,created_at:timestamp(),finished_at:null};
 const intent={job_id:context.job.id,attempt_id:attempt.id,retry_of:null,reason:"",ack_cost:false};
 const handler=createClinicalRecapHandler({enabled:true,apiKey:Deno.env.get("OPENAI_API_KEY"),authenticate:async()=>({actorId:context.actor_id,read:async()=>context,claim:async()=>attempt}),dispatch:async()=>{
   if(guardOutcome!=="not_attempted")return false;guardOutcome="unconfirmed";
   const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),url=Deno.env.get("SUPABASE_URL");
   if(!service||url!==fixed.project_url){guardOutcome="configuration_refused";return false;}
   try{const guard=await fetch(url+"/storage/v1/object/"+fixed.guard_bucket+"/"+fixed.guard_object,{method:"POST",headers:{Authorization:"Bearer "+service,apikey:service,"Content-Type":"application/octet-stream","x-upsert":"false"},body:new Uint8Array(),signal:AbortSignal.timeout(10000)});await guard.arrayBuffer();guardOutcome=guard.ok?"created":"refused";return guard.ok;}catch{guardOutcome="unconfirmed";return false;}
 },finish:async(_id,result)=>{
   const parsed=recapResultSchema.parse(result),{payload,...provider_manifest}=parsed;results.push(parsed);
   const output={id:attempt.id,job_id:context.job.id,manifest_sha256:context.manifest.sha256,payload,payload_sha256:await sha(JSON.stringify(payload)),provider_manifest,created_at:timestamp()};
   context=recapJobReadSchema.parse({...context,job:{...context.job,output_id:attempt.id,attempts:[{...attempt,state:"completed",result_hash:await sha(JSON.stringify(parsed)),finished_at:timestamp()}]},output});
   return{job_id:context.job.id,attempt_id:attempt.id,retained:true,outcome:"completed"};
 },fail:async(_id,uncertain,code,details)=>{failures.push({uncertain,code,details});},providerFetch:async(url,options)=>{
   if(guardOutcome!=="created"||providerCallCount!==0||url!=="https://api.openai.com/v1/responses"||options?.method!=="POST"||options.body!==requestBody||await sha(String(options.body))!==fixed.request_sha256||Date.now()>fixed.expires_at)throw Error("Fixed provider request refused");
   providerCallCount++;providerStarted=Date.now();
   try{const upstream=await fetch(url,options);providerHttp=upstream.status;providerRequestId=upstream.headers.get("x-request-id");
     const chunks:Uint8Array[]=[];let length=0;
     try{if(!upstream.body)throw Error();const reader=upstream.body.getReader();try{for(;;){const next=await reader.read();if(next.done)break;if(length+next.value.length>512000){const available=512000-length;if(available>0){chunks.push(next.value.slice(0,available));length+=available;}providerError="provider_response_oversized";await reader.cancel();throw Error("Oversized provider response");}chunks.push(next.value);length+=next.value.length;}}finally{reader.releaseLock();}providerBodyComplete=true;}catch{providerError??="provider_body_interrupted";}
     const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
     rawBody=new TextDecoder().decode(bytes);rawBytesB64=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(""));try{rawResponse=JSON.parse(rawBody);}catch{/* Preserve raw bytes even when incomplete/non-JSON. */}
     if(!providerBodyComplete)throw Error("Provider body interrupted");
     return new Response(bytes,{status:upstream.status,statusText:upstream.statusText,headers:upstream.headers});
   }catch{providerError??="provider_network_outcome_unconfirmed";throw Error("Synthetic provider outcome unconfirmed");}finally{providerFinished=Date.now();}
 }});
 let handlerStatus:number|null=null,handlerBody:unknown=null,probeError:string|null=null;
 try{const handled=await handler(new Request("https://fixed.synthetic.invalid/recap",{method:"POST",headers:{Authorization:"Bearer synthetic-fixed-handler","x-recap-intent":encodeURIComponent(JSON.stringify(intent)),"Content-Type":"application/json"},body:"{}"}));handlerStatus=handled.status;handlerBody=await handled.json();}catch{probeError="handler_outcome_unconfirmed";}
 const raw=rawResponse as {id?:unknown;model?:unknown;status?:unknown;usage?:unknown}|null;
 const uncertain=providerCallCount>0&&(!providerBodyComplete||failures.some((f:unknown)=>!!(f as {uncertain?:boolean}).uncertain)||!!probeError);
 return response({...base,action:"run",env_flags:envFlags,probe_attempt_outcome:guardOutcome==="created"?probeError??"dispatched":guardOutcome,provider_call_count:providerCallCount,http_status:providerHttp,provider_request_id:providerRequestId,response_id:typeof raw?.id==="string"?raw.id:null,provider_model:typeof raw?.model==="string"?raw.model:null,usage:raw?.usage??null,provider_status:typeof raw?.status==="string"?raw.status:null,provider_body_complete:providerBodyComplete,raw_provider_response:rawResponse,raw_provider_body:rawBody,raw_provider_body_b64:rawBytesB64,parsed_result:results[0]??null,parser_pass:results.length===1,handler_status:handlerStatus,handler_error:(handlerBody as {error?:unknown})?.error??null,failures,error:probeError??providerError??((handlerBody as {error?:{code?:string}})?.error?.code??null),uncertain,timing:{started_at:new Date(start).toISOString(),provider_started_at:providerStarted===null?null:new Date(providerStarted).toISOString(),provider_finished_at:providerFinished===null?null:new Date(providerFinished).toISOString(),duration_ms:Date.now()-start,provider_duration_ms:providerStarted===null||providerFinished===null?null:providerFinished-providerStarted}});
});
'''


def function_name(row):
    return row.get("slug", row.get("name", ""))


def owned_names(plan):
    return set(plan["function_names"])


def verify_attestation(plan, case, value, request_body):
    fields = {"run_id": plan["run_id"], "id": case["id"], "corpus_sha256": plan["corpus_sha256"], "manifest_sha256": case["manifest_sha256"], "context_sha256": case["context_sha256"], "request_sha256": case["request_sha256"], "source_sha256": plan["source_sha256"], "synthetic_only": True, "hosted_clinical_reads": 0, "hosted_clinical_writes": 0, "action": "attest"}
    if not isinstance(value, dict) or any(value.get(key) != expected for key, expected in fields.items()) or value.get("openai_key_present") is not True or value.get("request_body_b64") != request_body:
        raise RuntimeError("uploaded_fixed_input_attestation_failed")
    if digest(base64.b64decode(value["request_body_b64"], validate=True)) != case["request_sha256"]:
        raise RuntimeError("uploaded_request_bytes_changed")
    flags = value.get("env_flags")
    if not isinstance(flags, dict) or set(flags) != {"CLINICAL_AUDIO_PROCESSING_ENABLED", "CLINICAL_NOTE_PROCESSING_ENABLED", "CLINICAL_RECAP_PROCESSING_ENABLED"} or any(flag == "true" for flag in flags.values()):
        raise RuntimeError("existing_clinical_processing_gate_is_enabled")
    return flags


def verify_download(work: Path, name: str, index: bytes):
    download = work / ("download-" + name)
    (download / "supabase").mkdir(parents=True)
    (download / "supabase/config.toml").write_text('project_id = "' + PROJECT + '"\n')
    command(["supabase", "functions", "download", name, "--project-ref", PROJECT, "--workdir", str(download), "--use-api", "--agent", "no"])
    # The server-side unbundler must retain the actual module bytes. A changed
    # serialization/path fails closed before model invocation, not a weak match.
    expected = {"index.ts": index, **{Path(path).name: (ROOT / path).read_bytes() for path in SHARED}}
    receipts = {}
    for basename, data in expected.items():
        matches = [path for path in download.rglob(basename) if path.is_file() and path.read_bytes() == data]
        if not matches:
            raise RuntimeError("downloaded_probe_source_bytes_differ")
        receipts[basename] = digest(data)
    return receipts


def cleanup(plan, receipt, service, work):
    report = {"functions": {"attempted_names": list(receipt["deployment_attempted"]), "removed_names": [], "remaining_names": [], "errors": []}, "storage": {"bucket": plan["guard_bucket"], "object_paths": plan["object_paths"], "removed": False, "remaining": None, "errors": []}, "baseline_unchanged": {"functions": False, "secrets": False, "storage": False}, "complete": False}
    # Delete every attempted owned deployment even if the deploy command timed
    # out or returned an error. Never rely on an optimistic deployed boolean.
    for name in receipt["deployment_attempted"]:
        try:
            command(["supabase", "functions", "delete", name, "--project-ref", PROJECT, "--workdir", str(work), "--yes", "--agent", "no"])
        except Exception:
            report["functions"]["errors"].append({"name": name, "code": "delete_receipt_unconfirmed"})
    try:
        functions = cli_list("functions")
        present = {function_name(row) for row in functions}
        report["functions"]["remaining_names"] = sorted(owned_names(plan) & present)
        report["functions"]["removed_names"] = sorted(set(receipt["deployment_attempted"]) - present)
        baseline = receipt.get("baseline", {})
        report["baseline_unchanged"]["functions"] = digest(packed(stable_rows([row for row in functions if function_name(row) not in owned_names(plan)]))) == baseline.get("functions_sha256")
    except Exception:
        report["functions"]["errors"].append({"code": "function_removal_verification_unconfirmed"})
    if receipt.get("storage_creation_attempted"):
        try:
            # Exact owned object names only; no emptyBucket/general delete.
            status, _, _ = http("DELETE", "/storage/v1/object/" + plan["guard_bucket"], service, packed({"prefixes": plan["object_paths"]}), {"Content-Type": "application/json"})
            if status not in (200, 204, 404):
                report["storage"]["errors"].append({"code": "owned_guard_object_cleanup_unconfirmed", "http_status": status})
            status, _, _ = http("DELETE", "/storage/v1/bucket/" + plan["guard_bucket"], service)
            if status not in (200, 204, 404):
                report["storage"]["errors"].append({"code": "owned_guard_bucket_cleanup_unconfirmed", "http_status": status})
        except Exception:
            report["storage"]["errors"].append({"code": "owned_guard_cleanup_unconfirmed"})
    try:
        buckets = bucket_list(service)
        present = any(row.get("id", row.get("name")) == plan["guard_bucket"] for row in buckets)
        report["storage"]["remaining"] = present
        report["storage"]["removed"] = not present
        report["baseline_unchanged"]["storage"] = digest(packed(stable_rows([row for row in buckets if row.get("id", row.get("name")) != plan["guard_bucket"]]))) == receipt.get("baseline", {}).get("storage_sha256")
    except Exception:
        report["storage"]["errors"].append({"code": "storage_removal_verification_unconfirmed"})
    try:
        report["baseline_unchanged"]["secrets"] = secret_fingerprint(cli_list("secrets")) == receipt.get("baseline", {}).get("secrets_sha256")
    except Exception:
        report["functions"]["errors"].append({"code": "secret_metadata_verification_unconfirmed"})
    report["complete"] = not report["functions"]["remaining_names"] and report["storage"]["removed"] and all(report["baseline_unchanged"].values()) and not any(item.get("code", "").endswith("verification_unconfirmed") for item in report["functions"]["errors"])
    return report


def service_key():
    keys = cli_rows(command(["supabase", "projects", "api-keys", "--project-ref", PROJECT, "--output", "json", "--agent", "no"]))
    value = next((row.get("api_key") for row in keys if row.get("name") == "service_role"), None)
    if not isinstance(value, str) or len(value) < 40 or value.startswith("[REDACTED"):
        raise RuntimeError("staging_service_key_unavailable")
    # Never retrieve OPENAI_API_KEY. This is only the staging probe credential.
    return value


def run(plan_path: Path, corpus: Path):
    plan = json.loads(plan_path.read_bytes())
    validate_plan(plan, corpus)
    directory = plan_path.parent
    receipt_path = directory / "receipt.json"
    receipt = {"receipt_version": VERSION, "run_id": plan["run_id"], "corpus_version": plan["corpus_version"], "corpus_sha256": plan["corpus_sha256"], "source_sha256": plan["source_sha256"], "plan_sha256": digest(plan_path.read_bytes()), "maximum_paid_requests": 8, "started_at": now(), "finished_at": None, "staging_project": PROJECT, "hosted_clinical_reads": 0, "hosted_clinical_writes": 0, "temporary_nonclinical_storage_guard_writes": True, "deployment_attempted": [], "storage_creation_attempted": False, "cases": [{"id": item["id"], "title": item["title"], "manifest_sha256": item["manifest_sha256"], "request_sha256": item["request_sha256"], "probe_attempt_outcome": "not_attempted", "provider_call_count": 0, "provider_body_complete": False, "parser_pass": False, "uncertain": False, "error": None} for item in plan["cases"]], "cleanup": None, "error": None}
    save(receipt_path, receipt, exclusive=True)  # A paid run cannot be resumed/repeated.
    with (directory / "corpus.json").open("xb") as frozen_corpus:
        os.chmod(directory / "corpus.json", 0o600)
        frozen_corpus.write(corpus.read_bytes())
    work = Path(tempfile.mkdtemp(prefix="lrv-recap-probe-"))
    service = None
    try:
        service = service_key()
        functions, secrets, buckets = cli_list("functions"), cli_list("secrets"), bucket_list(service)
        if owned_names(plan) & {function_name(row) for row in functions} or any(row.get("id", row.get("name")) == plan["guard_bucket"] for row in buckets):
            raise RuntimeError("owned_resource_already_exists")
        if not any(row.get("name") == "OPENAI_API_KEY" for row in secrets):
            raise RuntimeError("existing_staging_openai_secret_missing")
        receipt["baseline"] = {"functions": stable_rows(functions), "secrets": stable_rows(secrets, "name"), "storage": stable_rows(buckets), "functions_sha256": digest(packed(stable_rows(functions))), "secrets_sha256": secret_fingerprint(secrets), "storage_sha256": digest(packed(stable_rows(buckets)))}
        save(receipt_path, receipt)
        receipt["storage_creation_attempted"] = True
        save(receipt_path, receipt)
        status, _, _ = http("POST", "/storage/v1/bucket", service, packed({"id": plan["guard_bucket"], "name": plan["guard_bucket"], "public": False, "file_size_limit": 1, "allowed_mime_types": ["application/octet-stream"]}), {"Content-Type": "application/json"})
        if status not in (200, 201):
            raise RuntimeError("private_guard_creation_unconfirmed")
        expires = int(time.time() * 1000) + 15 * 60 * 1000
        shared = work / "supabase/functions/_shared"
        shared.mkdir(parents=True)
        for relative in SHARED:
            shutil.copy2(ROOT / relative, shared / Path(relative).name)
        (work / "supabase/config.toml").write_text('project_id = "' + PROJECT + '"\n')
        indexes = {}
        for item, name in zip(plan["cases"], plan["function_names"], strict=True):
            fixed = {**item, "run_id": plan["run_id"], "corpus_b64": base64.b64encode(corpus.read_bytes()).decode(), "corpus_sha256": plan["corpus_sha256"], "source_sha256": plan["source_sha256"], "expires_at": expires, "auth_sha256": digest(("Bearer " + service).encode()), "project_url": BASE, "guard_bucket": plan["guard_bucket"], "guard_object": item["id"] + ".lock", "attempt_id": str(uuid.uuid5(uuid.UUID(plan["namespace"]), plan["run_id"] + ":" + item["id"]))}
            fixed.pop("request_body_b64")
            target = work / "supabase/functions" / name
            target.mkdir()
            for filename in ("deno.json", "deno.lock"):
                shutil.copy2(ROOT / "supabase/functions/clinical-recap-process" / filename, target / filename)
            index = PROBE.replace("__FIXED__", json.dumps(fixed, ensure_ascii=True, separators=(",", ":"))).encode()
            indexes[name] = index
            (target / "index.ts").write_bytes(index)
            # Persist exact synthetic source for independent review, no plaintext key.
            (directory / (name + ".ts")).write_bytes(index)
        first = work / "supabase/functions" / plan["function_names"][0]
        command(["deno", "check", "--frozen", "--config", str(first / "deno.json"), str(first / "index.ts")])
        receipt["probe_source_sha256"] = {name: digest(source) for name, source in indexes.items()}
        receipt["expires_at_epoch_ms"] = expires
        save(receipt_path, receipt)
        for name in plan["function_names"]:
            receipt["deployment_attempted"].append(name)  # Journal before ambiguous network deployment.
            save(receipt_path, receipt)
            command(["supabase", "functions", "deploy", name, "--project-ref", PROJECT, "--workdir", str(work), "--use-api", "--agent", "no"])
            print(json.dumps({"event": "fixed_probe_deployed", "name": name}), flush=True)
        receipt["download_verification"] = {}
        for name in plan["function_names"]:
            receipt["download_verification"][name] = verify_download(work, name, indexes[name])
            save(receipt_path, receipt)
        flags = None
        receipt["attestations"] = []
        for item, name in zip(plan["cases"], plan["function_names"], strict=True):
            status, _, body = http("POST", "/functions/v1/" + name, service, b"{}", {"Content-Type": "application/json", "x-evaluation-action": "attest"})
            if status != 200:
                raise RuntimeError("fixed_probe_attestation_unconfirmed")
            value = json.loads(body)
            actual_flags = verify_attestation(plan, item, value, item["request_body_b64"])
            if flags is not None and flags != actual_flags:
                raise RuntimeError("hosted_processing_flags_changed")
            flags = actual_flags
            receipt["attestations"].append(value)
            save(receipt_path, receipt)
        receipt["env_flags_before"] = flags
        if expires - int(time.time() * 1000) < 8 * 65000:
            raise RuntimeError("insufficient_fixed_probe_lifetime_for_eight_cases")
        validate_plan(plan, corpus)
        receipt["all_fixed_inputs_verified_before_any_paid_call"] = True
        save(receipt_path, receipt)
        for index, (item, name) in enumerate(zip(plan["cases"], plan["function_names"], strict=True)):
            validate_plan(plan, corpus)
            case = receipt["cases"][index]
            case["probe_attempt_outcome"] = "invocation_started_may_be_billed"
            case["uncertain"] = True
            case["client_started_at"] = now()
            save(receipt_path, receipt)  # Never reissue this invocation on any error.
            try:
                status, _, raw = http("POST", "/functions/v1/" + name, service, b"{}", {"Content-Type": "application/json", "x-evaluation-action": "run"}, timeout=100)
                (directory / ("case-" + item["id"] + "-probe-response.bin")).write_bytes(raw)
                os.chmod(directory / ("case-" + item["id"] + "-probe-response.bin"), 0o600)
                case["probe_http_status"] = status
                value = json.loads(raw)
                if status != 200:
                    raise OSError("probe_http_receipt_unconfirmed")
                if any(value.get(key) != expected for key, expected in {"run_id": plan["run_id"], "id": item["id"], "corpus_sha256": plan["corpus_sha256"], "request_sha256": item["request_sha256"], "manifest_sha256": item["manifest_sha256"], "source_sha256": plan["source_sha256"]}.items()) or value.get("provider_call_count") not in (0, 1):
                    raise RuntimeError("fixed_probe_receipt_unconfirmed")
                case.update(value)
                case["client_finished_at"] = now()
                if value.get("env_flags") != flags:
                    raise RuntimeError("hosted_processing_flags_changed")
                save(receipt_path, receipt)
                print(json.dumps({"case": item["id"], "provider_calls": case["provider_call_count"], "parser_pass": case.get("parser_pass"), "uncertain": case.get("uncertain"), "probe_attempt_outcome": case.get("probe_attempt_outcome")}), flush=True)
                if case.get("uncertain"):
                    case["stopped_without_retry"] = True
                    save(receipt_path, receipt)
            except BaseException as invocation_error:
                case["probe_attempt_outcome"] = "invocation_receipt_unconfirmed"
                case["error"] = "invocation_receipt_unconfirmed"
                case["uncertain"] = True
                case["stopped_without_retry"] = True
                save(receipt_path, receipt)
                if isinstance(invocation_error, (KeyboardInterrupt, SystemExit)):
                    receipt["error"] = "run_interrupted_no_retry"
                    break
                if isinstance(invocation_error, RuntimeError) and str(invocation_error) in {"hosted_processing_flags_changed", "fixed_probe_receipt_unconfirmed"}:
                    receipt["error"] = str(invocation_error)
                    break
                # Other not-yet-attempted fixed cases retain their authorized one
                # attempt. This case is never reissued, including unknown billing.
                continue
        # Harmless final attestation checks only, never repeat generation.
        status, _, body = http("POST", "/functions/v1/" + plan["function_names"][0], service, b"{}", {"Content-Type": "application/json", "x-evaluation-action": "attest"})
        if status != 200 or json.loads(body).get("env_flags") != flags:
            receipt["error"] = receipt["error"] or "final_processing_flags_verification_unconfirmed"
        else:
            receipt["env_flags_after"] = flags
    except BaseException as error:
        receipt["error"] = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r"[a-z_]+", str(error)) else "run_interrupted_or_preflight_failed"
    finally:
        if service is not None and receipt.get("baseline"):
            receipt["cleanup"] = cleanup(plan, receipt, service, work)
        else:
            receipt["cleanup"] = {"complete": not receipt["deployment_attempted"] and not receipt["storage_creation_attempted"], "reason": "no_hosted_resource_operation_started"}
        receipt["finished_at"] = now()
        receipt["observed_paid_requests"] = sum(item.get("provider_call_count", 0) for item in receipt["cases"])
        receipt["possible_unconfirmed_paid_requests"] = sum(item.get("probe_attempt_outcome") == "invocation_receipt_unconfirmed" for item in receipt["cases"])
        save(receipt_path, receipt)
        shutil.rmtree(work, ignore_errors=True)
    print(json.dumps({"receipt": str(receipt_path), "observed_paid_requests": receipt["observed_paid_requests"], "possible_unconfirmed_paid_requests": receipt["possible_unconfirmed_paid_requests"], "cleanup_complete": receipt["cleanup"]["complete"], "error": receipt["error"]}))
    return receipt


def review(path: Path):
    value = json.loads(path.read_bytes())
    if value.get("receipt_version") != VERSION:
        raise RuntimeError("unknown_receipt_version")
    summary = {"run_id": value["run_id"], "maximum_paid_requests": value["maximum_paid_requests"], "observed_paid_requests": value.get("observed_paid_requests"), "possible_unconfirmed_paid_requests": value.get("possible_unconfirmed_paid_requests"), "cleanup": value.get("cleanup"), "cases": [{key: case.get(key) for key in ("id", "provider_call_count", "parser_pass", "probe_attempt_outcome", "uncertain", "error")} for case in value["cases"]]}
    print(json.dumps(summary, indent=2))
    return summary


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path)
    parser.add_argument("--plan", type=Path)
    parser.add_argument("--output-plan", type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--prepare", action="store_true")
    action.add_argument("--run-synthetic-provider", action="store_true")
    action.add_argument("--review-receipt", type=Path)
    args = parser.parse_args(argv)
    if args.review_receipt:
        review(args.review_receipt)
        return 0
    if not args.corpus or not args.corpus.is_file():
        parser.error("--corpus must identify an existing eight-case local synthetic corpus")
    if args.prepare:
        path, plan = prepare(args.corpus, args.output_plan)
        print(json.dumps({"plan": str(path), "run_id": plan["run_id"], "corpus_sha256": plan["corpus_sha256"], "maximum_paid_requests": 8, "hosted_operations": 0, "provider_calls": 0}))
        return 0
    if not args.plan or not args.plan.is_file():
        parser.error("--run-synthetic-provider requires the reviewed existing --plan")
    result = run(args.plan, args.corpus)
    return 0 if result.get("cleanup", {}).get("complete") and not result.get("error") else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Synthetic evaluation stopped safely; inspect its private receipt. No automatic retry.", file=sys.stderr)
        sys.exit(1)
