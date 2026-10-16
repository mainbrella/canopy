import { build } from "esbuild";
import { Miniflare, Response, convertV4MiniflareOptions } from "miniflare";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = 8792;
await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", () => reject(new Error(`Voice browser tests need port ${port}.`)));
  server.listen(port, "127.0.0.1", () => server.close(resolve));
});
const bundle = await build({
  entryPoints: [`${root}test/browser-worker.ts`], bundle: true, write: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/voice-test.js');" },
  format: "esm", target: "es2022", platform: "browser", external: ["cloudflare:*", "node:*"],
  alias: { crypto: "node:crypto", url: "node:url", querystring: "node:querystring", path: "node:path" },
});
const mf = new Miniflare(convertV4MiniflareOptions({
  host: "127.0.0.1", port,
  workers: [{
    name: "voice-browser-test", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-09-18", compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"], durableObjects: { RECEPTIONIST_CALL: { className: "ReceptionistCall", useSQLite: true } },
    assets: { directory: `${root}dist/client`, binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true } },
    bindings: { ADMIN_PASSWORD: "voice-browser-test-password", VOICE_ENABLED: "true", TRANSCRIPT_RETENTION_DAYS: "30" },
    outboundService: () => new Response("External requests are disabled in browser tests.", { status: 503 }),
  }],
}));
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (stopping) return;
  stopping = true;
  await mf.dispose();
});
try {
  const db = await mf.getD1Database("DB");
  for (const name of (await readdir(`${root}migrations`)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = await readFile(`${root}migrations/${name}`, "utf8");
    const statements = sql.replace(/^--.*$/gm, "").split(";").map(statement => statement.trim()).filter(Boolean);
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
  console.log(`Voice browser fixture: http://127.0.0.1:${port} (in-memory data, simulated AI).`);
} catch (error) {
  await mf.dispose();
  throw error;
}
