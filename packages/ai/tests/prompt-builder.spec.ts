import { describe, expect, it } from "vitest";
import { buildCoachPacket, buildPostGameCoachMessages } from "../src/prompt-builder.ts";

function player(overrides: Record<string, unknown> = {}) {
  return {
    riotId: "Player#TAG",
    summonerName: "Player#TAG",
    championName: "Swain",
    livePosition: "TOP",
    team: "ORDER",
    role: "top",
    roleConfidence: 0.97,
    roleSource: "live client position",
    summonerSpells: ["Flash", "Teleport"],
    scores: { kills: 1, deaths: 1, assists: 1, creepScore: 40, wardScore: 6 },
    items: [{ displayName: "Doran's Ring" }],
    ...overrides
  };
}

function enemy(name: string, championName: string, role: string, overrides: Record<string, unknown> = {}) {
  return {
    riotId: name,
    summonerName: name,
    championName,
    livePosition: role === "mid" ? "MIDDLE" : role.toUpperCase(),
    team: "CHAOS",
    role,
    roleConfidence: 0.97,
    roleSource: "live client position",
    summonerSpells: ["Flash", "Ignite"],
    scores: { kills: 1, deaths: 1, assists: 0, creepScore: 38, wardScore: 4 },
    items: [{ displayName: "Long Sword" }],
    ...overrides
  };
}

function snapshot(timestampSec: number, overrides: Record<string, unknown> = {}) {
  const active = player(overrides);
  return {
    sessionId: "session-1",
    timestampSec,
    phase: timestampSec < 14 * 60 ? "early" : "mid",
    game: { gameMode: "CLASSIC", mapName: "Map11", mapNumber: 11, reviewMode: "coaching" },
    player: {
      riotId: "Player#TAG",
      summonerName: "Player#TAG",
      championName: "Swain",
      livePosition: "TOP",
      role: "top",
      roleConfidence: 0.97,
      roleSource: "live client position"
    },
    level: timestampSec >= 900 ? 11 : timestampSec >= 600 ? 8 : 5,
    currentGold: timestampSec >= 900 ? 900 : 450,
    scores: active.scores,
    items: active.items,
    allPlayers: [
      active,
      { ...player({ riotId: "AllyJg", summonerName: "AllyJg", championName: "Vi", livePosition: "JUNGLE", role: "jungle", scores: { kills: 2, deaths: 0, assists: 2, creepScore: 58, wardScore: 7 }, items: [{ displayName: "Sundered Sky" }] }), team: "ORDER" },
      enemy("EnemyTop", "Darius", "top", { scores: { kills: 2, deaths: 1, assists: 0, creepScore: 44, wardScore: 3 } }),
      enemy("EnemyJg", "Lee Sin", "jungle", { scores: { kills: 2, deaths: 1, assists: 2, creepScore: 54, wardScore: 8 } })
    ]
  };
}

