import { defineConfig } from "tsup";

// Build for npm. Inside the monorepo the workspace imports src/*.ts directly; only the published package uses dist/.
// Runtime deps stay external (tsup reads them from package.json).
export default defineConfig({
  entry: {
    index: "src/index.ts",
    errors: "src/errors.ts",
    mandate: "src/mandate.ts",
    demo: "src/demo.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  outDir: "dist",
  splitting: true,
  treeshake: true,
});
