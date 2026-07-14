import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_sessions (
      id TEXT PRIMARY KEY,
      riot_game_id TEXT,
      champion TEXT,
      role TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      ai_mode TEXT NOT NULL,
      report_status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS rank_snapshots (
      scope_key TEXT PRIMARY KEY,
      session_id TEXT,
      phase TEXT NOT NULL,
      queue_type TEXT NOT NULL,
      rank TEXT NOT NULL,
      tier TEXT NOT NULL,
      division TEXT,
      lp INTEGER NOT NULL,
      wins INTEGER,
      losses INTEGER,
      provisional INTEGER,
      source TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      match_queue_id INTEGER,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_rank_snapshots_session_phase
      ON rank_snapshots(session_id, phase);

    CREATE TABLE IF NOT EXISTS live_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp_sec REAL NOT NULL,
      snapshot_json TEXT NOT NULL,
      live_data_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_live_snapshots_session_time
      ON live_snapshots(session_id, timestamp_sec);

    CREATE TABLE IF NOT EXISTS live_events (
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp_sec REAL NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(id, session_id),
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_live_events_session_time
      ON live_events(session_id, timestamp_sec);

    CREATE TABLE IF NOT EXISTS coach_reports (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      summary TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_coach_reports_session
      ON coach_reports(session_id);

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      champion TEXT,
      role TEXT,
      strength_title TEXT NOT NULL,
      strength_detail TEXT NOT NULL,
      weakness_title TEXT NOT NULL,
      weakness_detail TEXT NOT NULL,
      rank TEXT,
      lp INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(report_id) REFERENCES coach_reports(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_journal_entries_created
      ON journal_entries(created_at DESC);

    CREATE TABLE IF NOT EXISTS review_chat_messages (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources_json TEXT NOT NULL DEFAULT '[]',
      warnings_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(report_id) REFERENCES coach_reports(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_review_chat_messages_report_time
      ON review_chat_messages(report_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS training_goals (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target_value REAL,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goal_results (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      passed INTEGER NOT NULL,
      value REAL,
      note TEXT NOT NULL,
      evaluated_at TEXT NOT NULL,
      FOREIGN KEY(goal_id) REFERENCES training_goals(id) ON DELETE CASCADE,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS screenshot_frames (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp_sec REAL NOT NULL,
      captured_at TEXT NOT NULL,
      file_path TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      source TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_screenshot_frames_session_time
      ON screenshot_frames(session_id, timestamp_sec);

    CREATE TABLE IF NOT EXISTS visual_observations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      frame_id TEXT,
      timestamp_sec REAL NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      evidence_kind TEXT NOT NULL DEFAULT 'verified',
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(frame_id) REFERENCES screenshot_frames(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS vod_imports (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      video_start_offset_sec REAL NOT NULL,
      duration_sec REAL,
      frame_count INTEGER NOT NULL,
      observation_count INTEGER NOT NULL,
      warnings_json TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_vod_imports_session
      ON vod_imports(session_id, imported_at DESC);

    CREATE TABLE IF NOT EXISTS llm_runs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT,
      session_id TEXT,
      status TEXT NOT NULL,
      prompt_hash TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const visualColumns = db.prepare("PRAGMA table_info(visual_observations)").all() as Array<{ name: string }>;
  if (!visualColumns.some((column) => column.name === "evidence_kind")) {
    db.exec("ALTER TABLE visual_observations ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'verified'");
  }

  // Older releases stored timestamp bookmarks and coarse pixel statistics as if
  // they were semantic visual observations. Reclassify them during migration so
  // saved reports cannot use those records to claim wave state or positioning.
  db.exec(`
    UPDATE visual_observations
    SET evidence_kind = CASE
      WHEN lower(title) LIKE '%telemetry parsed%' OR lower(title) LIKE '%metadata parsed%' THEN 'telemetry'
      WHEN lower(title) LIKE 'local % scan' OR lower(title) = 'minimap visibility check' OR lower(details) LIKE '%not object detection%' THEN 'pixel-scan'
      WHEN lower(title) LIKE '%bookmark%'
        OR lower(title) LIKE '%vod frame%'
        OR lower(title) LIKE '%replay frame%'
        OR lower(title) LIKE '%checkpoint%'
        OR lower(details) LIKE '%frame extracted%'
        OR lower(details) LIKE '%frame captured%' THEN 'bookmark'
      ELSE evidence_kind
    END
  `);
}
