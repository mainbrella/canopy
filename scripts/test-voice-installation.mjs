import { build } from "esbuild";
import { Miniflare, Response, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const secret="installation-browser-secret".repeat(4);
for(const port of [8793,8794])await new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",()=>reject(new Error(`Installation tests need port ${port}.`)));
  server.listen(port,"127.0.0.1",()=>server.close(resolve));
});
const bundle=entryPoints=>build({entryPoints,bundle:true,write:false,banner:{js:"import { createRequire } from 'node:module'; const require = createRequire('/installation-test.js');"},
  format:"esm",target:"es2022",platform:"browser",external:["cloudflare:*","node:*"],alias:{crypto:"node:crypto",url:"node:url",querystring:"node:querystring",path:"node:path"}});
const bundles=await Promise.all([bundle([`${root}platform/accounts/test/voice-browser-worker.ts`]),bundle([`${root}products/voice/test/fixture-worker.ts`])]);
let accounts,voice;
const forward=async(worker,request)=>worker.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:["GET","HEAD"].includes(request.method)?undefined:await request.arrayBuffer()});
accounts=new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:8793,workers:[{name:"accounts-installation-test",modules:true,script:bundles[0].outputFiles[0].text,
  compatibilityDate:"2026-09-18",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],
  bindings:{AUTH_ORIGINS:"http://127.0.0.1:5175",LOCAL_DEVELOPMENT:"true",VOICE_AUTH_SECRET:secret},
  outboundService:request=>voice?forward(voice,request):new Response("starting",{status:503})}]}));
voice=new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:8794,workers:[{name:"voice-installation-test",modules:true,script:bundles[1].outputFiles[0].text,
  compatibilityDate:"2026-09-18",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],
  durableObjects:{RECEPTIONIST_CALL:{className:"ReceptionistCall",useSQLite:true}},
  assets:{directory:`${root}products/voice/dist/client`,binding:"ASSETS",run_worker_first:true,routerConfig:{has_user_worker:true}},
  bindings:{VOICE_AUTH_MODE:"canopy",CANOPY_AUTH_SECRET:secret,CANOPY_INSTALLATION_ID:"browser-install",CANOPY_SOURCE_VERSION:"browser-version",
    CANOPY_ACCOUNTS_ORIGIN:"http://127.0.0.1:8793",CANOPY_CONSOLE_ORIGIN:"http://127.0.0.1:5175",VOICE_ENABLED:"true"},
  outboundService:request=>new URL(request.url).origin==="http://127.0.0.1:8793"?forward(accounts,request):new Response("External requests disabled",{status:503})}]}));
let stopping=false;
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{
  if(stopping)return;stopping=true;await Promise.allSettled([accounts.dispose(),voice.dispose()]);
});
try{
  for(const [runtime,directory]of[[accounts,"platform/accounts"],[voice,"products/voice"]]){
    const db=await runtime.getD1Database("DB");
    for(const file of(await readdir(`${root}${directory}/migrations`)).filter(file=>file.endsWith(".sql")).sort()){
      const sql=(await readFile(`${root}${directory}/migrations/${file}`,"utf8")).replace(/^--.*$/gm,"").split(";").map(part=>part.trim()).filter(Boolean);
      await db.batch(sql.map(sql=>db.prepare(sql)));
    }
  }
  const db=await accounts.getD1Database("DB");
  await db.prepare(`INSERT INTO product_installations(product,installation_id,account_id,worker_name,origin,version,source_revision,state,updated_at)
    VALUES('voice','browser-install','test-account','test-worker','http://127.0.0.1:8794','browser-version','test-source','installed',?)`).bind(new Date().toISOString()).run();
  console.log("Installation fixture ready (in-memory databases and deterministic AI; external requests blocked).");
}catch(error){await Promise.allSettled([accounts.dispose(),voice.dispose()]);throw error;}
