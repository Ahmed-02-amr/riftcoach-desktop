import { open } from "node:fs/promises";
import { basename, extname } from "node:path";

const ROFL_SIGNATURE = Buffer.from([0x52, 0x49, 0x4f, 0x54, 0x00, 0x00]);
const ROFL2_SIGNATURE = Buffer.from([0x52, 0x49, 0x4f, 0x54, 0x02, 0x00]);
const MAX_METADATA_BYTES = 16 * 1024 * 1024;

export type RoflFormat = "ROFL" | "ROFL2";

export interface RoflPlayerMetadata {
  participantIndex: number;
  puuid?: string;
  riotId?: string;
  summonerName?: string;
  championName: string;
  role: "top" | "jungle" | "mid" | "adc" | "support" | "unknown";
  team: "ORDER" | "CHAOS" | "UNKNOWN";
  won?: boolean;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  visionScore?: number;
  wardsPlaced?: number;
  wardsKilled?: number;
  level?: number;
  goldEarned?: number;
  itemIds: number[];
  raw: Record<string, unknown>;
}

export interface RoflMetadata {
  filePath: string;
  format: RoflFormat;
  gameVersion?: string;
  durationSec: number;
  platformId?: string;
  gameId?: string;
  matchId?: string;
  lastGameChunkId?: number;
  lastKeyFrameId?: number;
  players: RoflPlayerMetadata[];
}

/**
 * Parses the unencrypted metadata envelope from ROFL and ROFL2 files.
 * Modern replay packet payloads remain intentionally untouched.
 * Format offsets are based on the MIT-licensed fraxiinus/roflxd.cs reference parser.
 */
export async function parseRoflMetadata(filePath: string): Promise<RoflMetadata> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size < 32) throw new Error("ROFL file is too small to contain a valid replay header.");
    const header = await readRange(handle, 0, Math.min(288, stat.size));
    const signature = header.subarray(0, 6);
    const identity = replayIdentityFromFileName(filePath);

    if (signature.equals(ROFL2_SIGNATURE)) {
      const lengthBytes = await readRange(handle, stat.size - 4, 4);
      const metadataLength = lengthBytes.readUInt32LE(0);
      validateMetadataRange(metadataLength, stat.size - 4 - metadataLength, stat.size);
      const metadataBytes = await readRange(handle, stat.size - 4 - metadataLength, metadataLength);
      const raw = parseMetadataEnvelope(metadataBytes);
      return buildMetadata({
        filePath,
        format: "ROFL2",
        gameVersion: readRofl2GameVersion(header),
        raw,
        identity
      });
    }

    if (signature.equals(ROFL_SIGNATURE)) {
      if (header.length < 288) throw new Error("Legacy ROFL header is incomplete.");
      const metadataOffset = header.readUInt32LE(268);
      const metadataLength = header.readUInt32LE(272);
      validateMetadataRange(metadataLength, metadataOffset, stat.size);
      const metadataBytes = await readRange(handle, metadataOffset, metadataLength);
      const raw = parseMetadataEnvelope(metadataBytes);
      return buildMetadata({ filePath, format: "ROFL", gameVersion: cleanText(raw.gameVersion), raw, identity });
    }

    throw new Error("File signature is not a supported ROFL or ROFL2 replay.");
  } finally {
    await handle.close();
  }
}

