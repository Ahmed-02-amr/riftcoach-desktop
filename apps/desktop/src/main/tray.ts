import { Menu, Tray, app, nativeImage } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

interface TrayOptions {
  show(): void;
  quit(): void;
  generateReport(): void;
}

let tray: Tray | null = null;

export function createTray(options: TrayOptions): Tray {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "tray.png")
    : join(app.getAppPath(), "resources", "tray.png");
  const image = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip("RiftCoach");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open RiftCoach", click: options.show },
      { type: "separator" },
      { label: "Generate last report", click: options.generateReport },
      { type: "separator" },
      { label: "Quit", click: options.quit }
    ])
  );
  tray.on("double-click", options.show);
  return tray;
}
