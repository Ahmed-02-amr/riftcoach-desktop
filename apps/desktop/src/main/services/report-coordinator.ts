import log from "electron-log";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
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
  type JournalEntry,
  type KnowledgeContext,
  type KnowledgeSourceSnippet,
  type MatchContext,
  type NormalizedSnapshot,
  type RankedSnapshot,
  type VodImportResult
} from "@riftcoach/core";
import { OllamaCoachProvider, OpenAiProxyCoachProvider, enforceActionableCoachReport, enforceEvidenceBackedCoachReport } from "@riftcoach/ai";
import {
  ReplayClient,
  RiotMatchV5Client,
  parseRoflMetadata,
  riotRegionalRouteForPlatform,
  type RiotReplayGame,
  type RiotReplayPlayback,
  type RiotReplayRender
} from "@riftcoach/riot";
import {
  EventRepository,
  JournalRepository,
  RankSnapshotRepository,
  ReportRepository,
  SessionRepository,
  SettingsRepository,
  SnapshotRepository
} from "@riftcoach/storage";
import type { CredentialStore } from "./credential-store";
import type { LeagueReplayService } from "./league-replay-service";
import { createRoflReviewData } from "./rofl-review-data";
import type { ScreenshotService } from "./screenshot-service";
import type { VisualReviewService } from "./visual-review-service";

interface ReportCoordinatorOptions {
  db: Database.Database;
  settingsRepo: SettingsRepository;
  credentialStore: CredentialStore;
  screenshotService: ScreenshotService;
  visualReviewService: VisualReviewService;
  leagueReplayService: LeagueReplayService;
  userDataPath: string;
  notify(title: string, body: string): void;
}

export class ReportCoordinator {
  private readonly sessions: SessionRepository;
  private readonly snapshots: SnapshotRepository;
  private readonly events: EventRepository;
  private readonly reports: ReportRepository;
  private readonly journal: JournalRepository;
  private readonly rankSnapshots: RankSnapshotRepository;

