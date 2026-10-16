import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { handleCanopy } from "../worker/app/canopy";
import { currentUser, handleAuth, hashToken } from "../worker/app/auth-core";
import { handleVoiceRequest } from "../worker/app/voice";
import type { Env } from "../worker/env";

const origin="https://voice.example", secret="a".repeat(64), sessionHash="b".repeat(64);
async function fixture(t:TestContext){
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"handoff-test",modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-18",d1Databases:["DB"]}]}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database("DB");
  const migrations=new URL("../migrations/",import.meta.url);
  for(const file of readdirSync(migrations).filter(file=>file.endsWith(".sql")).sort()){
    const sql=readFileSync(new URL(file,migrations),"utf8").replace(/^--.*$/gm,"").split(";").map(part=>part.trim()).filter(Boolean);
    await db.batch(sql.map(sql=>db.prepare(sql)));
  }
  const env={DB:db,VOICE_AUTH_MODE:"canopy",CANOPY_AUTH_SECRET:secret,CANOPY_ACCOUNTS_ORIGIN:"https://accounts.example",CANOPY_CONSOLE_ORIGIN:"https://console.example",CANOPY_INSTALLATION_ID:"installation",CANOPY_SOURCE_VERSION:"v1",VOICE_ENABLED:"true",AI:{},RECEPTIONIST_CALL:{}} as unknown as Env;
  let valid=true;
  t.mock.method(globalThis,"fetch",async (_url:unknown,init:RequestInit)=>{
    assert.equal((init.headers as Record<string,string>).authorization,`Bearer ${secret}`);
    const {sessionHash:hash}=JSON.parse(String(init.body));
    return Response.json({user:valid?{id:hash===sessionHash?"user-one":"user-two"}:null});
  });
  const issue=async(userId="user-one",hash=sessionHash)=>{
    const response=await handleCanopy(new Request(`${origin}/_canopy/handoffs`,{method:"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/json"},body:JSON.stringify({installationId:"installation",userId,sessionHash:hash})}),env);
    assert.equal(response.status,201); return (await response.json() as {code:string}).code;
  };
  const exchange=(code:string,from=origin)=>handleCanopy(new Request(`${origin}/auth/canopy`,{method:"POST",headers:{origin:from,"content-type":"application/json"},body:JSON.stringify({code})}),env);
  return{db,env,issue,exchange,revoke(){valid=false;}};
}

test("Canopy handoffs are hashed, expire, and exchange atomically only on their own origin",async t=>{
  const f=await fixture(t); const code=await f.issue();
  assert.equal((await f.db.prepare("SELECT token_hash FROM canopy_handoffs").first())!.token_hash,await hashToken(code));
  assert.equal((await f.exchange(code,"https://evil.example")).status,403);
  const exchanges=await Promise.all([f.exchange(code),f.exchange(code)]);
  assert.deepEqual(exchanges.map(response=>response.status).sort(),[204,401]);
  const cookie=exchanges.find(response=>response.status===204)!.headers.get("set-cookie")!;
  assert.match(cookie,/^__Host-canopy_voice_session=/);
  assert.match(cookie,/HttpOnly; SameSite=Strict/);
  assert.match(cookie,/Secure/);
  assert.doesNotMatch(cookie,/Domain=/);
  assert.equal((await currentUser(f.env,new Request(origin,{headers:{cookie}})))!.id,"user-one");
  const expired=await f.issue();
  await f.db.prepare("UPDATE canopy_handoffs SET expires_at=0").run();
  assert.equal((await f.exchange(expired)).status,401);
  f.revoke();
  assert.equal(await currentUser(f.env,new Request(origin,{headers:{cookie}})),null);
});

test("Canopy users have distinct workspaces and cannot use the standalone owner password",async t=>{
  const f=await fixture(t);
  const cookies=[];
  for(const [id,hash] of [["user-one",sessionHash],["user-two","c".repeat(64)]]){
    const response=await f.exchange(await f.issue(id,hash));
    cookies.push(response.headers.get("set-cookie")!.split(";")[0]);
  }
  const request=(cookie:string,method:string,body?:unknown)=>handleVoiceRequest(new Request(`${origin}/voice/agent`,{method,headers:{cookie,origin,"content-type":"application/json"},body:body?JSON.stringify(body):undefined}),f.env,{} as ExecutionContext);
  const agent={name:"Maya",businessName:"First workspace",greeting:"Hello",instructions:"Take a message",voice:"asteria",transferNumber:null};
  assert.equal((await request(cookies[0],"PUT",agent)).status,200);
  assert.deepEqual(await(await request(cookies[1],"GET")).json(),{agent:null});
  assert.equal((await request(cookies[1],"PUT",{...agent,businessName:"Second workspace"})).status,200);
  assert.equal((await(await request(cookies[0],"GET")).json() as any).agent.businessName,"First workspace");
  const rows=(await f.db.prepare("SELECT id,user_id FROM voice_agents").all()).results;
  assert.equal(new Set(rows.map(row=>row.id)).size,2);
  assert.equal((await handleAuth(new Request(`${origin}/auth/login`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({password:"does not matter"})}),f.env)).status,503);
  assert.equal((await handleCanopy(new Request(`${origin}/_canopy/ready`),f.env)).status,401);
  assert.equal((await handleCanopy(new Request(`${origin}/_canopy/ready`,{headers:{authorization:`Bearer ${secret}`}}),f.env)).status,200);
});
