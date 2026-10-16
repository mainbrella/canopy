import { build } from "esbuild";
import { Miniflare, Response, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const secret="installation-browser-secret".repeat(4);
for(const port of [8793,8794,8795])await new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",()=>reject(new Error(`Installation tests need port ${port}.`)));
  server.listen(port,"127.0.0.1",()=>server.close(resolve));
});
const bundle=entryPoints=>build({entryPoints,bundle:true,write:false,banner:{js:"import { createRequire } from 'node:module'; const require = createRequire('/installation-test.js');"},
  format:"esm",target:"es2022",platform:"browser",external:["cloudflare:*","node:*"],alias:{crypto:"node:crypto",url:"node:url",querystring:"node:querystring",path:"node:path"}});
const bundles=await Promise.all([bundle([`${root}platform/accounts/test/voice-browser-worker.ts`]),bundle([`${root}products/voice/test/fixture-worker.ts`])]);
const cut=httpServer((request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><html lang="en"><title>Cut fixture</title><h1>Cut</h1><p>Separate admin sign-in (test fixture).</p><label>Admin password <input type="password"></label></html>');});
await new Promise(resolve=>cut.listen(8795,'127.0.0.1',resolve));
let accounts,voice;
const forward=async(worker,request)=>worker.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:["GET","HEAD"].includes(request.method)?undefined:await request.arrayBuffer()});
accounts=new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:8793,workers:[{name:"accounts-installation-test",modules:true,script:bundles[0].outputFiles[0].text,
  compatibilityDate:"2026-09-18",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],
  bindings:{AUTH_ORIGINS:"http://127.0.0.1:5175",LOCAL_DEVELOPMENT:"true",VOICE_AUTH_SECRET:secret},
  outboundService:request=>new URL(request.url).port==="8795"?new Response("Cut reachability fixture"):voice?forward(voice,request):new Response("starting",{status:503})}]}));
voice=new Miniflare(convertV4MiniflareOptions({host:"127.0.0.1",port:8794,workers:[{name:"voice-installation-test",modules:true,script:bundles[1].outputFiles[0].text,
  compatibilityDate:"2026-09-18",compatibilityFlags:["nodejs_compat"],d1Databases:["DB"],
  durableObjects:{RECEPTIONIST_CALL:{className:"ReceptionistCall",useSQLite:true}},
  assets:{directory:`${root}products/voice/dist/client`,binding:"ASSETS",run_worker_first:true,routerConfig:{has_user_worker:true}},
  bindings:{VOICE_AUTH_MODE:"canopy",CANOPY_AUTH_SECRET:secret,CANOPY_INSTALLATION_ID:"browser-install",CANOPY_SOURCE_VERSION:"browser-version",
    CANOPY_ACCOUNTS_ORIGIN:"http://127.0.0.1:8793",CANOPY_CONSOLE_ORIGIN:"http://127.0.0.1:5175",VOICE_ENABLED:"true"},
  outboundService:request=>new URL(request.url).origin==="http://127.0.0.1:8793"?forward(accounts,request):new Response("External requests disabled",{status:503})}]}));
let stopping=false;
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{
  if(stopping)return;stopping=true;cut.close();await Promise.allSettled([accounts.dispose(),voice.dispose()]);
});
try{
  for(const [runtime,directory]of[[accounts,"platform/accounts"],[voice,"products/voice"]]){
    const db=await runtime.getD1Database("DB");
    for(const file of(await readdir(`${root}${directory}/migrations`)).filter(file=>file.endsWith(".sql")).sort()){
      const sql=(await readFile(`${root}${directory}/migrations/${file}`,"utf8")).replace(/^--.*$/gm,"").split(";").map(part=>part.trim()).filter(Boolean);
      await db.batch(sql.map(sql=>db.prepare(sql)));
    }
  }
  const login=await accounts.dispatchFetch('http://127.0.0.1:8793/auth/email',{method:'POST',headers:{origin:'http://127.0.0.1:5175','content-type':'application/json'},body:JSON.stringify({email:'operator@installation.test',password:'private fixture operator password'})});
  if(!login.ok)throw new Error('Could not seed the fixture operator.');
  const cookie=login.headers.get('set-cookie').split(';')[0];
  await accounts.dispatchFetch('http://127.0.0.1:8793/__test/voice',{method:'POST',headers:{cookie}});
  console.log("Installation fixture ready (in-memory databases and deterministic AI; external requests blocked).");
}catch(error){cut.close();await Promise.allSettled([accounts.dispose(),voice.dispose()]);throw error;}
