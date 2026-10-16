import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Keep Wrangler's logs/config/cache inside Canopy too. Only local commands are
// exposed during this milestone; there is no production deployment configuration.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const local = args[0] === "dev" && args.includes("--local")
  || args.slice(0, 3).join(" ") === "d1 migrations apply" && args.includes("--local")
  || args[0] === "deploy" && args.includes("--dry-run");
if (!local || args.some(arg => /^--(remote|env|config|cwd)(=|$)/.test(arg) || arg === "-e" || arg === "-c")) {
  throw new Error("This milestone supports local development, local migrations and dry-run builds only.");
}
const cache = `${root}.cache`;
mkdirSync(`${cache}/tmp`, { recursive: true });
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), ...args], {
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
