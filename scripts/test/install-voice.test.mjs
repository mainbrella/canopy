import test from "node:test";
import assert from "node:assert/strict";
import { ensureDatabase, validateTarget, waitForVoiceReady } from "../install-voice.mjs";

function readinessFixture(fetcher) {
  let clock = 0;
  return { target: { origin: 'https://voice.example' }, state: { secret: 'private-secret', installationId: 'install' },
    source: { version: 'v1' }, fetcher, timeoutMs: 100, intervalMs: 10,
    now: () => clock, sleep: async ms => { clock += ms; }, log: () => {} };
}

test('readiness waits for new-domain DNS and transient routing without accepting another installation', async () => {
  let attempts = 0;
  const fixture = readinessFixture(async (url, options) => {
    assert.equal(url, 'https://voice.example/_canopy/ready');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer private-secret');
    attempts++;
    if (attempts === 1) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    if (attempts === 2) return new Response('Routing pending', { status: 503 });
    if (attempts === 3) throw new DOMException('Request timed out', 'TimeoutError');
    return Response.json({ ready: true, installationId: 'install', version: 'v1' });
  });
  assert.equal((await waitForVoiceReady(fixture)).ready, true);
  assert.equal(attempts, 4);
  for (const response of [
    { ready: true, installationId: 'another-install', version: 'v1' },
    { ready: true, installationId: 'install', version: 'v2' },
    { ready: false, installationId: 'install', version: 'v1' },
  ]) {
    let sleeps = 0;
    await assert.rejects(waitForVoiceReady({ ...fixture, fetcher: async () => Response.json(response), sleep: async () => { sleeps++; } }), /readiness did not match/);
    assert.equal(sleeps, 0);
  }
});

test('readiness stops on cancellation and permanent failures, and explains a bounded DNS timeout', async () => {
  let attempts = 0;
  const fixture = readinessFixture(async () => {
    attempts++;
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  });
  await assert.rejects(waitForVoiceReady(fixture), /timed out \(ENOTFOUND\).*Check DNS.*preserved/);
  assert.equal(attempts, 10);
  const controller = new AbortController();
  await assert.rejects(waitForVoiceReady({ ...fixture, signal: controller.signal, sleep: async () => { controller.abort(); } }), { name: 'AbortError' });
  await assert.rejects(waitForVoiceReady({ ...fixture, fetcher: async () => { throw new Error('certificate failed'); } }), /certificate failed/);
  await assert.rejects(waitForVoiceReady({ ...fixture, fetcher: async () => Response.json({ error: 'unauthorized' }, { status: 401 }) }), /readiness did not match/);
});

test("database retry reuses recorded UUIDs and requires explicit recovery for ambiguous names",async()=>{
  const target={databaseName:"canopy-voice-stg"}; const state={}; let databases=[],creates=0;
  const dependencies={target,state,list:async()=>databases,create:async()=>{creates++;return databases[0]={name:target.databaseName,uuid:"dedicated-id"};},persist:async()=>{}};
  assert.equal(await ensureDatabase(dependencies),"dedicated-id");
  assert.equal(await ensureDatabase(dependencies),"dedicated-id");
  assert.equal(creates,1);
  delete state.databaseId;
  await assert.rejects(ensureDatabase(dependencies),/Refusing to adopt/);
  assert.equal(await ensureDatabase({...dependencies,recoverDatabaseId:'dedicated-id'}),"dedicated-id");
  assert.equal(creates,1);
  delete state.databaseId; delete state.creatingDatabase;
  await assert.rejects(ensureDatabase(dependencies),/Refusing to adopt/);
});

test("failed creation can resume without duplicating the database",async()=>{
  const state={},target={databaseName:"canopy-voice-stg"}; let databases=[],creates=0;
  const dependencies={target,state,list:async()=>databases,persist:async()=>{},create:async()=>{creates++;databases=[{name:target.databaseName,uuid:"created-before-interruption"}];throw new Error("lost response");}};
  await assert.rejects(ensureDatabase(dependencies),/lost response/);
  await assert.rejects(ensureDatabase(dependencies),/Refusing to adopt/);
  assert.equal(await ensureDatabase({...dependencies,recoverDatabaseId:'created-before-interruption'}),"created-before-interruption");
  assert.equal(creates,1);
});

