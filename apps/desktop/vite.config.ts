import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  // Required for packaged Electron loadFile(). Vite defaults to absolute
  // /assets paths, which resolve to file:///assets/... and leave the
  // production desktop window blank.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
    alias: {
      "@renderer": resolve(__dirname, "src/renderer")
    }
  }
});
