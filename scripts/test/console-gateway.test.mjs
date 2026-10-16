import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

test('console gateway keeps optional Voice private, filters cookies and passes WebSocket upgrades',async t=>{
  const bundle=await build({entryPoints:[new URL('../../platform/console/worker/index.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm'});
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[
    {name:'gateway',modules:true,script:bundle.outputFiles[0].text,serviceBindings:{VOICE:'voice',ASSETS:'assets'}},
    {name:'empty',modules:true,script:bundle.outputFiles[0].text,serviceBindings:{ASSETS:'assets'}},
    {name:'assets',modules:true,script:"export default {fetch(){return new Response('console')}}"},
    {name:'voice',modules:true,script:`export default {fetch(request){
      if(request.headers.get('upgrade')==='websocket'){
        const pair=new WebSocketPair();pair[1].accept();
        pair[1].addEventListener('message',event=>pair[1].send(event.data));
        return new Response(null,{status:101,webSocket:pair[0]});
      }
      return Response.json({url:request.url,cookie:request.headers.get('cookie'),authorization:request.headers.get('authorization')});
    }}`},
  ].map(worker=>({...worker,compatibilityDate:'2026-09-18'}))}));
  t.after(()=>mf.dispose());
  const gateway=await mf.getWorker('gateway'),empty=await mf.getWorker('empty');
  assert.equal(await(await gateway.fetch('https://console.example/')).text(),'console');
  assert.equal((await empty.fetch('https://console.example/installed/voice/')).status,404);
  assert.equal((await gateway.fetch('https://console.example/installed/voice/_canopy/handoffs')).status,404);
  assert.equal((await gateway.fetch('https://console.example/installed/voice/_canopy/ready')).status,404);
  const response=await gateway.fetch('https://console.example/installed/voice/auth/session',{headers:{cookie:'__Host-canopy_stg_session=platform; __Host-canopy_voice_session=product; unrelated=value',authorization:'Bearer browser-input'}});
  const forwarded=await response.json();
  assert.equal(forwarded.url,'https://console.example/installed/voice/auth/session');
  assert.equal(forwarded.cookie,'__Host-canopy_voice_session=product');assert.equal(forwarded.authorization,null);
  const secret=`Bearer ${'a'.repeat(64)}`;
  const ready=await gateway.fetch('https://console.example/installed/voice/_canopy/ready',{headers:{authorization:secret}});
  assert.equal((await ready.json()).authorization,secret);
  const {handleRequest}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.equal((await handleRequest(new Request('https://console.example/installed/voice/_canopy/ready',{headers:{authorization:secret,origin:'https://console.example'}}),{VOICE:{fetch(){throw new Error('Browser probe must not reach Voice');}}})).status,404);
  const upgraded=await gateway.fetch('https://console.example/installed/voice/voice/calls/test/connect',{headers:{upgrade:'websocket'}});
  assert.equal(upgraded.status,101);
  const socket=upgraded.webSocket;socket.accept();
  const message=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Gateway WebSocket echo timed out')),3000);
    socket.addEventListener('message',event=>{clearTimeout(timer);resolve(event.data);},{once:true});
  });
  socket.send('mounted call');assert.equal(await message,'mounted call');socket.close();
});