test("installation target refuses shared identity and production resource names",()=>{
  const target={accountId:"a".repeat(32),workerName:"voice-test",databaseName:"voice-test",origin:"https://voice.example",accountsOrigin:"https://accounts.example",consoleOrigin:"https://console.example"};
  const accounts={account_id:target.accountId,name:"accounts-test",routes:[{pattern:"accounts.example"}],d1_databases:[{binding:"DB",database_name:"accounts-test",database_id:"account-db"}]};
  const consoleConfig={account_id:target.accountId,name:"console-test",routes:[{pattern:"console.example"}]};
  assert.equal(validateTarget(target,accounts,consoleConfig),"account-db");
  assert.throws(()=>validateTarget(target,{...accounts,name:"mainbrella-api"},consoleConfig),/dedicated/);
  assert.throws(()=>validateTarget({...target,databaseName:"accounts-test"},accounts,consoleConfig),/dedicated/);
  assert.throws(()=>validateTarget({...target,accountId:"b".repeat(32)},accounts,consoleConfig),/dedicated/);
});

test('atomic identity claims reject concurrent checkouts and recover only the same identity after expiry',async()=>{
  const { DatabaseSync }=await import('node:sqlite');
  const { readFile }=await import('node:fs/promises');
  const { claimInstallation }=await import('../install-voice.mjs');
  const db=new DatabaseSync(':memory:');
  try{
    for(const file of ['001_initial.sql','002_auth_sessions.sql','012_email_password.sql','013_product_installations.sql','014_product_access.sql'])db.exec(await readFile(new URL(`../../platform/accounts/migrations/${file}`,import.meta.url),'utf8'));
    const query=async(sql,params=[])=>db.prepare(sql).all(...params);
    const target={accountId:'a'.repeat(32),workerName:'canopy-voice-test',origin:'https://voice.example'};
    const source={version:'v1',revision:'b'.repeat(40),dirty:false};
    const a={target,source,state:{installationId:'A'},lease:'lease-A',now:1000};
    const b={...a,state:{installationId:'B'},lease:'lease-B'};
    const outcomes=await Promise.allSettled([claimInstallation(query,a),claimInstallation(query,b)]);
    assert.deepEqual(outcomes.map(outcome=>outcome.status),['fulfilled','rejected']);
    assert.equal(db.prepare('SELECT installation_id FROM product_installations').get().installation_id,'A');
    await assert.rejects(claimInstallation(query,{...b,now:200000}),/identity\/version/);
    await assert.rejects(claimInstallation(query,{...a,lease:'new-lease',now:2000}),/active lease/);
    await assert.rejects(claimInstallation(query,{...a,source:{...source,version:'v2'},now:200000}),/identity\/version/);
    await claimInstallation(query,{...a,lease:'resumed',now:200000});
    assert.equal(db.prepare('SELECT lease_token FROM product_installations').get().lease_token,'resumed');
    // A delayed former owner cannot publish failure, readiness or release the new lease.
    assert.equal(db.prepare("UPDATE product_installations SET state='failed' WHERE lease_token=?").run('lease-A').changes,0);
  }finally{db.close();}
});

test('registry migration retains an existing Voice installation and resource identities',async()=>{
  const { DatabaseSync }=await import('node:sqlite');const { readFile }=await import('node:fs/promises');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(await readFile(new URL('../../platform/accounts/migrations/013_product_installations.sql',import.meta.url),'utf8'));
    db.exec("INSERT INTO product_installations VALUES('voice','old-install','account','worker','db','namespace','https://voice.example','v1','source','installed',NULL,NULL,'today')");
    const before=db.prepare('SELECT * FROM product_installations').get();
    db.exec(await readFile(new URL('../../platform/accounts/migrations/014_product_access.sql',import.meta.url),'utf8'));
    const after=db.prepare('SELECT * FROM product_installations').get();
    for(const key of Object.keys(before))assert.equal(after[key],before[key]);
  }finally{db.close();}
});

