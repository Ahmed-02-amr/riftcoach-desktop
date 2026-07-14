import { BrowserWindow, app, dialog, ipcMain, type OpenDialogOptions } from "electron";
import type Database from "better-sqlite3";
import { DEFAULT_SETTINGS, normalizeAppSettings, testConfiguredWebSearch, type AppSettings } from "@riftcoach/core";
import { OllamaCoachProvider } from "@riftcoach/ai";
import {
  JournalRepository,
  MaintenanceRepository,
  ReportRepository,
  SessionRepository,
  SettingsRepository
} from "@riftcoach/storage";
import type { CredentialStore } from "./services/credential-store";
import type { LiveSessionService } from "./services/live-session-service";
import type { ReportCoordinator } from "./services/report-coordinator";
import type { ReviewChatService } from "./services/review-chat-service";
import type { ScreenshotService } from "./services/screenshot-service";
import type { VisualReviewService } from "./services/visual-review-service";

interface IpcContext {
  getWindow(): BrowserWindow | null;
  db: Database.Database;
  settingsRepo: SettingsRepository;
  credentialStore: CredentialStore;
  liveSessionService: LiveSessionService;
  reportCoordinator: ReportCoordinator;
  reviewChatService: ReviewChatService;
  screenshotService: ScreenshotService;
  visualReviewService: VisualReviewService;
  deleteAllLocalFiles(): void;
}

