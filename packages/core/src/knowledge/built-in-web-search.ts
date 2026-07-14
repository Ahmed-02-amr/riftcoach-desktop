import type { AppSettings } from "../types/settings";
import type { MatchContext } from "../types/game";
import {
  createKnowledgeSourceSnippet,
  normalizeKnowledgeUrl,
  planLeagueKnowledgeQueries,
  shouldUseWebKnowledge,
  type WebKnowledgeResult
} from "./web-search-shared";

interface BuiltInSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function retrieveBuiltInWebKnowledge(params: {
  match: MatchContext;
  settings: AppSettings;
}): Promise<WebKnowledgeResult> {
  if (!shouldUseWebKnowledge(params.settings)) return { sources: [], warnings: [] };
  return retrieveBuiltInKnowledgeForQueries({
    queries: planLeagueKnowledgeQueries(params.match),
    settings: params.settings
  });
}

export async function retrieveBuiltInKnowledgeForQueries(params: {
  queries: string[];
  settings: Pick<AppSettings, "webSearchMaxResults" | "webSearchTimeoutMs">;
}): Promise<WebKnowledgeResult> {
  const maxResults = Math.max(1, Math.min(10, params.settings.webSearchMaxResults));
  const sources: WebKnowledgeResult["sources"] = [];
  const warnings: string[] = [];
  const seenUrls = new Set<string>();

  for (const query of params.queries) {
    if (sources.length >= maxResults) break;
    try {
      const results = await searchDuckDuckGoHtml(query, params.settings.webSearchTimeoutMs);
      for (const [index, result] of results.entries()) {
        if (sources.length >= maxResults) break;
        const normalizedUrl = normalizeKnowledgeUrl(result.url);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);
        sources.push(
          createKnowledgeSourceSnippet({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            query,
            sourceIndex: sources.length,
            resultIndex: index
          })
        );
      }
    } catch (error) {
      warnings.push(`Built-in web search could not complete. ${describeBuiltInSearchFailure(error)}`);
      break;
    }
  }

  return { sources, warnings };
}

export async function testBuiltInWebSearch(params: {
  timeoutMs?: number;
}): Promise<{ ok: boolean; error?: string; resultCount?: number }> {
  try {
    const results = await searchDuckDuckGoHtml("League of Legends coaching wave management", params.timeoutMs ?? 15000);
    return { ok: results.length > 0, resultCount: results.length, error: results.length > 0 ? undefined : "No search results were returned." };
  } catch (error) {
    return { ok: false, error: describeBuiltInSearchFailure(error) };
  }
}

async function searchDuckDuckGoHtml(query: string, timeoutMs: number): Promise<BuiltInSearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      "user-agent": "RiftCoach/0.3 web enrichment",
      accept: "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const results = parseDuckDuckGoHtmlResults(html);
  if (results.length === 0) throw new Error("Search returned no parseable results.");
  return results.slice(0, 10);
}

function parseDuckDuckGoHtmlResults(html: string): BuiltInSearchResult[] {
  const results: BuiltInSearchResult[] = [];
  const anchorPattern = /<a\b(?=[^>]*class=["'][^"']*\bresult__a\b[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[1];
    const rawTitle = match[2];
    if (!rawHref || !rawTitle) continue;
    const url = cleanSearchUrl(rawHref);
    if (!url || /duckduckgo\.com\/(html|lite|l\/)/i.test(url)) continue;

    const followingHtml = html.slice(match.index + match[0].length, match.index + match[0].length + 3000);
    const snippetMatch = followingHtml.match(/<[^>]+\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    const snippet = cleanHtml(snippetMatch?.[1] ?? "");
    const title = cleanHtml(rawTitle);
    if (!title || !snippet) continue;
    results.push({ title, url, snippet });
  }

  return results;
}

function cleanSearchUrl(value: string): string | undefined {
  const href = decodeHtml(value);
  const absolute = href.startsWith("//") ? `https:${href}` : href;
  try {
    const parsed = new URL(absolute);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function cleanHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function describeBuiltInSearchFailure(error: unknown): string {
  const details = collectErrorDetails(error).join(" ");
  if (/timeout|aborted/i.test(details)) return "The request timed out. Check your internet connection or increase the web-search timeout in Settings.";
  if (/ENOTFOUND|getaddrinfo|fetch failed|ECONNRESET|ECONNREFUSED/i.test(details)) return "The app could not reach the search endpoint. Check your internet connection or firewall.";
  return details || "Unknown network error.";
}

function collectErrorDetails(error: unknown): string[] {
  const details: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.message) details.push(current.message);
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.code === "string") details.push(record.code);
      current = record.cause;
      continue;
    }
    if (typeof current === "string") details.push(current);
    break;
  }
  return Array.from(new Set(details));
}
