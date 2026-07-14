import { describe, expect, it } from "vitest";
import { createMatchContextFromSnapshots } from "../src/normalizer/live-data-normalizer.ts";
import { runExpertRules, runVisualReviewRules } from "../src/rules/index.ts";

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

  it("does not turn timestamp bookmarks or pixel scans into coaching insights", () => {
    const match = {
      ...ctx(),
      visualObservations: [
        {
          id: "bookmark",
          sessionId: "s1",
          timestampSec: 232,
          category: "death_context" as const,
          confidence: 0.82,
          title: "Fight before death VOD frame",
          details: "Frame extracted before a player-involved fight.",
          evidence: ["Frame: death.jpg"],
          evidenceKind: "bookmark" as const
        },
        {
          id: "scan",
          sessionId: "s1",
          timestampSec: 232,
          category: "positioning" as const,
          confidence: 0.7,
          title: "Local positioning scan",
          details: "Local pixel scan found high activity. Treat this as a replay bookmark, not object detection.",
          evidence: ["Gameplay activity: 0.8"],
          evidenceKind: "pixel-scan" as const
        }
      ]
    };

    expect(runVisualReviewRules(match)).toEqual([]);
  });
});
