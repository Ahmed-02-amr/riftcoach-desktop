import { app, BrowserWindow, Notification, shell } from "electron";
import log from "electron-log";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { DEFAULT_SETTINGS, type AppSettings } from "@riftcoach/core";
import { LocalDb, MaintenanceRepository, SettingsRepository } from "@riftcoach/storage";
import { registerIpcHandlers } from "./ipc";
import { createTray } from "./tray";
import { CredentialStore } from "./services/credential-store";
import { LiveSessionService } from "./services/live-session-service";
import { ReportCoordinator } from "./services/report-coordinator";
import { ReviewChatService } from "./services/review-chat-service";
import { ScreenshotService } from "./services/screenshot-service";
import { VisualReviewService } from "./services/visual-review-service";

export interface RiftCoachRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  showMainWindow(): void;
  getMainWindow(): BrowserWindow | null;
}

function rendererEntryPath(): string {
  return join(app.getAppPath(), "dist", "index.html");
}

function preloadEntryPath(): string {
  // tsup preserves the src/main and src/preload directory names when multiple
  // entries are built, so __dirname is dist-electron/main at runtime.
  return join(__dirname, "..", "preload", "preload.js");
}

export function createRiftCoachApp(): RiftCoachRuntime {
  let mainWindow: BrowserWindow | null = null;
  let db: LocalDb | null = null;
  let liveSessionService: LiveSessionService | null = null;
  let unsubscribeIpc: (() => void) | null = null;
  let isQuitting = false;

  function getSettingsRepo(): SettingsRepository {
    if (!db) throw new Error("Database is not initialized");
    return new SettingsRepository(db.db);
  }

  async function createWindow(settings: AppSettings): Promise<BrowserWindow> {
    const preload = preloadEntryPath();
    const icon = join(app.getAppPath(), "resources", "icon.ico");
    log.info("Creating main window", { devServer: process.env.VITE_DEV_SERVER_URL ?? null, preload, icon });

    const window = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 960,
      minHeight: 620,
      show: false,
      title: "RiftCoach",
      backgroundColor: "#0b1020",
      icon,
      autoHideMenuBar: true,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    window.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });

    window.webContents.on("will-navigate", (event, url) => {
      const devUrl = process.env.VITE_DEV_SERVER_URL;
      const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith("file://");
      if (!allowed) event.preventDefault();
    });

    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      log.error("Renderer failed to load", { errorCode, errorDescription, validatedURL });
      window.show();
    });

    window.webContents.on("render-process-gone", (_event, details) => {
      log.error("Renderer process gone", details);
    });

    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      log.debug("renderer console", { level, message, line, sourceId });
    });

    window.webContents.on("preload-error", (_event, preloadPath, error) => {
      log.error("Preload failed", { preloadPath, error });
    });

    window.once("ready-to-show", () => window.show());
    window.webContents.once("did-finish-load", () => {
      // Defensive fallback: in some dev setups ready-to-show can be missed or
      // delayed if the renderer throws before first paint. Show the shell so the
      // devtools/logs are reachable instead of silently looking like no app ran.
      if (!window.isVisible()) window.show();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      await window.loadURL(process.env.VITE_DEV_SERVER_URL);
      window.webContents.openDevTools({ mode: "detach" });
    } else {
      await window.loadFile(rendererEntryPath());
    }

    window.on("close", (event) => {
      if (settings.minimizeToTray && !isQuitting) {
        event.preventDefault();
        window.hide();
      }
    });

    return window;
  }

  async function start(): Promise<void> {
    app.setAppUserModelId("com.riftcoach.desktop");
    app.on("before-quit", () => {
      isQuitting = true;
    });

    const userData = app.getPath("userData");
    db = new LocalDb(join(userData, "riftcoach.sqlite"));
    const settingsRepo = new SettingsRepository(db.db);
    const settings = settingsRepo.getAppSettings(DEFAULT_SETTINGS);

    app.setLoginItemSettings({ openAtLogin: settings.startOnLogin });

    const screenshotService = new ScreenshotService({ userDataPath: userData });
    const visualReviewService = new VisualReviewService({ db: db.db, userDataPath: userData });
    const credentialStore = new CredentialStore();
    const reportCoordinator = new ReportCoordinator({
      db: db.db,
      settingsRepo,
      credentialStore,
      screenshotService,
      visualReviewService,
      notify: (title, body) => {
        if (!settingsRepo.getAppSettings(DEFAULT_SETTINGS).notificationsEnabled) return;
        if (Notification.isSupported()) new Notification({ title, body }).show();
      }
    });
    const reviewChatService = new ReviewChatService({
      db: db.db,
      settingsRepo,
      credentialStore
    });

    liveSessionService = new LiveSessionService({
      db: db.db,
      settingsRepo,
      screenshotService,
      reportCoordinator
    });

    liveSessionService.on("status", (status) => {
      mainWindow?.webContents.send("status:update", status);
    });

    mainWindow = await createWindow(settings);
    createTray({
      show: () => showMainWindow(),
      quit: () => {
        isQuitting = true;
        app.quit();
      },
      generateReport: () => reportCoordinator.generateForLatestEndedSession().catch((error) => log.error(error))
    });

    unsubscribeIpc = registerIpcHandlers({
      getWindow: () => mainWindow,
      db: db.db,
      settingsRepo,
      credentialStore,
      liveSessionService,
      reportCoordinator,
      reviewChatService,
      screenshotService,
      visualReviewService,
      deleteAllLocalFiles: () => {
        new MaintenanceRepository(db!.db).deleteAllLocalData();
        const screenshots = join(userData, "screenshots");
        const vodFrames = join(userData, "vod-frames");
        if (existsSync(screenshots)) rmSync(screenshots, { recursive: true, force: true });
        if (existsSync(vodFrames)) rmSync(vodFrames, { recursive: true, force: true });
      }
    });

    liveSessionService.start();
  }

  async function stop(): Promise<void> {
    unsubscribeIpc?.();
    liveSessionService?.stop();
    db?.close();
  }

  function showMainWindow(): void {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  return {
    start,
    stop,
    showMainWindow,
    getMainWindow: () => mainWindow
  };
}
