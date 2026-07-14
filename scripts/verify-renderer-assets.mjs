import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const indexPath = join(process.cwd(), "apps", "desktop", "dist", "index.html");
if (!existsSync(indexPath)) {
  console.error(`Renderer index not found: ${indexPath}`);
  process.exit(1);
}

const html = readFileSync(indexPath, "utf8");
const absoluteAssetPatterns = [
  /(?:src|href)=["']\/assets\//,
  /(?:src|href)=["']\/src\//
];

for (const pattern of absoluteAssetPatterns) {
  if (pattern.test(html)) {
    console.error("Renderer build uses absolute asset paths. Set Vite base to './' for Electron file:// packaging.");
    console.error(html);
    process.exit(1);
  }
}

if (!html.includes("./assets/")) {
  console.warn("Renderer index did not contain './assets/'. Check Vite output manually if the app window is blank.");
}

console.log("Renderer asset path verification passed.");
