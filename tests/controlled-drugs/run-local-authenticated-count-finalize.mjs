/** Closed SOURCE driver; Root alone executes after independent admission.
 * Fresh UI password login, one actual finalize then one lost acknowledgement.
 * Fixed120s INCLUDING cleanup; owning parent original600 watchdog remains.
 */
import assert from 'node:assert/strict';
import{createHash}from'node:crypto';
import{constants,openSync,closeSync,fstatSync,lstatSync,readFileSync,writeFileSync,readdirSync,realpathSync,existsSync}from'node:fs';
import{basename,dirname,resolve,sep}from'node:path';
import{fileURLToPath}from'node:url';
import{tmpdir}from'node:os';
import{createServer}from'vite';
import react from'@vitejs/plugin-react-swc';
import{chromium,expect}from'@playwright/test';
import{narcoticsFinalizeBrowserInputSchema,narcoticsBrowserPublicInput}from'./narcotics-finalize-browser-input.ts';
import{parseCountRequest,decodeCountPublicReceipt}from'../../src/hub/features/controlled-drugs/count/count-request-schema.ts';
import{verifyCountSavedReply}from'../../src/hub/features/controlled-drugs/count/count-wire.ts';
import{verifyCountReadReply}from'../../src/hub/features/controlled-drugs/count/count-read-wire.ts';
import{parseCountDiscoveryReply}from'../../src/hub/features/controlled-drugs/count/count-discovery.ts';
import{parseCountScopeReply}from'../../src/hub/features/controlled-drugs/count/count-admin-schema.ts';
import{parseCountOperationClosureRequest,verifyCountOperationClosureReply}from'../../src/hub/features/controlled-drugs/count/count-operation-closure.ts';
import{countOperationStorageKey}from'../../src/hub/features/controlled-drugs/count/count-operation-controller.ts';

