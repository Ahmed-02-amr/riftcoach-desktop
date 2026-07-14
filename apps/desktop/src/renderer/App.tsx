import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AppSettings,
  CoachChatMessage,
  CoachReport,
  JournalEntry,
  LiveSessionStatus,
  ProviderHealth,
  RankSyncStatus,
  ReplaySetupStatus,
  ScreenshotFrame,
  SessionRecord,
  VisualObservation,
  VodImportResult
} from "./types";
import { StatusPill } from "./components/StatusPill";
import { Card } from "./components/Card";
import { ReportView } from "./components/ReportView";
import { Icon, type IconName } from "./components/Icon";
import { JournalView } from "./components/JournalView";
import { formatDate, formatDuration } from "./utils";
import { isElectronShell, riftcoachApi } from "./api";

type Tab = "home" | "live" | "reports" | "journal" | "settings";
type VisualCache = { frames: ScreenshotFrame[]; observations: VisualObservation[]; imports: VodImportResult[] };

const navItems: Array<{ id: Tab; label: string; description: string; icon: IconName }> = [
  { id: "home", label: "Command Center", description: "Status, actions, latest review", icon: "command" },
  { id: "live", label: "Live Recorder", description: "Session capture and recorder health", icon: "recorder" },
  { id: "reports", label: "Reviews", description: "Post-game coaching reports", icon: "review" },
  { id: "journal", label: "Journal", description: "Strengths, focus and ranked climb", icon: "journal" },
  { id: "settings", label: "Settings", description: "AI, privacy and player profile", icon: "settings" }
];

