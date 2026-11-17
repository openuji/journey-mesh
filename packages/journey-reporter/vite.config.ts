import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  base: "./",
  publicDir: command === "serve" ? process.env.JOURNEY_REPORT_DIRECTORY || false : false,
  esbuild: { jsx: "automatic" },
  build: { outDir: "../dist/app", emptyOutDir: true }
}));
