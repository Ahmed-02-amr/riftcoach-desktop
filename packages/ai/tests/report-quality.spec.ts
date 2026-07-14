import { describe, expect, it } from "vitest";
import type { CoachReport, CoachReportInput } from "@riftcoach/core";
import { enforceActionableCoachReport, enforceEvidenceBackedCoachReport } from "../src/report-quality.ts";

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
    expect(repaired.mainMistake.title).toBe("Protect the first 10 minutes");
    expect(repaired.mainMistake.explanation).toMatch(/multiple deaths before 10 minutes/i);
    expect(repaired.mainMistake.evidence).toContain("Death at 4:10");
    expect(repaired.mainMistake.evidence.join("\n")).not.toContain("Target estimate");
    expect(repaired.nextGameDrill.steps.length).toBeGreaterThanOrEqual(3);
    expect(repaired.nextGameDrill.successMetric).toMatch(/zero deaths before 10:00/i);
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

  it("replaces parser praise and unsupported timeline claims in final-stats-only ROFL reviews", () => {
    const base = input();
    const player = {
      ...base.match.player,
      championName: "MasterYi",
      livePosition: "JUNGLE",
      role: "jungle" as const,
      roleSource: "ROFL2 metadata"
    };
    const roflInput: CoachReportInput = {
      ...base,
      insights: [],
      match: {
        ...base.match,
        game: { gameMode: "ROFL_REPLAY", mapName: "Summoner's Rift", reviewMode: "coaching" },
        player,
        snapshots: [{
          sessionId: base.match.sessionId,
          timestampSec: 1320.542,
          phase: "mid",
          game: { gameMode: "ROFL_REPLAY", mapName: "Summoner's Rift", reviewMode: "coaching" },
          player,
          scores: { kills: 2, deaths: 8, assists: 0, creepScore: 114, wardScore: 19 },
          items: [],
          allPlayers: [
            { ...player, team: "ORDER", scores: { kills: 2, deaths: 8, assists: 0, creepScore: 114, wardScore: 19 }, items: [] },
            { championName: "Zed", role: "mid", team: "ORDER", scores: { kills: 5, deaths: 5, assists: 3, creepScore: 111 }, items: [] }
          ]
        }],
        events: [],
        aggregate: {
          durationSec: 1320.542,
          kills: 2,
          deaths: 8,
          assists: 0,
          teamKills: 16,
          csPerMin: 5.18,
          visionScore: 19,
          deathsBefore10: 0,
          deathTimestamps: [],
          itemNamesFinal: [],
          totalSnapshots: 1
        }
      }
    };
    const malformed: CoachReport = {
      ...benchmarkSlopReport(),
      positiveHabit: {
        title: "Final stats parsed cleanly from ROFL metadata",
        explanation: "The telemetry envelope parsed all participants and role identification was reliable."
      },
      mainMistake: {
        title: "Commit to team fights without wave state or reset",
        explanation: "You arrived late because the wave was not pushed.",
        evidence: ["Kill participation: 13%"],
        whyItMatters: "The team lost position."
      },
      warnings: ["This review is based on visual-only ROFL replay data."],
      timelineNotes: [{ timestampSec: 600, title: "Vision timing", note: "At 10 minutes vision was trailing." }]
    };

    const repaired = enforceEvidenceBackedCoachReport(malformed, roflInput);

    expect(repaired.positiveHabit.title).toBe("Maintained jungle farm pace");
    expect(repaired.positiveHabit.explanation).toContain("Master Yi");
    expect(repaired.positiveHabit.explanation).not.toMatch(/parsed|metadata|telemetry envelope/i);
    expect(repaired.mainMistake.title).toBe("Reduce repeat deaths");
    expect(repaired.mainMistake.explanation).not.toMatch(/wave|arrived late|reset window/i);
    expect(repaired.timelineNotes).toEqual([]);
    expect(repaired.warnings.join("\n")).toMatch(/final-scoreboard metadata only/i);
    expect(repaired.warnings.join("\n")).not.toMatch(/visual-only/i);
  });

  it("repairs bookmark-driven coaching into telemetry-only claims and removes local paths", () => {
    const bookmarkInput = input();
    bookmarkInput.match.visualObservations = [{
      id: "bookmark-1",
      sessionId: bookmarkInput.match.sessionId,
      frameId: "frame-1",
      timestampSec: 221,
      category: "death_context",
      confidence: 0.82,
      title: "Fight before death VOD frame",
      details: "Frame extracted just before a player-involved fight. Review wave state and spacing.",
      evidence: ["VOD frame: C:\\Users\\player\\AppData\\frame.jpg", "Game time: 3:41"],
      evidenceKind: "bookmark"
    }];
    const deteriorated: CoachReport = {
      ...benchmarkSlopReport(),
      summary: "Turn the replay bookmark into an in-game trigger.",
      mainMistake: {
        title: "Replay the bookmark as a decision check",
        explanation: "The VOD frame proves the wave collapsed because your spacing was wrong.",
        evidence: ["VOD frame: C:\\Users\\player\\AppData\\frame.jpg", "Game time: 3:41"],
        whyItMatters: "The screenshot shows what went wrong."
      },
      positiveHabit: {
        title: "Sustain through mid game with tank items",
        explanation: "The build allowed you to survive fights and caused more assists."
      },
      timelineNotes: [{
        timestampSec: 600,
        title: "Recovered after the death",
        note: "The snapshot proves the tank build paid off and you survived longer."
      }],
      nextGameDrill: {
        title: "Replay the bookmark as a decision check",
        steps: ["Review the screenshot."],
        successMetric: "Choose better next time.",
        duration: "next_game"
      }
    };

    const repaired = enforceEvidenceBackedCoachReport(deteriorated, bookmarkInput);

    expect(repaired.mainMistake.title).toBe("Protect the first 10 minutes");
    expect(repaired.mainMistake.explanation).toContain("Telemetry records the death timing, not its cause");
    expect(repaired.mainMistake.evidence.join("\n")).not.toMatch(/C:\\Users|VOD frame/i);
    expect(repaired.summary).not.toMatch(/bookmark|screenshot/i);
    expect(repaired.positiveHabit.explanation).not.toMatch(/allowed you|caused more assists|survive fights/i);
    expect(repaired.timelineNotes.length).toBeGreaterThan(0);
    expect(repaired.timelineNotes.map((note) => note.note).join("\n")).not.toMatch(/recovered|paid off|survived longer/i);
    expect(repaired.timelineNotes[0]!.note).toContain("does not establish");
  });

  it("falls back to scoreboard evidence when bookmarks are removed and no rule insight remains", () => {
    const bookmarkInput = input();
    bookmarkInput.insights = [];
    bookmarkInput.match.visualObservations = [{
      id: "bookmark-1",
      sessionId: bookmarkInput.match.sessionId,
      timestampSec: 600,
      category: "wave",
      confidence: 0.7,
      title: "Laning checkpoint VOD frame",
      details: "Frame extracted as a review checkpoint.",
      evidence: ["VOD frame: C:\\Users\\player\\checkpoint.jpg"],
      evidenceKind: "bookmark"
    }];
    const deteriorated: CoachReport = {
      ...benchmarkSlopReport(),
      summary: "The replay bookmark shows a bad wave state.",
      mainMistake: {
        title: "Replay the bookmark as a decision check",
        explanation: "The screenshot proves the wave collapsed.",
        evidence: ["VOD frame: C:\\Users\\player\\checkpoint.jpg"],
        whyItMatters: "The frame shows the mistake."
      }
    };

    const repaired = enforceEvidenceBackedCoachReport(deteriorated, bookmarkInput);

    expect(repaired.summary).toContain("no timestamped decision error cleared the evidence threshold");
    expect(JSON.stringify(repaired)).not.toMatch(/C:\\\\Users|replay the bookmark|screenshot proves/i);
    expect(repaired.mainMistake.evidence.join("\n")).toContain("Final scoreboard");
  });
});