process.umask(0o077);
const root=fileURLToPath(new URL('../../',import.meta.url)),pageOrigin='http://127.0.0.1:64901';
const started=performance.now(),deadline=started+120000;let failure;
const fail=()=>{failure??=new Error('Closed count browser phase failed');};
const failureDiagnostics=[];
function noteFailure(error,phase){
 try{
  if(failureDiagnostics.length>=8)return;
  const names=new Set(['Error','AssertionError','TimeoutError','TypeError','ReferenceError','SyntaxError']);
  const name=error instanceof Error&&names.has(error.name)?error.name:'Other';
  const match=error instanceof Error?/run-local-authenticated-count-finalize\.mjs:(\d+):(\d+)/.exec(error.stack??''):null;
  const record={phase,error_name:name,driver_line:match?Number(match[1]):null,driver_column:match?Number(match[2]):null};
  if(Number.isInteger(error?.actual)&&error.actual>=0&&error.actual<=599)record.actual_integer=error.actual;
  if(Number.isInteger(error?.expected)&&error.expected>=0&&error.expected<=599)record.expected_integer=error.expected;
  failureDiagnostics.push(record);
 }catch{/* Diagnostics never change success, failure or cleanup behavior. */}
}
function remaining(cap=15000){if(failure)throw failure;const left=deadline-performance.now()-30000;if(left<=0)throw new Error('Original120s browser cutoff reserved for cleanup');return Math.min(cap,left);}
const sha=b=>createHash('sha256').update(b).digest('hex');
function regular(path,cap,privateFile=false){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const a=fstatSync(fd);assert(a.isFile()&&a.size<=cap&&a.uid===process.getuid());if(privateFile)assert.equal(a.mode&0o077,0);
  const data=readFileSync(fd);const b=fstatSync(fd);assert.equal(data.length,a.size);assert.equal(a.dev,b.dev);assert.equal(a.ino,b.ino);assert.equal(a.size,b.size);assert.equal(a.mtimeMs,b.mtimeMs);return data;
 }finally{closeSync(fd);}
}
function verifySources(){
 const raw=regular(resolve(root,'tests/controlled-drugs/narcotics-finalize-browser-bindings.json'),65536);assert.equal(sha(raw),'fa3282a22c9864a979b778979d975ae1cb037d9930fedf55cd19dadeb4992d92');
 const binding=JSON.parse(raw);assert.equal(binding.kind,'fixed-narcotics-authenticated-finalize-browser-source-bindings-v1');assert.equal(Object.keys(binding.files).length,146);
 for(const[name,wanted]of Object.entries(binding.files)){assert(!name.startsWith('/')&&!name.split('/').includes('..'));const path=resolve(root,name);assert(path.startsWith(root));const data=regular(path,2*1024*1024);assert.equal(data.length,wanted.bytes);assert.equal(sha(data),wanted.sha256);}
 return sha(raw);
}
const sourcesSha=verifySources();
if(process.argv.length!==3)throw new Error('Exactly one parent-owned private proof folder required');
function proofFolder(supplied){
 const requested=resolve(supplied),requestedParent=dirname(requested),requestedRoot=dirname(requestedParent);
 const tempRoots=[resolve(tmpdir()),resolve('/tmp')];
 const canonicalRoots=new Set(tempRoots.map(p=>realpathSync(p)));
 assert(new Set([...tempRoots,...canonicalRoots]).has(requestedRoot));
 assert.equal(basename(requested),'browser-count-finalize-proof');
 assert.match(basename(requestedParent),/^lrv-genuine-count4-v2-[A-Za-z0-9_-]+$/);
 for(const dir of[requested,requestedParent]){const s=lstatSync(dir);assert(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0);}
 const canonical=realpathSync(requested),canonicalParent=dirname(canonical);
 assert.equal(basename(canonical),'browser-count-finalize-proof');
 assert.equal(basename(canonicalParent),basename(requestedParent));
 assert(canonicalRoots.has(dirname(canonicalParent)));
 return canonical;
}
const folder=proofFolder(process.argv[2]);
assert.deepEqual(readdirSync(folder).sort(),['input.json']);
let input;
try{input=narcoticsFinalizeBrowserInputSchema.parse(JSON.parse(regular(resolve(folder,'input.json'),65536,true).toString('utf8')));}catch{throw new Error('Fixed private count-browser input is invalid');}
const publicInput=narcoticsBrowserPublicInput(input),pointerKey=countOperationStorageKey(input.actorId);
const sequence=['list_controlled_count_scopes_v1','discover_controlled_counts_v1','read_controlled_count_v1','finalize_controlled_count_v1','read_controlled_count_operation_closure_v1','discover_controlled_counts_v1','read_controlled_count_v1'];
let vite,browserServer,browser,context,page,authSession,operationRequest,acceptedReceipt,pointer,closure,firstRead,lastRead;
let loginReleased=false,authReleased=false,readReleased=false,lostOnce=false,unknownShown=false,storageCleared=false,agreementShown=false,reviewExplicit=false;
let browserClosed=false,viteClosed=false,authCalls=0,optionsCount=0;const profiles={profiles:0,user_roles:0};const calls=[],profileCalls=[],evidence={},blocked=new Set();
function output(name,value){writeFileSync(resolve(folder,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function bytes(name,raw,cap=2097152){assert(Buffer.isBuffer(raw)&&raw.length<=cap);writeFileSync(resolve(folder,name),raw,{flag:'wx',mode:0o600});return{file:name,bytes:raw.length,sha256:sha(raw)};}
async function snapshot(){return page.evaluate(()=>window.__LRV_NARCOTICS_LOCAL_PROOF__?.snapshot());}
async function barrier(label,value){output(label+'-ready.json',value);const path=resolve(folder,label+'-continue.json');while(!existsSync(path))await new Promise(r=>setTimeout(r,remaining(100)));remaining();assert.deepEqual(JSON.parse(regular(path,1024,true).toString('utf8')),{kind:value.kind,passed:true});}
async function closeWithin(work,ms){let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned child cleanup timeout')),ms);})]);}finally{clearTimeout(timer);}}
const decodedHeaders=h=>Object.fromEntries(Object.entries(h).filter(([k])=>!['content-length','content-encoding','transfer-encoding','connection'].includes(k.toLowerCase())));
try{
 vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',plugins:[react()],cacheDir:resolve(folder,'vite-cache'),
  define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(input.origin),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(input.anonKey)},
  resolve:{alias:{'@':resolve(root,'src')}},server:{host:'127.0.0.1',port:64901,strictPort:true,hmr:false,open:false,
   fs:{strict:true,allow:[root,resolve(folder,'vite-cache')],deny:['**/.env','**/.env.*','**/input.json','**/*-private.json']}}});
 await vite.listen();remaining();assert.equal(vite.httpServer.address().address,'127.0.0.1');assert.equal(vite.httpServer.address().port,64901);
 browserServer=await chromium.launchServer({headless:true,host:'127.0.0.1',executablePath:chromium.executablePath(),timeout:remaining(20000)});
 output('browser-owner.json',{node_pid:process.pid,browser_pid:browserServer.process().pid,executable:chromium.executablePath(),spawnargs:browserServer.process().spawnargs});
 assert.equal(new URL(browserServer.wsEndpoint()).hostname,'127.0.0.1');browser=await chromium.connect(browserServer.wsEndpoint(),{timeout:remaining()});
 context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});
 await context.routeWebSocket('**/*',socket=>{blocked.add(new URL(socket.url()).origin);fail();socket.close();});
 async function forward(route){remaining();const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:remaining(15000)});const body=await response.body();remaining();assert(body.length<=2097152);return{response,body,headers:decodedHeaders(response.headers())};}
 await context.route('**/*',async route=>{
  try{
   const request=route.request(),url=new URL(request.url()),method=request.method(),headers=request.headers();
   if(url.origin===pageOrigin){assert(['GET','HEAD'].includes(method));await route.continue();return;}
   if(url.origin!==input.origin){blocked.add(url.origin);throw new Error('External network refused');}
   assert.equal(url.hash,'');const token=url.pathname==='/auth/v1/token',relation=url.pathname==='/rest/v1/profiles'?'profiles':url.pathname==='/rest/v1/user_roles'?'user_roles':null;
   const match=/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname),rpc=match?.[1];assert(token||relation||sequence.includes(rpc));
   if(method==='OPTIONS'){assert(++optionsCount<=16);const got=await forward(route);assert([200,204].includes(got.response.status()));await route.fulfill({status:got.response.status(),headers:got.headers,body:got.body});return;}
   assert.equal(headers.apikey,input.anonKey);
   if(token){
    assert.equal(method,'POST');assert.equal(url.search,'?grant_type=password');assert(loginReleased&&!authSession&&calls.length===0);assert.equal(++authCalls,1);
    const raw=request.postDataBuffer();assert(raw&&raw.length<=65536);const q=JSON.parse(raw.toString('utf8'));assert.equal(q.email,input.login.email);assert.equal(q.password,input.login.password);
    assert(Object.keys(q).every(k=>['email','password','gotrue_meta_security'].includes(k)));if(q.gotrue_meta_security!==undefined)assert.deepEqual(q.gotrue_meta_security,{});
    evidence.auth_request=bytes('auth-request-private.json',raw,65536);const got=await forward(route);evidence.auth_response=bytes('auth-response-private.json',got.body);assert.equal(got.response.status(),200);
    const signed=JSON.parse(got.body.toString('utf8'));assert.equal(signed.user.id,input.actorId);assert.equal(signed.user.email,input.login.email);assert.equal(signed.token_type,'bearer');assert.equal(typeof signed.refresh_token,'string');
    assert.match(signed.access_token,/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);const claims=JSON.parse(Buffer.from(signed.access_token.split('.')[1],'base64url').toString('utf8'));
    assert.equal(claims.sub,input.actorId);assert.equal(claims.role,'authenticated');assert.match(claims.session_id,/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);assert(Number.isSafeInteger(claims.exp)&&claims.exp*1000>Date.now()+180000);
    authSession={token:signed.access_token,sessionId:claims.session_id};await route.fulfill({status:200,headers:got.headers,body:got.body});return;
   }
   assert(authSession);assert.equal(headers.authorization,`Bearer ${authSession.token}`);
   if(relation){
    assert.equal(method,'GET');assert.deepEqual([...url.searchParams],relation==='profiles'?[['select','id,first_name,last_name,full_name,role,is_active'],['id',`eq.${input.actorId}`]]:[['select','role'],['user_id',`eq.${input.actorId}`]]);
    assert(++profiles[relation]<=2);const got=await forward(route);assert.equal(got.response.status(),200);const index=profileCalls.length+1;const ref=bytes(`profile-${index}-${relation}.json`,got.body);profileCalls.push({relation,status:200,evidence:ref});await route.fulfill({status:200,headers:got.headers,body:got.body});return;
   }
   assert(authReleased);assert.equal(method,'POST');assert.equal(url.search,'');assert.equal(rpc,sequence[calls.length]);
   const raw=request.postDataBuffer();assert(raw&&raw.length<=131072);const payload=JSON.parse(raw.toString('utf8'));assert.deepEqual(Object.keys(payload),['p_request']);const q=payload.p_request;
   if(rpc==='list_controlled_count_scopes_v1')assert.deepEqual(q,{schema_version:1,actor_id:input.actorId,cursor:null,page_size:100});
   else if(rpc==='discover_controlled_counts_v1')assert.deepEqual(q,{schema_version:1,actor_id:input.actorId,product_id:input.scope.product_id,site_id:input.scope.site_id,cursor:null,page_size:25});
   else if(rpc==='read_controlled_count_v1')assert.deepEqual(q,{schema_version:1,actor_id:input.actorId,count_id:input.countId});
   else if(rpc==='finalize_controlled_count_v1'){
    assert(readReleased&&reviewExplicit&&!operationRequest);operationRequest=parseCountRequest('finalize',q);assert.equal(q.actor_id,input.actorId);assert.equal(q.count_id,input.countId);
   }else{
    assert(lostOnce&&unknownShown&&operationRequest);assert.deepEqual(q,{schema_version:1,actor_id:input.actorId,operation_id:operationRequest.operation_id,original_action:'finalize',scope_id:input.countId,product_id:input.scope.product_id,site_id:input.scope.site_id});
   }
   const index=calls.length+1,requestRef=bytes(`rpc-${index}-request.json`,raw,131072);const headerRef=bytes(`rpc-${index}-headers-private.json`,Buffer.from(JSON.stringify(headers)),65536);
   calls.push({rpc,method,request:requestRef,headers:headerRef});const got=await forward(route);const responseRef=bytes(`rpc-${index}-response.json`,got.body);calls[index-1].response=responseRef;calls[index-1].status=got.response.status();assert.equal(got.response.status(),200);
   assert.match(got.response.headers()['content-type']??'',/^application\/json(?:;|$)/i);
   if(rpc==='list_controlled_count_scopes_v1'){
    const list=parseCountScopeReply(got.body,q);assert(list.items.some(x=>x.product_id===input.scope.product_id&&x.site_id===input.scope.site_id));
   }else if(rpc==='discover_controlled_counts_v1'){
    const list=parseCountDiscoveryReply(got.body,q);assert.equal(list.counts.length,1);assert.equal(list.counts[0].count_id,input.countId);assert(list.capabilities.manage&&list.available_actions.includes('finalize'));assert(list.counts[0].participants.every(p=>p.submitted));
    assert.equal(list.counts[0].history_state,index===2?'open':'agreement');
   }else if(rpc==='read_controlled_count_v1'){
    const read=await verifyCountReadReply(new Uint8Array(got.body),q);assert.equal(read.data.product.id,input.scope.product_id);assert.equal(read.data.site.id,input.scope.site_id);assert(read.data.participants.every(p=>p.submitted));assert.equal(read.data.comparison?.agreement,true);
    if(index===3){firstRead=read;assert.equal(read.data.history_state,'collecting');assert.equal(read.data.current_boundary_state,'unchanged');assert.equal(read.data.terminal,null);}
    else{lastRead=read;assert.equal(read.data.history_state,'agreement');assert.equal(read.data.terminal.kind,'outcome');assert.equal(read.data.terminal.id,operationRequest.outcome_id);}
   }else if(rpc==='finalize_controlled_count_v1'){
    const saved=await verifyCountSavedReply('finalize',operationRequest,{schema_version:1,state:'saved',data:{receipt:decodeCountPublicReceipt(new Uint8Array(got.body))}});acceptedReceipt=saved.data.receipt;
    assert(!lostOnce);lostOnce=true;await route.abort('failed');return;
   }else{
    closure=await verifyCountOperationClosureReply(new Uint8Array(got.body),q);assert.equal(closure.state,'saved');assert.equal(closure.operation_id,operationRequest.operation_id);assert.deepEqual(closure.receipt,acceptedReceipt);
   }
   await route.fulfill({status:200,headers:got.headers,body:got.body});
  }catch(error){noteFailure(error,'route');fail();await route.abort().catch(()=>{});}
 });
 // Only the four PUBLIC harness fields are passed. Login/count IDs remain in
 // Node memory/private input, never in a source file, query or initScript.
 await context.addInitScript(value=>Object.defineProperty(window,'__LRV_NARCOTICS_LOCAL_INPUT__',{value}),publicInput);
 page=await context.newPage();page.setDefaultTimeout(remaining());page.on('pageerror',error=>{noteFailure(error,'page');fail();});
 page.on('dialog',dialog=>{fail();void dialog.dismiss().catch(()=>{});});
 await page.goto(pageOrigin+'/tests/controlled-drugs/narcotics-authenticated-fixture.html',{waitUntil:'networkidle',timeout:remaining(30000)});
 await expect(page.getByLabel('Email',{exact:true})).toBeVisible({timeout:remaining()});assert.equal(authCalls,0);assert.equal(calls.length,0);
 await page.getByLabel('Email',{exact:true}).fill(input.login.email);await page.getByLabel('Password',{exact:true}).fill(input.login.password);loginReleased=true;await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect.poll(async()=>!!(await snapshot())?.actorId,{timeout:remaining()}).toBe(true);const identity=await snapshot();assert.equal(identity.actorId,input.actorId);assert.equal(identity.sessionId,authSession.sessionId);assert.equal(authCalls,1);assert(profiles.profiles>=1&&profiles.user_roles>=1);await expect(page.locator('input[type="password"]')).toHaveCount(0,{timeout:remaining()});
 await barrier('auth-phase',{kind:'closed-count-browser-auth-v1',actor_id:input.actorId,session_id:authSession.sessionId,evidence:{...evidence},profile_calls:[...profileCalls],calls:[]});authReleased=true;
 await page.getByRole('button',{name:'Load authorized medication and site',exact:true}).click();await expect(page.getByRole('button',{name:'Load counts',exact:true})).toBeVisible({timeout:remaining()});assert.equal(calls.length,1);
 await page.getByRole('button',{name:'Load counts',exact:true}).click();await expect(page.getByRole('button',{name:'Open count',exact:true})).toHaveCount(1,{timeout:remaining()});await page.getByRole('button',{name:'Open count',exact:true}).click();
 const record=page.getByRole('region',{name:'Recorded stock count',exact:true});await expect(record).toBeVisible({timeout:remaining()});await expect(record.getByRole('region',{name:'Count comparison',exact:true})).toBeVisible({timeout:remaining()});assert(firstRead);assert.equal(calls.length,3);
 await barrier('read-phase',{kind:'closed-count-browser-read-v1',actor_id:input.actorId,session_id:authSession.sessionId,count_id:input.countId,calls:[...calls]});readReleased=true;
 assert.equal(await page.evaluate(key=>localStorage.getItem(key),pointerKey),null);
 const reviewed=page.getByRole('checkbox',{name:'I reviewed both recorded observations.',exact:true});await reviewed.check();reviewExplicit=true;await page.getByRole('button',{name:'Finalize count',exact:true}).click();
 await expect(page.getByRole('region',{name:'Pending count save',exact:true})).toBeVisible({timeout:remaining()});await expect(page.getByText('The result could not be confirmed. Check pending-save recovery before recording anything else.',{exact:true})).toBeVisible({timeout:remaining()});assert(lostOnce&&operationRequest);assert.equal(calls.length,4);unknownShown=true;
 const rawPointer=await page.evaluate(key=>localStorage.getItem(key),pointerKey);assert(rawPointer&&rawPointer.length<=4096);pointer=parseCountOperationClosureRequest(JSON.parse(rawPointer));assert.deepEqual(pointer,{schema_version:1,actor_id:input.actorId,operation_id:operationRequest.operation_id,original_action:'finalize',scope_id:input.countId,product_id:input.scope.product_id,site_id:input.scope.site_id});output('retained-id-only-pointer.json',pointer);
 await page.getByRole('button',{name:'Check original save',exact:true}).click();await expect(page.getByText('The original action was recorded.',{exact:true})).toBeVisible({timeout:remaining()});await expect(page.getByRole('region',{name:'Pending count save',exact:true})).toHaveCount(0,{timeout:remaining()});assert.equal(await page.evaluate(key=>localStorage.getItem(key),pointerKey),null);storageCleared=true;assert(closure);assert.equal(calls.length,5);
 await page.getByRole('button',{name:'Refresh count list',exact:true}).click();await expect(page.getByRole('button',{name:'Open count',exact:true})).toHaveCount(1,{timeout:remaining()});await page.getByRole('button',{name:'Open count',exact:true}).click();await expect(page.getByText('Count agrees',{exact:true})).toBeVisible({timeout:remaining()});assert(lastRead);assert.equal(calls.length,7);agreementShown=true;
 await expect(page.locator('input[type="password"]')).toHaveCount(0,{timeout:remaining()});await expect(page.getByLabel('Email',{exact:true})).toHaveCount(0,{timeout:remaining()});await page.screenshot({path:resolve(folder,'agreement-after-recovery.png'),fullPage:true});remaining();
}catch(error){noteFailure(error,'workflow');fail();}finally{
 let bad=false;
 try{if(context)await closeWithin(()=>context.close(),4000);}catch{bad=true;fail();}
 try{if(browser)await closeWithin(()=>browser.close(),4000);}catch{bad=true;fail();}
 try{if(browserServer){try{await closeWithin(()=>browserServer.close(),3000);}catch{await closeWithin(()=>browserServer.kill(),3000);throw new Error('Normal owned browser cleanup failed');}assert(browserServer.process().exitCode!==null||browserServer.process().signalCode!==null);}browserClosed=!bad;}catch{fail();}
 try{if(vite){await closeWithin(()=>vite.close(),5000);assert.equal(vite.httpServer.listening,false);}viteClosed=true;}catch{fail();}
 try{assert.equal(verifySources(),sourcesSha);}catch{fail();}
 if(performance.now()>=deadline||authCalls!==1||profiles.profiles<1||profiles.user_roles<1||!authReleased||!readReleased||!reviewExplicit||!lostOnce||!unknownShown||!storageCleared||!agreementShown||!acceptedReceipt||!closure||!lastRead||blocked.size||calls.length!==7||calls.some(c=>c.status!==200))fail();
 output('result.json',{kind:'closed-local-count-finalize-ack-loss-browser-v1',failure_diagnostics:failureDiagnostics,passed:!failure&&browserClosed&&viteClosed,actor_id:input.actorId,session_id:authSession?.sessionId??null,count_id:input.countId,operation_id:operationRequest?.operation_id??null,outcome_id:operationRequest?.outcome_id??null,source_binding_sha256:sourcesSha,auth_calls:authCalls,profile_calls:profileCalls,options_count:optionsCount,calls,auth_phase_released:authReleased,read_phase_released:readReleased,review_both_explicit:reviewExplicit,actual_finalize_200_then_ack_lost_once:lostOnce,unknown_UI_shown:unknownShown,id_only_pointer_retained:!!pointer,saved_closure_observed:!!closure,storage_cleared:storageCleared,agreement_UI_read:agreementShown,blocked_origins:[...blocked].sort(),normal_browser_cleanup:browserClosed,normal_vite_cleanup:viteClosed,decoded_entity_proxy:true,elapsed_seconds:(performance.now()-started)/1000,full_Auth_or_count_kernel_or_browser_or_physical_or_production_acceptance:false});
}
function finalCutoff(){if(performance.now()<deadline)return;fail();output('post-persistence-cutoff-failure.json',{passed:false,candidate_result_not_acceptance:true});throw new Error('Original count-browser120s cutoff exceeded');}
finalCutoff();if(failure)throw new Error('Closed count browser phase failed; private evidence retained');console.log('Closed count browser phase returned; parent source/metadata/Auth/data admission remains required.');finalCutoff();
