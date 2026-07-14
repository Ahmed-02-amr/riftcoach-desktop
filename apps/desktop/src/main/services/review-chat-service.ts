import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  DEFAULT_SETTINGS,
  buildRawLiveDataTelemetry,
  buildKnowledgeContext,
  createMatchContextFromSnapshots,
  isCasualReviewMode,
  planReviewChatKnowledgeQueries,
  retrieveBuiltInKnowledgeForQueries,
  runExpertRules,
  runVisualReviewRules,
  type AppSettings,
  type CoachChatInput,
  type CoachChatMessage,
  type CoachChatReply,
  type CoachInsight,
  type CoachReport,
  type KnowledgeContext,
  type MatchContext,
  type WebKnowledgeResult
} from "@riftcoach/core";
import { OllamaCoachProvider, OpenAiProxyCoachProvider } from "@riftcoach/ai";
import {
  EventRepository,
  ReportRepository,
  ReviewChatRepository,
  SessionRepository,
  SettingsRepository,
  SnapshotRepository,
  VisualRepository
} from "@riftcoach/storage";
import type { CredentialStore } from "./credential-store";

interface ReviewChatServiceOptions {
  db: Database.Database;
  settingsRepo: SettingsRepository;
  credentialStore: CredentialStore;
}

export class ReviewChatService {
  private readonly sessions: SessionRepository;
  private readonly snapshots: SnapshotRepository;
  private readonly events: EventRepository;
  private readonly reports: ReportRepository;
  private readonly chat: ReviewChatRepository;
  private readonly visuals: VisualRepository;

  constructor(private readonly options: ReviewChatServiceOptions) {
    this.sessions = new SessionRepository(options.db);
    this.snapshots = new SnapshotRepository(options.db);
    this.events = new EventRepository(options.db);
    this.reports = new ReportRepository(options.db);
    this.chat = new ReviewChatRepository(options.db);
    this.visuals = new VisualRepository(options.db);
  }

  listMessages(reportId: string): CoachChatMessage[] {
    return this.chat.list(reportId);
  }

  async sendMessage(reportId: string, content: string): Promise<{
    userMessage: CoachChatMessage;
    assistantMessage: CoachChatMessage;
    messages: CoachChatMessage[];
  }> {
    const cleanContent = content.trim();
    if (!cleanContent) throw new Error("Message cannot be empty.");

    const report = this.reports.get(reportId);
    if (!report) throw new Error("Report not found.");

    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const userMessage = createChatMessage({
      reportId: report.id,
      sessionId: report.sessionId,
      role: "user",
      content: cleanContent,
      sources: [],
      warnings: []
    });
    this.chat.save(userMessage);

    const match = await this.buildMatchContext(report);
    const casualMode = isCasualReviewMode(match.game) || report.reviewType === "casual_mode";
    const visualOnly = isVisualOnlyReview(match);
    const insights = casualMode ? [] : visualOnly ? runVisualReviewRules(match) : runExpertRules(match);
    const webKnowledge = await this.retrieveChatWebKnowledge({ report, match, settings, userMessage: cleanContent });
    const knowledge = mergeKnowledgeForChat({ report, match, insights, settings, webSources: webKnowledge.sources, webWarnings: webKnowledge.warnings });
    const input: CoachChatInput = {
      report,
      match: { ...match, knowledgeContext: knowledge },
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
      knowledge,
      history: this.chat.list(reportId).filter((message) => message.id !== userMessage.id),
      userMessage: cleanContent,
      webSources: webKnowledge.sources,
      webWarnings: webKnowledge.warnings
    };

    const reply = await this.generateWithConfiguredProvider(input, settings);
    const assistantMessage = createChatMessage({
      reportId: report.id,
      sessionId: report.sessionId,
      role: "assistant",
      content: reply.content,
      sources: reply.sources,
      warnings: reply.warnings
    });
    this.chat.save(assistantMessage);

    return {
      userMessage,
      assistantMessage,
      messages: this.chat.list(reportId)
    };
  }