export function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [status, setStatus] = useState<LiveSessionStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [reports, setReports] = useState<CoachReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [rankStatus, setRankStatus] = useState<RankSyncStatus | null>(null);
  const [replaySetup, setReplaySetup] = useState<ReplaySetupStatus | null>(null);
  const [visualsBySession, setVisualsBySession] = useState<Record<string, VisualCache>>({});
  const [message, setMessage] = useState<string>("");
  const [bootError, setBootError] = useState<string>("");
  const settingsDirtyRef = useRef(false);

  const selectedReport = useMemo(() => reports.find((r) => r.id === selectedReportId) ?? reports[0], [reports, selectedReportId]);

  async function refresh() {
    try {
      const [nextStatus, nextRankStatus, nextSettings, nextSessions, nextReports, nextJournalEntries, nextReplaySetup] = await Promise.all([
        riftcoachApi.getStatus(),
        riftcoachApi.getRankStatus(),
        riftcoachApi.getSettings(),
        riftcoachApi.listSessions(),
        riftcoachApi.listReports(),
        riftcoachApi.listJournalEntries(),
        riftcoachApi.getReplaySetupStatus()
      ]);
      setBootError("");
      setStatus(nextStatus);
      setRankStatus(nextRankStatus);
      if (!settingsDirtyRef.current) setSettings(nextSettings);
      setSessions(nextSessions);
      setReports(nextReports);
      setJournalEntries(nextJournalEntries);
      setReplaySetup(nextReplaySetup);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setBootError(detail);
      setMessage(`Refresh failed: ${detail}`);
    }
  }

  useEffect(() => {
    void refresh();
    const off = riftcoachApi.onStatusUpdate((s) => setStatus(s));
    const offRank = riftcoachApi.onRankStatusUpdate((s) => setRankStatus(s));
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      off();
      offRank();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const sessionIds = Array.from(new Set([reports[0]?.sessionId, selectedReport?.sessionId].filter((id): id is string => Boolean(id))));
    for (const sessionId of sessionIds) void loadVisuals(sessionId);
  }, [reports[0]?.sessionId, selectedReport?.sessionId]);

  async function loadVisuals(sessionId: string) {
    const [frames, observations, imports] = await Promise.all([
      riftcoachApi.listFrames(sessionId),
      riftcoachApi.listObservations(sessionId),
      riftcoachApi.listVodImports(sessionId)
    ]);
    setVisualsBySession((current) => ({
      ...current,
      [sessionId]: { frames, observations, imports }
    }));
  }

  async function generateReport(sessionId?: string) {
    try {
      setMessage("Generating report with the configured AI provider...");
      const report = await riftcoachApi.generateReport(sessionId);
      await refresh();
      if (report?.id) setSelectedReportId(report.id);
      setTab("reports");
      setMessage(report ? `Report generated with ${providerLabel(report.provider)}.` : "No ended session found yet. Leave RiftCoach running during a match, then generate the review after it ends.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await refresh();
      setTab("live");
      setMessage(`Report generation failed: ${detail}`);
    }
  }

  async function importVodAndGenerate(sessionId: string, videoStartOffsetSec: number) {
    try {
      setMessage("Choose a video file to attach to this recorded session...");
      const result = await riftcoachApi.importVod(sessionId, { videoStartOffsetSec });
      if (!result) {
        setMessage("Video attachment canceled.");
        return;
      }
      await loadVisuals(sessionId);
      setMessage(`Imported ${result.frameCount} video frames. Regenerating the review with visual evidence...`);
      const report = await riftcoachApi.generateReport(sessionId);
      await refresh();
      await loadVisuals(sessionId);
      if (report?.id) setSelectedReportId(report.id);
      setTab("reports");
      const warningText = result.warnings.length > 0 ? ` ${result.warnings[0]}` : "";
      setMessage(`Review updated: ${result.frameCount} video frames and ${result.observationCount} observations added.${warningText}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await refresh();
      setTab("live");
      setMessage(`Video attachment failed: ${detail}`);
    }
  }

  async function createVodReview(videoStartOffsetSec: number) {
    try {
      setMessage("Choose a video file or League .rofl replay for a standalone review...");
      const result = await riftcoachApi.createVodReview({ videoStartOffsetSec });
      if (!result) {
        setMessage("VOD or ROFL upload canceled.");
        return;
      }
      await refresh();
      await loadVisuals(result.sessionId);
      if (result.report?.id) setSelectedReportId(result.report.id);
      setTab("reports");
      const warningText = result.importResult?.warnings?.length ? ` ${result.importResult.warnings[0]}` : "";
      setMessage(
        `VOD/ROFL review ready: ${result.importResult.frameCount} frames and ${result.importResult.observationCount} evidence observations analyzed.${warningText}`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await refresh();
      setTab("live");
      setMessage(`VOD/ROFL review failed: ${detail}`);
    }
  }

  function updateSettings(next: AppSettings) {
    settingsDirtyRef.current = true;
    setSettings(next);
  }

  async function saveSettings(next: AppSettings) {
    const saved = await riftcoachApi.saveSettings(next);
    settingsDirtyRef.current = false;
    setSettings(saved);
    await refresh();
    setMessage("Settings saved.");
  }

  async function enableReplayApi() {
    try {
      setMessage("Enabling League Replay API and backing up game.cfg...");
      const next = await riftcoachApi.enableReplayApi();
      setReplaySetup(next);
      setMessage(next.backupPath ? `Replay API enabled. Backup saved to ${next.backupPath}` : next.message);
    } catch (error) {
      setMessage(`Replay API setup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function syncRankNow() {
    try {
      setMessage("Syncing rank from the League Client...");
      const next = await riftcoachApi.syncRankNow();
      setRankStatus(next);
      await refresh();
      setMessage(next.state === "synced" || next.state === "unranked"
        ? "Rank synced from the League Client."
        : rankSyncMessage(next));
    } catch (error) {
      setMessage(`Rank sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!settings || !status || !rankStatus) {
    return (
      <div className="boot">
        <div className="startup-card">
          <div className="loader" />
          <h1>Starting RiftCoach</h1>
          <p>Loading local database, recorder service, and desktop bridge.</p>
          {bootError && <p className="boot-error">{bootError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo"><Icon name="rank" size={25} /></div>
          <div>
            <h1>RiftCoach</h1>
            <p>League review desktop</p>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {navItems.map((item) => (
            <button key={item.id} aria-label={item.label} title={item.label} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              <span className="nav-icon"><Icon name={item.icon} size={19} /></span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <StatusPill state={status.state} />
          <div>
            <strong>{sidebarStatusTitle(status)}</strong>
            <span>{status.sessionId ? `Session ${status.sessionId}` : liveApiMessage(status).short}</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">{isElectronShell ? "Windows desktop app" : "Browser preview"}</p>
            <h1>{titleFor(tab)}</h1>
            <p>{subtitleFor(tab)}</p>
          </div>
          <div className="topbar-actions">
            <StatusPill state={status.state} compact />
            <button className="secondary icon-button" onClick={() => void refresh()}><Icon name="refresh" size={17} />Refresh</button>
          </div>
        </header>

        {!isElectronShell && (
          <div className="system-banner warning">
            <div>
              <strong>Renderer preview only</strong>
              <p>localhost:5173 is the React renderer. The actual product is the separate Electron desktop window.</p>
            </div>
          </div>
        )}
        {message && <div className="toast">{message}</div>}

        {tab === "home" && <Home status={status} settings={settings} reports={reports} journalEntries={journalEntries} visualsBySession={visualsBySession} onGenerate={() => void generateReport()} onOpenJournal={() => setTab("journal")} />}
        {tab === "live" && <Live status={status} sessions={sessions} settings={settings} replaySetup={replaySetup} onEnableReplayApi={enableReplayApi} onGenerate={generateReport} onImportVod={importVodAndGenerate} onCreateVodReview={createVodReview} />}
        {tab === "reports" && <Reports reports={reports} sessions={sessions} selected={selectedReport} visualsBySession={visualsBySession} setSelected={setSelectedReportId} onImportVod={importVodAndGenerate} />}
        {tab === "journal" && <JournalView entries={journalEntries} settings={settings} rankStatus={rankStatus} onSyncRank={syncRankNow} onUpdateProfile={async (rank, lp) => { await saveSettings({ ...settings, playerRank: rank, playerLp: lp }); }} />}
        {tab === "settings" && <Settings settings={settings} setSettings={updateSettings} save={saveSettings} dirty={settingsDirtyRef.current} />}
      </main>
    </div>
  );
}

function titleFor(tab: Tab) {
  return { home: "Command Center", live: "Live Recorder", reports: "Post-game Reviews", journal: "Auto Journal", settings: "Settings" }[tab];
}

function subtitleFor(tab: Tab) {
  return {
    home: "A clean control surface for recording, coaching, and next-game focus.",
    live: "Record matches automatically, upload a replay, or attach video evidence to a recorded game.",
    reports: "Review the highest-impact mistake, supporting evidence, and next-game drill.",
    journal: "Every completed review becomes a signal in your climb.",
    settings: "Choose AI mode, knowledge sources, privacy behavior, and Windows startup options."
  }[tab];
}

function Home({
  status,
  settings,
  reports,
  journalEntries,
  visualsBySession,
  onGenerate,
  onOpenJournal
}: {
  status: LiveSessionStatus;
  settings: AppSettings;
  reports: CoachReport[];
  journalEntries: JournalEntry[];
  visualsBySession: Record<string, VisualCache>;
  onGenerate: () => void;
  onOpenJournal: () => void;
}) {
  const latest = reports[0];
  const api = liveApiMessage(status);

  return (
    <div className="dashboard">
      <section className="hero-card">
        <div className="hero-content">
          <p className="eyebrow">Desktop coaching loop</p>
          <h2>{heroTitle(status)}</h2>
          <p>{heroDescription(status)}</p>
          <div className="button-row">
            <button onClick={onGenerate}>Generate last ended report</button>
          </div>
        </div>
        <div className="hero-panel">
          <StatusPill state={status.state} />
          <div className="hero-metric">
            <span>Game time</span>
            <strong>{formatDuration(status.gameTimeSec)}</strong>
          </div>
          <div className="hero-metric">
            <span>Snapshots</span>
            <strong>{status.snapshotsRecorded}</strong>
          </div>
        </div>
      </section>

      <div className="kpi-grid">
        <MetricCard label="Recorder" value={api.title} detail={api.short} tone={api.tone} />
        <MetricCard label="AI mode" value={aiModeLabel(settings.aiMode)} detail={aiModeDetail(settings)} tone="blue" />
        <MetricCard label="Reports" value={String(reports.length)} detail="Local post-game reviews saved" tone="purple" />
        <MetricCard label="Journal signals" value={String(journalEntries.length)} detail={journalEntries[0]?.strengthTitle ?? "Your next review starts the journal"} tone="green" />
      </div>

      <div className="grid two-uneven">
        <Card title="Recorder health" eyebrow="Current status" action={<StatusPill state={status.state} />}>
          <LiveApiExplainer status={status} />
        </Card>

        <Card title="Latest journal signal" eyebrow="Automatic reflection" action={<button className="secondary" onClick={onOpenJournal}>Open journal</button>}>
          {journalEntries[0] ? (
            <div className="mission-card">
              <span className="mission-marker" />
              <div>
                <h3>{journalEntries[0].strengthTitle}</h3>
                <p>{journalEntries[0].strengthDetail}</p>
                <small>Focus next: {journalEntries[0].weaknessTitle}</small>
              </div>
            </div>
          ) : (
            <EmptyState title="No journal signals yet" description="Complete a review and RiftCoach will automatically capture one strength and one focus area." />
          )}
        </Card>
      </div>

      <Card title="Latest review" eyebrow="Post-game coaching" action={latest && <button className="secondary" onClick={onGenerate}>Regenerate</button>}>
        {latest ? <ReportView report={latest} frames={visualsBySession[latest.sessionId]?.frames} observations={visualsBySession[latest.sessionId]?.observations} /> : <EmptyState title="No reviews yet" description="Leave RiftCoach running while you play a League match. After the match ends, generate a review from the recorded session." />}
      </Card>
    </div>
  );
}

function Live({
  status,
  sessions,
  settings,
  replaySetup,
  onEnableReplayApi,
  onGenerate,
  onImportVod,
  onCreateVodReview
}: {
  status: LiveSessionStatus;
  sessions: SessionRecord[];
  settings: AppSettings;
  replaySetup: ReplaySetupStatus | null;
  onEnableReplayApi: () => Promise<void>;
  onGenerate: (sessionId?: string) => void;
  onImportVod: (sessionId: string, videoStartOffsetSec: number) => Promise<void>;
  onCreateVodReview: (videoStartOffsetSec: number) => Promise<void>;
}) {
  const [vodSessionId, setVodSessionId] = useState("");
  const [vodOffsetSec, setVodOffsetSec] = useState(0);
  const endedSessions = sessions.filter((session) => session.endedAt);
  const vodCandidates = endedSessions.length > 0 ? endedSessions : sessions;
  const selectedVodSessionId = vodSessionId || vodCandidates[0]?.id || "";

  return (
    <div className="grid">
      <div className="grid two-uneven">
        <Card title="Live match recorder" eyebrow="Automatic capture" action={<StatusPill state={status.state} />}>
          <div className="status-summary">
            <div>
              <span>Current session</span>
              <strong>{status.sessionId ?? "None"}</strong>
            </div>
            <div>
              <span>Game time</span>
              <strong>{formatDuration(status.gameTimeSec)}</strong>
            </div>
            <div>
              <span>Snapshots</span>
              <strong>{status.snapshotsRecorded}</strong>
            </div>
            <div>
              <span>AI model</span>
              <strong>{settings.aiMode === "local-ollama" ? settings.ollamaModel : settings.openAiProxyModel}</strong>
            </div>
            <div>
              <span>Match VOD</span>
              <strong>{vodRecordingLabel(status)}</strong>
            </div>
          </div>
          <LiveApiExplainer status={status} />
          {status.state === "recording" && <button onClick={() => void riftcoachApi.stopActiveSession()}>Stop and finalize session</button>}
        </Card>

        <Card title="What to do now" eyebrow="Next step">
          <div className="workflow-list">
            <Step
              number="1"
              title={status.state === "recording" ? "Finish the match" : "Leave RiftCoach open"}
              description={status.state === "recording" ? "Recording is active. Play normally until the game ends." : "RiftCoach starts recording when a live League match begins."}
              active
            />
            <Step
              number="2"
              title="Generate the review"
              description="After the match ends, click Review on the saved session or generate the last ended report."
              active={status.state !== "recording"}
            />
            <Step
              number="3"
              title="Use one drill"
              description="Use the report's next-game drill while the Journal tracks recurring patterns over time."
              active={false}
            />
          </div>
        </Card>
      </div>

      <Card title="Review from a file" eyebrow="Video or League replay">
        <div className={`system-banner ${replaySetup?.enabled ? "green" : "blue"}`}>
          <div>
            <strong>{replaySetup?.enabled ? "Replay visuals are enabled" : "Offline ROFL review is ready"}</strong>
            <p>{replaySetup?.message ?? "Checking League replay configuration..."}</p>
            {replaySetup?.configPath && <code>{replaySetup.configPath}</code>}
          </div>
          {replaySetup?.installed && !replaySetup.enabled && (
            <button className="secondary" onClick={() => void onEnableReplayApi()}>Enable Replay API</button>
          )}
        </div>
        <div className="review-options-grid">
          <section className="review-option primary">
            <div>
              <p className="eyebrow">Standalone review</p>
              <h3>Upload video or .rofl replay</h3>
              <p>Use this when RiftCoach did not record the match. ROFL files are parsed offline first, so final stats do not depend on League replay playback.</p>
              <ul className="plain-list">
                <li>Video files: .mp4, .mkv, .mov, .webm.</li>
                <li>Replay files: ROFL and ROFL2 metadata, including participants and final stats.</li>
                <li>Replay API is optional and only adds League frames or a rendered video.</li>
                <li>Match-v5 can add minute timelines when enabled in Settings.</li>
              </ul>
            </div>
            <div>
              <label>Video offset seconds <span className="field-hint">Ignored for .rofl replays</span><input type="number" step={1} value={vodOffsetSec} onChange={(event) => setVodOffsetSec(Number(event.target.value))} /></label>
              <div className="button-row">
                <button onClick={() => void onCreateVodReview(vodOffsetSec)}>Choose file and generate review</button>
              </div>
            </div>
          </section>

          <section className="review-option">
            <div>
              <p className="eyebrow">Add evidence to a session</p>
              <h3>Attach video to a recorded game</h3>
              <p>Use this only when the video belongs to a match RiftCoach already recorded. This lines frames up with deaths, fights, objectives, and lane checkpoints.</p>
              <p className="muted">.rofl files use the standalone review path above.</p>
            </div>
            {vodCandidates.length > 0 ? (
              <div>
                <label>Recorded session<select value={selectedVodSessionId} onChange={(event) => setVodSessionId(event.target.value)}>
                  {vodCandidates.map((session) => (
                    <option key={session.id} value={session.id}>{sessionTitle(session)} - {formatDate(session.startedAt)}</option>
                  ))}
                </select></label>
                <div className="button-row">
                  <button className="secondary" onClick={() => selectedVodSessionId && void onImportVod(selectedVodSessionId, vodOffsetSec)} disabled={!selectedVodSessionId}>Attach video and regenerate</button>
                </div>
              </div>
            ) : (
              <p className="muted">No recorded sessions are available yet.</p>
            )}
          </section>
        </div>
      </Card>

      <Card title="Recorded sessions" eyebrow="Local history">
        {sessions.length === 0 ? (
          <EmptyState title="No recorded sessions" description="Start League, enter a match, and keep RiftCoach open in the tray. Sessions will appear here after recording begins." />
        ) : (
          <div className="data-table">
            <div className="table-head"><span>Game</span><span>Started</span><span>Status</span><span /></div>
            {sessions.map((session) => (
              <div className="table-row" key={session.id}>
                <span><strong>{sessionTitle(session)}</strong><small>{roleLabel(session.role)}</small></span>
                <span>{formatDate(session.startedAt)}</span>
                <span><span className="pill small">{reportStatusLabel(session.reportStatus)}</span></span>
                <button className="secondary" onClick={() => onGenerate(session.id)}>Review</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Reports({
  reports,
  sessions,
  selected,
  visualsBySession,
  setSelected,
  onImportVod
}: {
  reports: CoachReport[];
  sessions: SessionRecord[];
  selected?: CoachReport;
  visualsBySession: Record<string, VisualCache>;
  setSelected: (id: string) => void;
  onImportVod: (sessionId: string, videoStartOffsetSec: number) => Promise<void>;
}) {
  if (reports.length === 0) {
    return <EmptyState title="No post-game reviews yet" description="Record a match first, then generate a provider-backed review from the ended session." />;
  }

  const selectedSession = sessions.find((session) => session.id === selected?.sessionId);
  const selectedVisualOnly = selectedSession?.champion === "Uploaded VOD" || selectedSession?.champion === "ROFL Replay";

  return (
    <div className="reports-layout">
      <Card title="Review library" eyebrow={`${reports.length} saved`}>
        <div className="report-list">
          {reports.map((report) => (
            <button key={report.id} className={selected?.id === report.id ? "selected" : ""} onClick={() => setSelected(report.id)}>
              <span className="report-list-title">{report.mainMistake.title}</span>
              <span>{formatDate(report.createdAtIso)}</span>
              <small>{report.nextGameDrill.title}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card action={selected && (
        <div className="button-row compact">
          {!selectedVisualOnly && <button className="secondary" onClick={() => void onImportVod(selected.sessionId, 0)}>Attach video evidence</button>}
        </div>
      )}>
        {selected ? (
          <>
            <ReportView report={selected} frames={visualsBySession[selected.sessionId]?.frames} observations={visualsBySession[selected.sessionId]?.observations} />
            <ReviewChatPanel report={selected} />
          </>
        ) : (
          <p>No report selected.</p>
        )}
      </Card>
    </div>
  );
}

function ReviewChatPanel({ report }: { report: CoachReport }) {
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setDraft("");
    setError("");
    riftcoachApi
      .listReviewChatMessages(report.id)
      .then((next) => {
        if (!cancelled) setMessages(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [report.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, loading]);

  async function sendMessage(content: string) {
    const clean = content.trim();
    if (!clean || loading) return;
    setLoading(true);
    setError("");
    setDraft("");
    const optimistic: CoachChatMessage = {
      id: `pending-${Date.now()}`,
      reportId: report.id,
      sessionId: report.sessionId,
      role: "user",
      content: clean,
      createdAtIso: new Date().toISOString(),
      sources: [],
      warnings: []
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await riftcoachApi.sendReviewChatMessage(report.id, clean);
      setMessages(result.messages);
    } catch (err) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(clean);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const suggestions = [
    "What is the actual best next-game focus?",
    "Turn this into a 3-game plan.",
    "What decision should I change first?"
  ];

  return (
    <section className="review-chat-panel" aria-label="Review follow-up chat">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Follow-up coach</p>
          <h3>Ask what to do next</h3>
        </div>
        {loading && <span className="pill small">thinking</span>}
      </div>
      <p className="muted">Push back on the review, ask for a better plan, or turn the drill into something you can execute in your next queue.</p>

      {messages.length === 0 && !loading ? (
        <div className="chat-empty">
          <strong>No follow-up yet</strong>
          <p>Start with a question about the review, the drill, or the best course of action for the next match.</p>
        </div>
      ) : (
        <div className="chat-thread">
          {messages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <div className="chat-meta">
                <strong>{message.role === "user" ? "You" : "RiftCoach"}</strong>
                <span>{formatDate(message.createdAtIso)}</span>
              </div>
              <div className="chat-content">{message.content}</div>
              {message.sources.length > 0 && (
                <div className="chat-sources">
                  <span>Sources used</span>
                  {message.sources.map((source) => (
                    <a key={`${message.id}-${source.id}`} href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  ))}
                </div>
              )}
              {message.warnings.length > 0 && <p className="chat-warning">{message.warnings.join(" ")}</p>}
            </article>
          ))}
          {loading && (
            <article className="chat-message assistant">
              <div className="chat-meta"><strong>RiftCoach</strong><span>Working</span></div>
              <div className="chat-content">Reading the review and choosing the next action...</div>
            </article>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && <div className="system-banner red"><div><strong>Review chat failed</strong><p>{error}</p></div></div>}

      <div className="chat-suggestions">
        {suggestions.map((suggestion) => (
          <button key={suggestion} className="secondary" onClick={() => void sendMessage(suggestion)} disabled={loading}>
            {suggestion}
          </button>
        ))}
      </div>

      <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage(draft); }}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about the review, matchup, drill, or next-game plan..." rows={3} />
        <button type="submit" disabled={loading || !draft.trim()}>{loading ? "Thinking..." : "Send"}</button>
      </form>
    </section>
  );
}

function Settings({
  settings,
  setSettings,
  save,
  dirty
}: {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  save: (s: AppSettings) => Promise<void>;
  dirty: boolean;
}) {
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | null>(null);
  const [providerMessage, setProviderMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [apiToken, setApiToken] = useState("");
  const [webSearchToken, setWebSearchToken] = useState("");
  const [riotApiKey, setRiotApiKey] = useState("");

  const update = <K extends keyof AppSettings,>(key: K, value: AppSettings[K]) => {
    setProviderHealth(null);
    setProviderMessage("");
    setSettings({ ...settings, [key]: value });
  };

  async function saveAll() {
    setSaving(true);
    try {
      await save(settings);
    } finally {
      setSaving(false);
    }
  }

  async function testOllama() {
    setProviderMessage("Testing Ollama with the current form values...");
    const result = await riftcoachApi.testOllama(settings);
    setProviderHealth(result as ProviderHealth);
    if (!result.reachable) {
      setProviderMessage(`Ollama is not reachable: ${result.error ?? "unknown error"}`);
      return;
    }
    if (result.modelAvailable === false) {
      setProviderMessage(result.error ?? `Ollama is reachable, but ${settings.ollamaModel} is not installed.`);
      return;
    }
    setProviderMessage(`Ollama is reachable and ${settings.ollamaModel} is installed.`);
  }

  async function storeCloudToken() {
    if (!apiToken.trim()) {
      setProviderMessage("Paste an API proxy token before saving it.");
      return;
    }
    await riftcoachApi.setApiToken(apiToken.trim());
    setApiToken("");
    setProviderMessage("Cloud proxy token saved in the local encrypted credential store.");
  }

  async function deleteCloudToken() {
    await riftcoachApi.deleteApiToken();
    setApiToken("");
    setProviderMessage("Cloud proxy token removed.");
  }

  async function storeWebSearchToken() {
    if (settings.webSearchProvider === "built-in") {
      setProviderMessage("Built-in web search does not need an API key.");
      return;
    }
    if (!webSearchToken.trim()) {
      setProviderMessage("Paste an Ollama web-search API key before saving it.");
      return;
    }
    await riftcoachApi.setWebSearchToken(webSearchToken.trim());
    setWebSearchToken("");
    setProviderMessage("Web-search API key saved locally.");
  }

  async function deleteWebSearchToken() {
    await riftcoachApi.deleteWebSearchToken();
    setWebSearchToken("");
    setProviderMessage("Web-search API key removed.");
  }

  async function testWebSearch() {
    setProviderMessage("Testing web knowledge lookup...");
    const result = await riftcoachApi.testWebSearch(settings);
    setProviderHealth({ reachable: Boolean(result.ok), error: result.error } as ProviderHealth);
    const provider = result.provider === "built-in" ? "Built-in web search" : "Ollama web-search";
    setProviderMessage(result.ok ? `${provider} lookup works (${result.resultCount ?? 0} result returned).` : `${provider} lookup failed: ${result.error ?? "unknown error"}`);
  }

  async function storeRiotApiKey() {
    if (!riotApiKey.trim()) {
      setProviderMessage("Paste a Riot API key before saving it.");
      return;
    }
    await riftcoachApi.setRiotApiKey(riotApiKey.trim());
    setRiotApiKey("");
    setProviderMessage("Riot API key saved in the local encrypted credential store.");
  }

  async function deleteRiotApiKey() {
    await riftcoachApi.deleteRiotApiKey();
    setRiotApiKey("");
    setProviderMessage("Riot API key removed.");
  }

  async function testRiotApi() {
    setProviderMessage("Testing Riot Account and Match-v5 access...");
    const result = await riftcoachApi.testRiotApi(settings);
    setProviderHealth({ reachable: Boolean(result.ok), error: result.error } as ProviderHealth);
    setProviderMessage(result.ok
      ? `Riot API works for ${result.riotId}; ${result.matchCount ?? 0} recent matches found.`
      : `Riot API test failed: ${result.error ?? "unknown error"}`);
  }

  return (
    <div className="settings-page">
      <section className="settings-hero">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2>Connect RiftCoach to the model that will write your post-game reviews.</h2>
          <p>Reports use the selected model plus RiftCoach telemetry, benchmarks, and matchup context. Provider failures are shown directly.</p>
          {dirty && <span className="pill small unsaved">unsaved changes</span>}
        </div>
        <button onClick={() => void saveAll()} disabled={saving}>{saving ? "Saving..." : dirty ? "Save pending changes" : "Save settings"}</button>
      </section>

      <div className="grid two">
        <Card title="AI provider" eyebrow="Coaching engine">
          <div className="form-grid">
            <label>Mode<select value={settings.aiMode} onChange={(e) => update("aiMode", e.target.value as AppSettings["aiMode"])}>
              <option value="local-ollama">Local Ollama</option>
              <option value="openai-cloud">OpenAI cloud proxy</option>
              <option value="hybrid">Hybrid cloud report</option>
            </select></label>
            <label>Ollama URL<input value={settings.ollamaBaseUrl} onChange={(e) => update("ollamaBaseUrl", e.target.value)} placeholder="http://127.0.0.1:11434" /></label>
            <label>Ollama model<input value={settings.ollamaModel} onChange={(e) => update("ollamaModel", e.target.value)} placeholder="qwen2.5:7b-instruct" /></label>
            <label>Ollama context tokens<input type="number" min={2048} max={262144} step={1024} value={settings.ollamaContextTokens} onChange={(e) => update("ollamaContextTokens", Number(e.target.value))} /></label>
            <label>Ollama output tokens<input type="number" min={256} max={65536} step={512} value={settings.ollamaOutputTokens} onChange={(e) => update("ollamaOutputTokens", Number(e.target.value))} /></label>
            <label>Ollama timeout minutes<input type="number" min={1} max={30} value={Math.round(settings.ollamaTimeoutMs / 60000)} onChange={(e) => update("ollamaTimeoutMs", Number(e.target.value) * 60000)} /></label>
            <label>API base URL<input value={settings.apiBaseUrl} onChange={(e) => update("apiBaseUrl", e.target.value)} placeholder="http://127.0.0.1:8787" /></label>
            <label>OpenAI proxy model<input value={settings.openAiProxyModel} onChange={(e) => update("openAiProxyModel", e.target.value)} placeholder="gpt-4.1-mini" /></label>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void testOllama()}>Test Ollama with current values</button>
            <button onClick={() => void saveAll()} disabled={saving}>{dirty ? "Save provider settings" : "Saved"}</button>
          </div>
        </Card>

        <Card title="Provider diagnostics" eyebrow="Model health">
          <div className={`system-banner ${diagnosticTone(providerHealth, providerMessage)}`}>
            <div>
              <strong>{providerMessage || "No provider test has run yet"}</strong>
              <p>Use this before generating a report. The test uses the current form values, even before you save them.</p>
              {providerHealth?.models && providerHealth.models.length > 0 && <code>Installed Ollama models: {providerHealth.models.slice(0, 8).join(", ")}</code>}
            </div>
          </div>
          <div className="form-grid">
            <label>Cloud proxy token<input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Optional token for your RiftCoach API proxy" /></label>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={() => void storeCloudToken()}>Save token</button>
            <button className="secondary" onClick={() => void deleteCloudToken()}>Remove token</button>
          </div>
        </Card>

        <Card title="Knowledge and web search" eyebrow="Report context">
          <div className="form-grid">
            <label>Coaching context<select value={settings.knowledgeMode} onChange={(e) => update("knowledgeMode", e.target.value as AppSettings["knowledgeMode"])}>
              <option value="off">Telemetry only</option>
              <option value="built-in">Built-in benchmarks and matchup notes</option>
              <option value="web-assisted">Built-in + web enrichment</option>
            </select></label>
            <label>Search provider<select value={settings.webSearchProvider} onChange={(e) => update("webSearchProvider", e.target.value as AppSettings["webSearchProvider"])}>
              <option value="built-in">Built-in web search</option>
              <option value="ollama-web">Ollama web-search API</option>
            </select></label>
            {settings.webSearchProvider === "ollama-web" && (
              <label>Ollama web-search API key<input type="password" value={webSearchToken} onChange={(e) => setWebSearchToken(e.target.value)} placeholder="Only needed for Ollama web-search" /></label>
            )}
            <label>Web search results<input type="number" min={1} max={10} value={settings.webSearchMaxResults} onChange={(e) => update("webSearchMaxResults", Number(e.target.value))} /></label>
            <label>Web search timeout seconds<input type="number" min={5} max={60} value={Math.round(settings.webSearchTimeoutMs / 1000)} onChange={(e) => update("webSearchTimeoutMs", Number(e.target.value) * 1000)} /></label>
          </div>
          <p className="muted">Built-in web search works without Docker or an API key. It is used for report enrichment and review follow-up chat when web enrichment is enabled.</p>
          <div className="checkbox-list">
            <label className="checkbox"><input type="checkbox" checked={settings.webSearchEnabled} onChange={(e) => update("webSearchEnabled", e.target.checked)} /> Use web enrichment for reviews, VOD/ROFL reviews, and follow-up chat</label>
          </div>
          <div className="button-row">
            {settings.webSearchProvider === "ollama-web" && <button className="secondary" onClick={() => void storeWebSearchToken()}>Save web key</button>}
            <button className="secondary" onClick={() => void testWebSearch()}>Test web lookup</button>
            {settings.webSearchProvider === "ollama-web" && <button className="secondary" onClick={() => void deleteWebSearchToken()}>Remove web key</button>}
          </div>
        </Card>

        <Card title="Privacy and Windows" eyebrow="Local behavior">
          <div className="form-grid">
            <label>Privacy<select value={settings.privacyMode} onChange={(e) => update("privacyMode", e.target.value as AppSettings["privacyMode"])}>
              <option value="local-only">Local only</option>
              <option value="summary-cloud">Summary cloud</option>
              <option value="allow-screenshots-cloud">Allow screenshots cloud</option>
            </select></label>
            <label>Screenshot interval seconds<input type="number" min={15} value={settings.screenshotIntervalSec} onChange={(e) => update("screenshotIntervalSec", Number(e.target.value))} /></label>
            <label>Poll interval milliseconds<input type="number" min={1000} step={500} value={settings.pollIntervalMs} onChange={(e) => update("pollIntervalMs", Number(e.target.value))} /></label>
          </div>
          <div className="checkbox-list">
            <label className="checkbox"><input type="checkbox" checked={settings.captureScreenshots} onChange={(e) => update("captureScreenshots", e.target.checked)} /> Capture screenshots for post-game visual bookmarks</label>
            <label className="checkbox"><input type="checkbox" checked={settings.startOnLogin} onChange={(e) => update("startOnLogin", e.target.checked)} /> Start on login</label>
            <label className="checkbox"><input type="checkbox" checked={settings.minimizeToTray} onChange={(e) => update("minimizeToTray", e.target.checked)} /> Minimize to tray</label>
            <label className="checkbox"><input type="checkbox" checked={settings.notificationsEnabled} onChange={(e) => update("notificationsEnabled", e.target.checked)} /> Desktop notifications</label>
          </div>
        </Card>

        <Card title="Replays and match data" eyebrow="Automatic evidence">
          <p className="muted">ROFL final stats are parsed offline. Match-v5 enrichment and replay video rendering are optional upgrades.</p>
          <div className="form-grid">
            <label>Riot platform<select value={settings.riotPlatform} onChange={(e) => update("riotPlatform", e.target.value as AppSettings["riotPlatform"])}>
              {(["BR1", "EUN1", "EUW1", "JP1", "KR", "LA1", "LA2", "ME1", "NA1", "OC1", "PH2", "RU", "SG2", "TH2", "TR1", "TW2", "VN2"] as const).map((platform) => <option key={platform} value={platform}>{platform}</option>)}
            </select></label>
            <label>Live recording FPS<input type="number" min={10} max={60} value={settings.liveRecordingFps} onChange={(e) => update("liveRecordingFps", Number(e.target.value))} /></label>
            <label>Riot API key<input type="password" value={riotApiKey} onChange={(e) => setRiotApiKey(e.target.value)} placeholder="Optional developer key for Match-v5" /></label>
          </div>
          <div className="checkbox-list">
            <label className="checkbox"><input type="checkbox" checked={settings.recordLiveMatches} onChange={(e) => update("recordLiveMatches", e.target.checked)} /> Automatically record the League game window as a local VOD</label>
            <label className="checkbox"><input type="checkbox" checked={settings.riotMatchEnrichment} onChange={(e) => update("riotMatchEnrichment", e.target.checked)} /> Enrich ROFL reviews with Riot Match-v5 timeline data</label>
            <label className="checkbox"><input type="checkbox" checked={settings.renderRoflVideos} onChange={(e) => update("renderRoflVideos", e.target.checked)} /> Render a WebM from League replays when Replay API is enabled</label>
          </div>
          <p className="muted">Game-window recording is off by default, captures no microphone, and never falls back to recording the full desktop.</p>
          <div className="button-row">
            <button className="secondary" onClick={() => void storeRiotApiKey()}>Save Riot key</button>
            <button className="secondary" onClick={() => void testRiotApi()}>Test Match-v5</button>
            <button className="secondary" onClick={() => void deleteRiotApiKey()}>Remove Riot key</button>
          </div>
        </Card>

        <Card title="Player profile" eyebrow="Optional context">
          <p className="muted">Rank is read automatically from the running League Client. Manual values are used only when local sync is disabled or unavailable.</p>
          <div className="checkbox-list">
            <label className="checkbox"><input type="checkbox" checked={settings.automaticRankSync} onChange={(e) => update("automaticRankSync", e.target.checked)} /> Automatically sync Rank and LP from League</label>
          </div>
          <div className="form-grid">
            <label>Riot ID<input value={settings.riotId ?? ""} onChange={(e) => update("riotId", e.target.value)} placeholder="Name#TAG" /></label>
            <label>Ranked queue<select value={settings.rankQueue} onChange={(e) => update("rankQueue", e.target.value as AppSettings["rankQueue"])}>
              <option value="RANKED_SOLO_5x5">Solo / Duo</option>
              <option value="RANKED_FLEX_SR">Flex</option>
            </select></label>
            <label>Manual fallback rank<input value={settings.playerRank ?? ""} onChange={(e) => update("playerRank", e.target.value)} placeholder="Silver II" /></label>
            <label>Manual fallback LP<input type="number" min={0} max={100} value={settings.playerLp ?? ""} onChange={(e) => update("playerLp", e.target.value === "" ? undefined : Number(e.target.value))} placeholder="62" /></label>
            <label>Fallback role<select value={settings.mainRole ?? "unknown"} onChange={(e) => update("mainRole", e.target.value as AppSettings["mainRole"])}>
              <option value="unknown">Unknown</option>
              <option value="top">Top</option>
              <option value="jungle">Jungle</option>
              <option value="mid">Mid</option>
              <option value="adc">ADC</option>
              <option value="support">Support</option>
            </select></label>
            <label>Coach tone<select value={settings.coachTone} onChange={(e) => update("coachTone", e.target.value as AppSettings["coachTone"])}>
              <option value="direct">Direct</option>
              <option value="supportive">Supportive</option>
              <option value="analytical">Analytical</option>
              <option value="concise">Concise</option>
              <option value="toxic">Toxic roast</option>
            </select></label>
          </div>
        </Card>

        <Card title="Danger zone" eyebrow="Local data">
          <p className="muted">Deletes local sessions, reports, journal entries, and screenshots stored by RiftCoach.</p>
          <button className="danger" onClick={() => { if (confirm("Delete all local RiftCoach data?")) void riftcoachApi.deleteLocalData(); }}>Delete local data</button>
        </Card>
      </div>
    </div>
  );
}

function diagnosticTone(health: ProviderHealth | null, message: string): "green" | "blue" | "amber" | "red" {
  if (health?.reachable) return health.modelAvailable === false ? "amber" : "green";
  if (health && !health.reachable) return "red";
  if (/failed|not reachable|not installed|error/i.test(message)) return "red";
  if (message) return "green";
  return "blue";
}

function rankSyncMessage(status: RankSyncStatus): string {
  if (status.state === "client-not-running") return "Open the League Client to sync rank; the last verified snapshot remains saved.";
  if (status.state === "disabled") return "Automatic rank sync is disabled. RiftCoach will use the manual fallback.";
  if (status.state === "syncing") return "Rank sync is already in progress.";
  if (status.state === "error") return status.lastError ? `Rank sync failed: ${status.lastError}` : "Rank sync failed.";
  return "Rank synced from the League Client.";
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "green" | "blue" | "purple" | "amber" | "red" }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">◇</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <div className="button-row centered">{action}</div>}
    </div>
  );
}

function Step({ number, title, description, active }: { number: string; title: string; description: string; active: boolean }) {
  return (
    <div className={`step ${active ? "active" : ""}`}>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function LiveApiExplainer({ status }: { status: LiveSessionStatus }) {
  const api = liveApiMessage(status);
  const showTechnical = status.lastError && !isExpectedLiveClientOffline(status.lastError);
  return (
    <div className={`system-banner ${api.tone}`}>
      <div>
        <strong>{api.title}</strong>
        <p>{api.description}</p>
        {showTechnical && <code>{status.lastError}</code>}
      </div>
    </div>
  );
}

function liveApiMessage(status: LiveSessionStatus): { title: string; short: string; description: string; tone: "green" | "blue" | "purple" | "amber" | "red" } {
  if (status.state === "recording") {
    return {
      title: "Recording active match",
      short: "Recording now",
      description: "RiftCoach is recording this game for your post-game review.",
      tone: "green"
    };
  }
  if (status.state === "error") {
    return {
      title: "Recorder needs attention",
      short: "Needs attention",
      description: "The recorder needs attention before it can record your next match.",
      tone: "red"
    };
  }
  if (status.state === "league-not-running" || isExpectedLiveClientOffline(status.lastError)) {
    return {
      title: "Waiting for a live League match",
      short: "Ready for match start",
      description: "RiftCoach will start recording automatically when your match begins. You can leave the app minimized to tray.",
      tone: "amber"
    };
  }
  return {
    title: "Recorder idle",
    short: "Ready",
    description: "Leave RiftCoach open or minimized to tray. It will start recording when your next match begins.",
    tone: "blue"
  };
}

function isExpectedLiveClientOffline(error?: string): boolean {
  if (!error) return false;
  return /ECONNREFUSED|127\.0\.0\.1:2999|Live Client API request timed out|socket hang up/i.test(error);
}

function sidebarStatusTitle(status: LiveSessionStatus) {
  if (status.state === "recording") return "Recording match";
  if (status.state === "error") return "Recorder issue";
  if (status.state === "league-not-running") return "Waiting for match";
  return "Ready";
}

function vodRecordingLabel(status: LiveSessionStatus): string {
  const labels: Record<LiveSessionStatus["vodRecording"]["state"], string> = {
    disabled: "Off",
    idle: "Ready",
    starting: "Starting",
    recording: "Recording",
    finalizing: "Saving",
    saved: "Saved",
    error: "Unavailable"
  };
  return labels[status.vodRecording.state];
}

function heroTitle(status: LiveSessionStatus) {
  if (status.state === "recording") return "Recording this match for post-game coaching.";
  if (status.state === "error") return "Recorder needs attention before the next session.";
  return "Ready to review your next League game.";
}

function heroDescription(status: LiveSessionStatus) {
  if (status.state === "recording") return "Keep playing normally. RiftCoach is collecting local snapshots and will build a review after the game ends.";
  if (status.state === "error") return "Open the Live Recorder tab for details. Check the recorder status and provider settings.";
  return "Keep the app open in the tray, play a match, then come back for one evidence-backed improvement plan.";
}

function aiModeLabel(mode: AppSettings["aiMode"]) {
  return {
    "local-ollama": "Ollama",
    "openai-cloud": "OpenAI proxy",
    hybrid: "Hybrid"
  }[mode];
}

function aiModeDetail(settings: AppSettings) {
  if (settings.aiMode === "local-ollama") return settings.ollamaModel;
  return settings.openAiProxyModel;
}

function sessionTitle(session: SessionRecord) {
  if (session.champion === "Uploaded VOD") return "Uploaded video";
  if (session.champion === "ROFL Replay") return "League replay";
  return session.champion ?? "Unknown champion";
}

function reportStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Needs review",
    generating: "Generating",
    ready: "Review ready",
    failed: "Failed"
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function roleLabel(role?: string) {
  const labels: Record<string, string> = { top: "Top", jungle: "Jungle", mid: "Mid", adc: "ADC", support: "Support", unknown: "Detecting" };
  return labels[role ?? "unknown"] ?? "Detecting";
}

function providerLabel(provider: string) {
  if (provider === "ollama") return "Ollama";
  if (provider === "openai-proxy") return "OpenAI proxy";
  if (provider === "deterministic") return "legacy rules engine";
  return provider;
}
