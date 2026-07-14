import log from "electron-log";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { nanoid } from "nanoid";
import type Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  buildRawLiveDataTelemetry,
  buildKnowledgeContext,
  createMatchContextFromSnapshots,
  formatTime,
  isCasualReviewMode,
  phaseFromTime,
  retrieveConfiguredWebKnowledge,
  runExpertRules,
  runVisualReviewRules,
  type AppSettings,
  type CoachReport,
  type CoachReportInput,
  type KnowledgeContext,
  type KnowledgeSourceSnippet,
  type MatchContext,
  type NormalizedSnapshot,
  type VodImportResult
} from "@riftcoach/core";
import { OllamaCoachProvider, OpenAiProxyCoachProvider, enforceActionableCoachReport } from "@riftcoach/ai";
import { ReplayClient, type RiotReplayGame, type RiotReplayPlayback, type RiotReplayRender } from "@riftcoach/riot";
import {
  EventRepository,
  JournalRepository,
  ReportRepository,
  SessionRepository,
  SettingsRepository,
  SnapshotRepository
} from "@riftcoach/storage";
import type { CredentialStore } from "./credential-store";
import type { ScreenshotService } from "./screenshot-service";
import type { VisualReviewService } from "./visual-review-service";

interface ReportCoordinatorOptions {
  db: Database.Database;
  settingsRepo: SettingsRepository;
  credentialStore: CredentialStore;
  screenshotService: ScreenshotService;
  visualReviewService: VisualReviewService;
  notify(title: string, body: string): void;
}

export class ReportCoordinator {
  private readonly sessions: SessionRepository;
  private readonly snapshots: SnapshotRepository;
  private readonly events: EventRepository;
  private readonly reports: ReportRepository;
  private readonly journal: JournalRepository;

  constructor(private readonly options: ReportCoordinatorOptions) {
    this.sessions = new SessionRepository(options.db);
    this.snapshots = new SnapshotRepository(options.db);
    this.events = new EventRepository(options.db);
    this.reports = new ReportRepository(options.db);
    this.journal = new JournalRepository(options.db);
  }

  async generateForLatestEndedSession(): Promise<CoachReport | undefined> {
    const latest = this.sessions.getLatestEnded();
    if (!latest) return undefined;
    return this.generateForSession(latest.id);
  }

  async generateForSession(sessionId: string): Promise<CoachReport> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.sessions.updateReportStatus(sessionId, "generating");

