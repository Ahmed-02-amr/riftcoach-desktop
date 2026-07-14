import { app } from "electron";
import log from "electron-log";
import { createRiftCoachApp } from "./runtime";

log.initialize();
log.transports.file.level = "info";
log.transports.console.level = "debug";

process.on("uncaughtException", (error) => {
  log.error("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", reason);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const runtime = createRiftCoachApp();

  app.on("second-instance", () => {
    runtime.showMainWindow();
  });

  app.whenReady().then(async () => {
    await runtime.start();
  });

  app.on("window-all-closed", () => {
    // Keep the process alive for tray/background recording.
  });

  app.on("before-quit", async () => {
    await runtime.stop();
  });
}
