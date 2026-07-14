import {
  formatChampionName,
  phaseFromTime,
  reviewModeForGame,
  type AppSettings,
  type NormalizedEvent,
  type NormalizedPlayerSnapshot,
  type NormalizedSnapshot
} from "@riftcoach/core";
import type { RoflMetadata, RoflPlayerMetadata } from "@riftcoach/riot";

export interface RoflReviewData {
  snapshots: NormalizedSnapshot[];
  events: NormalizedEvent[];
  championName: string;
  role: AppSettings["mainRole"];
  durationSec: number;
  startedAtIso?: string;
  gameMode: string;
  mapName: string;
  evidence: string[];
  warnings: string[];
}

export function createRoflReviewData(input: {
  sessionId: string;
  metadata: RoflMetadata;
  settings: AppSettings;
  match?: any;
  timeline?: any;
}): RoflReviewData {
  const warnings: string[] = [];
  const metadataPlayer = selectMetadataPlayer(input.metadata, input.settings, warnings);
  const matchParticipants = arrayValue(input.match?.info?.participants);
  const matchPlayer = matchParticipants.find((participant) =>
    sameIdentity(participant?.puuid, metadataPlayer.puuid) ||
    sameIdentity(riotIdFromMatchParticipant(participant), metadataPlayer.riotId) ||
    sameIdentity(riotIdFromMatchParticipant(participant), input.settings.riotId)
  );
  if (input.match && !matchPlayer) warnings.push("Match-v5 returned the match, but the configured player could not be matched to a participant. ROFL metadata was used for the player snapshot.");

  const durationSec = Math.max(
    input.metadata.durationSec,
    numberValue(input.match?.info?.gameDuration),
    numberValue(input.timeline?.info?.frames?.at?.(-1)?.timestamp) / 1000
  );
  const mapNumber = optionalNumber(input.match?.info?.mapId);
  const mapName = mapNameForId(mapNumber);
  const gameMode = "ROFL_REPLAY";
  const sourceGameMode = cleanText(input.match?.info?.gameMode);
  const startedAtIso = timestampIso(input.match?.info?.gameStartTimestamp ?? input.match?.info?.gameCreation);
  const game = { gameMode, mapName, mapNumber, reviewMode: reviewModeForGame({ gameMode, mapName, mapNumber }) };
  const events = input.timeline ? normalizeTimelineEvents(input.timeline, matchParticipants) : [];
  const finalPlayers = matchParticipants.length > 0
    ? matchParticipants.map(normalizeMatchParticipant)
    : input.metadata.players.map(normalizeMetadataParticipant);
  const selectedFinal = matchPlayer ? normalizeMatchParticipant(matchPlayer) : normalizeMetadataParticipant(metadataPlayer);
  const playerIdentity = {
    puuid: cleanText(matchPlayer?.puuid) ?? metadataPlayer.puuid,
    riotId: riotIdFromMatchParticipant(matchPlayer) ?? metadataPlayer.riotId ?? input.settings.riotId,
    summonerName: cleanText(matchPlayer?.summonerName) ?? metadataPlayer.summonerName,
    championName: selectedFinal.championName,
    livePosition: cleanText(matchPlayer?.teamPosition) ?? cleanText(matchPlayer?.individualPosition),
    role: selectedFinal.role ?? metadataPlayer.role,
    roleConfidence: 0.98,
    roleSource: matchPlayer ? "Riot Match-v5 participant" : `${input.metadata.format} metadata`,
    rank: input.settings.playerRank
  } as const;

  const timelineSnapshots = buildTimelineSnapshots({
    sessionId: input.sessionId,
    timeline: input.timeline,
    matchPlayer,
    participants: matchParticipants,
    playerIdentity,
    game,
    events,
    durationSec
  });
  const finalSnapshot: NormalizedSnapshot = {
    sessionId: input.sessionId,
    timestampSec: durationSec,
    phase: phaseFromTime(durationSec),
    game,
    player: playerIdentity,
    level: selectedFinal.level,
    scores: selectedFinal.scores,
    items: selectedFinal.items,
    allPlayers: finalPlayers
  };
  const snapshots = [...timelineSnapshots.filter((snapshot) => snapshot.timestampSec < durationSec - 1), finalSnapshot];

  return {
    snapshots,
    events,
    championName: playerIdentity.championName,
    role: playerIdentity.role,
    durationSec,
    startedAtIso,
    gameMode,
    mapName,
    warnings,
    evidence: [
      `Replay format: ${input.metadata.format}.`,
      `Replay patch: ${input.metadata.gameVersion ?? "unknown"}.`,
      `Replay duration: ${Math.round(durationSec)} seconds.`,
      `ROFL participants parsed: ${input.metadata.players.length}.`,
      input.metadata.matchId ? `Match ID: ${input.metadata.matchId}.` : "Match ID was not available from the ROFL filename.",
      input.match ? "Riot Match-v5 details loaded." : "Review uses offline ROFL metadata.",
      sourceGameMode ? `Match-v5 game mode: ${sourceGameMode}.` : undefined,
      input.timeline ? `Riot Match-v5 timeline loaded with ${events.length} normalized events.` : "Minute-by-minute timeline was not available."
    ].filter((value): value is string => Boolean(value))
  };
}

