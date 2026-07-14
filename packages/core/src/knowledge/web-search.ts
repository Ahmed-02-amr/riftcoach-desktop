import type { AppSettings } from "../types/settings";
import type { MatchContext } from "../types/game";
import { retrieveBuiltInWebKnowledge, testBuiltInWebSearch } from "./built-in-web-search";
import { retrieveOllamaWebKnowledge, testOllamaWebSearch } from "./ollama-web-search";
import { type WebKnowledgeResult } from "./web-search-shared";

export async function retrieveConfiguredWebKnowledge(params: {
  match: MatchContext;
  settings: AppSettings;
  ollamaApiKey?: string;
}): Promise<WebKnowledgeResult> {
  if (params.settings.webSearchProvider === "ollama-web") {
    return retrieveOllamaWebKnowledge({ match: params.match, settings: params.settings, apiKey: params.ollamaApiKey });
  }
  return retrieveBuiltInWebKnowledge({ match: params.match, settings: params.settings });
}

export async function testConfiguredWebSearch(params: {
  settings: AppSettings;
  ollamaApiKey?: string;
}): Promise<{ ok: boolean; error?: string; resultCount?: number; provider: AppSettings["webSearchProvider"] }> {
  if (params.settings.webSearchProvider === "ollama-web") {
    const result = await testOllamaWebSearch({ apiKey: params.ollamaApiKey, timeoutMs: params.settings.webSearchTimeoutMs });
    return { ...result, provider: "ollama-web" };
  }
  const result = await testBuiltInWebSearch({ timeoutMs: params.settings.webSearchTimeoutMs });
  return { ...result, provider: "built-in" };
}
