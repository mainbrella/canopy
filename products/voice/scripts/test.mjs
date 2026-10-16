import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const browser = process.argv[2] === "--browser";
if (process.argv.length > (browser ? 3 : 2)) throw new Error("Only --browser is supported.");
const cache = `${root}.cache`;
await mkdir(`${cache}/tmp`, { recursive: true });
const files = (await Promise.all(["test", "src"].map(async directory => (await readdir(`${root}${directory}`))
  .filter(name => name.endsWith(".test.ts")).map(name => `${directory}/${name}`)))).flat();
const args = browser ? ["test/browser-server.mjs"] : ["--import", import.meta.resolve("tsx"), "--test", ...files];
const child = spawn(process.execPath, args, {
  cwd: root, stdio: "inherit",
  env: { ...process.env, TMPDIR: `${cache}/tmp`, XDG_CACHE_HOME: cache },
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; child.kill(signal); });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = stopping ? 0 : code ?? 1; });
