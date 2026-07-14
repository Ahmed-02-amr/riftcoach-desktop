import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeAppSettings } from "../src/types/settings.ts";

describe("settings normalization", () => {
  it("adds Ollama token defaults to older settings", () => {
    const settings = normalizeAppSettings({ ollamaModel: "llama3.1:8b-instruct" });

    expect(settings.ollamaContextTokens).toBe(DEFAULT_SETTINGS.ollamaContextTokens);
    expect(settings.ollamaOutputTokens).toBe(DEFAULT_SETTINGS.ollamaOutputTokens);
    expect(settings.webSearchProvider).toBe("built-in");
  });

  it("clamps Ollama token settings to supported local bounds", () => {
    const lowSettings = normalizeAppSettings({
      ollamaContextTokens: 1_000_000,
      ollamaOutputTokens: 1
    });

    expect(lowSettings.ollamaContextTokens).toBe(262_144);
    expect(lowSettings.ollamaOutputTokens).toBe(256);

    const highSettings = normalizeAppSettings({ ollamaOutputTokens: 1_000_000 });
    expect(highSettings.ollamaOutputTokens).toBe(65_536);
  });

  it("normalizes the configured web search provider", () => {
    expect(normalizeAppSettings({ webSearchProvider: "ollama-web" }).webSearchProvider).toBe("ollama-web");
    expect(normalizeAppSettings({ webSearchProvider: "searxng" }).webSearchProvider).toBe("built-in");
    expect(normalizeAppSettings({ webSearchProvider: "invalid" }).webSearchProvider).toBe("built-in");
  });

  it("normalizes LP snapshots to the ranked ladder range", () => {
    expect(normalizeAppSettings({ playerLp: 62 }).playerLp).toBe(62);
    expect(normalizeAppSettings({ playerLp: 140 }).playerLp).toBe(100);
    expect(normalizeAppSettings({ playerLp: -12 }).playerLp).toBe(0);
  });
});
