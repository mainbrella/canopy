import test from 'node:test';
import assert from 'node:assert/strict';
Object.defineProperty(globalThis,'location',{value:{hostname:'localhost'},configurable:true});
const { createDomainClient, parseDomainOrder, domainMoney } = await import('./domain-registrar.ts');
const order={id:'e038ce58-c743-47f3-a399-cd268c2336fb',domainName:'example.com',projectId:null,kind:'registration',years:1,amountCents:1299,renewalCents:1499,premium:false,autoRenew:true,status:'checkout',error:null,expiresAt:Date.now()+60000};
test('domain checkout validates prices and states before rendering',()=>{
  assert.equal(parseDomainOrder(order).amountCents,1299); assert.equal(domainMoney(1299),'$12.99');
  for(const change of [{amountCents:-1},{renewalCents:NaN},{status:'invented'},{projectId:0},{autoRenew:'true'}]) assert.throws(()=>parseDomainOrder({...order,...change}));
});
test('domain client binds order queries and quote requests to the authenticated API',async()=>{
  const calls:{url:URL;init?:RequestInit}[]=[];
  const client=createDomainClient({fetcher:async(input,init)=>{calls.push({url:new URL(String(input)),init});return Response.json({order});}});
  await client.order(order.id); await client.quote({domainName:'example.com',years:1,kind:'registration'});
  assert.equal(calls[0].url.pathname,'/domains/order');assert.equal(calls[0].url.searchParams.get('id'),order.id);assert.equal(calls[0].init?.credentials,'include');
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)),{domainName:'example.com',years:1,kind:'registration'});
});
test('unauthenticated domain requests trigger sign-in without trusting response details',async()=>{
  let called=false;const client=createDomainClient({onUnauthenticated:()=>{called=true;},fetcher:async()=>Response.json({error:'not_authenticated'},{status:401})});
  await assert.rejects(()=>client.order(order.id),/not_authenticated/);assert.equal(called,true);
});