  constructor(private readonly options: ReportCoordinatorOptions) {
    this.sessions = new SessionRepository(options.db);
    this.snapshots = new SnapshotRepository(options.db);
    this.events = new EventRepository(options.db);
    this.reports = new ReportRepository(options.db);
    this.journal = new JournalRepository(options.db);
    this.rankSnapshots = new RankSnapshotRepository(options.db);
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
      const rankProfile = this.rankProfileForSession(sessionId, settings);
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
          rank: rankProfile.rank,
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
      const evidenceBackedReport = enforceEvidenceBackedCoachReport(actionableReport, input);
      const report = attachKnowledgeToReport(evidenceBackedReport, knowledge);
      this.reports.save(report);
      this.journal.saveFromReport(report, session, rankProfile);
      this.sessions.updateReportStatus(sessionId, "ready");

      this.options.notify("RiftCoach review ready", report.mainMistake.title);
      return report;
    } catch (error) {
      this.sessions.updateReportStatus(sessionId, "failed");
      log.error("report generation failed", error);
      throw error;
    }
  }

  async listJournalEntries(limit = 100): Promise<JournalEntry[]> {
    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    for (const storedReport of this.reports.list(limit)) {
      const session = this.sessions.get(storedReport.sessionId);
      let report = storedReport;
      if (session) {
        try {
          const context = await this.buildMatchContext(session.id, session.startedAt, session.endedAt);
          const match: MatchContext = {
            ...context,
            visualObservations: this.options.visualReviewService.listObservations(session.id)
          };
          report = enforceEvidenceBackedCoachReport(storedReport, {
            match,
            insights: [],
            profile: { rank: this.rankProfileForSession(session.id, settings).rank, mainRole: settings.mainRole },
            settings: {
              aiMode: settings.aiMode,
              privacyMode: settings.privacyMode,
              coachTone: settings.coachTone,
              knowledgeMode: settings.knowledgeMode
            },
            knowledge: storedReport.knowledgeContext
          });
          if (JSON.stringify(report) !== JSON.stringify(storedReport)) this.reports.save(report);
        } catch (error) {
          log.warn(`journal repair skipped for session ${session.id}`, error);
        }
      }
      this.journal.saveFromReport(report, session, this.rankProfileForSession(report.sessionId, settings));
    }
    return this.journal.list(limit);
  }

  updateJournalRank(sessionId: string, snapshot: RankedSnapshot): void {
    this.journal.updateRankFromSnapshot(sessionId, snapshot);
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

    const metadata = await parseRoflMetadata(replayPath);
    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const warnings: string[] = [];
    const matchV5 = await this.loadRiotMatchData(metadata.matchId, metadata.platformId ?? settings.riotPlatform, settings.riotMatchEnrichment);
    warnings.push(...matchV5.warnings);
    const sessionId = nanoid(12);
    const reviewData = createRoflReviewData({
      sessionId,
      metadata,
      settings,
      match: matchV5.match,
      timeline: matchV5.timeline
    });
    warnings.push(...reviewData.warnings);
    const durationSec = cleanDuration(reviewData.durationSec, 30 * 60);
    const startedAt = reviewData.startedAtIso ?? new Date(Math.max(0, Date.now() - durationSec * 1000)).toISOString();
    const endedAt = reviewData.startedAtIso
      ? new Date(new Date(reviewData.startedAtIso).getTime() + durationSec * 1000).toISOString()
      : new Date().toISOString();

    this.sessions.create({
      id: sessionId,
      riotGameId: metadata.gameId,
      champion: reviewData.championName,
      role: reviewData.role ?? "unknown",
      startedAt,
      aiMode: settings.aiMode
    });
    this.sessions.end(sessionId, endedAt);

    try {
      for (const snapshot of reviewData.snapshots) {
        this.snapshots.insert(sessionId, snapshot, {
          source: "rofl-metadata",
          filePath: replayPath,
          format: metadata.format,
          gameVersion: metadata.gameVersion,
          matchId: metadata.matchId,
          matchV5Loaded: Boolean(matchV5.match),
          timelineLoaded: Boolean(matchV5.timeline)
        });
      }
      this.events.upsertMany(sessionId, reviewData.events);
      this.options.visualReviewService.saveEvidenceObservation({
        sessionId,
        timestampSec: durationSec,
        category: "unknown",
        confidence: matchV5.match ? 0.99 : 0.94,
        title: "ROFL telemetry parsed",
        details:
          `RiftCoach parsed ${metadata.players.length} participants and the selected player's final stats directly from the ${metadata.format} metadata envelope. ` +
          (matchV5.timeline
            ? "Riot Match-v5 added minute frames and event timing."
            : "This report does not depend on the League replay client or Replay API."),
        evidence: reviewData.evidence
      });

      let frameCount = 0;
      let observationCount = 1;
      let renderedVodPath: string | undefined;
      const setup = await this.options.leagueReplayService.getSetupStatus().catch((error) => {
        warnings.push(`Replay API setup could not be checked: ${formatProviderError(error)}`);
        return undefined;
      });
      if (!setup?.enabled) {
        warnings.push("Replay API is disabled. The offline telemetry report completed; use the one-click setup in Live & Replays to add replay frames or render a VOD.");
      } else {
        const launch = await this.options.leagueReplayService.launchReplay(replayPath);
        if (launch.warning) warnings.push(launch.warning);
        if (launch.launched) {
          const replayClient = new ReplayClient({ timeoutMs: 2500 });
          const playback = await waitForReplayPlayback(replayClient, 75_000).catch((error) => {
            warnings.push(`The offline report completed, but the League Replay API did not become reachable: ${formatProviderError(error)}`);
            return undefined;
          });
          if (playback) {
            const replayGame = await replayClient.readGame().catch(() => undefined);
            const initialRender = await replayClient.readRender().catch(() => undefined);
            const replayDurationSec = cleanDuration(playback.length ?? playback.duration, durationSec);
            for (const timestampSec of planReplayCaptureTimestamps(replayDurationSec, 10)) {
              try {
                await replayClient.seek(timestampSec, true);
                await delay(1500);
                const checkpointPlayback = await replayClient.readPlayback().catch(() => undefined);
                const checkpointRender = await replayClient.readRender().catch(() => undefined);
                const frame = await this.options.screenshotService.capturePrimaryScreen(sessionId, timestampSec, "rofl-replay-frame");
                if (!frame) {
                  warnings.push(`No League replay frame was available at ${formatTime(timestampSec)}.`);
                  continue;
                }
                const observations = this.options.visualReviewService.saveReplayFrame(frame, {
                  category: timestampSec < 14 * 60 ? "wave" : "positioning",
                  confidence: 0.66,
                  title: timestampSec < 14 * 60 ? "ROFL laning replay frame" : "ROFL mid-game replay frame",
                  details:
                    `Frame captured from the League replay at ${formatTime(timestampSec)}. Review camera focus, wave/map state, spacing, and visible objective setup.`,
                  evidence: [
                    `ROFL file: ${replayPath}`,
                    `Replay time: ${formatTime(timestampSec)}`,
                    "Source: Riot local Replay API seek + League-window screenshot",
                    ...replayApiEvidence({ playback: checkpointPlayback, render: checkpointRender, game: replayGame })
                  ]
                });
                frameCount += 1;
                observationCount += observations.length;
              } catch (error) {
                warnings.push(`Could not capture League replay at ${formatTime(timestampSec)}: ${formatProviderError(error)}`);
              }
            }

            if (settings.renderRoflVideos) {
              renderedVodPath = await renderReplayVideo({
                replayClient,
                outputRoot: this.options.userDataPath,
                sessionId,
                durationSec: replayDurationSec
              }).catch((error) => {
                warnings.push(`Replay video rendering failed; telemetry and frames were kept: ${formatProviderError(error)}`);
                return undefined;
              });
              if (renderedVodPath) {
                const context = await this.buildMatchContext(sessionId, startedAt, endedAt);
                const renderedImport = await this.options.visualReviewService.importVodForMatch(context, renderedVodPath, {
                  videoStartOffsetSec: 0,
                  maxFrames: 18
                });
                frameCount += renderedImport.frameCount;
                observationCount += renderedImport.observationCount;
                warnings.push(...renderedImport.warnings);
              }
            }
          }
        }
      }

      const importResult: VodImportResult = {
        id: nanoid(12),
        sessionId,
        filePath: renderedVodPath ?? replayPath,
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

  private async loadRiotMatchData(matchId: string | undefined, platformId: string, enabled: boolean): Promise<{
    match?: any;
    timeline?: any;
    warnings: string[];
  }> {
    if (!enabled) return { warnings: [] };
    if (!matchId) return { warnings: ["Riot Match-v5 enrichment is enabled, but the ROFL filename did not contain a platform and game ID."] };
    const apiKey = await this.options.credentialStore.getSecret("riot-api-key");
    if (!apiKey) return { warnings: ["Riot Match-v5 enrichment is enabled, but no Riot API key is saved in Settings."] };

    const client = new RiotMatchV5Client({ apiKey, regionalRoute: riotRegionalRouteForPlatform(platformId) });
    const warnings: string[] = [];
    const [matchResult, timelineResult] = await Promise.allSettled([client.getMatch(matchId), client.getTimeline(matchId)]);
    if (matchResult.status === "rejected") warnings.push(`Riot Match-v5 details were unavailable: ${formatProviderError(matchResult.reason)}`);
    if (timelineResult.status === "rejected") warnings.push(`Riot Match-v5 timeline was unavailable: ${formatProviderError(timelineResult.reason)}`);
    return {
      match: matchResult.status === "fulfilled" ? matchResult.value : undefined,
      timeline: timelineResult.status === "fulfilled" ? timelineResult.value : undefined,
      warnings
    };
  }

  private async buildMatchContext(sessionId: string, startedAtIso: string, endedAtIso?: string): Promise<MatchContext> {
    const snapshotRows = this.snapshots.listWithRaw(sessionId);
    const snapshots = snapshotRows.map((row) => row.snapshot);
    const events = this.events.list(sessionId);
    const match = createMatchContextFromSnapshots({ sessionId, startedAtIso, endedAtIso, snapshots, events });
    const session = this.sessions.get(sessionId);
    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const rankProfile = this.rankProfileForSession(sessionId, settings);
    const casualMode = isCasualReviewMode(match.game);
    const fallbackRole = !casualMode && settings.mainRole && settings.mainRole !== "unknown" ? settings.mainRole : undefined;
    const detectedRole = match.player.role && match.player.role !== "unknown" ? match.player.role : undefined;
    return {
      ...match,
      gameId: session?.riotGameId,
      rawLiveData: buildRawLiveDataTelemetry({ snapshots: snapshotRows, events, player: match.player }),
      player: {
        ...match.player,
        rank: rankProfile.rank ?? match.player.rank,
        role: casualMode ? "unknown" : detectedRole ?? fallbackRole ?? match.player.role,
        roleSource: casualMode ? "casual game mode" : detectedRole ? match.player.roleSource : fallbackRole ? "fallback profile" : match.player.roleSource,
        roleConfidence: casualMode ? 0 : detectedRole ? match.player.roleConfidence : fallbackRole ? 0.25 : match.player.roleConfidence
      }
    };
  }

  private rankProfileForSession(sessionId: string, settings: AppSettings): { rank?: string; lp?: number } {
    const snapshot = this.rankSnapshots.getForSession(sessionId, "after")
      ?? this.rankSnapshots.getForSession(sessionId, "before");
    return {
      rank: snapshot?.rank ?? settings.playerRank,
      lp: snapshot?.lp ?? settings.playerLp
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
  if (match.game?.gameMode === "VOD_REVIEW") return true;
  if (match.game?.gameMode !== "ROFL_REPLAY") return false;
  return match.snapshots.length === 0 || match.player.championName === "Unknown champion";
}

function isRoflReplayFile(filePath: string): boolean {
  return extname(filePath).toLowerCase() === ".rofl";
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

async function renderReplayVideo(input: {
  replayClient: ReplayClient;
  outputRoot: string;
  sessionId: string;
  durationSec: number;
}): Promise<string> {
  const outputDirectory = join(input.outputRoot, "rofl-recordings", input.sessionId);
  await mkdir(outputDirectory, { recursive: true });
  await input.replayClient.updatePlayback({ time: 0, paused: false, speed: 1 });
  await input.replayClient.updateRecording({
    recording: true,
    path: outputDirectory,
    codec: "webm",
    startTime: 0,
    endTime: input.durationSec,
    framesPerSecond: 30,
    enforceFrameRate: true,
    replaySpeed: 1,
    lossless: false
  });

  const deadline = Date.now() + Math.max(5 * 60_000, Math.min(2 * 60 * 60_000, input.durationSec * 4_000));
  let latestPath: string | undefined;
  while (Date.now() < deadline) {
    const recording = await input.replayClient.readRecording();
    if (recording.path) latestPath = resolve(recording.path);
    if (recording.recording === false) break;
    await delay(1_000);
  }

  if (latestPath && existsSync(latestPath) && (await stat(latestPath)).isFile()) return latestPath;
  const candidates = (await readdir(outputDirectory))
    .filter((entry) => extname(entry).toLowerCase() === ".webm")
    .map((entry) => join(outputDirectory, entry));
  const files = await Promise.all(candidates.map(async (filePath) => ({ filePath, modifiedAt: (await stat(filePath)).mtimeMs })));
  const newest = files.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.filePath;
  if (!newest) throw new Error("The Replay API finished without returning a WebM file.");
  return newest;
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
