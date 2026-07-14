import { describe, expect, it } from "vitest";
import type { CoachReport, CoachReportInput } from "@riftcoach/core";
import { enforceActionableCoachReport } from "../src/report-quality.ts";

function input(): CoachReportInput {
  return {
    match: {
      sessionId: "session-1",
      game: { gameMode: "CLASSIC", mapName: "Map11", mapNumber: 11, reviewMode: "coaching" },
      startedAtIso: "2026-07-09T00:00:00.000Z",
      player: {
        riotId: "Player#TAG",
        summonerName: "Player#TAG",
        championName: "Nasus",
        livePosition: "TOP",
        role: "top",
        roleConfidence: 0.95,
        roleSource: "live client position"
      },
      snapshots: [
        {
          sessionId: "session-1",
          timestampSec: 600,
          phase: "early",
          game: { gameMode: "CLASSIC", mapName: "Map11", mapNumber: 11, reviewMode: "coaching" },
          player: {
            riotId: "Player#TAG",
            summonerName: "Player#TAG",
            championName: "Nasus",
            livePosition: "TOP",
            role: "top",
            roleConfidence: 0.95,
            roleSource: "live client position"
          },
          scores: { kills: 0, deaths: 2, assists: 0, creepScore: 38, wardScore: 5 },
          items: [{ displayName: "Doran's Shield" }],
          allPlayers: []
        }
      ],
      events: [
        { id: 1, type: "champion_kill", timestampSec: 250, actorName: "Darius", victimName: "Player#TAG", rawEventName: "ChampionKill" },
        { id: 2, type: "champion_kill", timestampSec: 430, actorName: "Ekko", victimName: "Player#TAG", assistingParticipantNames: ["Darius"], rawEventName: "ChampionKill" }
      ],
      aggregate: {
        durationSec: 1500,
        kills: 0,
        deaths: 5,
        assists: 1,
        teamKills: 8,
        csAt10: 38,
        csAt15: 70,
        csPerMin: 4.2,
        visionScore: 14,
        deathsBefore10: 2,
        deathTimestamps: [250, 430, 790, 980, 1300],
        itemNamesFinal: ["Trinity Force"],
        totalSnapshots: 1
      }
    },
    insights: [
      {
        id: "death-1",
        category: "laning",
        severity: "high",
        confidence: 0.92,
        title: "Multiple deaths before 10 minutes",
        evidence: ["Death at 4:10", "Death at 7:10"],
        affectedTimestamps: [250, 430],
        ruleSource: "detectEarlyDeaths",
        recommendedFocus: "Play first 10 minutes survival-first."
      },
      {
        id: "cs-1",
        category: "cs",
        severity: "high",
        confidence: 0.8,
        title: "CS was below your role target at 10 minutes",
        evidence: ["CS at 10: 38", "Target estimate: 57"],
        affectedTimestamps: [600],
        ruleSource: "detectLowCs",
        recommendedFocus: "Catch safe waves first."
      }
    ],
    settings: { aiMode: "local-ollama", privacyMode: "local-only", coachTone: "direct", knowledgeMode: "built-in" }
  } as CoachReportInput;
}

function benchmarkSlopReport(): CoachReport {
  return {
    id: "report-1",
    sessionId: "session-1",
    provider: "ollama",
    model: "qwen",
    createdAtIso: "2026-07-09T00:00:00.000Z",
    reviewType: "coaching",
    summary:
      "Nasus top lane performance was hindered by a significant farming deficit relative to benchmarks, resulting in gold disadvantage and excessive deaths against Darius/Ekko despite decent vision control.",
    mainMistake: {
      title: "Significant farming deficit relative to benchmarks",
      explanation: "Nasus top lane performance was hindered by a significant farming deficit relative to benchmarks.",
      evidence: ["CS at 10: 38", "Target estimate: 57"],
      whyItMatters: "This caused a gold disadvantage and excessive deaths."
    },
    positiveHabit: {
      title: "Decent vision control",
      explanation: "Vision control was decent."
    },
    timelineNotes: [],
    nextGameDrill: {
      title: "Improve farming",
      steps: ["Focus on farming better."],
      successMetric: "Improve CS.",
      duration: "next_game"
    },
    warnings: []
  };
}

describe("report actionability enforcement", () => {
  it("rewrites benchmark-only report-card prose into a concrete decision review", () => {
    const repaired = enforceActionableCoachReport(benchmarkSlopReport(), input());

    expect(repaired.summary).not.toMatch(/performance was hindered|relative to benchmarks|gold disadvantage|decent vision|not a benchmark grade|decision pattern behind/i);
    expect(repaired.mainMistake.title).toBe("Stop taking the first doomed lane fight");
    expect(repaired.mainMistake.explanation).toMatch(/multiple deaths before 10 minutes/i);
    expect(repaired.mainMistake.evidence).toContain("Death at 4:10");
    expect(repaired.mainMistake.evidence.join("\n")).not.toContain("Target estimate");
    expect(repaired.nextGameDrill.steps.length).toBeGreaterThanOrEqual(3);
    expect(repaired.nextGameDrill.successMetric).toMatch(/zero avoidable deaths before 10:00/i);
  });

  it("turns a CS-only report into natural wave-discipline coaching", () => {
    const csOnlyInput = {
      ...input(),
      insights: input().insights.filter((insight) => insight.category === "cs")
    };
    const repaired = enforceActionableCoachReport(benchmarkSlopReport(), csOnlyInput);

    expect(repaired.summary).toContain("Nasus: Your next-game focus is wave discipline.");
    expect(repaired.summary).toContain("take the guaranteed wave first");
    expect(repaired.summary).not.toMatch(/not a benchmark grade|decision pattern behind|Treat low CS as the symptom/i);
    expect(repaired.mainMistake.title).toBe("Catch the safe wave before chasing the play");
    expect(repaired.mainMistake.explanation).toContain("Low CS usually comes from repeated wave choices");
    expect(repaired.nextGameDrill.steps).toContain("Before leaving lane, check whether a wave is about to reach your tower.");
  });
});
