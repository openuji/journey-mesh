import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** `pnpm dev` serves a run directory as public files: JOURNEY_RUN_DIRECTORY=<run> pnpm dev */
export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL("./src", import.meta.url)),
  base: "./",
  publicDir: command === "serve" ? process.env.JOURNEY_RUN_DIRECTORY || false : false,
  esbuild: { jsx: "automatic" },
  build: { outDir: "../dist", emptyOutDir: true }
}));
