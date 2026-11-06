// Stage the public npm package in packages/sdk/.publish/ from the tsup build in dist/.
// The workspace package stays "@leash/sdk" (the npm name @leash/sdk belongs to an unrelated project), so the
// published name, entry points and dependency list are written here instead of in package.json.
//   pnpm --filter @leash/sdk build && pnpm --filter @leash/sdk stage
//   cd packages/sdk/.publish && npm publish --access public
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLIC_NAME = "@soumyaexe/leash-sdk";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".publish");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(join(root, "dist", "index.js"))) throw new Error("dist/ is missing: run the build first");

// only what the built code imports (checked with: grep -rhoE 'from "[^".][^"]*"' src)
const RUNTIME = ["@noble/hashes", "@solana/spl-token", "@solana/web3.js", "bs58", "buffer"];
const dependencies = Object.fromEntries(RUNTIME.map((d) => {
  const v = pkg.dependencies?.[d];
  if (!v) throw new Error(`${d} is imported but not in package.json dependencies`);
  return [d, v];
}));

const entry = (name) => ({
  import: { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` },
  require: { types: `./dist/${name}.d.cts`, default: `./dist/${name}.cjs` },
});

const publicPkg = {
  name: PUBLIC_NAME,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  type: "module",
  main: "./dist/index.cjs",
  module: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": entry("index"),
    "./errors": entry("errors"),
    "./mandate": entry("mandate"),
    "./demo": entry("demo"),
    "./idl/leash.json": "./idl/leash.json",
    "./package.json": "./package.json",
  },
  files: ["dist", "idl", "README.md", "LICENSE"],
  sideEffects: false,
  keywords: ["solana", "anchor", "ai-agents", "agent-wallet", "x402", "spending-policy", "devnet"],
  engines: { node: ">=20" },
  dependencies,
};

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "idl"), { recursive: true });
cpSync(join(root, "dist"), join(out, "dist"), { recursive: true });
cpSync(join(root, "src", "idl", "leash.json"), join(out, "idl", "leash.json"));
cpSync(join(root, "..", "..", "LICENSE"), join(out, "LICENSE"));
// The README already uses the public name for install and import lines (and warns that @leash/sdk on npm is
// someone else's), so it is copied as is; fail if an install line points at the wrong package.
const readme = readFileSync(join(root, "README.md"), "utf8");
const wrong = readme.split("\n").filter((l) => /(pnpm add|yarn add|npm i(nstall)?) @leash\/sdk/.test(l) && !/unrelated|their/i.test(l));
if (wrong.length) throw new Error(`README install line points at @leash/sdk:\n${wrong.join("\n")}`);
writeFileSync(join(out, "README.md"), readme);
writeFileSync(join(out, "package.json"), JSON.stringify(publicPkg, null, 2) + "\n");
console.log(`staged ${PUBLIC_NAME}@${pkg.version} in ${out}`);
