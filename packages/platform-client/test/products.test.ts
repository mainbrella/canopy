import test from "node:test";
import assert from "node:assert/strict";
import { createProductClient } from "../src/products.ts";

test("product client validates actual status and keeps handoffs on the installed origin",async()=>{
  const requests:Array<{url:string;options:RequestInit}>=[];
  let url=`https://voice.example/handoff.html#${"a".repeat(64)}`;
  const client=createProductClient({baseUrl:"https://accounts.example/",fetcher:(async(input,options)=>{
    requests.push({url:String(input),options:options!});
    return Response.json(String(input).endsWith("/open")?{url}:{product:"voice",state:"ready",version:"v1",origin:"https://voice.example"});
  }) as typeof fetch});
  assert.equal((await client.readVoiceInstallation()).state,"ready");
  assert.equal(await client.openVoice("https://voice.example"),url);
  assert.equal(requests[0].options.credentials,"include");
  assert.equal(requests[1].options.method,"POST");
  url=`https://evil.example/handoff.html#${"a".repeat(64)}`;
  await assert.rejects(client.openVoice("https://voice.example"),/Could not open Voice/);
});

test("malformed or unsuccessful product responses cannot become ready or open",async()=>{
  for(const response of [new Response("offline",{status:503}),Response.json({product:"voice",state:"optimistic",version:null,origin:null})]){
    const client=createProductClient({fetcher:(async()=>response.clone()) as typeof fetch});
    await assert.rejects(client.readVoiceInstallation(),/Could not check Voice/);
    await assert.rejects(client.openVoice("https://voice.example"),/Could not open Voice/);
  }
});

test('mounted handoffs stay on the installed origin and exact product path',async()=>{
  let url=`https://console.example/installed/voice/handoff.html#${'a'.repeat(64)}`;
  const client=createProductClient({fetcher:(async()=>Response.json({url})) as typeof fetch});
  assert.equal(await client.openVoice('https://console.example','/installed/voice'),url);
  for(const path of ['/handoff.html','/installed/cut/handoff.html','/installed/voice/handoff.html?next=elsewhere']){
    url=`https://console.example${path}#${'a'.repeat(64)}`;
    await assert.rejects(client.openVoice('https://console.example','/installed/voice'),/Could not open Voice/);
  }
  await assert.rejects(client.openVoice('https://console.example','/installed/voice/../cut'),/Could not open Voice/);
});
