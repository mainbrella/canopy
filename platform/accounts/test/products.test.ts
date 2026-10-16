import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";

const origin = "http://127.0.0.1:5175";
const secret = "a".repeat(64);
function installed(f: ReturnType<typeof fixture>, state = "installed") {
  f.env.VOICE_AUTH_SECRET = secret;
  f.sqlite.prepare(`INSERT INTO product_installations(product,installation_id,account_id,worker_name,database_id,origin,version,source_revision,state,updated_at)
    VALUES('voice','instance-install','account','canopy-voice','dedicated-db','https://voice.example','test-version','source',?,?)`).run(state,new Date().toISOString());
}

test("installation discovery is instance-wide and ordinary accounts cannot provision it", async t => {
  const f = fixture(t);
  assert.equal((await (await f.request("/products/voice")).json()).state,"not_installed");
  installed(f);
  t.mock.method(globalThis,"fetch",async () => Response.json({ready:true,installationId:"instance-install",version:"test-version"}));
  const anonymous = await (await f.request("/products/voice")).json();
  assert.equal(anonymous.state,"ready");
  for (const email of ["one@example.com","two@example.com"]) {
    const cookie = (await f.login(email)).headers.get("set-cookie")!.split(";")[0];
    const status=await (await f.request("/products/voice",{headers:{cookie}})).json();
    assert.equal(status.state,anonymous.state);
    assert.equal(status.access,"denied");
    assert.equal(status.canInstall,false);
    assert.equal((await f.request("/products/voice",{method:"POST",headers:{cookie,origin}})).status,405);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM product_installations").get()!.count,1);
  assert.equal((await f.request("/products/voice/open",{method:"POST",headers:{origin}})).status,401);
});

test("opening Voice uses the authenticated identity and a bounded private server handoff",async t=>{
  const f=fixture(t); installed(f);
  const login=await f.login(); const {user}=await login.clone().json();
  f.env.OPERATOR_USER_ID=user.id; f.env.VOICE_BILLING_MODE="owner_funded";
  const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const calls:Array<{url:string;body?:Record<string,unknown>}>=[];
  t.mock.method(globalThis,"fetch",async (url:string,init:RequestInit)=>{
    assert.equal(init.redirect,"manual");
    assert.equal((init.headers as Record<string,string>).authorization,`Bearer ${secret}`);
    calls.push({url,body:init.body?JSON.parse(String(init.body)):undefined});
    return Response.json(url.endsWith("/ready")?{ready:true,installationId:"instance-install",version:"test-version"}:{code:"b".repeat(64)});
  });
  assert.equal((await f.request("/products/voice/open",{method:"POST",headers:{cookie}})).status,403);
  assert.equal((await f.request("/products/voice/open",{method:"POST",headers:{cookie,origin:"https://evil.example"}})).status,403);
  const response=await f.request("/products/voice/open",{method:"POST",headers:{cookie,origin}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"no-store");
  assert.deepEqual(await response.json(),{url:`https://voice.example/handoff.html#${"b".repeat(64)}`});
  assert.equal(calls[1].body!.userId,user.id);
  assert.match(calls[1].body!.sessionHash as string,/^[a-f0-9]{64}$/);
  assert.notEqual(calls[1].body!.sessionHash,cookie.split("=")[1]);
});

test("pending, failed, unreachable and mismatched installations never report readiness",async t=>{
  const f=fixture(t); installed(f,"installing");
  assert.equal((await (await f.request("/products/voice")).json()).state,"installing");
  f.sqlite.exec("UPDATE product_installations SET state='failed'");
  assert.equal((await (await f.request("/products/voice")).json()).state,"failed");
  f.sqlite.exec("UPDATE product_installations SET state='installed'");
  const fetcher=t.mock.method(globalThis,"fetch",async()=>Response.json({ready:true,installationId:"wrong",version:"test-version"}));
  assert.equal((await (await f.request("/products/voice")).json()).state,"unavailable");
  fetcher.mock.mockImplementation(async()=>{throw new Error("private provider failure");});
  const response=await f.request("/products/voice");
  assert.equal((await response.clone().json()).state,"unavailable");
  assert.doesNotMatch(await response.text(),/provider|secret|account/);
});

test("private session checks require the operator secret and reflect logout immediately",async t=>{
  const f=fixture(t); installed(f);
  const login=await f.login(); const {user}=await login.clone().json();
  f.env.OPERATOR_USER_ID=user.id; f.env.VOICE_BILLING_MODE="owner_funded";
  const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const sessionHash=f.sqlite.prepare("SELECT token_hash FROM sessions").get()!.token_hash;
  const call=(authorization:string)=>f.request("/internal/voice/session",{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify({sessionHash})});
  assert.equal((await call("Bearer wrong")).status,401);
  assert.deepEqual(await (await call(`Bearer ${secret}`)).json(),{user:{id:user.id}});
  await f.request("/auth/logout",{method:"POST",headers:{cookie,origin}});
  assert.deepEqual(await (await call(`Bearer ${secret}`)).json(),{user:null});
});

test("public signup confers neither provisioning nor paid access; grants and revocations apply immediately",async t=>{
  const f=fixture(t); installed(f);
  const login=await f.login('operator@example.com');const {user:operator}=await login.clone().json();
  const ownerCookie=login.headers.get('set-cookie')!.split(';')[0];
  const signup=await f.login('public@example.com');const {user}=await signup.clone().json();
  const cookie=signup.headers.get('set-cookie')!.split(';')[0];
  f.env.OPERATOR_USER_ID=operator.id;f.env.VOICE_BILLING_MODE='owner_funded';f.env.VOICE_INSTALL_ENABLED='true';
  const post=(path:string,session:string,body?:unknown)=>f.request(path,{method:'POST',headers:{cookie:session,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  let fetches=0;
  t.mock.method(globalThis,'fetch',async()=>{fetches++;return Response.json({ready:true,installationId:'instance-install',version:'test-version'});});
  assert.equal((await post('/products/voice/open',cookie)).status,403);assert.equal(fetches,0);
  assert.equal((await post('/products/voice/install',cookie)).status,403);
  assert.equal((await post('/products/voice/access',cookie,{userId:user.id,allowed:true})).status,403);
  assert.equal((await post('/products/voice/access',ownerCookie,{userId:user.id,allowed:true})).status,200);
  const sessionHash=f.sqlite.prepare('SELECT token_hash FROM sessions WHERE user_id=?').get(user.id)!.token_hash;
  const check=()=>f.request('/internal/voice/session',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({sessionHash})});
  assert.deepEqual(await(await check()).json(),{user:{id:user.id}});
  const authorize=()=>f.request('/internal/voice/authorize',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({userId:user.id})});
  assert.equal((await authorize()).status,200);
  f.env.VOICE_BILLING_MODE='managed';
  assert.equal((await authorize()).status,403);assert.deepEqual(await(await check()).json(),{user:null});
  f.env.VOICE_BILLING_MODE='owner_funded';
  assert.equal((await post('/products/voice/access',ownerCookie,{userId:user.id,allowed:false})).status,200);
  assert.deepEqual(await(await check()).json(),{user:null});
});

test("operator installation requests persist, deduplicate, and retry without client credentials",async t=>{
  const f=fixture(t); const login=await f.login();const {user}=await login.clone().json();
  f.env.OPERATOR_USER_ID=user.id;f.env.VOICE_BILLING_MODE='owner_funded';f.env.VOICE_INSTALL_ENABLED='true';
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const install=()=>f.request('/products/voice/install',{method:'POST',headers:{cookie,origin}});
  const replies=await Promise.all([install(),install()]);
  assert.deepEqual(replies.map(response=>response.status),[202,202]);
  const [a,b]=await Promise.all(replies.map(response=>response.json()));
  assert.equal(a.request_id,b.request_id);
  assert.equal((await(await f.request('/products/voice',{headers:{cookie}})).json()).state,'pending');
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM product_install_requests').get()!.n,1);
  f.sqlite.exec("UPDATE product_install_requests SET state='failed'");
  assert.equal((await(await install()).json()).request_id,a.request_id);
  assert.equal((await f.request('/products/voice/install',{method:'POST',headers:{cookie}})).status,403);
});