export function registerIpcHandlers(ctx: IpcContext): () => void {
  const handlers: Array<[string, (...args: any[]) => any]> = [
    ["status:get", () => ctx.liveSessionService.getStatus()],
    ["settings:get", () => ctx.settingsRepo.getAppSettings(DEFAULT_SETTINGS)],
    ["settings:save", (_event, settings: AppSettings) => {
      const before = ctx.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
      const merged = normalizeAppSettings(settings);
      ctx.settingsRepo.setAppSettings(merged);
      app.setLoginItemSettings({ openAtLogin: merged.startOnLogin });
      if (before.pollIntervalMs !== merged.pollIntervalMs) ctx.liveSessionService.restart();
      return merged;
    }],
    ["credentials:set-api-token", async (_event, token: string) => {
      await ctx.credentialStore.setSecret("api-token", token);
      return { ok: true };
    }],
    ["credentials:delete-api-token", async () => {
      await ctx.credentialStore.deleteSecret("api-token");
      return { ok: true };
    }],
    ["credentials:set-web-search-token", async (_event, token: string) => {
      await ctx.credentialStore.setSecret("ollama-web-search-token", token);
      return { ok: true };
    }],
    ["credentials:delete-web-search-token", async () => {
      await ctx.credentialStore.deleteSecret("ollama-web-search-token");
      return { ok: true };
    }],
    ["sessions:list", () => new SessionRepository(ctx.db).list(100)],
    ["sessions:stop-active", async () => {
      await ctx.liveSessionService.stopActiveSession();
      return ctx.liveSessionService.getStatus();
    }],
    ["sessions:generate-report", async (_event, sessionId?: string) => {
      return sessionId ? ctx.reportCoordinator.generateForSession(sessionId) : ctx.reportCoordinator.generateForLatestEndedSession();
    }],
    ["reports:list", () => new ReportRepository(ctx.db).list(100)],
    ["reports:get", (_event, reportId: string) => new ReportRepository(ctx.db).get(reportId)],
    ["review-chat:list", (_event, reportId: string) => ctx.reviewChatService.listMessages(reportId)],
    ["review-chat:send", (_event, reportId: string, content: string) => ctx.reviewChatService.sendMessage(reportId, content)],
    ["journal:list", () => {
      const reports = new ReportRepository(ctx.db).list(100);
      const sessions = new SessionRepository(ctx.db);
      const journal = new JournalRepository(ctx.db);
      const settings = ctx.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
      for (const report of reports) {
        if (!journal.hasReport(report.id)) {
          journal.saveFromReport(report, sessions.get(report.sessionId), { rank: settings.playerRank, lp: settings.playerLp });
        }
      }
      return journal.list(100);
    }],
    ["visual:list-frames", (_event, sessionId: string) => ctx.visualReviewService.listFrames(sessionId)],
    ["visual:list-observations", (_event, sessionId: string) => ctx.visualReviewService.listObservations(sessionId)],
    ["visual:list-vod-imports", (_event, sessionId: string) => ctx.visualReviewService.listVodImports(sessionId)],
    ["visual:get-frame-data-url", (_event, filePath: string) => ctx.visualReviewService.readFrameDataUrl(filePath)],
    ["visual:select-vod", async () => {
      const win = ctx.getWindow();
      const options: OpenDialogOptions = {
        title: "Select a VOD or ROFL replay file",
        properties: ["openFile"],
        filters: [{ name: "Video and replay files", extensions: ["mp4", "mkv", "mov", "webm", "rofl"] }]
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      return result.canceled ? undefined : result.filePaths[0];
    }],
    ["visual:import-vod", async (_event, sessionId: string, options?: { filePath?: string; videoStartOffsetSec?: number }) => {
      if (!sessionId) throw new Error("Session id is required for VOD import.");
      let filePath = options?.filePath;
      if (!filePath) {
        const win = ctx.getWindow();
        const dialogOptions: OpenDialogOptions = {
          title: "Attach video evidence to RiftCoach review",
          properties: ["openFile"],
          filters: [{ name: "Video files", extensions: ["mp4", "mkv", "mov", "webm"] }]
        };
        const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
        if (result.canceled) return undefined;
        filePath = result.filePaths[0];
      }
      if (!filePath) return undefined;
      return ctx.reportCoordinator.importVodForSession(sessionId, filePath, {
        videoStartOffsetSec: options?.videoStartOffsetSec
      });
    }],
    ["visual:create-vod-review", async (_event, options?: { filePath?: string; videoStartOffsetSec?: number }) => {
      let filePath = options?.filePath;
      if (!filePath) {
        const win = ctx.getWindow();
        const dialogOptions: OpenDialogOptions = {
          title: "Upload a VOD or ROFL replay for RiftCoach review",
          properties: ["openFile"],
          filters: [{ name: "Video and replay files", extensions: ["mp4", "mkv", "mov", "webm", "rofl"] }]
        };
        const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
        if (result.canceled) return undefined;
        filePath = result.filePaths[0];
      }
      if (!filePath) return undefined;
      return ctx.reportCoordinator.createVodReview(filePath, {
        videoStartOffsetSec: options?.videoStartOffsetSec
      });
    }],
    ["providers:test-ollama", async (_event, override?: Partial<AppSettings>) => {
      const settings = normalizeAppSettings({ ...ctx.settingsRepo.getAppSettings(DEFAULT_SETTINGS), ...(override ?? {}) });
      return new OllamaCoachProvider({ baseUrl: settings.ollamaBaseUrl, model: settings.ollamaModel, timeoutMs: settings.ollamaTimeoutMs }).health();
    }],
    ["providers:test-web-search", async (_event, override?: Partial<AppSettings>) => {
      const settings = normalizeAppSettings({ ...ctx.settingsRepo.getAppSettings(DEFAULT_SETTINGS), ...(override ?? {}) });
      const token = await ctx.credentialStore.getSecret("ollama-web-search-token");
      return testConfiguredWebSearch({ settings, ollamaApiKey: token });
    }],
    ["maintenance:delete-local-data", () => {
      new MaintenanceRepository(ctx.db).deleteAllLocalData();
      ctx.deleteAllLocalFiles();
      return { ok: true };
    }]
  ];

  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler);
  return () => {
    for (const [channel] of handlers) ipcMain.removeHandler(channel);
  };
}
