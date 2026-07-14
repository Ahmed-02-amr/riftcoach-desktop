import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@riftcoach/core";
import { updateReplayApiSetting } from "../src/main/services/league-replay-service.ts";
import { buildLeagueRecordingArgs } from "../src/main/services/game-recording-service.ts";
import { createRoflReviewData } from "../src/main/services/rofl-review-data.ts";
import { rankedQueueForGameQueue, rankedSnapshotFromClient } from "../src/main/services/rank-sync-service.ts";

describe("Replay API one-click setup", () => {
  it("adds EnableReplayApi to an existing General section while preserving CRLF", () => {
    const input = "[General]\r\nLanguageLocaleRegion=en_US\r\n\r\n[Performance]\r\nShadows=1\r\n";
    const output = updateReplayApiSetting(input, true);

    expect(output).toContain("[General]\r\nEnableReplayApi=1\r\nLanguageLocaleRegion=en_US");
    expect(output.endsWith("\r\n")).toBe(true);
  });

  it("updates an existing setting without creating duplicates", () => {
    const output = updateReplayApiSetting("[General]\nEnableReplayApi=0\nEnableReplayApi=true\n", true);

    expect(output).toBe("[General]\nEnableReplayApi=1\n");
    expect(output.match(/EnableReplayApi/g)).toHaveLength(1);
  });

  it("creates a General section when the config does not have one", () => {
    const output = updateReplayApiSetting("[Performance]\nShadows=1", true);

    expect(output).toContain("[General]\nEnableReplayApi=1");
  });
});

describe("automatic League window recording", () => {
  it("builds a League-window-only ffmpeg capture command", () => {
    const args = buildLeagueRecordingArgs("C:\\recordings\\match.mkv", 500);

    expect(args).toContain("gdigrab");
    expect(args).toContain("title=League of Legends (TM) Client");
    expect(args).toContain("60");
    expect(args.at(-1)).toBe("C:\\recordings\\match.mkv");
  });
});

describe("automatic League rank sync", () => {
  it("normalizes the selected ranked queue into a journal snapshot", () => {
    const snapshot = rankedSnapshotFromClient({
      queues: [{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", division: "I", leaguePoints: 84, wins: 38, losses: 31 }]
    }, "RANKED_SOLO_5x5", "2026-07-14T18:42:00.000Z", 420);

    expect(snapshot).toMatchObject({ rank: "Gold I", lp: 84, wins: 38, losses: 31, matchQueueId: 420, source: "league-client" });
    expect(rankedQueueForGameQueue(420)).toBe("RANKED_SOLO_5x5");
    expect(rankedQueueForGameQueue(440)).toBe("RANKED_FLEX_SR");
    expect(rankedQueueForGameQueue(400)).toBeUndefined();
  });
});

describe("offline ROFL review normalization", () => {
  it("selects the configured Riot ID and carries final stats into the coaching snapshot", () => {
    const result = createRoflReviewData({
      sessionId: "session-1",
      settings: { ...DEFAULT_SETTINGS, riotId: "Player One#NA1", mainRole: "mid" },
      metadata: {
        filePath: "NA1-123.rofl",
        format: "ROFL2",
        gameVersion: "16.13.1",
        durationSec: 1_842,
        platformId: "NA1",
        gameId: "123",
        matchId: "NA1_123",
        players: [
          {
            participantIndex: 0,
            riotId: "Player One#NA1",
            championName: "Syndra",
            role: "mid",
            team: "ORDER",
            won: true,
            kills: 9,
            deaths: 3,
            assists: 11,
            creepScore: 224,
            visionScore: 27,
            level: 17,
            itemIds: [6655, 3020],
            raw: {}
          },
          {
            participantIndex: 1,
            riotId: "Opponent#NA1",
            championName: "Zed",
            role: "mid",
            team: "CHAOS",
            kills: 3,
            deaths: 9,
            assists: 2,
            creepScore: 190,
            itemIds: [],
            raw: {}
          }
        ]
      }
    });

    expect(result.championName).toBe("Syndra");
    expect(result.snapshots.at(-1)?.scores).toMatchObject({ kills: 9, deaths: 3, assists: 11, creepScore: 224 });
    expect(result.snapshots.at(-1)?.allPlayers).toHaveLength(2);
    expect(result.evidence).toContain("Match ID: NA1_123.");
  });
});
