import type { PlayerRole } from "./settings";
import type { VisualObservation } from "./visual";
import type { KnowledgeContext } from "./knowledge";

export type GamePhase = "early" | "mid" | "late";
export type ReviewMode = "coaching" | "casual_mode";
export type CasualGameReason = "aram" | "arena";

export interface GameMetadata {
  gameMode?: string;
  mapName?: string;
  mapNumber?: number;
  mapTerrain?: string;
  reviewMode?: ReviewMode;
  casualReason?: CasualGameReason;
}

export interface PlayerIdentity {
  puuid?: string;
  riotId?: string;
  summonerName?: string;
  championName: string;
  livePosition?: string;
  role: PlayerRole;
  roleConfidence?: number;
  roleSource?: string;
  rank?: string;
}

export interface ItemSnapshot {
  itemId?: number;
  displayName: string;
  count?: number;
  slot?: number;
  priceEstimate?: number;
  canUse?: boolean;
  consumable?: boolean;
  rawDescription?: string;
  rawDisplayName?: string;
}

export interface ScoreSnapshot {
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  wardScore?: number;
}

export interface ChampionStatsSnapshot {
  abilityHaste?: number;
  abilityPower?: number;
  armor?: number;
  armorPenetrationFlat?: number;
  armorPenetrationPercent?: number;
  attackDamage?: number;
  attackRange?: number;
  attackSpeed?: number;
  bonusArmorPenetrationPercent?: number;
  bonusMagicPenetrationPercent?: number;
  cooldownReduction?: number;
  critChance?: number;
  critDamage?: number;
  currentHealth?: number;
  healthRegenRate?: number;
  lifeSteal?: number;
  magicLethality?: number;
  magicPenetrationFlat?: number;
  magicPenetrationPercent?: number;
  magicResist?: number;
  maxHealth?: number;
  moveSpeed?: number;
  physicalLethality?: number;
  resourceMax?: number;
  resourceRegenRate?: number;
  resourceType?: string;
  resourceValue?: number;
  spellVamp?: number;
  tenacity?: number;
}

export interface AbilitySnapshot {
  slot: string;
  id?: string;
  displayName?: string;
  rawDescription?: string;
  rawDisplayName?: string;
  abilityLevel?: number;
}

export interface RuneSnapshot {
  id?: number;
  displayName?: string;
  rawDescription?: string;
  rawDisplayName?: string;
}

export interface RuneTreeSnapshot extends RuneSnapshot {}

export interface ActivePlayerDetailsSnapshot {
  summonerName?: string;
  riotId?: string;
  level?: number;
  currentGold?: number;
  championStats?: ChampionStatsSnapshot;
  abilities?: AbilitySnapshot[];
  runes?: {
    keystone?: RuneSnapshot;
    primaryRuneTree?: RuneTreeSnapshot;
    secondaryRuneTree?: RuneTreeSnapshot;
    generalRunes?: RuneSnapshot[];
    statRunes?: RuneSnapshot[];
  };
}

export interface NormalizedSnapshot {
  sessionId: string;
  timestampSec: number;
  phase: GamePhase;
  game?: GameMetadata;
  player: PlayerIdentity;
  level?: number;
  currentGold?: number;
  scores: ScoreSnapshot;
  items: ItemSnapshot[];
  allPlayers?: NormalizedPlayerSnapshot[];
  activePlayerDetails?: ActivePlayerDetailsSnapshot;
}

export interface NormalizedPlayerSnapshot {
  riotId?: string;
  summonerName?: string;
  championName: string;
  livePosition?: string;
  team: "ORDER" | "CHAOS" | "UNKNOWN";
  isBot?: boolean;
  isDead?: boolean;
  respawnTimer?: number;
  level?: number;
  role?: PlayerRole;
  roleConfidence?: number;
  roleSource?: string;
  summonerSpells?: string[];
  runes?: {
    keystone?: RuneSnapshot;
    primaryRuneTree?: RuneTreeSnapshot;
    secondaryRuneTree?: RuneTreeSnapshot;
    generalRunes?: RuneSnapshot[];
    statRunes?: RuneSnapshot[];
  };
  scores: ScoreSnapshot;
  items: ItemSnapshot[];
}