function input() {
  const snapshots = [
    snapshot(300, { scores: { kills: 0, deaths: 0, assists: 0, creepScore: 28, wardScore: 2 }, items: [{ displayName: "Doran's Ring" }] }),
    snapshot(600, { scores: { kills: 0, deaths: 1, assists: 0, creepScore: 54, wardScore: 5 }, items: [{ displayName: "Doran's Ring" }, { displayName: "Lost Chapter" }] }),
    snapshot(900, { scores: { kills: 1, deaths: 1, assists: 1, creepScore: 88, wardScore: 8 }, items: [{ displayName: "Doran's Ring" }, { displayName: "Lost Chapter" }] }),
    snapshot(1200, { scores: { kills: 2, deaths: 1, assists: 2, creepScore: 128, wardScore: 12 }, items: [{ displayName: "Liandry's Anguish" }, { displayName: "Sorcerer's Shoes" }] }),
    snapshot(1260, { scores: { kills: 2, deaths: 1, assists: 2, creepScore: 136, wardScore: 13 }, items: [{ displayName: "Liandry's Anguish" }, { displayName: "Sorcerer's Shoes" }] })
  ];

  return {
    match: {
      sessionId: "session-1",
      game: { gameMode: "CLASSIC", mapName: "Map11", mapNumber: 11, reviewMode: "coaching" },
      startedAtIso: "2026-06-03T00:00:00.000Z",
      player: snapshots.at(-1)!.player,
      snapshots,
      events: [
        { id: 1, type: "champion_kill", timestampSec: 390, actorName: "EnemyJg", victimName: "Player#TAG", assistingParticipantNames: ["EnemyTop"], rawEventName: "ChampionKill" },
        { id: 2, type: "dragon_kill", timestampSec: 480, actorName: "EnemyJg", rawEventName: "DragonKill" },
        { id: 3, type: "champion_kill", timestampSec: 820, actorName: "Player#TAG", victimName: "EnemyTop", rawEventName: "ChampionKill" },
        { id: 4, type: "champion_kill", timestampSec: 1000, actorName: "AllyJg", victimName: "EnemyJg", assistingParticipantNames: ["Player#TAG"], rawEventName: "ChampionKill" }
      ],
      aggregate: {
        durationSec: 1260,
        kills: 2,
        deaths: 1,
        assists: 2,
        teamKills: 4,
        csAt10: 54,
        csAt15: 88,
        csPerMin: (136 / 1260) * 60,
        visionScore: 13,
        deathsBefore10: 1,
        deathTimestamps: [390],
        itemNamesFinal: ["Liandry's Anguish", "Sorcerer's Shoes"],
        totalSnapshots: snapshots.length
      },
      rawLiveData: {
        source: "riot-live-client-allgamedata",
        endpoint: "/liveclientdata/allgamedata",
        tokenBudget: 131072,
        estimatedTokens: 100,
        totalStoredSnapshots: 1,
        includedSnapshots: 1,
        omittedSnapshots: 0,
        selectionReason: "All stored raw /allgamedata snapshots fit the raw telemetry budget.",
        snapshots: [
          {
            checkpoint: "end",
            timestampSec: 1260,
            estimatedTokens: 100,
            allGameData: {
              gameData: { gameMode: "CLASSIC", gameTime: 1260 },
              activePlayer: { championStats: { currentHealth: 900, maxHealth: 1600 } }
            }
          }
        ],
        warnings: []
      },
      visualObservations: [
        {
          id: "visual-1",
          sessionId: "session-1",
          timestampSec: 390,
          category: "death_context",
          confidence: 0.66,
          title: "Visual bookmark near death",
          details: "Screenshot near death.",
          evidence: ["Frame: death.png"],
          evidenceKind: "verified"
        }
      ]
    },
    insights: [
      {
        id: "insight-1",
        category: "laning",
        severity: "medium",
        confidence: 0.72,
        title: "Early death before 10 minutes",
        evidence: ["Death at 6:30"],
        affectedTimestamps: [390],
        ruleSource: "detectEarlyDeaths",
        recommendedFocus: "Play first 10 minutes survival-first."
      }
    ],
    profile: { rank: "Gold", mainRole: "top" },
    settings: { aiMode: "local-ollama", privacyMode: "local-only", coachTone: "direct", knowledgeMode: "built-in" }
  } as any;
}

