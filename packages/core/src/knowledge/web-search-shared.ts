import type { AppSettings } from "../types/settings";
import type { MatchContext } from "../types/game";
import type { KnowledgeSourceSnippet } from "../types/knowledge";

export interface WebKnowledgeResult {
  sources: KnowledgeSourceSnippet[];
  warnings: string[];
}

export function shouldUseWebKnowledge(settings: AppSettings): boolean {
  return settings.knowledgeMode === "web-assisted" && settings.webSearchEnabled;
}

export function planLeagueKnowledgeQueries(match: MatchContext): string[] {
  const champion = match.player.championName;
  const role = match.player.role === "unknown" ? "League of Legends" : `${match.player.role} lane`;
  const roleContext = match.player.role === "unknown" ? "League of Legends" : `${match.player.role} role`;
  const hasKnownChampion = hasSpecificChampion(champion);

  if (match.game?.gameMode === "VOD_REVIEW" || match.game?.gameMode === "ROFL_REPLAY") {
    return uniqueQueries([
      `League of Legends VOD review ${roleContext} positioning minimap wave management checklist`,
      "League of Legends replay review common mistakes objective setup map awareness",
      `League of Legends ${roleContext} coaching fundamentals wave vision spacing`
    ]);
  }

  const latest = match.snapshots.at(-1);
  const activeName = (match.player.summonerName ?? match.player.riotId ?? "").toLowerCase();
  const active = latest?.allPlayers?.find((player) =>
    [player.summonerName, player.riotId].filter(Boolean).some((name) => String(name).toLowerCase() === activeName)
  );
  const enemyTeam = active?.team === "ORDER" ? "CHAOS" : active?.team === "CHAOS" ? "ORDER" : undefined;
  const enemySameRole = enemyTeam ? latest?.allPlayers?.find((player) => player.team === enemyTeam && player.role === match.player.role) : undefined;

  const benchmarkQuery =
    match.player.role === "unknown"
      ? "League of Legends average vision score CS at 10 benchmark by role rank"
      : `League of Legends average ${match.player.role} vision score CS at 10 benchmark rank`;
  const queries = [
    benchmarkQuery,
    hasKnownChampion
      ? `League of Legends ${champion} ${role} coaching tips common mistakes`
      : `League of Legends ${roleContext} coaching tips common mistakes`
  ];
  if (hasKnownChampion && enemySameRole?.championName) queries.push(`League of Legends ${champion} vs ${enemySameRole.championName} ${role} matchup tips`);
  return uniqueQueries(queries);
}

export function planReviewChatKnowledgeQueries(params: {
  match: MatchContext;
  userMessage: string;
  reportTitle?: string;
}): string[] {
  const champion = hasSpecificChampion(params.match.player.championName) ? params.match.player.championName : "";
  const role = params.match.player.role === "unknown" ? "" : params.match.player.role;
  const topic = [champion, role, params.reportTitle, params.userMessage]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return uniqueQueries([
    topic ? `League of Legends coaching ${topic}` : "League of Legends coaching decision review",
    topic ? `League of Legends ${topic} best course of action` : "League of Legends replay review best course of action"
  ]);
}

export function createKnowledgeSourceSnippet(params: {
  title?: string;
  url: string;
  snippet: string;
  query: string;
  sourceIndex: number;
  resultIndex: number;
}): KnowledgeSourceSnippet {
  return {
    id: `web-${Date.now()}-${params.sourceIndex}-${params.resultIndex}`,
    title: params.title?.trim() || params.url,
    url: params.url,
    snippet: params.snippet.trim().slice(0, 900),
    query: params.query,
    sourceType: "web",
    reliability: classifyWebSourceReliability(params.url),
    fetchedAtIso: new Date().toISOString()
  };
}

export function classifyWebSourceReliability(url: string): "low" | "medium" | "high" {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("riotgames.com") || host.endsWith("leagueoflegends.com")) return "high";
    if (/(u\.gg|op\.gg|mobalytics|lolalytics|mobafire|probuilds|leagueofgraphs)/i.test(host)) return "medium";
    return "low";
  } catch {
    return "low";
  }
}

export function uniqueQueries(queries: string[]): string[] {
  return Array.from(new Set(queries.map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

export function normalizeKnowledgeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function hasSpecificChampion(champion: string | undefined): boolean {
  const value = champion?.trim();
  if (!value) return false;
  return !/^unknown champion$/i.test(value) && !/^(uploaded vod|rofl replay)$/i.test(value);
}
