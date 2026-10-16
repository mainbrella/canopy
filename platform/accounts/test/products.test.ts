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
    assert.deepEqual(await (await f.request("/products/voice",{headers:{cookie}})).json(),anonymous);
    assert.equal((await f.request("/products/voice",{method:"POST",headers:{cookie,origin}})).status,405);
  }
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS count FROM product_installations").get()!.count,1);
  assert.equal((await f.request("/products/voice/open",{method:"POST",headers:{origin}})).status,401);
});

test("opening Voice uses the authenticated identity and a bounded private server handoff",async t=>{
  const f=fixture(t); installed(f);
  const login=await f.login(); const {user}=await login.clone().json();
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
  const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const sessionHash=f.sqlite.prepare("SELECT token_hash FROM sessions").get()!.token_hash;
  const call=(authorization:string)=>f.request("/internal/voice/session",{method:"POST",headers:{authorization,"content-type":"application/json"},body:JSON.stringify({sessionHash})});
  assert.equal((await call("Bearer wrong")).status,401);
  assert.deepEqual(await (await call(`Bearer ${secret}`)).json(),{user:{id:user.id}});
  await f.request("/auth/logout",{method:"POST",headers:{cookie,origin}});
  assert.deepEqual(await (await call(`Bearer ${secret}`)).json(),{user:null});
});
