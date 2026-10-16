import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Keep Wrangler's logs/config/cache inside Canopy. Remote commands are restricted
// to explicit staging actions and the two dedicated staging configurations.
const root = fileURLToPath(new URL("../", import.meta.url));
let args = process.argv.slice(2);
let cwd = process.cwd();
const staging = args[0] === "staging";
if (staging) {
  const action = args[1];
  const commands = {
    whoami: ["whoami"],
    login: ["login"],
    "create-db": ["d1", "create", "canopy-accounts-stg"],
    migrate: ["d1", "migrations", "apply", "DB", "--remote"],
    "build:api": ["deploy", "--dry-run", "--outdir", "dist-staging"],
    "build:console": ["deploy", "--dry-run"],
    "deploy:api": ["deploy"],
    "deploy:console": ["deploy"],
  };
  if (args.length !== 2 || !Object.hasOwn(commands, action)) throw new Error("Unknown staging action.");
  const consoleWorker = action.endsWith(":console");
  cwd = `${root}platform/${consoleWorker ? "console" : "accounts"}`;
  const config = JSON.parse(readFileSync(`${cwd}/wrangler.staging.jsonc`, "utf8"));
  const name = consoleWorker ? "canopy-console-stg" : "canopy-accounts-stg";
  const host = consoleWorker ? "stg.mainbrella.com" : "api-stg.mainbrella.com";
  if (config.name !== name || config.account_id !== "2b7a9be82bb64187230703b024e25157"
    || config.routes?.length !== 1 || config.routes[0].pattern !== host || config.routes[0].custom_domain !== true
    || (!consoleWorker && (config.d1_databases?.length !== 1 || config.d1_databases[0].database_name !== name))) {
    throw new Error("Staging configuration does not match the dedicated Canopy resources.");
  }
  if (action === "migrate" || action === "deploy:api") {
    const id = config.d1_databases[0].database_id;
    if (!/^[a-f0-9-]{36}$/.test(id) || id === "41be6d7b-26fb-4701-a3fb-fdf3454e14f9") {
      throw new Error("Create a separate staging database and set its ID before migrating or deploying.");
    }
  }
  args = [...commands[action], "--config", "wrangler.staging.jsonc"];
}
const local = args[0] === "dev" && args.includes("--local")
  || args.slice(0, 3).join(" ") === "d1 migrations apply" && args.includes("--local")
  || args[0] === "deploy" && args.includes("--dry-run");
if (!staging && (!local || args.some(arg => /^--(remote|env|config|cwd)(=|$)/.test(arg) || arg === "-e" || arg === "-c"))) {
  throw new Error("Use local commands or an explicit staging action.");
}
const cache = `${root}.cache`;
mkdirSync(`${cache}/tmp`, { recursive: true });
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), ...args], {
  stdio: "inherit",
  cwd,
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
