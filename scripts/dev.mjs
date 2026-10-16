import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// Refuse occupied ports before running migrations or starting a partial stack.
for (const port of [5175, 8789]) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Canopy needs port ${port}. Stop the process using it and retry.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());

function run(script, workspace) {
  const args = ["run", script, ...(workspace ? ["--workspace", workspace] : [])];
  const child = spawn("npm", args, { cwd: root, stdio: "inherit", detached: process.platform !== "win32" });
  children.add(child);
  child.once("error", error => { console.error(error.message); children.delete(child); stop(1); });
  child.once("exit", () => children.delete(child));
  return child;
}

const migration = run("db:migrate:local");
const result = await new Promise(resolve => {
  migration.once("error", () => resolve(1));
  migration.once("exit", code => resolve(code ?? 1));
});
if (result !== 0 || stopping) {
  stop(1);
} else {
  for (const workspace of ["@canopy/accounts", "@canopy/console"]) {
    run("dev", workspace).once("exit", code => { if (!stopping) stop(code || 1); });
  }
}
