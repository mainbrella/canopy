import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const product = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = `${product}dist/source`;
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--allow-dirty")) throw new Error("Only --allow-dirty is supported (for local verification).");
const git = (...values) => execFileSync("git", ["-C", root, ...values], { encoding: "utf8" }).trim();
const dirty = Boolean(git("status", "--porcelain", "--untracked-files=all"));
if (dirty && !args.includes("--allow-dirty")) throw new Error("Commit the source before exporting a release, or use --allow-dirty for local verification.");
const pkg = JSON.parse(await readFile(`${product}package.json`, "utf8"));
delete pkg.scripts["catalog:manifest"];
const lock = JSON.parse(await readFile(`${root}package-lock.json`, "utf8"));
const wrapper = { name: "@canopy/voice-source", version: pkg.version, private: true, type: "module", license: pkg.license,
  engines: pkg.engines, workspaces: ["products/voice"],
  scripts: Object.fromEntries(Object.keys(pkg.scripts).map(name => [name, `npm run ${name} --workspace @canopy/voice`])) };
const packages = { "": wrapper, "node_modules/@canopy/voice": { resolved: "products/voice", link: true } };

function resolveDependency(from, name) {
  for (let directory = from; ; directory = dirname(directory) === "." ? "" : dirname(directory)) {
    const path = `${directory ? `${directory}/` : ""}node_modules/${name}`;
    if (lock.packages[path]) return path;
    if (!directory) return null;
  }
}
// Preserve npm's existing workspace and peer-dependency placement. The export
// contains only Voice and its dependency closure, with no version re-resolution.
function include(path, initial = false) {
  if (packages[path]) return;
  const entry = lock.packages[path];
  if (!entry || entry.link) throw new Error(`Voice has an unresolved workspace dependency at ${path}.`);
  packages[path] = entry;
  const names = Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies,
    ...(initial ? entry.devDependencies : {}) });
  for (const name of names) {
    const resolved = resolveDependency(path, name);
    if (resolved) include(resolved);
    else if (entry.dependencies?.[name] && !entry.optionalDependencies?.[name]) throw new Error(`Unresolved dependency ${name} in ${path}.`);
  }
}
include("products/voice", true);

for (const path of [".dev.vars", "wrangler.install.jsonc", ".wrangler/state"]) {
  if (existsSync(`${output}/${path}`) || existsSync(`${output}/products/voice/${path}`)) {
    throw new Error("The existing export contains local configuration or database state. Move it before generating a new export.");
  }
}
await rm(output, { recursive: true, force: true });
const target = `${output}/products/voice`;
await mkdir(`${target}/scripts`, { recursive: true });
for (const path of ["worker", "src", "test", "public", "migrations", "index.html", "login.html", "handoff.html", "vite.config.ts",
  "tsconfig.worker.json", "tsconfig.client.json", "wrangler.jsonc", ".dev.vars.example", "README.md", "NOTICE.md", "LICENSE"]) {
  await cp(`${product}${path}`, `${target}/${path}`, { recursive: true });
}
await cp(`${product}scripts/wrangler.mjs`, `${target}/scripts/wrangler.mjs`);
await cp(`${product}scripts/test.mjs`, `${target}/scripts/test.mjs`);
await mkdir(`${target}/docs`, { recursive: true });
for (const path of ["telephony.md", "voice-languages.md", "installation.md"]) await cp(`${product}docs/${path}`, `${target}/docs/${path}`);
await writeFile(`${target}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
await writeFile(`${output}/package.json`, `${JSON.stringify(wrapper, null, 2)}\n`);
await writeFile(`${output}/package-lock.json`, `${JSON.stringify({ name: wrapper.name, version: pkg.version, lockfileVersion: 3, requires: true, packages }, null, 2)}\n`);
await writeFile(`${output}/SOURCE.json`, `${JSON.stringify({ repository: "https://github.com/mainbrella/canopy",
  revision: git("rev-parse", "HEAD"), version: pkg.version, dirty, release: !dirty }, null, 2)}\n`);
const provenance = JSON.parse(await readFile(`${root}migration-sources.json`, "utf8"));
provenance.files = provenance.files.filter(file => file.destination.startsWith("products/voice/") && existsSync(`${output}/${file.destination}`));
await writeFile(`${output}/migration-sources.json`, `${JSON.stringify(provenance, null, 2)}\n`);
await cp(`${product}LICENSE`, `${output}/LICENSE`);
await writeFile(`${output}/README.md`, "# Mainbrella Voice source\n\nThis export contains only Voice and its locked dependencies. See [setup and installation](products/voice/README.md) and SOURCE.json.\n\nRun `npm ci`, `npm run type-check`, `npm test`, and `npm run build` here. The one-product workspace preserves npm's dependency and peer resolution without installing Canopy's platform services.\n");
await writeFile(`${output}/.npmrc`, "cache=.cache/npm\nfund=false\n");
await writeFile(`${output}/.gitignore`, "node_modules/\ndist/\n.wrangler/\n.cache/\n.dev.vars\n.env*\nwrangler.install.jsonc\n");
process.stdout.write(`Voice source: ${output}\n${dirty ? "Uncommitted verification export; not a release." : "Source and dependency versions pinned; see SOURCE.json."}\n`);