describe("coach prompt telemetry", () => {
  it("exposes compact Riot telemetry beyond CS-only evidence", () => {
    const packet = buildCoachPacket(input()) as any;

    expect(packet.telemetry.roleEvidence).toMatchObject({
      champion: "Swain",
      role: "top",
      livePosition: "TOP",
      roleSource: "live client position"
    });
    expect(packet.telemetry.keySnapshots.map((entry: any) => entry.checkpoint)).toEqual(["5m", "10m", "15m", "20m", "end"]);
    expect(packet.telemetry.participantScoreboard.find((entry: any) => entry.subject)).toMatchObject({
      champion: "Swain",
      finalItems: ["Liandry's Anguish", "Sorcerer's Shoes"]
    });
    expect(packet.telemetry.objectiveTimeline[0]).toMatchObject({
      eventType: "dragon_kill",
      actor: { champion: "Lee Sin", role: "jungle", team: "CHAOS" }
    });
    expect(packet.telemetry.playerCombatTimeline.map((event: any) => event.eventType)).toEqual(["death", "kill", "assist"]);
    expect(packet.telemetry.playerItemTimeline.at(-1).items).toContain("Liandry's Anguish");
    expect(packet.telemetry.visualBookmarks[0].title).toBe("Visual bookmark near death");
    expect(packet.telemetry.dataAvailability.available.join("\n")).toContain("Raw Riot /allgamedata payloads");
    expect(packet.telemetry.rawRiotLiveClient.snapshots[0].allGameData.activePlayer.championStats.currentHealth).toBe(900);
    expect(packet.telemetry.evidence.join("\n")).toContain("Objective timeline");
  });

  it("instructs the model to use telemetry as citeable evidence", () => {
    const messages = buildPostGameCoachMessages(input());
    expect(messages[0]!.content).toContain("Use the telemetry block as first-class evidence");
    expect(messages[0]!.content).toContain("rawRiotLiveClient");
    expect(messages[0]!.content).toContain("Benchmarks are context, not the review");
    expect(messages[0]!.content).toContain("Prefer a timestamped decision mistake");

    const packet = JSON.parse(messages[1]!.content);
    expect(packet.instruction.requiredOutput).toContain("telemetry.evidence");
    expect(packet.telemetry.rawRiotLiveClient.includedSnapshots).toBe(1);
    expect(packet.instruction.qualityBar.join("\n")).toContain("concrete next-game behavior");
    expect(packet.instruction.forbiddenPatterns).toContain("benchmark-only diagnosis");
    expect(packet.telemetry.evidence.some((entry: string) => entry.startsWith("Role evidence:"))).toBe(true);
  });

  it("does not expose bookmark-only frames as semantic visual evidence", () => {
    const bookmarkOnlyInput = input();
    bookmarkOnlyInput.match.visualObservations = [{
      id: "bookmark-1",
      sessionId: "session-1",
      timestampSec: 390,
      category: "death_context",
      confidence: 0.82,
      title: "Fight before death VOD frame",
      details: "Frame extracted before a death.",
      evidence: ["VOD frame: C:\\Users\\player\\death.jpg"],
      evidenceKind: "bookmark"
    }];

    const packet = buildCoachPacket(bookmarkOnlyInput) as any;
    const messages = buildPostGameCoachMessages(bookmarkOnlyInput);

    expect(packet.telemetry.visualBookmarks).toEqual([]);
    expect(JSON.stringify(packet)).not.toContain("C:\\\\Users");
    expect(messages[0]!.content).toContain("Timestamp bookmarks and local pixel scans are navigation aids, not image understanding");
  });

  it("treats offline ROFL final metadata as scoreboard data without fabricating a timeline", () => {
    const roflInput = input();
    const finalSnapshot = roflInput.match.snapshots.at(-1)!;
    const roflGame = { gameMode: "ROFL_REPLAY", mapName: "Summoner's Rift", reviewMode: "coaching" };
    const roflPlayer = { ...roflInput.match.player, championName: "MasterYi", role: "jungle", roleSource: "ROFL2 metadata" };
    roflInput.match = {
      ...roflInput.match,
      game: roflGame,
      player: roflPlayer,
      snapshots: [{
        ...finalSnapshot,
        timestampSec: 1320,
        game: roflGame,
        player: roflPlayer,
        scores: { kills: 2, deaths: 8, assists: 0, creepScore: 114, wardScore: 19 }
      }],
      events: [],
      visualObservations: [],
      aggregate: {
        ...roflInput.match.aggregate,
        durationSec: 1320,
        kills: 2,
        deaths: 8,
        assists: 0,
        csAt10: undefined,
        csAt15: undefined,
        csPerMin: 5.18,
        visionScore: 19,
        deathTimestamps: [],
        totalSnapshots: 1
      }
    };

    const packet = buildCoachPacket(roflInput) as any;

    expect(packet.matchSummary.evidenceMode).toBe("rofl_final_stats_only");
    expect(packet.matchSummary.timelineAvailable).toBe(false);
    expect(packet.telemetry.capture.source).toMatch(/Offline ROFL final-scoreboard metadata/i);
    expect(packet.telemetry.keySnapshots).toEqual([]);
    expect(packet.telemetry.playerCombatTimeline).toEqual([]);
    expect(packet.telemetry.evidence.join("\n")).toContain("one final scoreboard and no minute-by-minute timeline");
    expect(packet.telemetry.evidence.join("\n")).not.toMatch(/Visual-only|at 5:00|at 10:00/i);
    expect(packet.instruction.qualityBar.join("\n")).toContain("Never use parser success");
  });

  it("supports toxic roast tone with safety guardrails", () => {
    const toxicInput = input();
    toxicInput.settings.coachTone = "toxic";
    const messages = buildPostGameCoachMessages(toxicInput);

    expect(messages[0]!.content).toContain("ranked-solo-queue roast");
    expect(messages[0]!.content).toContain("Do not impersonate any specific streamer");
    expect(messages[0]!.content).toContain("Do not use slurs");
  });
});
