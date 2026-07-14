import { defineConfig } from "tsup";

// Keep Electron as an external runtime module. If tsup bundles the npm package
// named "electron", the compiled main process can throw:
// "Electron failed to install correctly".
export default defineConfig({
  entry: ["src/main/main.ts", "src/preload/preload.ts"],
  format: ["cjs"],
  platform: "node",
  target: "es2022",
  outDir: "dist-electron",
  sourcemap: true,
  clean: true,
  external: ["electron", "better-sqlite3", "ffmpeg-static", "ffprobe-static"],
  splitting: false,
  shims: false
});
