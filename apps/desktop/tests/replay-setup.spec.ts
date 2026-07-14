import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@riftcoach/core";
import { updateReplayApiSetting } from "../src/main/services/league-replay-service.ts";
import { buildLeagueRecordingArgs, captureBoundsWithinPrimary } from "../src/main/services/game-recording-service.ts";
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
    const args = buildLeagueRecordingArgs("C:\\recordings\\match.mkv", 500, {
      width: 1920,
      height: 1080,
      offsetX: 0,
      offsetY: 0
    });

    expect(args).toContain("lavfi");
    expect(args.join(" ")).toContain("ddagrab=framerate=60");
    expect(args.join(" ")).toContain("video_size=1920x1080");
    expect(args.join(" ")).toContain("offset_x=0:offset_y=0");
    expect(args.join(" ")).not.toContain("gdigrab");
    expect(args.at(-1)).toBe("C:\\recordings\\match.mkv");
  });

  it("crops capture to the League window inside the primary display", () => {
    expect(captureBoundsWithinPrimary(
      { left: 10, top: 20, right: 1919, bottom: 1079 },
      { left: 0, top: 0, right: 1920, bottom: 1080 }
    )).toEqual({ width: 1908, height: 1058, offsetX: 10, offsetY: 20 });

    expect(captureBoundsWithinPrimary(
      { left: 2200, top: 0, right: 3200, bottom: 900 },
      { left: 0, top: 0, right: 1920, bottom: 1080 }
    )).toBeUndefined();
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
