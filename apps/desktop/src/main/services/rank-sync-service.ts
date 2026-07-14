import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import log from "electron-log";
import type Database from "better-sqlite3";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type RankedQueueType,
  type RankedSnapshot,
  type RankSyncStatus
} from "@riftcoach/core";
import {
  LeagueClientApi,
  LiveClientUnavailableError,
  parseLeagueClientLockfile,
  type LeagueClientConnection,
  type LeagueClientGameflowSession,
  type LeagueClientRankedStats
} from "@riftcoach/riot";
import { RankSnapshotRepository, SettingsRepository } from "@riftcoach/storage";
import { discoverLeagueInstallation } from "./league-replay-service";

interface LeagueRankClient {
  readCurrentRankedStats(): Promise<LeagueClientRankedStats>;
  readGameflowSession(): Promise<LeagueClientGameflowSession>;
}

interface RankSyncServiceOptions {
  db: Database.Database;
  settingsRepo: SettingsRepository;
  clientFactory?: () => Promise<LeagueRankClient | undefined>;
  afterMatchRetryOffsetsMs?: number[];
  now?: () => string;
  wait?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_RETRY_OFFSETS_MS = [15_000, 45_000, 90_000];
const BACKGROUND_SYNC_INTERVAL_MS = 30_000;

export class RankSyncService extends EventEmitter {
  private readonly snapshots: RankSnapshotRepository;
  private readonly clientFactory: () => Promise<LeagueRankClient | undefined>;
  private readonly retryOffsets: number[];
  private readonly now: () => string;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private timer: NodeJS.Timeout | undefined;
  private syncing = false;
  private currentStatus: RankSyncStatus;