    try {
      const context = await this.buildMatchContext(sessionId, session.startedAt, session.endedAt);
      await this.options.visualReviewService.createBookmarkObservations(context);
      const visualObservations = this.options.visualReviewService.listObservations(sessionId);
      const matchWithVisuals: MatchContext = { ...context, visualObservations };
      const casualMode = isCasualReviewMode(matchWithVisuals.game);
      const visualOnlyMode = isVisualOnlyReview(matchWithVisuals);
      const insights = casualMode ? [] : visualOnlyMode ? runVisualReviewRules(matchWithVisuals) : runExpertRules(matchWithVisuals);
      const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
      const webToken = await this.options.credentialStore.getSecret("ollama-web-search-token");
      const webKnowledge = casualMode
        ? { sources: [], warnings: [] }
        : await retrieveConfiguredWebKnowledge({ match: matchWithVisuals, settings, ollamaApiKey: webToken });
      if (!casualMode && settings.knowledgeMode === "web-assisted") {
        log.info("web enrichment completed", {
          sessionId,
          visualOnly: visualOnlyMode,
          sources: webKnowledge.sources.length,
          warnings: webKnowledge.warnings.length
        });
      }
      const knowledge = casualMode
        ? undefined
        : visualOnlyMode
          ? buildVisualOnlyKnowledgeContext({ settings, webSources: webKnowledge.sources, warnings: webKnowledge.warnings })
          : buildKnowledgeContext({
              match: matchWithVisuals,
              insights,
              settings,
              webSources: webKnowledge.sources,
              warnings: webKnowledge.warnings
            });
      const enrichedMatch: MatchContext = { ...matchWithVisuals, knowledgeContext: knowledge };
      const input: CoachReportInput = {
        match: enrichedMatch,
        insights,
        profile: {
          rank: settings.playerRank,
          mainRole: settings.mainRole
        },
        settings: {
          aiMode: settings.aiMode,
          privacyMode: settings.privacyMode,
          coachTone: settings.coachTone,
          knowledgeMode: settings.knowledgeMode
        },
        knowledge
      };

      const rawReport = await this.generateWithConfiguredProvider(input, settings);
      const actionableReport = enforceActionableCoachReport(rawReport, input);
      const report = attachKnowledgeToReport(actionableReport, knowledge);
      this.reports.save(report);
      this.journal.saveFromReport(report, session, { rank: settings.playerRank, lp: settings.playerLp });
      this.sessions.updateReportStatus(sessionId, "ready");

      this.options.notify("RiftCoach review ready", report.mainMistake.title);
      return report;
    } catch (error) {
      this.sessions.updateReportStatus(sessionId, "failed");
      log.error("report generation failed", error);
      throw error;
    }
  }

  async importVodForSession(sessionId: string, filePath: string, options?: { videoStartOffsetSec?: number }): Promise<VodImportResult> {
    if (isRoflReplayFile(filePath)) {
      throw new Error("ROFL replay files create standalone visual reviews. Attach-to-session import currently supports video files only.");
    }
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const context = await this.buildMatchContext(sessionId, session.startedAt, session.endedAt);
    return this.options.visualReviewService.importVodForMatch(context, filePath, options);
  }

  async createVodReview(filePath: string, options?: { videoStartOffsetSec?: number }): Promise<{
    sessionId: string;
    importResult: VodImportResult;
    report: CoachReport;
  }> {
    if (isRoflReplayFile(filePath)) return this.createRoflReplayReview(filePath);

    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const videoStartOffsetSec = cleanNumber(options?.videoStartOffsetSec, 0);
    const durationSec = await this.options.visualReviewService.probeVodDuration(filePath).catch((error) => {
      if (error instanceof Error && /VOD file not found/i.test(error.message)) throw error;
      log.warn("standalone VOD duration probe failed", error);
      return undefined;
    });
    const gameDurationSec = Math.max(0, (durationSec ?? 30 * 60) - videoStartOffsetSec);
    const endedAt = new Date().toISOString();
    const startedAt = new Date(Math.max(0, Date.now() - gameDurationSec * 1000)).toISOString();
    const sessionId = nanoid(12);

    this.sessions.create({
      id: sessionId,
      champion: "Uploaded VOD",
      role: settings.mainRole ?? "unknown",
      startedAt,
      aiMode: settings.aiMode
    });
    this.sessions.end(sessionId, endedAt);

    try {
      this.snapshots.insert(
        sessionId,
        createVisualOnlySnapshot({
          sessionId,
          durationSec: gameDurationSec,
          settings,
          gameMode: "VOD_REVIEW",
          mapName: "Uploaded local VOD",
          championName: "Unknown champion"
        }),
        { source: "standalone-vod", filePath, videoStartOffsetSec }
      );
      const context = await this.buildMatchContext(sessionId, startedAt, endedAt);
      const importResult = await this.options.visualReviewService.importVodForMatch(context, filePath, {
        ...options,
        videoStartOffsetSec,
        maxFrames: 18
      });
      const report = await this.generateForSession(sessionId);
      return { sessionId, importResult, report };
    } catch (error) {
      this.sessions.updateReportStatus(sessionId, "failed");
      throw error;
    }
  }

  private async createRoflReplayReview(filePath: string): Promise<{
    sessionId: string;
    importResult: VodImportResult;
    report: CoachReport;
  }> {
    const replayPath = resolve(filePath);
    if (!existsSync(replayPath)) throw new Error(`ROFL replay file not found: ${filePath}`);

    const warnings: string[] = [];
    const launchResult = await launchRoflReplay(replayPath);
    warnings.push(...launchResult.warnings);
    if (launchResult.needsManualOpen) {
      this.options.notify(
        "Open the League replay",
        "RiftCoach could not launch the .rofl file automatically. Open the replay in League now and leave RiftCoach waiting."
      );
    }

    const replayClient = new ReplayClient({ timeoutMs: 2500 });
    let playback: RiotReplayPlayback;
    const replayWaitMs = launchResult.needsManualOpen ? 180_000 : 90_000;
    try {
      playback = await waitForReplayPlayback(replayClient, replayWaitMs);
    } catch (error) {
      const launchNote = launchResult.launched
        ? ` Launched: ${launchResult.executablePath}.`
        : " Automatic replay launch was blocked or unavailable; open the replay manually from the League client.";
      const manualHelp = launchResult.needsManualOpen
        ? " If Windows or Riot Vanguard blocks external replay launchers, start the replay yourself, keep it on the current League patch, and leave RiftCoach open while it waits for Riot's local Replay API."
        : "";
      throw new Error(
        `ROFL replay support needs the League replay client running for that replay and Riot's local Replay API enabled. RiftCoach could not reach the Replay API after ${Math.round(replayWaitMs / 1000)} seconds.${launchNote}${manualHelp} ${formatProviderError(error)}`
      );
    }

    const replayGame = await replayClient.readGame().catch((error) => {
      warnings.push(`Replay API game metadata was not available: ${formatProviderError(error)}`);
      return undefined;
    });
    const initialRender = await replayClient.readRender().catch((error) => {
      warnings.push(`Replay API render metadata was not available before capture: ${formatProviderError(error)}`);
      return undefined;
    });
    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const durationSec = cleanDuration(playback.length ?? playback.duration, 30 * 60);
    const endedAt = new Date().toISOString();
    const startedAt = new Date(Math.max(0, Date.now() - durationSec * 1000)).toISOString();
    const sessionId = nanoid(12);

    this.sessions.create({
      id: sessionId,
      champion: "ROFL Replay",
      role: settings.mainRole ?? "unknown",
      startedAt,
      aiMode: settings.aiMode
    });
    this.sessions.end(sessionId, endedAt);

    try {
      this.snapshots.insert(
        sessionId,
        createVisualOnlySnapshot({
          sessionId,
          durationSec,
          settings,
          gameMode: "ROFL_REPLAY",
          mapName: replayMapName(replayGame),
          championName: "Unknown champion"
        }),
        { source: "rofl-replay", filePath: replayPath, playback, game: replayGame, render: initialRender }
      );

      let frameCount = 0;
      let observationCount = 0;
      for (const timestampSec of planReplayCaptureTimestamps(durationSec, 10)) {
        try {
          await replayClient.seek(timestampSec, true);
          await delay(1500);
          const checkpointPlayback = await replayClient.readPlayback().catch(() => undefined);
          const checkpointRender = await replayClient.readRender().catch(() => undefined);
          const frame = await this.options.screenshotService.capturePrimaryScreen(sessionId, timestampSec, "rofl-replay-frame");
          if (!frame) {
            warnings.push(`No screen frame was available at replay time ${formatTime(timestampSec)}.`);
            continue;
          }
          const observations = this.options.visualReviewService.saveReplayFrame(frame, {
            category: timestampSec < 14 * 60 ? "wave" : "positioning",
            confidence: 0.66,
            title: timestampSec < 14 * 60 ? "ROFL laning replay frame" : "ROFL mid-game replay frame",
            details:
              `Frame captured from a ROFL replay at ${formatTime(timestampSec)} after seeking with Riot's local Replay API. Playback and render metadata were recorded when available. Review camera focus, wave/map state, spacing, and visible objective setup.`,
            evidence: [
              `ROFL file: ${replayPath}`,
              `Replay time: ${formatTime(timestampSec)}`,
              "Source: Riot local Replay API seek + local desktop screenshot",
              ...replayApiEvidence({ playback: checkpointPlayback, render: checkpointRender, game: replayGame })
            ]
          });
          frameCount += 1;
          observationCount += observations.length;
        } catch (error) {
          warnings.push(`Could not capture ROFL replay at ${formatTime(timestampSec)}: ${formatProviderError(error)}`);
        }
      }

      if (frameCount === 0) {
        throw new Error(`ROFL replay opened, but RiftCoach could not capture any replay frames. ${warnings.at(-1) ?? ""}`.trim());
      }

      const importResult: VodImportResult = {
        id: nanoid(12),
        sessionId,
        filePath: replayPath,
        importedAtIso: new Date().toISOString(),
        videoStartOffsetSec: 0,
        durationSec,
        frameCount,
        observationCount,
        warnings
      };
      this.options.visualReviewService.saveVodImport(importResult);
      const report = await this.generateForSession(sessionId);
      return { sessionId, importResult, report };
    } catch (error) {
      this.sessions.updateReportStatus(sessionId, "failed");
      throw error;
    }
  }

  private async buildMatchContext(sessionId: string, startedAtIso: string, endedAtIso?: string): Promise<MatchContext> {
    const snapshotRows = this.snapshots.listWithRaw(sessionId);
    const snapshots = snapshotRows.map((row) => row.snapshot);
    const events = this.events.list(sessionId);
    const match = createMatchContextFromSnapshots({ sessionId, startedAtIso, endedAtIso, snapshots, events });
    const session = this.sessions.get(sessionId);
    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const casualMode = isCasualReviewMode(match.game);
    const fallbackRole = !casualMode && settings.mainRole && settings.mainRole !== "unknown" ? settings.mainRole : undefined;
    const detectedRole = match.player.role && match.player.role !== "unknown" ? match.player.role : undefined;
    return {
      ...match,
      gameId: session?.riotGameId,
      rawLiveData: buildRawLiveDataTelemetry({ snapshots: snapshotRows, events, player: match.player }),
      player: {
        ...match.player,
        rank: settings.playerRank ?? match.player.rank,
        role: casualMode ? "unknown" : detectedRole ?? fallbackRole ?? match.player.role,
        roleSource: casualMode ? "casual game mode" : detectedRole ? match.player.roleSource : fallbackRole ? "fallback profile" : match.player.roleSource,
        roleConfidence: casualMode ? 0 : detectedRole ? match.player.roleConfidence : fallbackRole ? 0.25 : match.player.roleConfidence
      }
    };
  }

  private async generateWithConfiguredProvider(input: CoachReportInput, settings: AppSettings): Promise<CoachReport> {
    if (settings.aiMode === "local-ollama") {
      try {
        return await new OllamaCoachProvider({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaModel,
          contextTokens: settings.ollamaContextTokens,
          outputTokens: settings.ollamaOutputTokens,
          timeoutMs: settings.ollamaTimeoutMs
        }).generatePostGameReport(input);
      } catch (error) {
        throw new Error(
          `Ollama report generation failed for model "${settings.ollamaModel}" at ${settings.ollamaBaseUrl}: ${formatProviderError(error)}`
        );
      }
    }

    if (settings.aiMode === "openai-cloud" || settings.aiMode === "hybrid") {
      try {
        const token = await this.options.credentialStore.getSecret("api-token");
        return await new OpenAiProxyCoachProvider({
          apiBaseUrl: settings.apiBaseUrl,
          model: settings.openAiProxyModel,
          authToken: token
        }).generatePostGameReport(input);
      } catch (error) {
        throw new Error(
          `OpenAI proxy report generation failed for model "${settings.openAiProxyModel}" at ${settings.apiBaseUrl}: ${formatProviderError(error)}`
        );
      }
    }

    throw new Error(`Unsupported AI mode: ${String((settings as any).aiMode)}`);
  }
}

