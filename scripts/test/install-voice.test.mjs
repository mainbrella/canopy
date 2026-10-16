import test from "node:test";
import assert from "node:assert/strict";
import { ensureDatabase, validateTarget } from "../install-voice.mjs";

test("database retry reuses recorded resources and creation intent, while rejecting unrelated names",async()=>{
  const target={databaseName:"canopy-voice-stg"}; const state={}; let databases=[],creates=0;
  const dependencies={target,state,list:async()=>databases,create:async()=>{creates++;return databases[0]={name:target.databaseName,uuid:"dedicated-id"};},persist:async()=>{}};
  assert.equal(await ensureDatabase(dependencies),"dedicated-id");
  assert.equal(await ensureDatabase(dependencies),"dedicated-id");
  assert.equal(creates,1);
  delete state.databaseId;
  assert.equal(await ensureDatabase(dependencies),"dedicated-id");
  assert.equal(creates,1);
  delete state.databaseId; delete state.creatingDatabase;
  await assert.rejects(ensureDatabase(dependencies),/Refusing to adopt/);
});

test("failed creation can resume without duplicating the database",async()=>{
  const state={},target={databaseName:"canopy-voice-stg"}; let databases=[],creates=0;
  const dependencies={target,state,list:async()=>databases,persist:async()=>{},create:async()=>{creates++;databases=[{name:target.databaseName,uuid:"created-before-interruption"}];throw new Error("lost response");}};
  await assert.rejects(ensureDatabase(dependencies),/lost response/);
  assert.equal(await ensureDatabase(dependencies),"created-before-interruption");
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
