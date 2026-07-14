import type { AppSettings } from "../types/settings";
import type { MatchContext } from "../types/game";
import {
  createKnowledgeSourceSnippet,
  normalizeKnowledgeUrl,
  planLeagueKnowledgeQueries,
  shouldUseWebKnowledge,
  type WebKnowledgeResult
} from "./web-search-shared";

interface SearchResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}

export async function retrieveOllamaWebKnowledge(params: {
  match: MatchContext;
  settings: AppSettings;
  apiKey?: string;
}): Promise<WebKnowledgeResult> {
  const { match, settings, apiKey } = params;
  if (!shouldUseWebKnowledge(settings)) return { sources: [], warnings: [] };
  if (!apiKey) return { sources: [], warnings: ["Web knowledge is enabled, but no Ollama web-search API key is stored."] };

  const queries = planLeagueKnowledgeQueries(match);
  const maxPerQuery = Math.max(1, Math.min(3, settings.webSearchMaxResults));
  const sources: WebKnowledgeResult["sources"] = [];
  const warnings: string[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    if (sources.length >= settings.webSearchMaxResults) break;
    try {
      const response = await fetch("https://ollama.com/api/web_search", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        signal: AbortSignal.timeout(settings.webSearchTimeoutMs),
        body: JSON.stringify({ query, max_results: maxPerQuery })
      });
      if (!response.ok) {
        warnings.push(`Web search failed for "${query}" with HTTP ${response.status}.`);
        continue;
      }
      const data = (await response.json()) as SearchResponse;
      for (const [index, result] of (data.results ?? []).entries()) {
        if (sources.length >= settings.webSearchMaxResults) break;
        if (!result.url || !result.content) continue;
        const normalizedUrl = normalizeKnowledgeUrl(result.url);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);
        sources.push(createKnowledgeSourceSnippet({ title: result.title, url: result.url, snippet: result.content, query, sourceIndex: sources.length, resultIndex: index }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Web search could not complete for "${query}": ${message}`);
    }
  }

  return { sources, warnings };
}

export async function testOllamaWebSearch(params: { apiKey?: string; timeoutMs?: number }): Promise<{ ok: boolean; error?: string; resultCount?: number }> {
  if (!params.apiKey) return { ok: false, error: "No Ollama web-search API key is stored." };
  try {
    const response = await fetch("https://ollama.com/api/web_search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${params.apiKey}`,
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(params.timeoutMs ?? 15000),
      body: JSON.stringify({ query: "League of Legends coaching benchmark CS at 10", max_results: 1 })
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const json = (await response.json()) as SearchResponse;
    return { ok: true, resultCount: json.results?.length ?? 0 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