function createVisualOnlySnapshot(params: {
  sessionId: string;
  durationSec: number;
  settings: AppSettings;
  gameMode: "VOD_REVIEW" | "ROFL_REPLAY";
  mapName: string;
  championName: string;
}): NormalizedSnapshot {
  const durationSec = Math.max(0, params.durationSec);
  const profileRole = params.settings.mainRole && params.settings.mainRole !== "unknown" ? params.settings.mainRole : "unknown";
  const riotId = params.settings.riotId?.trim() || undefined;
  const sourceLabel = params.gameMode === "ROFL_REPLAY" ? "ROFL replay" : "standalone VOD upload";
  return {
    sessionId: params.sessionId,
    timestampSec: durationSec,
    phase: phaseFromTime(durationSec),
    game: {
      gameMode: params.gameMode,
      mapName: params.mapName,
      reviewMode: "coaching"
    },
    player: {
      riotId,
      summonerName: riotId?.split("#")[0],
      championName: params.championName,
      role: profileRole,
      roleConfidence: profileRole === "unknown" ? 0 : 0.2,
      roleSource: profileRole === "unknown" ? sourceLabel : `profile fallback for ${sourceLabel}`,
      rank: params.settings.playerRank
    },
    scores: {
      kills: 0,
      deaths: 0,
      assists: 0,
      creepScore: 0
    },
    items: [],
    allPlayers: []
  };
}

