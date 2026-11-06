import { defineConfig } from "tsup";

// Bundle the workspace SDK (shipped as TS source); keep npm deps external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  noExternal: [/^@leash\//],
  banner: { js: "#!/usr/bin/env node" },
});
