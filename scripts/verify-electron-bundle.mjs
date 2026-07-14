import fs from "node:fs";
import path from "node:path";

const mainPath = path.resolve("apps/desktop/dist-electron/main/main.js");
if (!fs.existsSync(mainPath)) {
  console.error(`Missing Electron main bundle: ${mainPath}`);
  process.exit(1);
}

const source = fs.readFileSync(mainPath, "utf8");
const forbiddenMarkers = [
  "Electron failed to install correctly",
  "getElectronPath",
  "path.txt"
];

const found = forbiddenMarkers.filter((marker) => source.includes(marker));
if (found.length > 0) {
  console.error("Electron npm package appears to be bundled into the main process.");
  console.error(`Forbidden markers: ${found.join(", ")}`);
  console.error("Expected fix: apps/desktop/tsup.config.ts must externalize 'electron'.");
  process.exit(1);
}

console.log("Electron bundle verification passed.");
