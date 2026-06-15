import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["dist/**", "node_modules/**"],
  },
  lint: {
    ignorePatterns: ["dist/**", "node_modules/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
  pack: {
    entry: ["src/cli.ts"],
    dts: false,
    format: ["esm"],
    sourcemap: false,
  },
});