function isVisualOnlyReview(match: MatchContext): boolean {
  return match.game?.gameMode === "VOD_REVIEW" || match.game?.gameMode === "ROFL_REPLAY";
}

function isRoflReplayFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".rofl";
}

interface RoflLaunchResult {
  executablePath?: string;
  warnings: string[];
  launched: boolean;
  needsManualOpen: boolean;
}

async function launchRoflReplay(replayPath: string): Promise<RoflLaunchResult> {
  const executablePath = findLeagueGameExecutable();
  if (!executablePath) {
    return {
      warnings: [
        "Could not find League of Legends.exe for ROFL playback. Set RIFTCOACH_LEAGUE_EXE to the Game\\League of Legends.exe path, or install League in the default Riot Games location."
      ],
      launched: false,
      needsManualOpen: true
    };
  }

  const warnings: string[] = [];
  try {
    await launchDetached(executablePath, [replayPath], dirname(executablePath));
    warnings.push(`Launched ROFL replay with League game executable: ${executablePath}`);
    return { executablePath, warnings, launched: true, needsManualOpen: false };
  } catch (error) {
    warnings.push(`Direct League launch failed: ${formatProviderError(error)}`);
  }

  try {
    await launchWithWindowsStartProcess(executablePath, replayPath);
    warnings.push(`Launched ROFL replay through Windows Start-Process fallback: ${executablePath}`);
    return { executablePath, warnings, launched: true, needsManualOpen: false };
  } catch (error) {
    warnings.push(`Windows Start-Process fallback failed: ${formatProviderError(error)}`);
  }

  warnings.push(
    `Could not launch ROFL replay with League executable "${executablePath}". Open the replay manually in the League client while RiftCoach waits for the Replay API.`
  );
  return { executablePath, warnings, launched: false, needsManualOpen: true };
}

