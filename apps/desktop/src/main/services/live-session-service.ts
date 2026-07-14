import { EventEmitter } from "node:events";
import log from "electron-log";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { DEFAULT_SETTINGS, normalizeEvents, normalizeLiveData, nowIso, type AppSettings } from "@riftcoach/core";
import { LiveClientReader } from "@riftcoach/riot";
import { EventRepository, SessionRepository, SettingsRepository, SnapshotRepository, VisualRepository } from "@riftcoach/storage";
import type { ScreenshotService } from "./screenshot-service";
import type { ReportCoordinator } from "./report-coordinator";

export interface LiveSessionStatus {
  state: "idle" | "recording" | "league-not-running" | "error";
  sessionId?: string;
  gameTimeSec?: number;
  snapshotsRecorded: number;
  lastError?: string;
  updatedAtIso: string;
}

interface LiveSessionServiceOptions {
  db: Database.Database;
  settingsRepo: SettingsRepository;
  screenshotService: ScreenshotService;
  reportCoordinator: ReportCoordinator;
}

export class LiveSessionService extends EventEmitter {
  private readonly reader = new LiveClientReader();
  private readonly sessions: SessionRepository;
  private readonly snapshots: SnapshotRepository;
  private readonly events: EventRepository;
  private readonly visuals: VisualRepository;
  private timer: NodeJS.Timeout | undefined;
  private activeSessionId: string | undefined;
  private snapshotsRecorded = 0;
  private lastScreenshotAtSec = -Infinity;
  private manualStopped = false;
  private currentStatus: LiveSessionStatus = {
    state: "league-not-running",
    snapshotsRecorded: 0,
    updatedAtIso: nowIso()
  };

  constructor(private readonly options: LiveSessionServiceOptions) {
    super();
    this.sessions = new SessionRepository(options.db);
    this.snapshots = new SnapshotRepository(options.db);
    this.events = new EventRepository(options.db);
    this.visuals = new VisualRepository(options.db);
  }

  start(): void {
    if (this.timer) return;
    this.manualStopped = false;
    void this.pollOnce();
    const interval = this.settings().pollIntervalMs;
    this.timer = setInterval(() => void this.pollOnce(), interval);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.manualStopped = true;
  }

  restart(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.manualStopped = false;
    this.start();
  }

  getStatus(): LiveSessionStatus {
    return {
      ...this.currentStatus,
      sessionId: this.activeSessionId ?? this.currentStatus.sessionId,
      snapshotsRecorded: this.snapshotsRecorded,
      updatedAtIso: nowIso()
    };
  }

  async stopActiveSession(): Promise<void> {
    if (!this.activeSessionId) return;
    await this.finishSession(this.activeSessionId);
  }

  private async pollOnce(): Promise<void> {
    if (this.manualStopped) return;
    let liveData: any;
    try {
      liveData = await this.reader.readAllGameData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.activeSessionId) {
        await this.finishSession(this.activeSessionId);
      } else {
        this.emitStatus({
          state: "league-not-running",
          lastError: isExpectedLiveClientOffline(message) ? undefined : message
        });
      }
      return;
    }

    try {
      const sessionId = this.activeSessionId ?? this.createSession(liveData);
      const snapshot = normalizeLiveData(sessionId, liveData);
      const events = normalizeEvents(liveData);
      this.snapshots.insert(sessionId, snapshot, liveData);
      this.events.upsertMany(sessionId, events);
      this.snapshotsRecorded += 1;

      await this.maybeCaptureScreenshot(sessionId, snapshot.timestampSec);

      this.emitStatus({
        state: "recording",
        sessionId,
        gameTimeSec: snapshot.timestampSec
      });
    } catch (error) {
      log.error("Live session poll failed", error);
      this.emitStatus({ state: "error", lastError: error instanceof Error ? error.message : String(error) });
    }
  }

  private createSession(liveData: any): string {
    const settings = this.settings();
    const sessionId = nanoid(12);
    const snapshot = normalizeLiveData(sessionId, liveData);
    this.sessions.create({
      id: sessionId,
      riotGameId: String(liveData?.gameData?.gameID ?? liveData?.gameData?.gameId ?? ""),
      champion: snapshot.player.championName,
      role: snapshot.player.role,
      startedAt: nowIso(),
      aiMode: settings.aiMode
    });
    this.activeSessionId = sessionId;
    this.snapshotsRecorded = 0;
    this.lastScreenshotAtSec = -Infinity;
    log.info(`Started local session ${sessionId}`);
    return sessionId;
  }

  private async finishSession(sessionId: string): Promise<void> {
    this.sessions.end(sessionId, nowIso());
    this.activeSessionId = undefined;
    this.snapshotsRecorded = 0;
    this.lastScreenshotAtSec = -Infinity;
    this.emitStatus({ state: "league-not-running" });
    log.info(`Finished local session ${sessionId}`);
    void this.options.reportCoordinator.generateForSession(sessionId).catch((error) => log.error("auto report generation failed", error));
  }

  private async maybeCaptureScreenshot(sessionId: string, timestampSec: number): Promise<void> {
    const settings = this.settings();
    if (!settings.captureScreenshots) return;
    if (timestampSec - this.lastScreenshotAtSec < settings.screenshotIntervalSec) return;
    const frame = await this.options.screenshotService.capturePrimaryScreen(sessionId, timestampSec);
    if (frame) {
      this.visuals.saveFrame(frame);
      this.lastScreenshotAtSec = timestampSec;
    }
  }

  private settings(): AppSettings {
    return this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
  }

  private emitStatus(partial: Partial<LiveSessionStatus>): void {
    const status: LiveSessionStatus = {
      state: partial.state ?? (this.activeSessionId ? "recording" : "idle"),
      sessionId: partial.sessionId ?? this.activeSessionId,
      gameTimeSec: partial.gameTimeSec,
      snapshotsRecorded: this.snapshotsRecorded,
      lastError: partial.lastError,
      updatedAtIso: nowIso()
    };
    this.currentStatus = status;
    this.emit("status", status);
  }
}

function isExpectedLiveClientOffline(message: string): boolean {
  return /ECONNREFUSED|127\.0\.0\.1:2999|Live Client API request timed out|socket hang up/i.test(message);
}
