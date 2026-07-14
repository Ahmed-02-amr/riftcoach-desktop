export type AiMode = "local-ollama" | "openai-cloud" | "hybrid";

export type PrivacyMode = "local-only" | "summary-cloud" | "allow-screenshots-cloud";

export type CoachTone = "direct" | "supportive" | "analytical" | "concise" | "toxic";

export type PlayerRole = "top" | "jungle" | "mid" | "adc" | "support" | "unknown";

export type KnowledgeMode = "off" | "built-in" | "web-assisted";

export type WebSearchProvider = "built-in" | "ollama-web";

export interface AppSettings {
  aiMode: AiMode;
  privacyMode: PrivacyMode;
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
  startOnLogin: boolean;
  minimizeToTray: boolean;
  notificationsEnabled: boolean;
  coachTone: CoachTone;
  knowledgeMode: KnowledgeMode;
  webSearchEnabled: boolean;
  webSearchProvider: WebSearchProvider;
  webSearchMaxResults: number;
  webSearchTimeoutMs: number;
  playerRank?: string;
  playerLp?: number;
  /** Optional fallback only. RiftCoach attempts to infer the active role from live match data first. */
  mainRole?: PlayerRole;
  riotId?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiMode: "local-ollama",
  privacyMode: "local-only",
  apiBaseUrl: "http://127.0.0.1:8787",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:7b-instruct",
  ollamaContextTokens: 262_144,
  ollamaOutputTokens: 8_192,
  openAiProxyModel: "gpt-4.1-mini",
  ollamaTimeoutMs: 10 * 60 * 1000,
  pollIntervalMs: 5000,
  captureScreenshots: false,
  screenshotIntervalSec: 60,
  startOnLogin: false,
  minimizeToTray: true,
  notificationsEnabled: true,
  coachTone: "direct",
  knowledgeMode: "built-in",
  webSearchEnabled: false,
  webSearchProvider: "built-in",
  webSearchMaxResults: 4,
  webSearchTimeoutMs: 15000,
  mainRole: "unknown"
};

const AI_MODES = new Set<string>(["local-ollama", "openai-cloud", "hybrid"]);
const PRIVACY_MODES = new Set<string>(["local-only", "summary-cloud", "allow-screenshots-cloud"]);
const COACH_TONES = new Set<string>(["direct", "supportive", "analytical", "concise", "toxic"]);
const PLAYER_ROLES = new Set<string>(["top", "jungle", "mid", "adc", "support", "unknown"]);
const KNOWLEDGE_MODES = new Set<string>(["off", "built-in", "web-assisted"]);
const WEB_SEARCH_PROVIDERS = new Set<string>(["built-in", "ollama-web"]);

function cleanUrl(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.replace(/\/+$/, "");
}

function cleanPositiveNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function cleanOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

export function normalizeAppSettings(input?: Partial<AppSettings> | Record<string, unknown>): AppSettings {
  const raw = { ...DEFAULT_SETTINGS, ...(input ?? {}) } as Record<string, unknown>;

  const aiMode = typeof raw.aiMode === "string" && AI_MODES.has(raw.aiMode) ? raw.aiMode : DEFAULT_SETTINGS.aiMode;
  const privacyMode = typeof raw.privacyMode === "string" && PRIVACY_MODES.has(raw.privacyMode) ? raw.privacyMode : DEFAULT_SETTINGS.privacyMode;
  const coachTone = typeof raw.coachTone === "string" && COACH_TONES.has(raw.coachTone) ? raw.coachTone : DEFAULT_SETTINGS.coachTone;
  const mainRole = typeof raw.mainRole === "string" && PLAYER_ROLES.has(raw.mainRole) ? raw.mainRole : DEFAULT_SETTINGS.mainRole;
  const knowledgeMode = typeof raw.knowledgeMode === "string" && KNOWLEDGE_MODES.has(raw.knowledgeMode) ? raw.knowledgeMode : DEFAULT_SETTINGS.knowledgeMode;
  const webSearchProvider =
    typeof raw.webSearchProvider === "string" && WEB_SEARCH_PROVIDERS.has(raw.webSearchProvider)
      ? raw.webSearchProvider
      : DEFAULT_SETTINGS.webSearchProvider;

  return {
    aiMode: aiMode as AiMode,
    privacyMode: privacyMode as PrivacyMode,
    apiBaseUrl: cleanUrl(raw.apiBaseUrl, DEFAULT_SETTINGS.apiBaseUrl),
    ollamaBaseUrl: cleanUrl(raw.ollamaBaseUrl, DEFAULT_SETTINGS.ollamaBaseUrl),
    ollamaModel: typeof raw.ollamaModel === "string" && raw.ollamaModel.trim() ? raw.ollamaModel.trim() : DEFAULT_SETTINGS.ollamaModel,
    ollamaContextTokens: cleanPositiveNumber(raw.ollamaContextTokens, DEFAULT_SETTINGS.ollamaContextTokens, 2_048, 262_144),
    ollamaOutputTokens: cleanPositiveNumber(raw.ollamaOutputTokens, DEFAULT_SETTINGS.ollamaOutputTokens, 256, 65_536),
    openAiProxyModel: typeof raw.openAiProxyModel === "string" && raw.openAiProxyModel.trim() ? raw.openAiProxyModel.trim() : DEFAULT_SETTINGS.openAiProxyModel,
    ollamaTimeoutMs: cleanPositiveNumber(raw.ollamaTimeoutMs, DEFAULT_SETTINGS.ollamaTimeoutMs, 60_000, 30 * 60 * 1000),
    pollIntervalMs: cleanPositiveNumber(raw.pollIntervalMs, DEFAULT_SETTINGS.pollIntervalMs, 1000, 60000),
    captureScreenshots: Boolean(raw.captureScreenshots),
    screenshotIntervalSec: cleanPositiveNumber(raw.screenshotIntervalSec, DEFAULT_SETTINGS.screenshotIntervalSec, 15, 600),
    startOnLogin: Boolean(raw.startOnLogin),
    minimizeToTray: raw.minimizeToTray === false ? false : DEFAULT_SETTINGS.minimizeToTray,
    notificationsEnabled: raw.notificationsEnabled === false ? false : DEFAULT_SETTINGS.notificationsEnabled,
    coachTone: coachTone as CoachTone,
    knowledgeMode: knowledgeMode as KnowledgeMode,
    webSearchEnabled: Boolean(raw.webSearchEnabled),
    webSearchProvider: webSearchProvider as WebSearchProvider,
    webSearchMaxResults: cleanPositiveNumber(raw.webSearchMaxResults, DEFAULT_SETTINGS.webSearchMaxResults, 1, 10),
    webSearchTimeoutMs: cleanPositiveNumber(raw.webSearchTimeoutMs, DEFAULT_SETTINGS.webSearchTimeoutMs, 5000, 60000),
    playerRank: typeof raw.playerRank === "string" && raw.playerRank.trim() ? raw.playerRank.trim() : undefined,
    playerLp: cleanOptionalNumber(raw.playerLp, 0, 100),
    mainRole: mainRole as PlayerRole,
    riotId: typeof raw.riotId === "string" && raw.riotId.trim() ? raw.riotId.trim() : undefined
  };
}
