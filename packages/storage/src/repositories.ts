import { nanoid } from "nanoid";
import {
  formatChampionName,
  normalizeAppSettings,
  type AppSettings,
  type CoachChatMessage,
  type CoachReport,
  type GoalResult,
  type JournalEntry,
  type NormalizedEvent,
  type NormalizedSnapshot,
  type RankedQueueType,
  type RankedSnapshot,
  type RankSnapshotPhase,
  type ScreenshotFrame,
  type TrainingGoal,
  type VisualObservation,
  type VodImportResult
} from "@riftcoach/core";
import type Database from "better-sqlite3";

function json<T>(value: T): string {
  return JSON.stringify(value);
}

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

export interface SessionRecord {
  id: string;
  riotGameId?: string;
  champion?: string;
  role?: string;
  startedAt: string;
  endedAt?: string;
  aiMode: string;
  reportStatus: "pending" | "generating" | "ready" | "failed";
}

export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  get<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
    return row ? parse<T>(row.value_json) : undefined;
  }

  set<T>(key: string, value: T): void {
    this.db.prepare(`
      INSERT INTO settings(key, value_json, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, json(value), new Date().toISOString());
  }

  getAppSettings(defaults: AppSettings): AppSettings {
    return normalizeAppSettings({ ...defaults, ...(this.get<Record<string, unknown>>("app") ?? {}) });
  }

  setAppSettings(settings: AppSettings): void {
    this.set("app", normalizeAppSettings(settings));
  }
}

export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: { id: string; riotGameId?: string; champion?: string; role?: string; startedAt: string; aiMode: string }): void {
    this.db.prepare(`
      INSERT INTO local_sessions(id, riot_game_id, champion, role, started_at, ai_mode, report_status)
      VALUES(?, ?, ?, ?, ?, ?, 'pending')
    `).run(input.id, input.riotGameId ?? null, input.champion ?? null, input.role ?? null, input.startedAt, input.aiMode);
  }

  end(sessionId: string, endedAt: string): void {
    this.db.prepare("UPDATE local_sessions SET ended_at = ? WHERE id = ?").run(endedAt, sessionId);
  }

  updateReportStatus(sessionId: string, status: SessionRecord["reportStatus"]): void {
    this.db.prepare("UPDATE local_sessions SET report_status = ? WHERE id = ?").run(status, sessionId);
  }

  list(limit = 50): SessionRecord[] {
    const rows = this.db.prepare("SELECT * FROM local_sessions ORDER BY started_at DESC LIMIT ?").all(limit) as any[];
    return rows.map(mapSession);
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM local_sessions WHERE id = ?").get(sessionId) as any | undefined;
    return row ? mapSession(row) : undefined;
  }

  getLatestEnded(): SessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM local_sessions WHERE ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1").get() as any | undefined;
    return row ? mapSession(row) : undefined;
  }
}

function mapSession(row: any): SessionRecord {
  return {
    id: row.id,
    riotGameId: row.riot_game_id ?? undefined,
    champion: row.champion ?? undefined,
    role: row.role ?? undefined,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    aiMode: row.ai_mode,
    reportStatus: row.report_status
  };
}

export class SnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  insert(sessionId: string, snapshot: NormalizedSnapshot, rawLiveData?: unknown): void {
    this.db.prepare(`
      INSERT INTO live_snapshots(session_id, timestamp_sec, snapshot_json, live_data_json, created_at)
      VALUES(?, ?, ?, ?, ?)
    `).run(sessionId, snapshot.timestampSec, json(snapshot), rawLiveData ? json(rawLiveData) : null, new Date().toISOString());
  }

  list(sessionId: string): NormalizedSnapshot[] {
    const rows = this.db.prepare("SELECT snapshot_json FROM live_snapshots WHERE session_id = ? ORDER BY timestamp_sec ASC").all(sessionId) as { snapshot_json: string }[];
    return rows.map((row) => parse<NormalizedSnapshot>(row.snapshot_json));
  }

  listWithRaw(sessionId: string): Array<{ snapshot: NormalizedSnapshot; rawLiveData?: unknown }> {
    const rows = this.db.prepare("SELECT snapshot_json, live_data_json FROM live_snapshots WHERE session_id = ? ORDER BY timestamp_sec ASC").all(sessionId) as {
      snapshot_json: string;
      live_data_json: string | null;
    }[];
    return rows.map((row) => ({
      snapshot: parse<NormalizedSnapshot>(row.snapshot_json),
      rawLiveData: row.live_data_json ? parse<unknown>(row.live_data_json) : undefined
    }));
  }
}

export class EventRepository {
  constructor(private readonly db: Database.Database) {}

  upsertMany(sessionId: string, events: NormalizedEvent[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO live_events(id, session_id, timestamp_sec, event_json, created_at)
      VALUES(?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const event of events) stmt.run(String(event.id), sessionId, event.timestampSec, json(event), now);
  }

  list(sessionId: string): NormalizedEvent[] {
    const rows = this.db.prepare("SELECT event_json FROM live_events WHERE session_id = ? ORDER BY timestamp_sec ASC").all(sessionId) as { event_json: string }[];
    return rows.map((row) => parse<NormalizedEvent>(row.event_json));
  }
}

export class ReportRepository {
  constructor(private readonly db: Database.Database) {}

  save(report: CoachReport): void {
    this.db.prepare(`
      INSERT INTO coach_reports(id, session_id, provider, summary, report_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET summary = excluded.summary, report_json = excluded.report_json
    `).run(report.id, report.sessionId, report.provider, report.summary, json(report), report.createdAtIso);
  }

  list(limit = 50): CoachReport[] {
    const rows = this.db.prepare("SELECT report_json FROM coach_reports ORDER BY created_at DESC LIMIT ?").all(limit) as { report_json: string }[];
    return rows.map((row) => parse<CoachReport>(row.report_json));
  }

  get(reportId: string): CoachReport | undefined {
    const row = this.db.prepare("SELECT report_json FROM coach_reports WHERE id = ?").get(reportId) as { report_json: string } | undefined;
    return row ? parse<CoachReport>(row.report_json) : undefined;
  }

  getBySession(sessionId: string): CoachReport | undefined {
    const row = this.db.prepare("SELECT report_json FROM coach_reports WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(sessionId) as { report_json: string } | undefined;
    return row ? parse<CoachReport>(row.report_json) : undefined;
  }
}

export class RankSnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  saveCurrent(snapshot: RankedSnapshot): void {
    this.save(`current:${snapshot.queueType}`, undefined, "current", snapshot);
  }

  saveForSession(sessionId: string, phase: RankSnapshotPhase, snapshot: RankedSnapshot): void {
    this.save(`${sessionId}:${phase}`, sessionId, phase, snapshot);
  }

  getCurrent(queueType: RankedQueueType): RankedSnapshot | undefined {
    return this.get(`current:${queueType}`);
  }

  getForSession(sessionId: string, phase: RankSnapshotPhase): RankedSnapshot | undefined {
    return this.get(`${sessionId}:${phase}`);
  }

  private save(scopeKey: string, sessionId: string | undefined, phase: RankSnapshotPhase | "current", snapshot: RankedSnapshot): void {
    this.db.prepare(`
      INSERT INTO rank_snapshots(
        scope_key, session_id, phase, queue_type, rank, tier, division, lp,
        wins, losses, provisional, source, synced_at, match_queue_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        session_id = excluded.session_id,
        phase = excluded.phase,
        queue_type = excluded.queue_type,
        rank = excluded.rank,
        tier = excluded.tier,
        division = excluded.division,
        lp = excluded.lp,
        wins = excluded.wins,
        losses = excluded.losses,
        provisional = excluded.provisional,
        source = excluded.source,
        synced_at = excluded.synced_at,
        match_queue_id = excluded.match_queue_id
    `).run(
      scopeKey,
      sessionId ?? null,
      phase,
      snapshot.queueType,
      snapshot.rank,
      snapshot.tier,
      snapshot.division ?? null,
      snapshot.lp,
      snapshot.wins ?? null,
      snapshot.losses ?? null,
      snapshot.provisional === undefined ? null : snapshot.provisional ? 1 : 0,
      snapshot.source,
      snapshot.syncedAtIso,
      snapshot.matchQueueId ?? null
    );
  }

  private get(scopeKey: string): RankedSnapshot | undefined {
    const row = this.db.prepare("SELECT * FROM rank_snapshots WHERE scope_key = ?").get(scopeKey) as any | undefined;
    if (!row) return undefined;
    return {
      queueType: row.queue_type,
      rank: row.rank,
      tier: row.tier,
      division: row.division ?? undefined,
      lp: row.lp,
      wins: row.wins ?? undefined,
      losses: row.losses ?? undefined,
      provisional: row.provisional === null ? undefined : Boolean(row.provisional),
      source: row.source,
      syncedAtIso: row.synced_at,
      matchQueueId: row.match_queue_id ?? undefined
    };
  }
}

export class JournalRepository {
  constructor(private readonly db: Database.Database) {}

  hasReport(reportId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM journal_entries WHERE report_id = ?").get(reportId));
  }

  saveFromReport(
    report: CoachReport,
    session: SessionRecord | undefined,
    profile: { rank?: string; lp?: number }
  ): void {
    this.db.prepare(`
      INSERT INTO journal_entries(
        id, report_id, session_id, champion, role, strength_title, strength_detail,
        weakness_title, weakness_detail, rank, lp, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET
        champion = excluded.champion,
        role = excluded.role,
        strength_title = excluded.strength_title,
        strength_detail = excluded.strength_detail,
        weakness_title = excluded.weakness_title,
        weakness_detail = excluded.weakness_detail,
        rank = COALESCE(journal_entries.rank, excluded.rank),
        lp = COALESCE(journal_entries.lp, excluded.lp),
        created_at = excluded.created_at
    `).run(
      `journal-${report.id}`,
      report.id,
      report.sessionId,
      session?.champion ? formatChampionName(session.champion) : null,
      session?.role ?? null,
      report.positiveHabit.title,
      report.positiveHabit.explanation,
      report.mainMistake.title,
      report.mainMistake.explanation,
      profile.rank ?? null,
      profile.lp ?? null,
      session?.startedAt ?? report.createdAtIso
    );
  }

  updateRankFromSnapshot(sessionId: string, snapshot: RankedSnapshot): void {
    this.db.prepare("UPDATE journal_entries SET rank = ?, lp = ? WHERE session_id = ?")
      .run(snapshot.rank, snapshot.lp, sessionId);
  }

  list(limit = 100): JournalEntry[] {
    const rows = this.db.prepare("SELECT * FROM journal_entries ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    const rankSnapshots = new RankSnapshotRepository(this.db);
    return rows.map((row) => {
      const before = rankSnapshots.getForSession(row.session_id, "before");
      const after = rankSnapshots.getForSession(row.session_id, "after");
      const finalRank = after?.rank ?? row.rank ?? before?.rank;
      const finalLp = after?.lp ?? row.lp ?? before?.lp;
      return {
        id: row.id,
        reportId: row.report_id,
        sessionId: row.session_id,
        champion: row.champion ?? undefined,
        role: row.role ?? undefined,
        createdAtIso: row.created_at,
        strengthTitle: row.strength_title,
        strengthDetail: row.strength_detail,
        weaknessTitle: row.weakness_title,
        weaknessDetail: row.weakness_detail,
        rank: finalRank,
        lp: finalLp,
        rankBefore: before?.rank,
        lpBefore: before?.lp,
        lpDelta: before && after ? rankScore(after.rank, after.lp) - rankScore(before.rank, before.lp) : undefined,
        rankQueue: after?.queueType ?? before?.queueType,
        rankSource: after?.source ?? before?.source,
        rankSyncedAtIso: after?.syncedAtIso ?? before?.syncedAtIso
      };
    });
  }
}

function rankScore(rank: string, lp: number): number {
  const [tier = "", division = "IV"] = rank.trim().toUpperCase().split(/\s+/);
  const tiers = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"];
  const divisions: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
  const tierIndex = Math.max(0, tiers.indexOf(tier));
  const divisionIndex = tierIndex >= 7 ? 0 : divisions[division] ?? 0;
  return tierIndex * 400 + divisionIndex * 100 + lp;
}

export class ReviewChatRepository {
  constructor(private readonly db: Database.Database) {}

  save(message: CoachChatMessage): void {
    this.db.prepare(`
      INSERT INTO review_chat_messages(id, report_id, session_id, role, content, sources_json, warnings_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.reportId,
      message.sessionId,
      message.role,
      message.content,
      json(message.sources ?? []),
      json(message.warnings ?? []),
      message.createdAtIso
    );
  }

  list(reportId: string): CoachChatMessage[] {
    const rows = this.db.prepare("SELECT * FROM review_chat_messages WHERE report_id = ? ORDER BY created_at ASC").all(reportId) as any[];
    return rows.map((row) => ({
      id: row.id,
      reportId: row.report_id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      sources: parse<CoachChatMessage["sources"]>(row.sources_json),
      warnings: parse<CoachChatMessage["warnings"]>(row.warnings_json),
      createdAtIso: row.created_at
    }));
  }
}

export class TrainingRepository {
  constructor(private readonly db: Database.Database) {}

  saveGoal(goal: TrainingGoal): void {
    this.db.prepare(`
      INSERT INTO training_goals(id, type, title, description, target_value, created_at, active)
      VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, target_value = excluded.target_value, active = excluded.active
    `).run(goal.id, goal.type, goal.title, goal.description, goal.targetValue ?? null, goal.createdAtIso, goal.active ? 1 : 0);
  }

  listGoals(): TrainingGoal[] {
    const rows = this.db.prepare("SELECT * FROM training_goals ORDER BY created_at DESC").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      targetValue: row.target_value ?? undefined,
      createdAtIso: row.created_at,
      active: row.active === 1
    }));
  }

  activeGoal(): TrainingGoal | undefined {
    return this.listGoals().find((goal) => goal.active);
  }

  saveResult(result: GoalResult): void {
    this.db.prepare(`
      INSERT INTO goal_results(id, goal_id, session_id, passed, value, note, evaluated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(12), result.goalId, result.sessionId, result.passed ? 1 : 0, result.value ?? null, result.note, result.evaluatedAtIso);
  }

  listResults(goalId?: string): GoalResult[] {
    const rows = goalId
      ? (this.db.prepare("SELECT * FROM goal_results WHERE goal_id = ? ORDER BY evaluated_at DESC").all(goalId) as any[])
      : (this.db.prepare("SELECT * FROM goal_results ORDER BY evaluated_at DESC").all() as any[]);
    return rows.map((row) => ({
      goalId: row.goal_id,
      sessionId: row.session_id,
      passed: row.passed === 1,
      value: row.value ?? undefined,
      note: row.note,
      evaluatedAtIso: row.evaluated_at
    }));
  }
}

export class VisualRepository {
  constructor(private readonly db: Database.Database) {}

  saveFrame(frame: ScreenshotFrame): void {
    this.db.prepare(`
      INSERT INTO screenshot_frames(id, session_id, timestamp_sec, captured_at, file_path, width, height, source)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `).run(frame.id, frame.sessionId, frame.timestampSec, frame.capturedAtIso, frame.filePath, frame.width ?? null, frame.height ?? null, frame.source);
  }

  listFrames(sessionId: string): ScreenshotFrame[] {
    const rows = this.db.prepare("SELECT * FROM screenshot_frames WHERE session_id = ? ORDER BY timestamp_sec ASC").all(sessionId) as any[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      timestampSec: row.timestamp_sec,
      capturedAtIso: row.captured_at,
      filePath: row.file_path,
      width: row.width ?? undefined,
      height: row.height ?? undefined,
      source: row.source
    }));
  }

  saveObservation(obs: VisualObservation): void {
    this.db.prepare(`
      INSERT INTO visual_observations(id, session_id, frame_id, timestamp_sec, category, confidence, title, details, evidence_json, evidence_kind)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      obs.id,
      obs.sessionId,
      obs.frameId ?? null,
      obs.timestampSec,
      obs.category,
      obs.confidence,
      obs.title,
      obs.details,
      json(obs.evidence),
      obs.evidenceKind ?? "verified"
    );
  }

  listObservations(sessionId: string): VisualObservation[] {
    const rows = this.db.prepare("SELECT * FROM visual_observations WHERE session_id = ? ORDER BY timestamp_sec ASC").all(sessionId) as any[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      frameId: row.frame_id ?? undefined,
      timestampSec: row.timestamp_sec,
      category: row.category,
      confidence: row.confidence,
      title: row.title,
      details: row.details,
      evidence: parse<string[]>(row.evidence_json),
      evidenceKind: row.evidence_kind ?? undefined
    }));
  }

  saveVodImport(result: VodImportResult): void {
    this.db.prepare(`
      INSERT INTO vod_imports(id, session_id, file_path, imported_at, video_start_offset_sec, duration_sec, frame_count, observation_count, warnings_json)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        file_path = excluded.file_path,
        video_start_offset_sec = excluded.video_start_offset_sec,
        duration_sec = excluded.duration_sec,
        frame_count = excluded.frame_count,
        observation_count = excluded.observation_count,
        warnings_json = excluded.warnings_json
    `).run(
      result.id,
      result.sessionId,
      result.filePath,
      result.importedAtIso,
      result.videoStartOffsetSec,
      result.durationSec ?? null,
      result.frameCount,
      result.observationCount,
      json(result.warnings)
    );
  }

  listVodImports(sessionId: string): VodImportResult[] {
    const rows = this.db.prepare("SELECT * FROM vod_imports WHERE session_id = ? ORDER BY imported_at DESC").all(sessionId) as any[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      filePath: row.file_path,
      importedAtIso: row.imported_at,
      videoStartOffsetSec: row.video_start_offset_sec,
      durationSec: row.duration_sec ?? undefined,
      frameCount: row.frame_count,
      observationCount: row.observation_count,
      warnings: parse<string[]>(row.warnings_json)
    }));
  }
}

export class MaintenanceRepository {
  constructor(private readonly db: Database.Database) {}

  deleteAllLocalData(): void {
    this.db.exec(`
      DELETE FROM visual_observations;
      DELETE FROM vod_imports;
      DELETE FROM screenshot_frames;
      DELETE FROM review_chat_messages;
      DELETE FROM journal_entries;
      DELETE FROM goal_results;
      DELETE FROM training_goals;
      DELETE FROM coach_reports;
      DELETE FROM live_events;
      DELETE FROM live_snapshots;
      DELETE FROM rank_snapshots;
      DELETE FROM local_sessions;
      DELETE FROM llm_runs;
    `);
  }
}
