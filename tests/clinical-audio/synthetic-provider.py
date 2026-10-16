"""Bounded OpenAI acceptance through a temporary staging-only, service-key-only probe.

Only fixed synthetic speech is embedded. No patient source or clinical activation.
Never reads back OPENAI_API_KEY; Supabase injects its existing staging secret.
"""
import argparse, base64, hashlib, json, os, shutil, subprocess, tempfile, uuid, wave
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--run-synthetic-provider', action='store_true', required=True)
p.add_argument('--fixture', choices=['baseline','shorthand','medication','vaccines','ambiguity'], default='baseline')
args=p.parse_args()
os.umask(0o077)
root = Path(__file__).resolve().parents[2]
ref = 'kothoqicubowyhwfsrte'
name = 'clinical-audio-synthetic-' + uuid.uuid4().hex[:10]
work = Path(tempfile.mkdtemp(prefix=name + '-'))
speech = ('Synthetic veterinary test. This is a fictional patient named Test Dog. '
          'The owner reports coughing for two days, with no vomiting. '
          'No physical examination findings were dictated. '
          'Assessment: cause of cough is undetermined. Plan: schedule an examination. '
          'No medication was prescribed. End of synthetic test.')
fixtures = {
 'shorthand': "Synthetic veterinary test. Fictional patient Test Dog. Subjective: owner says A D R, ain't doing right, with no vomiting. Objective: B A R. Body condition score five of nine. Assessment: cause undetermined. Plan: C B C, chemistry panel, and rads recommended, not yet performed. End of synthetic test.",
 'medication': "Synthetic veterinary test. Fictional patient Test Cat. Subjective: owner reports past use of Cerenia, not Convenia. No medication was administered today. Plan: confirm the historical Cerenia dose, written as zero point five milligrams, not five milligrams. No prescription is being issued. No objective examination was dictated. End of synthetic test.",
 'vaccines': "Synthetic veterinary test. Fictional patient Test Dog. Plan: rabies and Bordetella vaccines discussed. Owner declined both today. No vaccines were administered. No product, lot number, or due date was dictated. Assessment: vaccination status not verified. No examination findings were dictated. End of synthetic test.",
 'ambiguity': "Synthetic veterinary test. Fictional patient Test Cat. Subjective: owner reports A D R. Plan: clarify the note that says dex, S I D, A S. Drug, frequency, and site are unconfirmed. Do not make a prescription. No examination findings were dictated. End of synthetic test.",
}
speech=fixtures.get(args.fixture,speech)
deployed = False
receipt = None

def command(argv, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=180, **kwargs)
    if result.returncode:
        raise RuntimeError('Synthetic probe command failed: ' + argv[0] + '; ' + (result.stdout[-2000:] if argv[:3]==['supabase','functions','deploy'] else '') + result.stderr[-1500:])
    return result.stdout

