import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  // Spark ships a WebAssembly module that Vite must not pre-bundle.
  optimizeDeps: { exclude: ["@sparkjsdev/spark"] },
});
