import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseRoflMetadata, riotRegionalRouteForPlatform } from "../src/index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ROFL metadata parser", () => {
  it("reads current ROFL2 footer metadata without loading the replay payload", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "NA1-1234567890.rofl");
    const metadata = metadataEnvelope();
    const header = Buffer.alloc(32);
    Buffer.from([0x52, 0x49, 0x4f, 0x54, 0x02, 0x00]).copy(header, 0);
    const version = Buffer.from("16.13.1.2", "utf8");
    header[14] = version.length;
    version.copy(header, 15);
    const length = Buffer.alloc(4);
    length.writeUInt32LE(metadata.length);
    await writeFile(filePath, Buffer.concat([header, Buffer.alloc(64, 7), metadata, length]));

    const parsed = await parseRoflMetadata(filePath);

    expect(parsed.format).toBe("ROFL2");
    expect(parsed.gameVersion).toBe("16.13.1.2");
    expect(parsed.durationSec).toBe(1320.5);
    expect(parsed.matchId).toBe("NA1_1234567890");
    expect(parsed.players[0]).toMatchObject({
      riotId: "Player One#NA1",
      championName: "Syndra",
      role: "mid",
      team: "ORDER",
      kills: 8,
      deaths: 3,
      assists: 11,
      creepScore: 222,
      itemIds: [6655, 3089]
    });
  });

  it("reads legacy ROFL metadata from the header offsets", async () => {
    const directory = await temporaryDirectory();
    const filePath = join(directory, "EUW1-42.rofl");
    const metadata = metadataEnvelope("14.8.1");
    const header = Buffer.alloc(288);
    Buffer.from([0x52, 0x49, 0x4f, 0x54, 0x00, 0x00]).copy(header, 0);
    header.writeUInt16LE(288, 262);
    header.writeUInt32LE(288 + metadata.length, 264);
    header.writeUInt32LE(288, 268);
    header.writeUInt32LE(metadata.length, 272);
    await writeFile(filePath, Buffer.concat([header, metadata]));

    const parsed = await parseRoflMetadata(filePath);

    expect(parsed.format).toBe("ROFL");
    expect(parsed.gameVersion).toBe("14.8.1");
    expect(parsed.platformId).toBe("EUW1");
    expect(parsed.players).toHaveLength(1);
  });
});

describe("Riot regional routing", () => {
  it("maps platform shards to Match-v5 regional routes", () => {
    expect(riotRegionalRouteForPlatform("NA1")).toBe("americas");
    expect(riotRegionalRouteForPlatform("EUW1")).toBe("europe");
    expect(riotRegionalRouteForPlatform("KR")).toBe("asia");
    expect(riotRegionalRouteForPlatform("OC1")).toBe("sea");
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "riftcoach-rofl-"));
  temporaryDirectories.push(directory);
  return directory;
}

function metadataEnvelope(gameVersion?: string): Buffer {
  const statsJson = JSON.stringify([
    {
      RIOT_ID_GAME_NAME: "Player One",
      RIOT_ID_TAG_LINE: "NA1",
      PUUID: "test-puuid",
      SKIN: "Syndra",
      TEAM_POSITION: "MIDDLE",
      TEAM: "100",
      WIN: "1",
      CHAMPIONS_KILLED: "8",
      NUM_DEATHS: "3",
      ASSISTS: "11",
      MINIONS_KILLED: "210",
      NEUTRAL_MINIONS_KILLED: "12",
      VISION_SCORE: "27",
      LEVEL: "17",
      ITEM0: "6655",
      ITEM1: "3089",
      ITEM2: "0"
    }
  ]);
  return Buffer.from(
    JSON.stringify({ gameLength: 1_320_500, gameVersion, lastGameChunkId: 55, lastKeyFrameId: 8, statsJson }),
    "utf8"
  );
}
