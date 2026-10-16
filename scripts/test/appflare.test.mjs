import test from 'node:test';
import assert from 'node:assert/strict';
import { cutEvidence, reconcileCut } from '../register-appflare.mjs';
import { validateCore } from '../setup-core.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
const input=()=>({install:{id:'install-one',app_slug:'cut',worker_name:'test-cut',status:'installed',origin:'catalog',build_kind:'artifact',catalog_version:'0.1.0',pin_sha:'a'.repeat(40),current_version_id:'version-id',artifact_digest:'b'.repeat(64),workers_dev_enabled:1,manifest_json:JSON.stringify({catalog:{repo:'MendyLanda/cut'}})},
  resources:[{kind:'worker',name:'test-cut',managed_by:'appflare'},{kind:'kv',name:'test-cut-links',cf_id:'kv-id',binding:'LINKS',managed_by:'appflare'}],
  deployments:[{versions:[{version_id:'version-id',percentage:100}]}],domains:[],subdomain:'operator',accountId:'c'.repeat(32),managerWorker:'test-appflare'});

test('Cut registration verifies source, resources, deployed version and origin without claiming identity or billing',()=>{
  const fixture=input();const evidence=cutEvidence(fixture);
  assert.equal(evidence.origin,'https://test-cut.operator.workers.dev');
  assert.deepEqual(evidence.capabilities,{identity:false,billing:false,health:'reachability',openPath:'/admin'});
  for(const alter of [f=>f.install.pin_sha='',f=>f.install.app_slug='other',f=>f.install.current_version_id='wrong',f=>f.resources=[],f=>f.install.served_domain='unrelated.example']){
    const f=input();alter(f);assert.throws(()=>cutEvidence(f));
  }
});
test('Cut reconciliation persists evidence and repeats safely without replacing another install',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    for(const file of ['001_initial.sql','013_product_installations.sql','014_product_access.sql'])db.exec(await readFile(new URL(`../../platform/accounts/migrations/${file}`,import.meta.url),'utf8'));
    const query=async(sql,params=[])=>db.prepare(sql).all(...params);
    const evidence=cutEvidence(input());await reconcileCut(query,evidence,'operator');await reconcileCut(query,evidence,'operator');
    const row=db.prepare("SELECT * FROM product_installations WHERE product='cut'").get();
    assert.equal(row.provisioner,'appflare');assert.equal(row.source_repository,'MendyLanda/cut');
    await assert.rejects(reconcileCut(query,{...evidence,installationId:'another'},'operator'),/different Cut/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM product_installations').get().n,1);
  }finally{db.close();}
});
test('portable core requires dedicated origins, explicit product selection and isolated rate limits',()=>{
  const target={accountId:'a'.repeat(32),prefix:'own-core',accountsOrigin:'https://api.example.com',consoleOrigin:'https://console.example.com',products:[],emailRateNamespace:'5001',googleRateNamespace:'5002'};
  assert.equal(validateCore(target),target);
  assert.deepEqual(validateCore({...target,products:['voice']}).products,['voice']);
  for(const alter of [f=>f.accountsOrigin='https://api-stg.mainbrella.com',f=>f.googleRateNamespace='5001',f=>f.products=['unknown'],f=>f.prefix='../escape']){
    const copy={...target};alter(copy);assert.throws(()=>validateCore(copy));
  }
});
