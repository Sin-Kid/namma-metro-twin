// Builds the static site into dist/ and injects the Mapbox public token.
// The token comes from the MAPBOX_TOKEN environment variable (Netlify) or a local .env file.
// It is never stored in the repository.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const src = join(root, "src"), dist = join(root, "dist");

function loadDotEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotEnv();

const token = (process.env.MAPBOX_TOKEN || "").trim();
if (!token) {
  console.error("MAPBOX_TOKEN is not set. Add it to .env for local builds, or to the Netlify site's environment variables.");
  process.exit(1);
}
if (!token.startsWith("pk.")) {
  console.error("MAPBOX_TOKEN must be a public token (starts with pk.). Never ship a secret sk. token to the browser.");
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dist, f));
writeFileSync(join(dist, "config.js"), `window.MAPBOX_TOKEN=${JSON.stringify(token)};\n`);
console.log(`Built ${readdirSync(dist).length} files into dist/`);