export type NormalizedEventDataValue = string | number | boolean | Array<string | number | boolean>;

export type NormalizedEventType =
  | "champion_kill"
  | "dragon_kill"
  | "baron_kill"
  | "rift_herald_kill"
  | "turret_kill"
  | "inhibitor_kill"
  | "game_start"
  | "other";

export interface NormalizedEvent {
  id: number | string;
  type: NormalizedEventType;
  timestampSec: number;
  actorName?: string;
  victimName?: string;
  assistingParticipantNames?: string[];
  rawEventName?: string;
  eventData?: Record<string, NormalizedEventDataValue>;
}

export interface RawLiveDataSnapshot {
  checkpoint: string;
  timestampSec: number;
  estimatedTokens: number;
  allGameData: unknown;
}

export interface RawLiveDataTelemetry {
  source: "riot-live-client-allgamedata";
  endpoint: "/liveclientdata/allgamedata";
  tokenBudget: number;
  estimatedTokens: number;
  totalStoredSnapshots: number;
  includedSnapshots: number;
  omittedSnapshots: number;
  selectionReason: string;
  snapshots: RawLiveDataSnapshot[];
  warnings: string[];
}

export interface MatchAggregate {
  durationSec: number;
  kills: number;
  deaths: number;
  assists: number;
  teamKills?: number;
  csAt10?: number;
  csAt15?: number;
  csPerMin: number;
  visionScore?: number;
  deathsBefore10: number;
  firstDeathAtSec?: number;
  deathTimestamps: number[];
  itemNamesFinal: string[];
  totalSnapshots: number;
}

export interface MatchContext {
  sessionId: string;
  gameId?: string;
  game?: GameMetadata;
  startedAtIso: string;
  endedAtIso?: string;
  player: PlayerIdentity;
  snapshots: NormalizedSnapshot[];
  events: NormalizedEvent[];
  aggregate: MatchAggregate;
  rawLiveData?: RawLiveDataTelemetry;
  visualObservations?: VisualObservation[];
  knowledgeContext?: KnowledgeContext;
}

export interface UserProfileContext {
  rank?: string;
  mainRole?: PlayerRole;
  learningGoal?: string;
  recentPatternSummary?: string;
}

export function phaseFromTime(timestampSec: number): GamePhase {
  if (timestampSec < 14 * 60) return "early";
  if (timestampSec < 25 * 60) return "mid";
  return "late";
}

export function casualGameReason(game?: Pick<GameMetadata, "gameMode" | "mapName" | "mapNumber">): CasualGameReason | undefined {
  const mode = game?.gameMode?.trim().toUpperCase();
  const mapName = game?.mapName?.trim().toLowerCase() ?? "";
  const mapNumber = game?.mapNumber;

  if (mode === "ARAM" || mapNumber === 12 || mapNumber === 14 || /howling abyss|butcher'?s bridge/.test(mapName)) return "aram";
  if (mode === "ARENA" || mode === "CHERRY" || mapNumber === 30 || /rings of wrath/.test(mapName)) return "arena";
  return undefined;
}

export function reviewModeForGame(game?: Pick<GameMetadata, "gameMode" | "mapName" | "mapNumber">): ReviewMode {
  return casualGameReason(game) ? "casual_mode" : "coaching";
}

export function isCasualReviewMode(game?: GameMetadata): boolean {
  return game?.reviewMode === "casual_mode" || Boolean(casualGameReason(game));
}

export function casualGameLabel(reason?: CasualGameReason): string {
  if (reason === "aram") return "ARAM";
  if (reason === "arena") return "Arena";
  return "casual mode";
}
