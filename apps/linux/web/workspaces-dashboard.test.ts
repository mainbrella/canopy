import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location={hostname:'localhost'} as Location;
const {workspaceMetadata,createWorkspaceClient,workspaceUsageRows,workspaceUsageNote}=await import('./workspaces-dashboard.ts');
const id='d688d42a-25ef-4c13-9b28-21a0fde6e163';
test('workspace metadata rejects invalid identities and does not retain private fields',()=>{
  const value={id,name:'Saved files',expiresAt:Date.now()+10000,status:'ready',archived:false,size:'small',handle:{id:'private'}};
  assert.equal((workspaceMetadata(value) as unknown as Record<string, unknown>).handle,undefined);
  assert.throws(()=>workspaceMetadata({...value,id:'other-account'}));
  assert.throws(()=>workspaceMetadata({...value,status:'deleted'}));
});
test('save transport preserves recovery keys, includes cookies and forbids redirects',async()=>{
  let seen!: { url: string | URL | Request; options?: RequestInit };const request=createWorkspaceClient({fetcher:async(url,options)=>{seen={url,options};return Response.json({id});}});
  assert.equal((await request('/workspaces','POST',{name:'Saved files'},'recovery-key')).id,id);
  assert.equal(seen.options!.credentials,'include');assert.equal(seen.options!.redirect,'error');
  assert.equal((seen.options!.headers as Record<string, string>)['Idempotency-Key'],'recovery-key');assert.deepEqual(JSON.parse(seen.options!.body as string),{name:'Saved files'});
});
test('authentication failure notifies dashboard and retains public error code',async()=>{
  let notified=false;const request=createWorkspaceClient({onUnauthenticated:()=>{notified=true;},fetcher:async()=>Response.json({error:'not_authenticated'},{status:401})});
  await assert.rejects(request('/workspaces'),/not_authenticated/);assert.equal(notified,true);
});

test('replaying a durable request preserves its exact serialized body and idempotency key', async () => {
  const calls: RequestInit[] = [];
  const request = createWorkspaceClient({ fetcher: async (_url, options) => { calls.push(options!); return Response.json({ id }); } });
  const body = '{"id":"c1","createdAt":"2026-10-12T12:00:00.000Z","name":"保存","stop":false}';
  await request('/workspaces', 'POST', undefined, 'same-key', body);
  await request('/workspaces', 'POST', undefined, 'same-key', body);
  assert.deepEqual(calls.map(call => call.body), [body, body]);
  assert.deepEqual(calls.map(call => (call.headers as Record<string, string>)['Idempotency-Key']), ['same-key', 'same-key']);
});

test('quota display keeps live reservations separate from cumulative capture budgets', () => {
  const result = { limits: { maxSaved: 5, maxReservedBytes: 100e9, maxSavesPerMonth: 10, maxCaptureBytesPerMonth: 200e9, maxRetainedCaptureBytes: 500e9 },
    usage: { saved: 0, reservedBytes: 0, savesThisMonth: 3, captureBytesThisMonth: 60e9, retainedCaptureBytes: 80e9,
      captureBudgetResetsAt: Date.parse('2026-11-01T00:00:00Z'), nextRetainedCaptureReleaseAt: Date.parse('2026-12-01T00:00:00Z'), nextRetainedCaptureReleaseBytes: 20e9 } };
  assert.deepEqual(workspaceUsageRows(result), [
    ['Saved workspaces', '0 / 5'], ['Saved disk reservation', '0 bytes / 100 GB'], ['Saves this month', '3 / 10'],
    ['Capture reservation this month', '60 GB / 200 GB'], ['Retained capture reservation', '80 GB / 500 GB'],
  ]);
  assert.match(workspaceUsageNote(result), /Deleting releases saved capacity but does not reset capture budgets/);
  assert.match(workspaceUsageNote(result), /20 GB of retained reservation releases/);
  assert.doesNotMatch(workspaceUsageNote(result), /physically deleted|erased/);
});

test('older or unavailable usage responses never invent zero usage or release dates', () => {
  assert.ok(workspaceUsageRows({}).every(([, value]) => value === 'Unavailable'));
  assert.match(workspaceUsageNote({ usage: { retainedCaptureBytes: 10e9 } }), /release time is unavailable/);
  assert.match(workspaceUsageNote({ usage: { retainedCaptureBytes: 0 } }), /No retained capture reservation/);
});
