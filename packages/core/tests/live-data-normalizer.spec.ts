import { describe, expect, it } from "vitest";
import { buildRawLiveDataTelemetry, createMatchContextFromSnapshots, normalizeEvents, normalizeLiveData } from "../src/normalizer/live-data-normalizer.ts";

function liveData(overrides: any = {}) {
  return {
    gameData: {
      gameTime: 600,
      gameMode: "CLASSIC",
      mapName: "Map11",
      mapNumber: 11,
      ...overrides.gameData
    },
    activePlayer: {
      riotId: "Player#TAG",
      summonerName: "Player#TAG",
      level: 9,
      currentGold: 500,
      championStats: {
        currentHealth: 1234,
        maxHealth: 1800,
        resourceType: "MANA",
        resourceValue: 220,
        resourceMax: 400,
        armor: 77,
        magicResist: 48
      },
      abilities: {
        Q: { displayName: "Death's Hand", id: "SwainQ", abilityLevel: 5 },
        W: { displayName: "Vision of Empire", id: "SwainW", abilityLevel: 1 },
        E: { displayName: "Nevermove", id: "SwainE", abilityLevel: 3 },
        R: { displayName: "Demonic Ascension", id: "SwainR", abilityLevel: 1 },
        Passive: { displayName: "Ravenous Flock", id: "SwainPassive" }
      },
      fullRunes: {
        keystone: { id: 8437, displayName: "Grasp of the Undying" },
        primaryRuneTree: { id: 8400, displayName: "Resolve" },
        secondaryRuneTree: { id: 8200, displayName: "Sorcery" },
        generalRunes: [{ id: 8437, displayName: "Grasp of the Undying" }],
        statRunes: [{ id: 5008, rawDescription: "perk_tooltip_StatModAdaptive" }]
      }
    },
    allPlayers: [
      {
        riotId: "Player#TAG",
        summonerName: "Player#TAG",
        championName: "Swain",
        position: "TOP",
        team: "ORDER",
        isDead: false,
        respawnTimer: 0,
        level: 9,
        scores: { kills: 2, deaths: 1, assists: 3, creepScore: 70, wardScore: 8 },
        items: [],
        summonerSpells: {
          summonerSpellOne: { displayName: "Flash" },
          summonerSpellTwo: { displayName: "Teleport" }
        },
        ...overrides.player
      }
    ],
    events: {
      Events: [
        { EventID: 0, EventName: "GameStart", EventTime: 0 },
        { EventID: 1, EventName: "DragonKill", EventTime: 500, KillerName: "Player#TAG", DragonType: "Infernal", Stolen: false }
      ]
    }
  };
}

describe("live data normalization", () => {
  it("uses Riot Live Client position before champion role hints", () => {
    const snapshot = normalizeLiveData("s1", liveData());

    expect(snapshot.player.championName).toBe("Swain");
    expect(snapshot.player.livePosition).toBe("TOP");
    expect(snapshot.allPlayers?.[0]?.livePosition).toBe("TOP");
    expect(snapshot.player.role).toBe("top");
    expect(snapshot.player.roleSource).toBe("live client position");
    expect(snapshot.activePlayerDetails?.championStats?.currentHealth).toBe(1234);
    expect(snapshot.activePlayerDetails?.abilities?.find((ability) => ability.slot === "Q")).toMatchObject({ displayName: "Death's Hand", abilityLevel: 5 });
    expect(snapshot.activePlayerDetails?.runes?.keystone?.displayName).toBe("Grasp of the Undying");
    expect(snapshot.allPlayers?.[0]?.isDead).toBe(false);
    expect(snapshot.allPlayers?.[0]?.level).toBe(9);
  });

  it("marks ARAM as casual mode and avoids lane inference", () => {
    const snapshot = normalizeLiveData(
      "s1",
      liveData({
        gameData: { gameMode: "ARAM", mapName: "Howling Abyss", mapNumber: 12 },
        player: { position: "MIDDLE" }
      })
    );
    const match = createMatchContextFromSnapshots({
      sessionId: "s1",
      startedAtIso: new Date().toISOString(),
      snapshots: [snapshot],
      events: []
    });

    expect(snapshot.game?.reviewMode).toBe("casual_mode");
    expect(snapshot.game?.casualReason).toBe("aram");
    expect(snapshot.player.role).toBe("unknown");
    expect(match.game?.reviewMode).toBe("casual_mode");
  });

  it("preserves raw event fields and can expose raw allgamedata within a budget", () => {
    const raw = liveData();
    const snapshot = normalizeLiveData("s1", raw);
    const events = normalizeEvents(raw);
    const rawTelemetry = buildRawLiveDataTelemetry({
      snapshots: [{ snapshot, rawLiveData: raw }],
      events,
      tokenBudget: 131_072
    });

    expect(events.find((event) => event.type === "dragon_kill")?.eventData).toMatchObject({
      DragonType: "Infernal",
      Stolen: false
    });
    expect(rawTelemetry?.includedSnapshots).toBe(1);
    expect(rawTelemetry?.omittedSnapshots).toBe(0);
    expect(rawTelemetry?.snapshots[0]?.allGameData).toMatchObject({ gameData: { gameMode: "CLASSIC" } });
  });

  it("matches Riot kill events that omit the Riot ID tag", () => {
    const snapshot = normalizeLiveData("s1", liveData());
    const match = createMatchContextFromSnapshots({
      sessionId: "s1",
      startedAtIso: new Date().toISOString(),
      snapshots: [snapshot],
      events: [{
        id: 2,
        type: "champion_kill",
        timestampSec: 226,
        actorName: "EnemyTop",
        victimName: "Player",
        rawEventName: "ChampionKill"
      }]
    });

    expect(match.aggregate.deathTimestamps).toEqual([226]);
    expect(match.aggregate.deathsBefore10).toBe(1);
  });
});
