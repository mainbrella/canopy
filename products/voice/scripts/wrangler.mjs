import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Product-local paths also work in the standalone source export. These commands
// cannot deploy or contact remote bindings; live installs use an explicit config.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const allowed = [
  ["dev", "--local", "--ip", "127.0.0.1", "--port", "8791"],
  ["d1", "migrations", "apply", "DB", "--local"],
  ["deploy", "--dry-run", "--outdir", "dist/worker"],
];
if (!allowed.some(command => JSON.stringify(command) === JSON.stringify(args))) {
  throw new Error("Use Voice's local development, migration, or dry-run build script.");
}
const cache = `${root}.cache`;
mkdirSync(`${cache}/tmp`, { recursive: true });
const cli = resolve(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin/wrangler.js");
const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: `${cache}/wrangler/logs`,
    XDG_CONFIG_HOME: `${cache}/config`,
    XDG_CACHE_HOME: cache,
    TMPDIR: `${cache}/tmp`,
  },
});
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  stopping = true;
  child.kill(signal);
});
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = stopping ? 0 : code ?? 1; });
