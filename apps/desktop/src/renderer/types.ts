export interface LiveSessionStatus {
  state: "idle" | "recording" | "league-not-running" | "error";
  sessionId?: string;
  gameTimeSec?: number;
  snapshotsRecorded: number;
  lastError?: string;
  vodRecording: {
    state: "disabled" | "idle" | "starting" | "recording" | "finalizing" | "saved" | "error";
    sessionId?: string;
    filePath?: string;
    startedAtGameTimeSec?: number;
    error?: string;
  };
  updatedAtIso: string;
}

export type RankedQueueType = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

export interface RankedSnapshot {
  queueType: RankedQueueType;
  rank: string;
  tier: string;
  division?: string;
  lp: number;
  wins?: number;
  losses?: number;
  provisional?: boolean;
  source: "league-client" | "league-client-cache" | "manual";
  syncedAtIso: string;
  matchQueueId?: number;
}

export interface RankSyncStatus {
  state: "syncing" | "synced" | "client-not-running" | "unranked" | "disabled" | "error";
  snapshot?: RankedSnapshot;
  lastError?: string;
  updatedAtIso: string;
}

export interface AppSettings {
  aiMode: "local-ollama" | "openai-cloud" | "hybrid";
  privacyMode: "local-only" | "summary-cloud" | "allow-screenshots-cloud";
  apiBaseUrl: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaContextTokens: number;
  ollamaOutputTokens: number;
  openAiProxyModel: string;
  ollamaTimeoutMs: number;
  pollIntervalMs: number;
  captureScreenshots: boolean;
  screenshotIntervalSec: number;
  recordLiveMatches: boolean;
  liveRecordingFps: number;
  renderRoflVideos: boolean;
  riotMatchEnrichment: boolean;
  riotPlatform: "BR1" | "EUN1" | "EUW1" | "JP1" | "KR" | "LA1" | "LA2" | "ME1" | "NA1" | "OC1" | "PH2" | "RU" | "SG2" | "TH2" | "TR1" | "TW2" | "VN2";
  startOnLogin: boolean;
  minimizeToTray: boolean;
  notificationsEnabled: boolean;
  coachTone: "direct" | "supportive" | "analytical" | "concise" | "toxic";
  knowledgeMode: "off" | "built-in" | "web-assisted";
  webSearchEnabled: boolean;
  webSearchProvider: "built-in" | "ollama-web";
  webSearchMaxResults: number;
  webSearchTimeoutMs: number;
  playerRank?: string;
  playerLp?: number;
  automaticRankSync: boolean;
  rankQueue: RankedQueueType;
  mainRole?: "top" | "jungle" | "mid" | "adc" | "support" | "unknown";
  riotId?: string;
}

export interface ReplaySetupStatus {
  installed: boolean;
  installPath?: string;
  executablePath?: string;
  configPath?: string;
  enabled: boolean;
  apiReachable: boolean;
  backupPath?: string;
  message: string;
}

export interface SessionRecord {
  id: string;
  champion?: string;
  role?: string;
  startedAt: string;
  endedAt?: string;
  aiMode: string;
  reportStatus: string;
}

export interface KnowledgeSourceSnippet {
  id: string;
  title: string;
  url: string;
  snippet: string;
  query: string;
  sourceType: "web" | "built-in" | "riot-static";
  reliability: "low" | "medium" | "high";
  fetchedAtIso: string;
}

export interface KnowledgeContext {
  mode: "off" | "built-in" | "web-assisted";
  evidenceMode: "telemetry_only" | "telemetry_plus_benchmarks" | "telemetry_plus_web";
  benchmarkComparisons: Array<{
    metric: string;
    label: string;
    scope: string;
    playerValue?: number;
    median?: number;
    p25?: number;
    p75?: number;
    unit?: string;
    interpretation: string;
    confidence: string;
    sampleSize?: number;
    source: string;
  }>;
  matchupTips: Array<{
    champion: string;
    role: string;
    opponentChampion?: string;
    matchupDifficulty?: string;
    lanePlan: string[];
    dangerWindows: string[];
    commonMistakes: string[];
    source: string;
    confidence: string;
  }>;
  webSources: KnowledgeSourceSnippet[];
  warnings: string[];
}

export interface CoachReport {
  id: string;
  sessionId: string;
  provider: "ollama" | "openai-proxy" | "deterministic" | string;
  model?: string;
  createdAtIso: string;
  reviewType?: "coaching" | "casual_mode";
  summary: string;
  mainMistake: { title: string; explanation: string; evidence: string[]; whyItMatters: string };
  positiveHabit: { title: string; explanation: string };
  timelineNotes: Array<{ timestampSec: number; title: string; note: string }>;
  nextGameDrill: { title: string; steps: string[]; successMetric: string; duration: string };
  knowledgeContext?: KnowledgeContext;
  warnings: string[];
}

export interface CoachChatMessage {
  id: string;
  reportId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAtIso: string;
  sources: KnowledgeSourceSnippet[];
  warnings: string[];
}

export interface CoachChatSendResult {
  userMessage: CoachChatMessage;
  assistantMessage: CoachChatMessage;
  messages: CoachChatMessage[];
}

export interface TrainingGoal {
  id: string;
  type: string;
  title: string;
  description: string;
  targetValue?: number;
  createdAtIso: string;
  active: boolean;
}

export interface GoalResult {
  goalId: string;
  sessionId: string;
  passed: boolean;
  value?: number;
  note: string;
  evaluatedAtIso: string;
}

export interface JournalEntry {
  id: string;
  reportId: string;
  sessionId: string;
  champion?: string;
  role?: string;
  createdAtIso: string;
  strengthTitle: string;
  strengthDetail: string;
  weaknessTitle: string;
  weaknessDetail: string;
  rank?: string;
  lp?: number;
  rankBefore?: string;
  lpBefore?: number;
  lpDelta?: number;
  rankQueue?: RankedQueueType;
  rankSource?: "league-client" | "league-client-cache" | "manual";
  rankSyncedAtIso?: string;
}

export interface ProviderHealth {
  reachable: boolean;
  model?: string;
  modelAvailable?: boolean;
  models?: string[];
  error?: string;
}

export interface ScreenshotFrame {
  id: string;
  sessionId: string;
  timestampSec: number;
  capturedAtIso: string;
  filePath: string;
  width?: number;
  height?: number;
  source: "screen-capture" | "vod-frame" | "rofl-replay-frame";
}

export interface VisualObservation {
  id: string;
  sessionId: string;
  frameId?: string;
  timestampSec: number;
  category: "positioning" | "vision" | "wave" | "objective_setup" | "death_context" | "unknown";
  confidence: number;
  title: string;
  details: string;
  evidence: string[];
}

export interface VodImportResult {
  id: string;
  sessionId: string;
  filePath: string;
  importedAtIso: string;
  videoStartOffsetSec: number;
  durationSec?: number;
  frameCount: number;
  observationCount: number;
  warnings: string[];
}