function selectMetadataPlayer(metadata: RoflMetadata, settings: AppSettings, warnings: string[]): RoflPlayerMetadata {
  const configured = settings.riotId?.trim();
  if (configured) {
    const exact = metadata.players.find((player) => sameIdentity(player.riotId, configured));
    if (exact) return exact;
  }

  const fallbackRole = settings.mainRole && settings.mainRole !== "unknown" ? settings.mainRole : undefined;
  if (fallbackRole) {
    const candidates = metadata.players.filter((player) => player.role === fallbackRole);
    if (candidates.length === 1 && candidates[0]) {
      warnings.push(`The configured Riot ID did not match this replay, so RiftCoach selected the only ${fallbackRole} participant. Confirm the Player Profile Riot ID for exact matching.`);
      return candidates[0];
    }
  }

  const available = metadata.players.map((player) => player.riotId ?? player.championName).slice(0, 10).join(", ");
  throw new Error(
    `RiftCoach parsed the ROFL metadata but could not identify you. Set Player Profile > Riot ID to Name#TAG and import again. Replay participants: ${available || "unknown"}.`
  );
}

function buildTimelineSnapshots(input: {
  sessionId: string;
  timeline: any;
  matchPlayer: any;
  participants: any[];
  playerIdentity: NormalizedSnapshot["player"];
  game: NonNullable<NormalizedSnapshot["game"]>;
  events: NormalizedEvent[];
  durationSec: number;
}): NormalizedSnapshot[] {
  const participantId = optionalNumber(input.matchPlayer?.participantId);
  if (!input.timeline || participantId === undefined) return [];
  return arrayValue(input.timeline?.info?.frames).flatMap((frame): NormalizedSnapshot[] => {
    const timestampSec = numberValue(frame?.timestamp) / 1000;
    if (timestampSec <= 0 || timestampSec > input.durationSec + 30) return [];
    const participantFrame = frame?.participantFrames?.[String(participantId)] ?? frame?.participantFrames?.[participantId];
    if (!participantFrame) return [];
    const relevantEvents = input.events.filter((event) => event.timestampSec <= timestampSec);
    const identity = identityCandidates(input.playerIdentity);
    const kills = relevantEvents.filter((event) => event.type === "champion_kill" && identity.has(normalizeIdentity(event.actorName))).length;
    const deaths = relevantEvents.filter((event) => event.type === "champion_kill" && identity.has(normalizeIdentity(event.victimName))).length;
    const assists = relevantEvents.filter((event) => event.type === "champion_kill" && event.assistingParticipantNames?.some((name) => identity.has(normalizeIdentity(name)))).length;
    return [{
      sessionId: input.sessionId,
      timestampSec,
      phase: phaseFromTime(timestampSec),
      game: input.game,
      player: input.playerIdentity,
      level: optionalNumber(participantFrame.level),
      currentGold: optionalNumber(participantFrame.currentGold),
      scores: {
        kills,
        deaths,
        assists,
        creepScore: numberValue(participantFrame.minionsKilled) + numberValue(participantFrame.jungleMinionsKilled)
      },
      items: []
    }];
  });
}

function normalizeTimelineEvents(timeline: any, participants: any[]): NormalizedEvent[] {
  const participantNames = new Map<number, string>();
  for (const participant of participants) {
    const id = optionalNumber(participant?.participantId);
    if (id !== undefined) participantNames.set(id, participantLabel(participant));
  }

  const normalized: NormalizedEvent[] = [];
  for (const frame of arrayValue(timeline?.info?.frames)) {
    for (const event of arrayValue(frame?.events)) {
      const timestampSec = numberValue(event?.timestamp) / 1000;
      const rawType = cleanText(event?.type) ?? "UNKNOWN";
      let type: NormalizedEvent["type"] = "other";
      if (rawType === "CHAMPION_KILL") type = "champion_kill";
      if (rawType === "ELITE_MONSTER_KILL") {
        const monster = cleanText(event?.monsterType)?.toUpperCase();
        type = monster === "DRAGON" ? "dragon_kill" : monster === "BARON_NASHOR" ? "baron_kill" : monster === "RIFTHERALD" ? "rift_herald_kill" : "other";
      }
      if (rawType === "BUILDING_KILL") {
        const building = cleanText(event?.buildingType)?.toUpperCase();
        type = building === "TOWER_BUILDING" ? "turret_kill" : building === "INHIBITOR_BUILDING" ? "inhibitor_kill" : "other";
      }
      if (type === "other") continue;

      normalized.push({
        id: cleanText(event?.eventId) ?? `${rawType}-${Math.round(timestampSec * 1000)}-${normalized.length}`,
        type,
        timestampSec,
        actorName: participantNames.get(numberValue(event?.killerId)),
        victimName: participantNames.get(numberValue(event?.victimId)),
        assistingParticipantNames: arrayValue(event?.assistingParticipantIds)
          .map((id) => participantNames.get(numberValue(id)))
          .filter((name): name is string => Boolean(name)),
        rawEventName: rawType,
        eventData: compactEventData(event)
      });
    }
  }
  return normalized;
}