try:
    command(['say', '-v', 'Samantha', '-o', str(work/'speech.aiff'), speech])
    command(['ffmpeg', '-v', 'error', '-i', str(work/'speech.aiff'), '-ar', '16000', '-ac', '1', '-f', 's16le', str(work/'speech.pcm')])
    with wave.open(str(work/'speech.wav'), 'wb') as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes((work/'speech.pcm').read_bytes())
    wav = (work/'speech.wav').read_bytes()
    shared = work/'supabase/functions/_shared'; shared.mkdir(parents=True)
    for filename in ['clinical-audio-handler.ts', 'clinical-audio-model.ts', 'clinical-veterinary-context.ts']:
        shutil.copy2(root/'supabase/functions/_shared'/filename, shared/filename)
    target = work/'supabase/functions'/name; target.mkdir()
    shutil.copy2(root/'supabase/functions/clinical-audio-process/deno.json', target/'deno.json')
    shutil.copy2(root/'supabase/functions/clinical-audio-process/deno.lock', target/'deno.lock')
    source = '''import {createClinicalAudioHandler} from "../_shared/clinical-audio-handler.ts";
import {audioDigest,inspectAudioWav} from "../_shared/clinical-audio-model.ts";
const deadline=DEADLINE;
const bytes=Uint8Array.from(atob(AUDIO),c=>c.charCodeAt(0));
Deno.serve(async(request)=>{
 if(request.method!=="POST"||Date.now()>deadline||await audioDigest(new TextEncoder().encode(request.headers.get("Authorization")??""))!==KEYHASH)return new Response("Forbidden",{status:403});
 if(await request.text()!=="{}")return new Response("Fixed synthetic input only",{status:400});
 const actor=crypto.randomUUID(),id=crypto.randomUUID(),now=new Date().toISOString();
 const policy={version:2,status:"approved",consent_text:"Synthetic engineering fixture only; no practice policy approval.",audio_retention:"not_stored",transcript_retention:"Synthetic fixture",transcription_model:"gpt-transcribe",soap_model:"gpt-6-luna",reviewed_by:actor,reviewed_at:now,created_at:now};
 const info=inspectAudioWav(bytes);
 const job={id,actor_id:actor,pet_id:crypto.randomUUID(),encounter_id:crypto.randomUUID(),expected_version:1,policy_version:2,sha256:await audioDigest(bytes),frames:info.frames,byte_size:info.byte_size,source_note:"Fixed synthetic engineering speech; no patient source",transcript:null,transcription_request_id:null,proposal_id:null,created_at:now,attempts:[]};
 const failures=[],results=[],calls=[]; let stage="transcribe",attempt=crypto.randomUUID();
 const handler=createClinicalAudioHandler({enabled:true,apiKey:Deno.env.get("OPENAI_API_KEY"),authenticate:async()=>({actorId:actor,read:async()=>({job,policy}),claim:async()=>({id:attempt,job_id:id,actor_id:actor,stage,model:stage==="transcribe"?policy.transcription_model:policy.soap_model,state:"claimed",intent:{job_id:id,stage,retry_of:null,reason:"",ack_cost:false},lease_until:new Date(Date.now()+120000).toISOString(),result_hash:null,error_code:null,failure_details:null,provider_request_id:null,created_at:now,finished_at:null})}),dispatch:async()=>true,finish:async(_id,result)=>{results.push({stage,...result});if(stage==="transcribe"){job.transcript=result.payload.text;job.transcription_request_id=result.request_id;}else job.proposal_id=crypto.randomUUID();},fail:async(_id,uncertain,code,details)=>{failures.push({stage,uncertain,code,details});},providerFetch:async(url,options)=>{calls.push({stage,path:new URL(url).pathname});return fetch(url,options);}});
 const statuses=[];
 for(const next of ["transcribe","generate"]){stage=next;attempt=crypto.randomUUID();const intent={job_id:id,attempt_id:attempt,stage,retry_of:null,reason:"",ack_cost:false};const response=await handler(new Request("https://synthetic.invalid/process",{method:"POST",headers:{Authorization:"Bearer synthetic-internal",'content-type':stage==="transcribe"?"application/octet-stream":"application/json",'x-audio-intent':encodeURIComponent(JSON.stringify(intent))},body:stage==="transcribe"?bytes:"{}"}));statuses.push({stage,status:response.status});await response.text();if(response.status!==200)break;}
 return Response.json({synthetic_only:true,clinical_database_used:false,clinical_flags_changed:false,seconds:info.seconds,statuses,calls,failures,results});
});
'''.replace('DEADLINE', str(__import__('time').time_ns()//1000000+15*60*1000)).replace('AUDIO', json.dumps(base64.b64encode(wav).decode()))
    (target/'index.ts').write_text(source)
    (work/'supabase/config.toml').write_text('project_id = "' + ref + '"\n')
    keys = json.loads(command(['supabase', 'projects', 'api-keys', '--project-ref', ref, '--output', 'json']))
    if isinstance(keys, dict): keys = keys.get('rows', keys.get('data', []))
    service = next(k['api_key'] for k in keys if k.get('name')=='service_role')
    (target/'index.ts').write_text(source.replace('KEYHASH', json.dumps(hashlib.sha256(('Bearer '+service).encode()).hexdigest())))
    command(['supabase', 'functions', 'deploy', name, '--project-ref', ref, '--workdir', str(work), '--use-api'])
    deployed = True
    request = Request('https://'+ref+'.supabase.co/functions/v1/'+name, data=b'{}', headers={'Authorization':'Bearer '+service,'apikey':service,'Content-Type':'application/json'})
    try:
        with urlopen(request, timeout=170) as response: receipt=json.load(response)
    except HTTPError as error:
        raise RuntimeError('Synthetic probe HTTP ' + str(error.code)) from None
    receipt.update({'staging_project':ref,'temporary_function':name,'audio_sha256':hashlib.sha256(wav).hexdigest(),'handler_sha256':hashlib.sha256((shared/'clinical-audio-handler.ts').read_bytes()).hexdigest(),'temporary_function_removed':False,'fixture':args.fixture,'speech':speech})
finally:
    if deployed:
        command(['supabase', 'functions', 'delete', name, '--project-ref', ref, '--workdir', str(work), '--yes'])
        if receipt: receipt['temporary_function_removed']=True
    shutil.rmtree(work)
    if receipt:
        (root/'tmp').mkdir(exist_ok=True)
        (root/'tmp/clinical-audio-synthetic-provider.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps({k:receipt[k] for k in ['fixture','synthetic_only','clinical_database_used','clinical_flags_changed','statuses','calls','failures','temporary_function_removed']}))