  constructor(private readonly options: RankSyncServiceOptions) {
    super();
    this.snapshots = new RankSnapshotRepository(options.db);
    this.clientFactory = options.clientFactory ?? createLeagueRankClient;
    this.retryOffsets = options.afterMatchRetryOffsetsMs ?? DEFAULT_RETRY_OFFSETS_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)));
    const settings = this.settings();
    const snapshot = this.snapshots.getCurrent(settings.rankQueue);
    this.currentStatus = {
      state: settings.automaticRankSync ? "client-not-running" : "disabled",
      snapshot,
      updatedAtIso: this.now()
    };
  }

  start(): void {
    if (this.timer) return;
    void this.syncNow();
    this.timer = setInterval(() => void this.syncNow(), BACKGROUND_SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  getStatus(): RankSyncStatus {
    return { ...this.currentStatus };
  }

  async syncNow(): Promise<RankSyncStatus> {
    const settings = this.settings();
    if (!settings.automaticRankSync) {
      this.emitStatus({ state: "disabled", snapshot: manualSnapshot(settings, settings.rankQueue, this.now()) });
      return this.getStatus();
    }
    if (this.syncing) return this.getStatus();

    this.syncing = true;
    this.emitStatus({ state: "syncing", snapshot: this.snapshots.getCurrent(settings.rankQueue) });
    try {
      const snapshot = await this.fetchSnapshot(settings.rankQueue);
      this.saveCurrent(snapshot, settings);
      this.emitStatus({ state: snapshot.rank === "Unranked" ? "unranked" : "synced", snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cached = this.snapshots.getCurrent(settings.rankQueue);
      this.emitStatus({
        state: isClientUnavailable(message) ? "client-not-running" : "error",
        snapshot: cached,
        lastError: isClientUnavailable(message) ? undefined : message
      });
    } finally {
      this.syncing = false;
    }
    return this.getStatus();
  }

  async captureBeforeMatch(sessionId: string): Promise<RankedSnapshot | undefined> {
    const settings = this.settings();
    if (!settings.automaticRankSync) {
      const snapshot = manualSnapshot(settings, settings.rankQueue, this.now());
      if (snapshot) this.snapshots.saveForSession(sessionId, "before", snapshot);
      return snapshot;
    }

    try {
      const client = await this.requireClient();
      const [rankedStats, gameflow] = await Promise.all([
        client.readCurrentRankedStats(),
        client.readGameflowSession().catch(() => undefined)
      ]);
      const matchQueueId = gameflowQueueId(gameflow);
      const queueType = rankedQueueForGameQueue(matchQueueId) ?? settings.rankQueue;
      const snapshot = rankedSnapshotFromClient(rankedStats, queueType, this.now(), matchQueueId);
      this.snapshots.saveCurrent(snapshot);
      this.snapshots.saveForSession(sessionId, "before", snapshot);
      if (queueType === settings.rankQueue) this.saveCurrent(snapshot, settings);
      this.emitStatus({ state: snapshot.rank === "Unranked" ? "unranked" : "synced", snapshot });
      return snapshot;
    } catch (error) {
      const fallback = this.cachedOrManualSnapshot(settings, settings.rankQueue);
      if (fallback) this.snapshots.saveForSession(sessionId, "before", fallback);
      const message = error instanceof Error ? error.message : String(error);
      log.warn("Automatic pre-match rank capture was unavailable", message);
      this.emitStatus({
        state: isClientUnavailable(message) ? "client-not-running" : "error",
        snapshot: fallback,
        lastError: isClientUnavailable(message) ? undefined : message
      });
      return fallback;
    }
  }

  async captureAfterMatch(sessionId: string): Promise<RankedSnapshot | undefined> {
    const settings = this.settings();
    const before = this.snapshots.getForSession(sessionId, "before");
    if (!settings.automaticRankSync || (before?.matchQueueId !== undefined && !rankedQueueForGameQueue(before.matchQueueId))) {
      const snapshot = before ?? this.cachedOrManualSnapshot(settings, settings.rankQueue);
      if (snapshot) this.snapshots.saveForSession(sessionId, "after", snapshot);
      return snapshot;
    }

    const queueType = before?.queueType ?? settings.rankQueue;
    const startedAt = Date.now();
    let latest: RankedSnapshot | undefined;
    let lastError: string | undefined;
    for (const offset of this.retryOffsets) {
      const remaining = Math.max(0, offset - (Date.now() - startedAt));
      if (remaining > 0) await this.wait(remaining);
      try {
        latest = await this.fetchSnapshot(queueType, before?.matchQueueId);
        this.snapshots.saveCurrent(latest);
        if (queueType === settings.rankQueue) this.saveCurrent(latest, settings);
        if (!before || rankStateChanged(before, latest)) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        log.warn(`Post-match rank sync attempt at ${offset}ms failed`, lastError);
      }
    }

    const finalSnapshot = latest ?? this.cachedOrManualSnapshot(settings, queueType, before?.matchQueueId) ?? before;
    if (finalSnapshot) {
      this.snapshots.saveForSession(sessionId, "after", finalSnapshot);
      this.emitStatus({ state: finalSnapshot.rank === "Unranked" ? "unranked" : "synced", snapshot: finalSnapshot });
    } else if (lastError) {
      this.emitStatus({ state: isClientUnavailable(lastError) ? "client-not-running" : "error", lastError });
    }
    return finalSnapshot;
  }

  private async fetchSnapshot(queueType: RankedQueueType, matchQueueId?: number): Promise<RankedSnapshot> {
    const client = await this.requireClient();
    const rankedStats = await client.readCurrentRankedStats();
    return rankedSnapshotFromClient(rankedStats, queueType, this.now(), matchQueueId);
  }

  private async requireClient(): Promise<LeagueRankClient> {
    const client = await this.clientFactory();
    if (!client) throw new LiveClientUnavailableError("League Client is not running or its lockfile could not be found.");
    return client;
  }

  private saveCurrent(snapshot: RankedSnapshot, settings: AppSettings): void {
    this.snapshots.saveCurrent(snapshot);
    if (snapshot.queueType !== settings.rankQueue) return;
    this.options.settingsRepo.setAppSettings({ ...settings, playerRank: snapshot.rank, playerLp: snapshot.lp });
  }

  private cachedOrManualSnapshot(settings: AppSettings, queueType: RankedQueueType, matchQueueId?: number): RankedSnapshot | undefined {
    const cached = this.snapshots.getCurrent(queueType);
    if (cached) return { ...cached, source: "league-client-cache", matchQueueId: matchQueueId ?? cached.matchQueueId };
    return manualSnapshot(settings, queueType, this.now(), matchQueueId);
  }

  private settings(): AppSettings {
    return this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
  }

  private emitStatus(partial: Omit<RankSyncStatus, "updatedAtIso">): void {
    this.currentStatus = { ...partial, updatedAtIso: this.now() };
    this.emit("status", this.getStatus());
  }
}

export function rankedSnapshotFromClient(
  stats: LeagueClientRankedStats,
  queueType: RankedQueueType,
  syncedAtIso: string,
  matchQueueId?: number
): RankedSnapshot {
  const entry = stats.queues?.find((queue) => queue.queueType === queueType);
  const tier = cleanRankPart(entry?.tier) ?? "UNRANKED";
  const division = cleanRankPart(entry?.division);
  const lp = cleanNonNegativeInteger(entry?.leaguePoints);
  return {
    queueType,
    rank: tier === "UNRANKED" ? "Unranked" : `${titleCase(tier)}${division ? ` ${division}` : ""}`,
    tier,
    division,
    lp,
    wins: optionalNonNegativeInteger(entry?.wins),
    losses: optionalNonNegativeInteger(entry?.losses),
    provisional: typeof entry?.isProvisional === "boolean" ? entry.isProvisional : undefined,
    source: "league-client",
    syncedAtIso,
    matchQueueId
  };
}

export function rankedQueueForGameQueue(queueId?: number): RankedQueueType | undefined {
  if (queueId === 420) return "RANKED_SOLO_5x5";
  if (queueId === 440) return "RANKED_FLEX_SR";
  return undefined;
}

export async function discoverLeagueClientConnection(): Promise<LeagueClientConnection | undefined> {
  const candidates = new Set<string>();
  const explicit = process.env.RIFTCOACH_LEAGUE_LOCKFILE?.trim();
  if (explicit) candidates.add(resolve(explicit));
  const installation = await discoverLeagueInstallation();
  if (installation?.lockfilePath) candidates.add(installation.lockfilePath);
  if (installation?.installPath) candidates.add(resolve(installation.installPath, "lockfile"));

  for (const filePath of candidates) {
    try {
      return parseLeagueClientLockfile(await readFile(filePath, "utf8"));
    } catch {
      // The client rotates this file on restart; continue through every discovered location.
    }
  }
  return undefined;
}

async function createLeagueRankClient(): Promise<LeagueRankClient | undefined> {
  const connection = await discoverLeagueClientConnection();
  return connection ? new LeagueClientApi(connection) : undefined;
}

function manualSnapshot(
  settings: AppSettings,
  queueType: RankedQueueType,
  syncedAtIso: string,
  matchQueueId?: number
): RankedSnapshot | undefined {
  const rank = settings.playerRank?.trim();
  if (!rank) return undefined;
  const [tier = "UNRANKED", division] = rank.toUpperCase().split(/\s+/);
  return {
    queueType,
    rank,
    tier,
    division,
    lp: settings.playerLp ?? 0,
    source: "manual",
    syncedAtIso,
    matchQueueId
  };
}

function gameflowQueueId(gameflow?: LeagueClientGameflowSession): number | undefined {
  const value = Number(gameflow?.gameData?.queue?.id);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function rankStateChanged(before: RankedSnapshot, after: RankedSnapshot): boolean {
  return before.rank !== after.rank
    || before.lp !== after.lp
    || before.wins !== after.wins
    || before.losses !== after.losses
    || before.provisional !== after.provisional;
}

function cleanRankPart(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : undefined;
}

function cleanNonNegativeInteger(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : cleanNonNegativeInteger(value);
}

function titleCase(value: string): string {
  return `${value.slice(0, 1)}${value.slice(1).toLowerCase()}`;
}

function isClientUnavailable(message: string): boolean {
  return /League Client is not running|lockfile|ECONNREFUSED|socket hang up|timed out|HTTP (401|403|404)/i.test(message);
}
