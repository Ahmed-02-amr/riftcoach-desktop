import type { RiftCoachApi } from "../preload/preload";
import type { AppSettings, JournalEntry, LiveSessionStatus } from "./types";

export const isElectronShell = typeof window !== "undefined" && Boolean(window.riftcoach);

const previewSettings: AppSettings = {
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
  playerRank: "Gold I",
  playerLp: 62,
  mainRole: "unknown"
};

const previewJournal: JournalEntry[] = [
  {
    id: "preview-8", reportId: "report-8", sessionId: "session-8", champion: "Syndra", role: "mid",
    createdAtIso: "2026-07-14T18:42:00.000Z", strengthTitle: "Lane discipline", strengthDetail: "Managed the wave before leaving lane and protected the recall window.",
    weaknessTitle: "Early deaths", weaknessDetail: "The first death removed pressure before the objective setup.", rank: "Gold I", lp: 62
  },
  {
    id: "preview-7", reportId: "report-7", sessionId: "session-7", champion: "Viego", role: "jungle",
    createdAtIso: "2026-07-12T21:58:00.000Z", strengthTitle: "Objective setup", strengthDetail: "Created tempo before neutral objectives and arrived with the team.",
    weaknessTitle: "Vision timing", weaknessDetail: "Control wards landed after the most important rotation had already started.", rank: "Gold I", lp: 48
  },
  {
    id: "preview-6", reportId: "report-6", sessionId: "session-6", champion: "Ornn", role: "top",
    createdAtIso: "2026-07-09T17:27:00.000Z", strengthTitle: "Lane discipline", strengthDetail: "Absorbed pressure without giving away the wave state.",
    weaknessTitle: "Early deaths", weaknessDetail: "A preventable death before ten minutes delayed the first item spike.", rank: "Gold II", lp: 84
  },
  {
    id: "preview-5", reportId: "report-5", sessionId: "session-5", champion: "Syndra", role: "mid",
    createdAtIso: "2026-07-07T19:12:00.000Z", strengthTitle: "Objective setup", strengthDetail: "Moved first from a prepared mid wave.",
    weaknessTitle: "Vision timing", weaknessDetail: "Side-lane pressure was taken without enough river information.", rank: "Gold II", lp: 59
  }
];

const previewStatus: LiveSessionStatus = {
  state: "league-not-running",
  snapshotsRecorded: 0,
  gameTimeSec: 0,
  updatedAtIso: new Date().toISOString(),
  lastError: undefined
};

function createPreviewApi(): RiftCoachApi {
  let settings = previewSettings;
  return {
    getStatus: async () => previewStatus,
    onStatusUpdate: () => () => undefined,
    getSettings: async () => settings,
    saveSettings: async (next: AppSettings) => {
      settings = { ...settings, ...next };
      return settings;
    },
    setApiToken: async () => ({ ok: true }),
    deleteApiToken: async () => ({ ok: true }),
    setWebSearchToken: async () => ({ ok: true }),
    deleteWebSearchToken: async () => ({ ok: true }),
    listSessions: async () => [],
    stopActiveSession: async () => previewStatus,
    generateReport: async () => undefined,
    listReports: async () => [],
    getReport: async () => undefined,
    listReviewChatMessages: async () => [],
    sendReviewChatMessage: async () => {
      throw new Error("Review chat requires the Electron desktop shell.");
    },
    listJournalEntries: async () => previewJournal,
    listFrames: async () => [],
    listObservations: async () => [],
    listVodImports: async () => [],
    getFrameDataUrl: async () => undefined,
    selectVod: async () => undefined,
    importVod: async () => undefined,
    createVodReview: async () => undefined,
    testOllama: async () => ({ reachable: false, model: settings.ollamaModel, error: "Ollama test requires the Electron desktop shell." }),
    testWebSearch: async () => ({ ok: false, error: "Web-search test requires the Electron desktop shell." }),
    deleteLocalData: async () => ({ ok: true })
  };
}

export const riftcoachApi: RiftCoachApi = window.riftcoach ?? createPreviewApi();
