import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { handleCanopy } from "../worker/app/canopy";
import { currentUser, handleAuth, hashToken } from "../worker/app/auth-core";
import { handleVoiceRequest } from "../worker/app/voice";
import type { Env } from "../worker/env";

const origin="https://voice.example", secret="a".repeat(64), sessionHash="b".repeat(64);
async function fixture(t:TestContext,mounted=false){
  const origin=mounted?"https://console.example":"https://voice.example";
  const base=mounted?"/installed/voice":"";
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"handoff-test",modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-09-18",d1Databases:["DB"]}]}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database("DB");
  const migrations=new URL("../migrations/",import.meta.url);
  for(const file of readdirSync(migrations).filter(file=>file.endsWith(".sql")).sort()){
    const sql=readFileSync(new URL(file,migrations),"utf8").replace(/^--.*$/gm,"").split(";").map(part=>part.trim()).filter(Boolean);
    await db.batch(sql.map(sql=>db.prepare(sql)));
  }
  const env={DB:db,VOICE_AUTH_MODE:"canopy",CANOPY_AUTH_SECRET:secret,CANOPY_ACCOUNTS_ORIGIN:"https://accounts.example",CANOPY_CONSOLE_ORIGIN:"https://console.example",CANOPY_INSTALLATION_ID:"installation",CANOPY_SOURCE_VERSION:"v1",VOICE_ENABLED:"true",VOICE_BASE_PATH:base,VOICE_PUBLIC_ORIGIN:origin,AI:{},RECEPTIONIST_CALL:{}} as unknown as Env;
  let valid=true;
  t.mock.method(globalThis,"fetch",async (_url:unknown,init:RequestInit)=>{
    assert.equal((init.headers as Record<string,string>).authorization,`Bearer ${secret}`);
    const {sessionHash:hash}=JSON.parse(String(init.body));
    return Response.json({user:valid?{id:hash===sessionHash?"user-one":"user-two"}:null});
  });
  const issue=async(userId="user-one",hash=sessionHash)=>{
    const response=await handleCanopy(new Request(`${origin}${base}/_canopy/handoffs`,{method:"POST",headers:{authorization:`Bearer ${secret}`,"content-type":"application/json"},body:JSON.stringify({installationId:"installation",userId,sessionHash:hash})}),env);
    assert.equal(response.status,201); return (await response.json() as {code:string}).code;
  };
  const exchange=(code:string,from=origin)=>handleCanopy(new Request(`${origin}${base}/auth/canopy`,{method:"POST",headers:{origin:from,"content-type":"application/json"},body:JSON.stringify({code})}),env);
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

test('mounted routing preserves sessions, strips only asset paths, and redirects the old host',async t=>{
  const f=await fixture(t,true);
  const {handleRequest}=await import('../worker/app/router');
  const response=await f.exchange(await f.issue());
  const cookie=response.headers.get('set-cookie')!.split(';')[0];
  assert.match(response.headers.get('set-cookie')!,/Path=\/; HttpOnly; SameSite=Strict.*Secure/);
  const request=(path:string,options:RequestInit={})=>handleRequest(new Request(`https://console.example${path}`,options),f.env,{} as ExecutionContext);
  assert.equal((await(await request('/installed/voice/auth/session',{headers:{cookie}})).json() as any).user.id,'user-one');
  f.env.ASSETS={fetch:async(request:Request)=>new Response(new URL(request.url).pathname)} as unknown as Env['ASSETS'];
  assert.equal(await(await request('/installed/voice/base.css')).text(),'/base.css');
  f.env.ASSETS={fetch:async()=>Response.redirect('https://console.example/handoff',307)} as unknown as Env['ASSETS'];
  assert.equal((await request('/installed/voice/handoff.html')).headers.get('location'),'https://console.example/installed/voice/handoff');
  assert.equal((await request('/auth/session')).status,404);
  assert.equal((await request('/installed/voice-other/auth/session')).status,404);
  assert.equal((await request('/installed/voice/agents/private')).status,404);
  assert.equal((await request('/installed/voice')).headers.get('location'),'https://console.example/installed/voice/');
  f.env.VOICE_LEGACY_ORIGIN='https://old-voice.example';
  const moved=await handleRequest(new Request('https://old-voice.example/'),f.env,{} as ExecutionContext);
  assert.equal(moved.status,308);assert.equal(moved.headers.get('location'),'https://console.example/installed/voice/');
  f.revoke();
  assert.equal((await request('/installed/voice/voice/agent',{headers:{cookie}})).status,401);
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

test('instance call limits are atomic across workspaces and usage authorization fails closed',async t=>{
  const f=await fixture(t);
  const {createCall}=await import('../worker/lib/voice');
  const config={id:crypto.randomUUID(),name:'Maya',businessName:'Workshop',greeting:'Hello',instructions:'Take a message',voice:'asteria',voiceLogic:'original_no_reply',model:'aura-1',language:'en',transferNumber:null,updatedAt:new Date().toISOString()} as const;
  let allowed=true;
  t.mock.method(globalThis,'fetch',async()=>Response.json({allowed,billingMode:'owner_funded'}));
  f.env.VOICE_INSTANCE_CONCURRENT_CALL_LIMIT='2';f.env.VOICE_INSTANCE_DAILY_CALL_LIMIT='3';
  const configs=new Map<string,typeof config>();
  for(const user of ['one','two','three','four','five']) {
    const entry={...config,id:crypto.randomUUID()};configs.set(user,entry);
    await f.db.prepare(`INSERT INTO voice_agents(id,user_id,name,business_name,greeting,instructions,voice,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(entry.id,user,'Maya','Workshop','Hello','Take messages','asteria',new Date().toISOString()).run();
  }
  const calls=await Promise.all(['one','two','three','four'].map(user=>createCall(f.env,user,configs.get(user)!,'text')));
  assert.equal(calls.filter(Boolean).length,2);
  await f.db.prepare("UPDATE voice_calls SET status='completed',ended_at=?").bind(new Date().toISOString()).run();
  assert.ok(await createCall(f.env,'three',configs.get('three')!,'text'));
  await f.db.prepare("UPDATE voice_calls SET status='completed'").run();
  assert.equal(await createCall(f.env,'four',configs.get('four')!,'text'),null);
  f.env.VOICE_INSTANCE_DAILY_CALL_LIMIT='20';allowed=false;
  assert.equal(await createCall(f.env,'five',configs.get('five')!,'text'),null);
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('billing offline');});
  assert.equal(await createCall(f.env,'five',configs.get('five')!,'text'),null);
  t.mock.method(globalThis,'fetch',async()=>Response.json({allowed:true,billingMode:'managed'}));
  assert.equal(await createCall(f.env,'five',configs.get('five')!,'text'),null);
});

for(const mounted of [false,true])test(`signed Canopy carriers retain workspace and replay checks (${mounted?'mounted':'standalone URL'})`,async t=>{
  const f=await fixture(t,mounted);
  const origin=mounted?'https://console.example':'https://voice.example';
  const base=mounted?'/installed/voice':'';
  const {handleTwilioRequest}=await import('../worker/app/voice-twilio');
  const {handleTelnyxRequest}=await import('../worker/app/voice-telnyx');
  const {getExpectedTwilioSignature}=await import('twilio/lib/webhooks/webhooks.js');
  const id=crypto.randomUUID(),other=crypto.randomUUID();
  await f.db.prepare(`INSERT INTO voice_agents(id,user_id,name,business_name,greeting,instructions,voice,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(id,'user-one','Maya','Workshop','Hello','Take messages','asteria',new Date().toISOString()).run();
  Object.assign(f.env,{VOICE_PUBLIC_ORIGIN:origin,VOICE_CARRIER_AGENT_ID:id,VOICE_CARRIER_USER_ID:'user-one',
    TWILIO_AUTH_TOKEN:'test-token',TWILIO_ACCOUNT_SID:`AC${'a'.repeat(32)}`,TWILIO_PHONE_NUMBER:'+15551234567',
    RECEPTIONIST_CALL:{idFromName:(value:string)=>value,get:()=>({fetch:async()=>new Response('ok')})}});
  t.mock.method(globalThis,'fetch',async()=>Response.json({allowed:true,billingMode:'owner_funded'}));
  const twilio=async(agentId:string,sid:string)=>{
    const fields={AccountSid:f.env.TWILIO_ACCOUNT_SID!,To:f.env.TWILIO_PHONE_NUMBER!,CallSid:sid};
    const url=`${origin}${base}/voice/twilio/incoming/${agentId}`;
    return handleTwilioRequest(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':getExpectedTwilioSignature('test-token',url,fields)},body:new URLSearchParams(fields)}),f.env);
  };
  const sid=`CA${'b'.repeat(32)}`;
  assert.equal((await twilio(other,sid)).status,403);
  const incoming=await twilio(id,sid);assert.match(await incoming.text(),/<Stream/);
  assert.doesNotMatch(await(await twilio(id,sid)).text(),/<Stream/);
  f.env.VOICE_CARRIER_USER_ID='user-two';
  assert.doesNotMatch(await(await twilio(id,`CA${'c'.repeat(32)}`)).text(),/<Stream/);
  f.env.VOICE_CARRIER_USER_ID='user-one';
  const keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
  const encode=(bytes:ArrayBuffer)=>Buffer.from(bytes).toString('base64');
  Object.assign(f.env,{TELNYX_PUBLIC_KEY:encode(await crypto.subtle.exportKey('raw',keys.publicKey)),TELNYX_API_KEY:'test-key',TELNYX_ACCOUNT_SID:crypto.randomUUID(),TELNYX_CONNECTION_ID:'1234',TELNYX_PHONE_NUMBER:'+15557654321'});
  const telnyx=async(agentId:string,callId:string)=>{
    const body=new URLSearchParams({AccountSid:f.env.TELNYX_ACCOUNT_SID!,To:f.env.TELNYX_PHONE_NUMBER!,ConnectionId:'1234',CallSid:callId}).toString();
    const timestamp=String(Math.floor(Date.now()/1000));
    const signature=encode(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(`${timestamp}|${body}`)));
    return handleTelnyxRequest(new Request(`${origin}${base}/voice/telnyx/incoming/${agentId}`,{method:'POST',body,headers:{'content-type':'application/x-www-form-urlencoded','telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature}}),f.env);
  };
  const telnyxId=crypto.randomUUID();
  assert.equal((await telnyx(other,telnyxId)).status,403);
  assert.match(await(await telnyx(id,telnyxId)).text(),/<Stream/);
  assert.doesNotMatch(await(await telnyx(id,telnyxId)).text(),/<Stream/);
});