function normalizeMatchParticipant(participant: any): NormalizedPlayerSnapshot {
  const itemIds = [0, 1, 2, 3, 4, 5, 6]
    .map((slot) => numberValue(participant?.[`item${slot}`]))
    .filter((itemId) => itemId > 0);
  return {
    riotId: riotIdFromMatchParticipant(participant),
    summonerName: cleanText(participant?.summonerName),
    championName: formatChampionName(cleanText(participant?.championName)),
    livePosition: cleanText(participant?.teamPosition) ?? cleanText(participant?.individualPosition),
    team: numberValue(participant?.teamId) === 100 ? "ORDER" : numberValue(participant?.teamId) === 200 ? "CHAOS" : "UNKNOWN",
    level: optionalNumber(participant?.champLevel),
    role: normalizeRole(cleanText(participant?.teamPosition) ?? cleanText(participant?.individualPosition)),
    roleConfidence: 0.98,
    roleSource: "Riot Match-v5 participant",
    scores: {
      kills: numberValue(participant?.kills),
      deaths: numberValue(participant?.deaths),
      assists: numberValue(participant?.assists),
      creepScore: numberValue(participant?.totalMinionsKilled) + numberValue(participant?.neutralMinionsKilled),
      wardScore: optionalNumber(participant?.visionScore)
    },
    items: itemIds.map((itemId, slot) => ({ itemId, displayName: `Item ${itemId}`, slot }))
  };
}

function normalizeMetadataParticipant(player: RoflPlayerMetadata): NormalizedPlayerSnapshot {
  return {
    riotId: player.riotId,
    summonerName: player.summonerName,
    championName: formatChampionName(player.championName),
    livePosition: player.role,
    team: player.team,
    level: player.level,
    role: player.role,
    roleConfidence: 0.92,
    roleSource: "ROFL metadata",
    scores: {
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      creepScore: player.creepScore,
      wardScore: player.visionScore
    },
    items: player.itemIds.map((itemId, slot) => ({ itemId, displayName: `Item ${itemId}`, slot }))
  };
}

function compactEventData(event: any): Record<string, string | number | boolean | Array<string | number | boolean>> {
  const data: Record<string, string | number | boolean | Array<string | number | boolean>> = {};
  for (const key of ["monsterType", "monsterSubType", "buildingType", "laneType", "towerType", "killType", "multiKillLength"]) {
    const value = event?.[key];
    if (["string", "number", "boolean"].includes(typeof value)) data[key] = value;
  }
  return data;
}

function participantLabel(participant: any): string {
  return riotIdFromMatchParticipant(participant) ?? cleanText(participant?.summonerName) ?? cleanText(participant?.championName) ?? `Participant ${participant?.participantId ?? "?"}`;
}

function riotIdFromMatchParticipant(participant: any): string | undefined {
  const gameName = cleanText(participant?.riotIdGameName);
  const tagLine = cleanText(participant?.riotIdTagline ?? participant?.riotIdTagLine);
  return gameName && tagLine ? `${gameName}#${tagLine}` : gameName;
}

function identityCandidates(player: NormalizedSnapshot["player"]): Set<string> {
  return new Set([player.riotId, player.summonerName, player.championName].map(normalizeIdentity).filter(Boolean));
}

function sameIdentity(left: unknown, right: unknown): boolean {
  const a = normalizeIdentity(left);
  const b = normalizeIdentity(right);
  return Boolean(a && b && a === b);
}

function normalizeIdentity(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function normalizeRole(value?: string): NonNullable<NormalizedPlayerSnapshot["role"]> {
  const role = value?.trim().toUpperCase();
  if (role === "TOP") return "top";
  if (role === "JUNGLE") return "jungle";
  if (role === "MIDDLE" || role === "MID") return "mid";
  if (role === "BOTTOM" || role === "BOT" || role === "CARRY" || role === "DUO_CARRY") return "adc";
  if (role === "UTILITY" || role === "SUPPORT" || role === "DUO_SUPPORT") return "support";
  return "unknown";
}

function mapNameForId(mapId?: number): string {
  if (mapId === 11 || mapId === undefined) return "Summoner's Rift";
  if (mapId === 12) return "Howling Abyss";
  if (mapId === 30) return "Rings of Wrath";
  return `League map ${mapId}`;
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function cleanText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function timestampIso(value: unknown): string | undefined {
  const timestamp = optionalNumber(value);
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
