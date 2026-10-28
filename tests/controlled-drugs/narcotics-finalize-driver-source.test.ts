/** Offline source/value controls: no services, HTTP, browser or Auth proof. */
import assert from'node:assert/strict';import{test}from'node:test';import{readFileSync}from'node:fs';import ts from'typescript';import{createHash}from'node:crypto';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
import{narcoticsFinalizeBrowserInputSchema as schema,narcoticsBrowserPublicInput as publicInput}from'./narcotics-finalize-browser-input.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const anon=[Buffer.from('{}').toString('base64url'),Buffer.from('{"role":"anon"}').toString('base64url'),'source-only'].join('.');
const value={origin:'http://127.0.0.1:64661',anonKey:anon,actorId:id(1),scope:{product_id:id(2),site_id:id(3)},countId:id(4),login:{email:'lrv-closed-0123456789abcdef-0@example.invalid',password:'A'.repeat(40)}};
const source=readFileSync(new URL('./run-local-authenticated-count-finalize.mjs',import.meta.url),'utf8');
function has(...terms:string[]){for(const term of terms)assert(source.includes(term),term);}
test('strict private owner input and exact known synthetic credentials',()=>{
 assert(schema.safeParse(value).success);
 for(const password of ['A'.repeat(39),'A'.repeat(41),'x'.repeat(39)+'!'])assert(!schema.safeParse({...value,login:{...value.login,password}}).success);
 for(const email of ['real@example.com','lrv-closed-0123456789abcdef-2@example.invalid'])assert(!schema.safeParse({...value,login:{...value.login,email}}).success);
 for(const key of ['session','accessToken','deadline','browserPort'])assert(!schema.safeParse({...value,[key]:'untrusted'}).success);
});
test('initScript has only original public four fields, never login or countID',()=>{
 const p=publicInput(value);assert.deepEqual(Object.keys(p).sort(),['actorId','anonKey','origin','scope']);assert(!JSON.stringify(p).includes(value.login.password));assert(!('countId'in p));has("'__LRV_NARCOTICS_LOCAL_INPUT__',{value}),publicInput)");
});
test('syntax and fixed120s phase reserve, ports and no env-file fallback',()=>{
 const tree=ts.createSourceFile('driver.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);assert.equal(tree.parseDiagnostics.length,0);
 has("pageOrigin='http://127.0.0.1:64901'",'deadline=started+120000','deadline-performance.now()-30000','configFile:false,envFile:false','strictPort:true');assert(!source.includes('process.env.'));
});
test('bounded nonblocking regular FD reads and private output',()=>{
 has('constants.O_NOFOLLOW','constants.O_NONBLOCK','fstatSync(fd)','readFileSync(fd)','a.mtimeMs,b.mtimeMs',"regular(path,1024,true)","flag:'wx',mode:0o600","readdirSync(folder).sort(),['input.json']");
});
test('actual UI login and broker identity, no preload',()=>{
 has("getByLabel('Email'","getByLabel('Password'","name:'Sign in'","await barrier('auth-phase'",'assert.equal(claims.sub,input.actorId)','identity.sessionId,authSession.sessionId');
 for(const term of ['.auth.setSession(','.setExtraHTTPHeaders(','storageState:','addCookies('])assert(!source.includes(term));
});
test('real forwarding zero retry/redirect, websocket and private-file confinement',()=>{
 has('route.fetch({maxRedirects:0,maxRetries:0,timeout:remaining(15000)})','headers.authorization,`Bearer ${authSession.token}`','body:got.body',"context.routeWebSocket('**/*'","serviceWorkers:'block'","deny:['**/.env','**/.env.*','**/input.json','**/*-private.json']");assert(!source.includes('route.fulfill({json:'));
});
test('actual200 receipt retained and verified before one response loss',()=>{
 assert.equal((source.match(/route\.abort\('failed'\)/g)||[]).length,1);has('assert(!lostOnce);lostOnce=true;');
 assert(source.indexOf('const saved=await verifyCountSavedReply')<source.indexOf("route.abort('failed')"));assert(source.indexOf('const responseRef=bytes')<source.indexOf("route.abort('failed')"));
});
test('strict seven real business calls, no retries/extra mutations',()=>{
 const m=/const sequence=(\[[^;]+\]);/.exec(source);assert(m);assert.deepEqual(Function('return '+m[1])(),['list_controlled_count_scopes_v1','discover_controlled_counts_v1','read_controlled_count_v1','finalize_controlled_count_v1','read_controlled_count_operation_closure_v1','discover_controlled_counts_v1','read_controlled_count_v1']);has('assert.equal(rpc,sequence[calls.length])','calls.length!==7');
});
test('actual unknown UI, ID-only7 pointer, same saved receipt and agreement outcome',()=>{
 has("name:'Pending count save'","name:'Check original save'",'pointer=parseCountOperationClosureRequest',"original_action:'finalize'",'storageCleared=true','assert.deepEqual(closure.receipt,acceptedReceipt)','read.data.terminal.id,operationRequest.outcome_id');assert(!source.includes('localStorage.setItem('));
});
test('owned normal cleanup and post-persistence cutoff, no failure screenshot',()=>{
 has('context.close()','browser.close()','browserServer.close()','browserServer.kill()','vite.close()','assert.equal(verifySources(),sourcesSha)','post-persistence-cutoff-failure.json','full_Auth_or_count_kernel_or_browser_or_physical_or_production_acceptance:false');assert.equal((source.match(/page\.screenshot\(/g)||[]).length,1);
});

test('canonical OS temp roots admit Mac aliases and Linux, refuse escapes and symlink leaves',async()=>{
 const path=await import('node:path');
 const block=source.slice(source.indexOf('function proofFolder('),source.indexOf('const folder=proofFolder'));
 function model(osTemp:string,aliases:Record<string,string>,candidate:string,bad?:string){
  const real=(p:string)=>{for(const [from,to]of Object.entries(aliases).sort((a,b)=>b[0].length-a[0].length))if(p===from||p.startsWith(from+'/'))return to+p.slice(from.length);return p;};
  const stat=(p:string)=>({isDirectory:()=>true,isSymbolicLink:()=>p===bad,uid:501,mode:0o40700});
  return Function('assert','resolve','dirname','basename','tmpdir','realpathSync','lstatSync','process',block+'return proofFolder(arguments[8]);')(assert,path.resolve,path.dirname,path.basename,()=>osTemp,real,stat,{getuid:()=>501},candidate);
 }
 const run='lrv-genuine-count4-v2-Ab_09',proof='browser-count-finalize-proof';
 for(const prefix of ['/tmp','/private/tmp','/var/folders/j9/task/T','/private/var/folders/j9/task/T']){
  const aliases={'/tmp':'/private/tmp','/var':'/private/var'};
  const expected=prefix.replace(/^\/tmp/,'/private/tmp').replace(/^\/var/,'/private/var');
  assert.equal(model('/var/folders/j9/task/T',aliases,`${prefix}/${run}/${proof}`),`${expected}/${run}/${proof}`);
 }
 assert.equal(model('/tmp',{},`/tmp/${run}/${proof}`),`/tmp/${run}/${proof}`);
 for(const candidate of [`/home/user/${run}/${proof}`,`/tmp/nested/${run}/${proof}`,`/tmp/../home/${run}/${proof}`,`/tmp/other/${proof}`,`/tmp/${run}/wrong`])assert.throws(()=>model('/tmp',{},candidate));
 assert.throws(()=>model('/tmp',{'/custom':'/tmp'},`/custom/${run}/${proof}`));
 for(const leaf of [`/tmp/${run}`,`/tmp/${run}/${proof}`])assert.throws(()=>model('/tmp',{},`/tmp/${run}/${proof}`,leaf));
 assert.throws(()=>model('/tmp',{['/tmp/'+run]:'/outside/'+run},`/tmp/${run}/${proof}`));
});
test('V2 operative driver has exact V1 inverse except OS temp import and validation block',()=>{
 const inverse=JSON.parse(readFileSync(new URL('./narcotics-finalize-portability-inverse.json',import.meta.url),'utf8'));
 const restored=source.replace('\n'+inverse.added_import,'').replace(inverse.new_block,inverse.old_block);
 const crypto=requireCryptoForInverse();
 assert.equal(crypto(restored),inverse.source_v1_driver_sha256);assert.equal(crypto(source),inverse.source_v2_driver_sha256);
 function requireCryptoForInverse(){return (text:string)=>{assert.equal(typeof text,'string');return hash(text);};}
});
