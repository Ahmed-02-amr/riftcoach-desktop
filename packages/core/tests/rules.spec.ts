import { describe, expect, it } from "vitest";
import { createMatchContextFromSnapshots } from "../src/normalizer/live-data-normalizer.ts";
import { runExpertRules } from "../src/rules/index.ts";

function ctx() {
  return createMatchContextFromSnapshots({
    sessionId: "s1",
    startedAtIso: new Date().toISOString(),
    snapshots: [
      {
        sessionId: "s1",
        timestampSec: 300,
        phase: "early",
        player: { championName: "Jinx", role: "adc", summonerName: "Player" },
        scores: { kills: 0, deaths: 1, assists: 0, creepScore: 25 },
        items: []
      },
      {
        sessionId: "s1",
        timestampSec: 600,
        phase: "early",
        player: { championName: "Jinx", role: "adc", summonerName: "Player" },
        scores: { kills: 0, deaths: 2, assists: 0, creepScore: 42 },
        items: []
      }
    ],
    events: [
      { id: 1, type: "champion_kill", timestampSec: 240, victimName: "Player" },
      { id: 2, type: "champion_kill", timestampSec: 520, victimName: "Player" }
    ]
  });
}

describe("expert rules", () => {
  it("detects early deaths", () => {
    const insights = runExpertRules(ctx());
    expect(insights.some((insight) => insight.ruleSource === "detectEarlyDeaths")).toBe(true);
  });
});