test('provisioning resumes after deployment interruption and readiness mismatch without duplicate resources',async()=>{
  const { DatabaseSync }=await import('node:sqlite');
  const { readFile,mkdir,writeFile,mkdtemp }=await import('node:fs/promises');
  const { root }=await import('../operator.mjs');
  const { main }=await import('../install-voice.mjs');
  await mkdir(`${root}/.cache`,{recursive:true});
  const directory=await mkdtemp(`${root}/.cache/install-flow-`);
  const productDirectory=`${directory}/voice`;await mkdir(productDirectory);
  await writeFile(`${productDirectory}/wrangler.jsonc`,await readFile(`${root}/products/voice/wrangler.jsonc`));
  const target={accountId:'a'.repeat(32),workerName:'fixture-voice',databaseName:'fixture-voice',origin:'https://fixture-voice.example',accountsOrigin:'https://fixture-api.example',consoleOrigin:'https://fixture-console.example',operatorUserId:'operator',
    accountsConfig:`${directory}/accounts.json`,consoleConfig:`${directory}/console.json`};
  await writeFile(target.accountsConfig,JSON.stringify({name:'fixture-accounts',account_id:target.accountId,routes:[{pattern:'fixture-api.example'}],vars:{OPERATOR_USER_ID:'operator',VOICE_BILLING_MODE:'owner_funded'},d1_databases:[{binding:'DB',database_id:'core-db',database_name:'fixture-accounts'}]}));
  await writeFile(target.consoleConfig,JSON.stringify({name:'fixture-console',account_id:target.accountId,routes:[{pattern:'fixture-console.example'}]}));
  await writeFile(`${directory}/target.json`,JSON.stringify(target));
  const db=new DatabaseSync(':memory:');
  try{
    for(const file of ['001_initial.sql','013_product_installations.sql','014_product_access.sql'])db.exec(await readFile(new URL(`../../platform/accounts/migrations/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id,email) VALUES('operator','operator@example.com'); INSERT INTO product_install_requests VALUES('voice','request','operator','pending','today')");
    let databases=[],workers=[],voiceBindings=[],creates=0,deploys=0,interrupt=true,readyMismatch=true,consoleFailure=true;
    const dependencies={productDirectory,privateDirectory:`${directory}/private`,source:{version:'fixture-v1',revision:'b'.repeat(40),dirty:false,fingerprint:'fixture',hashes:{}},
      query:async(sql,params=[])=>db.prepare(sql).all(...params),
      api:async(path,method='GET',body)=>{
        if(path.endsWith('/workers/scripts'))return workers;
        if(path.endsWith('/workers/domains'))return [];
        if(path.endsWith('/settings'))return {bindings:[...voiceBindings,{name:'RECEPTIONIST_CALL',namespace_id:'fixture-namespace'}]};
        if(path.endsWith('/deployments'))return {deployments:[{versions:[{version_id:'deployed-fixture-version',percentage:100}]}]};
        if(path.includes('/d1/database?'))return databases;
        if(path.endsWith('/d1/database')&&method==='POST'){creates++;const row={name:body.name,uuid:'fixture-database'};databases.push(row);return row;}
        if(path.endsWith('/d1/database/core-db'))return {name:'fixture-accounts'};
        if(path===`/accounts/${target.accountId}`)return {id:target.accountId};
        throw new Error(`Unexpected fixture API call: ${path}`);
      },
      run:async(_command,args)=>{
        if(args[1]!=='deploy')return '';
        deploys++;
        if(interrupt){interrupt=false;throw new Error('simulated deploy interruption');}
        const config=JSON.parse(await readFile(args[args.indexOf('--config')+1],'utf8'));
        if(config.name==='fixture-console'&&consoleFailure){consoleFailure=false;throw new Error('simulated console deployment failure');}
        if(config.name===target.workerName){workers=[{id:target.workerName}];voiceBindings=[{name:'CANOPY_INSTALLATION_ID',text:config.vars.CANOPY_INSTALLATION_ID}];}
        return '';
      },
      fetcher:async()=>{
        const state=JSON.parse(await readFile(`${directory}/private/private.json`,'utf8'));
        return Response.json({ready:true,installationId:readyMismatch?'wrong':state.installationId,version:'fixture-v1'});
      },buildConsole:async()=>{},
    };
    const args=['--config',`${directory}/target.json`];
    await assert.rejects(main(args,dependencies),/simulated deploy interruption/);
    assert.equal(db.prepare('SELECT state FROM product_installations').get().state,'failed');
    assert.equal(db.prepare('SELECT state FROM product_install_requests').get().state,'failed');
    await assert.rejects(main(args,dependencies),/readiness did not match/);
    assert.equal(db.prepare('SELECT state FROM product_installations').get().state,'failed');
    readyMismatch=false;
    await assert.rejects(main(args,dependencies),/simulated console deployment failure/);
    assert.equal(db.prepare('SELECT state FROM product_installations').get().state,'failed');
    await main(args,dependencies);
    const row=db.prepare('SELECT * FROM product_installations').get();
    assert.equal(row.state,'installed');assert.equal(row.database_id,'fixture-database');assert.equal(row.namespace_id,'fixture-namespace');assert.equal(row.lease_token,null);
    assert.equal(db.prepare('SELECT state FROM product_install_requests').get().state,'complete');
    assert.equal(creates,1);
    const inventory=JSON.parse(await readFile(`${directory}/private/inventory.json`,'utf8'));
    assert.equal(inventory.deployedVersions['fixture-voice'][0].version_id,'deployed-fixture-version');
    const previousDeploys=deploys;await main(args,dependencies);assert.equal(deploys,previousDeploys);
  }finally{db.close();}
});

test('operator runner processes only the pinned owner requests and recovers interrupted expired work',async()=>{
  const { DatabaseSync }=await import('node:sqlite');const { readFile }=await import('node:fs/promises');const {processVoiceRequest}=await import('../run-operator.mjs');
  const db=new DatabaseSync(':memory:');
  try{
    for(const file of ['001_initial.sql','013_product_installations.sql','014_product_access.sql'])db.exec(await readFile(new URL(`../../platform/accounts/migrations/${file}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO users(id) VALUES('operator'); INSERT INTO product_install_requests VALUES('voice','request','operator','pending','today')");
    const query=async(sql,params=[])=>db.prepare(sql).all(...params);let installs=0;
    const install=async()=>{installs++;db.exec("UPDATE product_install_requests SET state='complete'");};
    assert.equal(await processVoiceRequest(query,'public-user',install),false);assert.equal(installs,0);
    assert.equal(await processVoiceRequest(query,'operator',install),true);assert.equal(installs,1);
    assert.equal(await processVoiceRequest(query,'operator',install),false);
    db.exec("UPDATE product_install_requests SET state='running'; INSERT INTO product_installations(product,installation_id,account_id,worker_name,origin,version,source_revision,state,updated_at,lease_expires) VALUES('voice','id','a','worker','https://voice.example','v1','src','installing','today',0)");
    assert.equal(await processVoiceRequest(query,'operator',install),true);assert.equal(installs,2);
    db.prepare("UPDATE product_install_requests SET state='running'").run();db.prepare('UPDATE product_installations SET lease_expires=?').run(Date.now()+120000);
    assert.equal(await processVoiceRequest(query,'operator',install),false);
    db.prepare('UPDATE product_installations SET lease_expires=0').run();
    await assert.rejects(processVoiceRequest(query,'operator',async()=>{throw new Error('failed deploy');}),/failed deploy/);
    assert.equal(db.prepare('SELECT state FROM product_install_requests').get().state,'failed');
    db.exec("UPDATE product_install_requests SET state='pending',updated_at='first-attempt'");
    await assert.rejects(processVoiceRequest(query,'operator',async()=>{
      db.exec("UPDATE product_install_requests SET state='pending',updated_at='new-retry'");
      throw new Error('old failure');
    }),/old failure/);
    assert.equal(db.prepare('SELECT state FROM product_install_requests').get().state,'pending');
  }finally{db.close();}
});