function buildMetadata(input: {
  filePath: string;
  format: RoflFormat;
  gameVersion?: string;
  raw: Record<string, unknown>;
  identity: { platformId?: string; gameId?: string; matchId?: string };
}): RoflMetadata {
  const statsJson = input.raw.statsJson;
  if (typeof statsJson !== "string" || !statsJson.trim()) throw new Error("ROFL metadata does not contain player statistics.");
  let playerRows: unknown;
  try {
    playerRows = JSON.parse(statsJson);
  } catch (error) {
    throw new Error(`ROFL player statistics are invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(playerRows)) throw new Error("ROFL player statistics are not an array.");

  return {
    filePath: input.filePath,
    format: input.format,
    gameVersion: cleanText(input.gameVersion),
    durationSec: Math.max(0, numberValue(input.raw.gameLength) / 1000),
    ...input.identity,
    lastGameChunkId: optionalNumber(input.raw.lastGameChunkId),
    lastKeyFrameId: optionalNumber(input.raw.lastKeyFrameId),
    players: playerRows.map((row, index) => normalizePlayer(row, index))
  };
}

function normalizePlayer(value: unknown, participantIndex: number): RoflPlayerMetadata {
  const raw = isRecord(value) ? value : {};
  const gameName = cleanText(raw.RIOT_ID_GAME_NAME);
  const tagLine = cleanText(raw.RIOT_ID_TAG_LINE);
  const riotId = gameName && tagLine ? `${gameName}#${tagLine}` : gameName;
  const laneMinions = numberValue(raw.MINIONS_KILLED);
  const jungleMinions = numberValue(raw.NEUTRAL_MINIONS_KILLED);
  const itemIds = [0, 1, 2, 3, 4, 5, 6]
    .map((slot) => numberValue(raw[`ITEM${slot}`]))
    .filter((itemId) => itemId > 0);

  return {
    participantIndex,
    puuid: cleanText(raw.PUUID),
    riotId,
    summonerName: cleanText(raw.NAME) ?? gameName,
    championName: cleanText(raw.SKIN) ?? "Unknown champion",
    role: normalizeRole(cleanText(raw.TEAM_POSITION) ?? cleanText(raw.INDIVIDUAL_POSITION)),
    team: normalizeTeam(raw.TEAM),
    won: optionalBoolean(raw.WIN),
    kills: numberValue(raw.CHAMPIONS_KILLED),
    deaths: numberValue(raw.NUM_DEATHS),
    assists: numberValue(raw.ASSISTS),
    creepScore: laneMinions + jungleMinions,
    visionScore: optionalNumber(raw.VISION_SCORE),
    wardsPlaced: optionalNumber(raw.WARD_PLACED),
    wardsKilled: optionalNumber(raw.WARD_KILLED),
    level: optionalNumber(raw.LEVEL),
    goldEarned: optionalNumber(raw.GOLD_EARNED),
    itemIds,
    raw
  };
}

function readRofl2GameVersion(header: Buffer): string | undefined {
  const length = header[14] ?? 0;
  if (length > 0 && length <= 48 && 15 + length <= header.length) {
    return cleanText(header.subarray(15, 15 + length).toString("utf8"));
  }
  return cleanText(header.subarray(14, 30).toString("utf8").replace(/[\u0000-\u001f]/g, ""));
}

function replayIdentityFromFileName(filePath: string): { platformId?: string; gameId?: string; matchId?: string } {
  const stem = basename(filePath, extname(filePath));
  const match = /^([a-z0-9]+)[-_](\d+)$/i.exec(stem);
  if (!match?.[1] || !match[2]) return {};
  const platformId = match[1].toUpperCase();
  const gameId = match[2];
  return { platformId, gameId, matchId: `${platformId}_${gameId}` };
}

function parseMetadataEnvelope(bytes: Buffer): Record<string, unknown> {
  try {
    const parsed = JSON.parse(bytes.toString("utf8").replace(/\u0000+$/g, ""));
    if (!isRecord(parsed)) throw new Error("metadata root is not an object");
    return parsed;
  } catch (error) {
    throw new Error(`ROFL metadata is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateMetadataRange(length: number, offset: number, fileSize: number): void {
  if (!Number.isInteger(length) || length <= 0 || length > MAX_METADATA_BYTES) throw new Error(`ROFL metadata length is invalid: ${length}.`);
  if (!Number.isInteger(offset) || offset < 0 || offset + length > fileSize) throw new Error("ROFL metadata points outside the replay file.");
}

async function readRange(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error(`Could not read ${length} bytes from ROFL file at offset ${position}.`);
  return buffer;
}

function normalizeRole(value?: string): RoflPlayerMetadata["role"] {
  const role = value?.trim().toUpperCase();
  if (role === "TOP") return "top";
  if (role === "JUNGLE") return "jungle";
  if (role === "MIDDLE" || role === "MID") return "mid";
  if (role === "BOTTOM" || role === "BOT" || role === "CARRY" || role === "DUO_CARRY") return "adc";
  if (role === "UTILITY" || role === "SUPPORT" || role === "DUO_SUPPORT") return "support";
  return "unknown";
}

function normalizeTeam(value: unknown): RoflPlayerMetadata["team"] {
  const team = String(value ?? "").trim().toUpperCase();
  if (team === "100" || team === "ORDER" || team === "BLUE") return "ORDER";
  if (team === "200" || team === "CHAOS" || team === "RED") return "CHAOS";
  return "UNKNOWN";
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "win", "yes"].includes(text)) return true;
  if (["0", "false", "fail", "loss", "no"].includes(text)) return false;
  return undefined;
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
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim() : "";
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