function findLeagueGameExecutable(): string | undefined {
  const candidates = [
    process.env.RIFTCOACH_LEAGUE_EXE,
    "C:\\Riot Games\\League of Legends\\Game\\League of Legends.exe",
    process.env.SystemDrive ? `${process.env.SystemDrive}\\Riot Games\\League of Legends\\Game\\League of Legends.exe` : undefined,
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Riot Games\\League of Legends\\Game\\League of Legends.exe` : undefined,
    process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Riot Games\\League of Legends\\Game\\League of Legends.exe` : undefined
  ];

  return candidates
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate))
    .find((candidate) => existsSync(candidate));
}

function launchDetached(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });

    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolveLaunch();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectLaunch(error);
    });
  });
}

function launchWithWindowsStartProcess(executablePath: string, replayPath: string): Promise<void> {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "Start-Process -FilePath $env:RIFTCOACH_LEAGUE_EXE -ArgumentList @($env:RIFTCOACH_ROFL_PATH) -WorkingDirectory $env:RIFTCOACH_LEAGUE_CWD"
  ].join("; ");

  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      {
        windowsHide: true,
        env: {
          ...process.env,
          RIFTCOACH_LEAGUE_EXE: executablePath,
          RIFTCOACH_ROFL_PATH: replayPath,
          RIFTCOACH_LEAGUE_CWD: dirname(executablePath)
        }
      }
    );
    let stderr = "";
    let settled = false;

    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectLaunch(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolveLaunch();
        return;
      }
      rejectLaunch(new Error(`powershell.exe exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

function replayMapName(game?: RiotReplayGame): string {
  const mapName = stringValue(game?.mapName);
  const gameMode = stringValue(game?.gameMode);
  const mapNumber = cleanOptionalNumber(game?.mapNumber);
  if (mapName && gameMode) return `${mapName} (${gameMode})`;
  if (mapName) return mapName;
  if (gameMode) return `League replay file (${gameMode})`;
  if (typeof mapNumber === "number") return `League replay map ${mapNumber}`;
  return "League replay file";
}

function replayApiEvidence(params: {
  playback?: RiotReplayPlayback;
  render?: RiotReplayRender;
  game?: RiotReplayGame;
}): string[] {
  const evidence: string[] = [];
  const gameMode = stringValue(params.game?.gameMode);
  const mapName = stringValue(params.game?.mapName);
  const mapNumber = cleanOptionalNumber(params.game?.mapNumber);
  if (gameMode || mapName || typeof mapNumber === "number") {
    evidence.push(`Replay API game: ${[gameMode, mapName, typeof mapNumber === "number" ? `map ${mapNumber}` : undefined].filter(Boolean).join(", ")}.`);
  }

  if (params.playback) {
    const time = cleanOptionalNumber(params.playback.time);
    const length = cleanOptionalNumber(params.playback.length ?? params.playback.duration);
    const speed = cleanOptionalNumber(params.playback.speed);
    const paused = typeof params.playback.paused === "boolean" ? params.playback.paused : undefined;
    const parts = [
      typeof time === "number" ? `time ${formatTime(time)}` : undefined,
      typeof length === "number" ? `length ${formatTime(length)}` : undefined,
      typeof speed === "number" ? `speed ${speed}` : undefined,
      typeof paused === "boolean" ? `paused ${paused}` : undefined
    ].filter(Boolean);
    if (parts.length > 0) evidence.push(`Replay API playback: ${parts.join(", ")}.`);
  }

  if (params.render) {
    const cameraMode = stringValue(params.render.cameraMode);
    const fieldOfView = cleanOptionalNumber(params.render.fieldOfView);
    const keys = Object.keys(params.render).filter((key) => params.render?.[key] !== undefined).slice(0, 8);
    const parts = [
      cameraMode ? `camera ${cameraMode}` : undefined,
      typeof fieldOfView === "number" ? `fov ${fieldOfView}` : undefined,
      keys.length > 0 ? `fields ${keys.join(", ")}` : undefined
    ].filter(Boolean);
    if (parts.length > 0) evidence.push(`Replay API render: ${parts.join(", ")}.`);
  }

  return evidence;
}

async function waitForReplayPlayback(replayClient: ReplayClient, timeoutMs: number): Promise<RiotReplayPlayback> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const playback = await replayClient.readPlayback();
      if (playback && typeof playback === "object") return playback;
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Replay API did not become reachable"));
}

function cleanDuration(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(60, Math.min(4 * 60 * 60, numeric));
}

function cleanOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function planReplayCaptureTimestamps(durationSec: number, maxFrames: number): number[] {
  const duration = cleanDuration(durationSec, 30 * 60);
  const count = Math.max(4, Math.min(18, maxFrames));
  const firstUsable = Math.min(Math.max(60, duration * 0.06), Math.max(0, duration - 20));
  const lastUsable = Math.max(firstUsable, duration * 0.94);
  const timestamps = new Set<number>();

  if (duration <= 5 * 60) {
    for (let index = 1; index <= count; index += 1) {
      timestamps.add(Math.round((duration * index) / (count + 1)));
    }
    return Array.from(timestamps).filter((value) => value > 0).sort((a, b) => a - b);
  }

  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    timestamps.add(Math.round(firstUsable + (lastUsable - firstUsable) * ratio));
  }
  return Array.from(timestamps).filter((value) => value > 0 && value < duration).sort((a, b) => a - b);
}

function buildVisualOnlyKnowledgeContext(params: {
  settings: AppSettings;
  webSources?: KnowledgeSourceSnippet[];
  warnings?: string[];
}): KnowledgeContext {
  const webSources = params.settings.knowledgeMode === "web-assisted" ? params.webSources ?? [] : [];
  return {
    mode: params.settings.knowledgeMode,
    evidenceMode: webSources.length > 0 ? "telemetry_plus_web" : "telemetry_only",
    benchmarkComparisons: [],
    matchupTips: [],
    webSources,
    warnings: params.warnings ?? []
  };
}

function attachKnowledgeToReport(report: CoachReport, knowledge?: KnowledgeContext): CoachReport {
  if (!knowledge) return report;
  const warnings = [...report.warnings];
  for (const warning of knowledge.warnings) {
    const labeled = `Knowledge: ${warning}`;
    if (!warnings.includes(labeled)) warnings.push(labeled);
  }
  return { ...report, warnings, knowledgeContext: knowledge };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function cleanNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatProviderError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