  private async buildMatchContext(report: CoachReport): Promise<MatchContext> {
    const session = this.sessions.get(report.sessionId);
    if (!session) throw new Error(`Session not found for report: ${report.sessionId}`);
    const snapshotRows = this.snapshots.listWithRaw(report.sessionId);
    const snapshots = snapshotRows.map((row) => row.snapshot);
    const events = this.events.list(report.sessionId);
    const match = createMatchContextFromSnapshots({
      sessionId: report.sessionId,
      startedAtIso: session.startedAt,
      endedAtIso: session.endedAt,
      snapshots,
      events
    });
    const settings = this.options.settingsRepo.getAppSettings(DEFAULT_SETTINGS);
    const casualMode = isCasualReviewMode(match.game);
    const fallbackRole = !casualMode && settings.mainRole && settings.mainRole !== "unknown" ? settings.mainRole : undefined;
    const detectedRole = match.player.role && match.player.role !== "unknown" ? match.player.role : undefined;
    return {
      ...match,
      gameId: session.riotGameId,
      rawLiveData: buildRawLiveDataTelemetry({ snapshots: snapshotRows, events, player: match.player }),
      visualObservations: this.visuals.listObservations(report.sessionId),
      knowledgeContext: report.knowledgeContext,
      player: {
        ...match.player,
        rank: settings.playerRank ?? match.player.rank,
        role: casualMode ? "unknown" : detectedRole ?? fallbackRole ?? match.player.role,
        roleSource: casualMode ? "casual game mode" : detectedRole ? match.player.roleSource : fallbackRole ? "fallback profile" : match.player.roleSource,
        roleConfidence: casualMode ? 0 : detectedRole ? match.player.roleConfidence : fallbackRole ? 0.25 : match.player.roleConfidence
      }
    };
  }

  private async retrieveChatWebKnowledge(params: {
    report: CoachReport;
    match: MatchContext;
    settings: AppSettings;
    userMessage: string;
  }): Promise<WebKnowledgeResult> {
    const { settings } = params;
    if (settings.knowledgeMode !== "web-assisted" || !settings.webSearchEnabled) return { sources: [], warnings: [] };
    return retrieveBuiltInKnowledgeForQueries({
      queries: planReviewChatKnowledgeQueries({
        match: params.match,
        reportTitle: params.report.mainMistake.title,
        userMessage: params.userMessage
      }),
      settings
    });
  }

  private async generateWithConfiguredProvider(input: CoachChatInput, settings: AppSettings): Promise<CoachChatReply> {
    if (settings.aiMode === "local-ollama") {
      try {
        return await new OllamaCoachProvider({
          baseUrl: settings.ollamaBaseUrl,
          model: settings.ollamaModel,
          contextTokens: settings.ollamaContextTokens,
          outputTokens: settings.ollamaOutputTokens,
          timeoutMs: settings.ollamaTimeoutMs
        }).generateReviewChatReply(input);
      } catch (error) {
        throw new Error(`Ollama review chat failed for model "${settings.ollamaModel}" at ${settings.ollamaBaseUrl}: ${formatProviderError(error)}`);
      }
    }

    if (settings.aiMode === "openai-cloud" || settings.aiMode === "hybrid") {
      try {
        const token = await this.options.credentialStore.getSecret("api-token");
        return await new OpenAiProxyCoachProvider({
          apiBaseUrl: settings.apiBaseUrl,
          model: settings.openAiProxyModel,
          authToken: token,
          timeoutMs: settings.ollamaTimeoutMs
        }).generateReviewChatReply(input);
      } catch (error) {
        throw new Error(`OpenAI proxy review chat failed for model "${settings.openAiProxyModel}" at ${settings.apiBaseUrl}: ${formatProviderError(error)}`);
      }
    }

    throw new Error(`Unsupported AI mode: ${String((settings as any).aiMode)}`);
  }
}

function createChatMessage(params: Omit<CoachChatMessage, "id" | "createdAtIso">): CoachChatMessage {
  return {
    ...params,
    id: nanoid(12),
    createdAtIso: new Date().toISOString()
  };
}

function mergeKnowledgeForChat(params: {
  report: CoachReport;
  match: MatchContext;
  insights: CoachInsight[];
  settings: AppSettings;
  webSources: CoachChatReply["sources"];
  webWarnings: string[];
}): KnowledgeContext | undefined {
  if (params.settings.knowledgeMode === "off") return undefined;
  const reportKnowledge = params.report.knowledgeContext;
  const webSources = dedupeSources([...(reportKnowledge?.webSources ?? []), ...params.webSources]);
  const warnings = Array.from(new Set([...(reportKnowledge?.warnings ?? []), ...params.webWarnings]));
  if (isVisualOnlyReview(params.match)) {
    return {
      mode: params.settings.knowledgeMode,
      evidenceMode: webSources.length > 0 ? "telemetry_plus_web" : "telemetry_only",
      benchmarkComparisons: [],
      matchupTips: [],
      webSources,
      warnings
    };
  }

  return buildKnowledgeContext({
    match: params.match,
    insights: params.insights,
    settings: params.settings,
    webSources,
    warnings
  });
}

function dedupeSources(sources: CoachChatReply["sources"]): CoachChatReply["sources"] {
  const seen = new Set<string>();
  const out: CoachChatReply["sources"] = [];
  for (const source of sources) {
    const key = source.url.replace(/#.*$/, "").replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function isVisualOnlyReview(match: MatchContext): boolean {
  return match.game?.gameMode === "VOD_REVIEW" || match.game?.gameMode === "ROFL_REPLAY";
}

function formatProviderError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
