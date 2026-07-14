import type {
  AbilitySnapshot,
  ActivePlayerDetailsSnapshot,
  ChampionStatsSnapshot,
  GameMetadata,
  MatchAggregate,
  MatchContext,
  NormalizedEvent,
  NormalizedEventDataValue,
  NormalizedEventType,
  NormalizedPlayerSnapshot,
  RawLiveDataTelemetry,
  RuneSnapshot,
  RuneTreeSnapshot,
  NormalizedSnapshot,
  ScoreSnapshot
} from "../types/game";
import type { PlayerRole } from "../types/settings";
import { casualGameReason, phaseFromTime, reviewModeForGame } from "../types/game";

interface RoleGuess {
  role: PlayerRole;
  confidence: number;
  source: string;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickName(player: any): string | undefined {
  return player?.riotId || player?.summonerName || player?.summonerNameRaw || player?.name;
}

function normalizeScores(scores: any): ScoreSnapshot {
  return {
    kills: toNumber(scores?.kills),
    deaths: toNumber(scores?.deaths),
    assists: toNumber(scores?.assists),
    creepScore: toNumber(scores?.creepScore ?? scores?.creepScoreTotal),
    wardScore: typeof scores?.wardScore === "number" ? scores.wardScore : undefined
  };
}

function normalizeItems(items: any[]): NormalizedSnapshot["items"] {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => ({
    itemId: typeof item?.itemID === "number" ? item.itemID : typeof item?.itemId === "number" ? item.itemId : undefined,
    displayName: String(item?.displayName ?? item?.name ?? `Item ${index + 1}`),
    count: typeof item?.count === "number" ? item.count : undefined,
    slot: typeof item?.slot === "number" ? item.slot : index,
    priceEstimate: typeof item?.price === "number" ? item.price : undefined,
    canUse: typeof item?.canUse === "boolean" ? item.canUse : undefined,
    consumable: typeof item?.consumable === "boolean" ? item.consumable : undefined,
    rawDescription: typeof item?.rawDescription === "string" ? item.rawDescription : undefined,
    rawDisplayName: typeof item?.rawDisplayName === "string" ? item.rawDisplayName : undefined
  }));
}

function normalizeTeam(team: unknown): "ORDER" | "CHAOS" | "UNKNOWN" {
  if (team === "ORDER" || team === "CHAOS") return team;
  return "UNKNOWN";
}

function normalizeLivePosition(position: unknown): string | undefined {
  const value = typeof position === "string" ? position.trim().toUpperCase() : "";
  return value || undefined;
}

function normalizeGameMetadata(liveData: any): GameMetadata {
  const raw = liveData?.gameData ?? liveData?.gameStats ?? {};
  const base: GameMetadata = {
    gameMode: typeof raw?.gameMode === "string" ? raw.gameMode : undefined,
    mapName: typeof raw?.mapName === "string" ? raw.mapName : undefined,
    mapNumber: typeof raw?.mapNumber === "number" ? raw.mapNumber : undefined,
    mapTerrain: typeof raw?.mapTerrain === "string" ? raw.mapTerrain : undefined
  };
  const reason = casualGameReason(base);
  return {
    ...base,
    reviewMode: reviewModeForGame(base),
    casualReason: reason
  };
}

function normalizeSpellNames(player: any): string[] {
  const spells = player?.summonerSpells;
  const values = [spells?.summonerSpellOne, spells?.summonerSpellTwo, player?.spell1, player?.spell2];
  return values
    .flatMap((spell: any) => [spell?.displayName, spell?.rawDescription, spell?.name, spell?.id])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

const CHAMPION_STAT_KEYS = [
  "abilityHaste",
  "abilityPower",
  "armor",
  "armorPenetrationFlat",
  "armorPenetrationPercent",
  "attackDamage",
  "attackRange",
  "attackSpeed",
  "bonusArmorPenetrationPercent",
  "bonusMagicPenetrationPercent",
  "cooldownReduction",
  "critChance",
  "critDamage",
  "currentHealth",
  "healthRegenRate",
  "lifeSteal",
  "magicLethality",
  "magicPenetrationFlat",
  "magicPenetrationPercent",
  "magicResist",
  "maxHealth",
  "moveSpeed",
  "physicalLethality",
  "resourceMax",
  "resourceRegenRate",
  "spellVamp",
  "tenacity"
] as const;

function normalizeChampionStats(stats: any): ChampionStatsSnapshot | undefined {
  if (!stats || typeof stats !== "object") return undefined;
  const out: ChampionStatsSnapshot = {};
  for (const key of CHAMPION_STAT_KEYS) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  if (typeof stats.resourceType === "string" && stats.resourceType.trim()) out.resourceType = stats.resourceType.trim();
  if (typeof stats.resourceValue === "number" && Number.isFinite(stats.resourceValue)) out.resourceValue = stats.resourceValue;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeAbility(slot: string, ability: any): AbilitySnapshot | undefined {
  if (!ability || typeof ability !== "object") return undefined;
  const out: AbilitySnapshot = { slot };
  if (typeof ability.id === "string") out.id = ability.id;
  if (typeof ability.displayName === "string") out.displayName = ability.displayName;
  if (typeof ability.rawDescription === "string") out.rawDescription = ability.rawDescription;
  if (typeof ability.rawDisplayName === "string") out.rawDisplayName = ability.rawDisplayName;
  if (typeof ability.abilityLevel === "number" && Number.isFinite(ability.abilityLevel)) out.abilityLevel = ability.abilityLevel;
  return Object.keys(out).length > 1 ? out : undefined;
}

function normalizeAbilities(abilities: any): AbilitySnapshot[] | undefined {
  if (!abilities || typeof abilities !== "object") return undefined;
  const slots = ["Passive", "Q", "W", "E", "R"];
  const out = slots.flatMap((slot) => {
    const ability = normalizeAbility(slot, abilities[slot]);
    return ability ? [ability] : [];
  });
  return out.length > 0 ? out : undefined;
}

function normalizeRune(rune: any): RuneSnapshot | undefined {
  if (!rune || typeof rune !== "object") return undefined;
  const out: RuneSnapshot = {};
  if (typeof rune.id === "number" && Number.isFinite(rune.id)) out.id = rune.id;
  if (typeof rune.displayName === "string") out.displayName = rune.displayName;
  if (typeof rune.rawDescription === "string") out.rawDescription = rune.rawDescription;
  if (typeof rune.rawDisplayName === "string") out.rawDisplayName = rune.rawDisplayName;
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeRuneTree(tree: any): RuneTreeSnapshot | undefined {
  return normalizeRune(tree);
}

function normalizeRunes(runes: any): ActivePlayerDetailsSnapshot["runes"] | undefined {
  if (!runes || typeof runes !== "object") return undefined;
  const generalRunes = Array.isArray(runes.generalRunes)
    ? runes.generalRunes.map(normalizeRune).filter((rune: RuneSnapshot | undefined): rune is RuneSnapshot => Boolean(rune))
    : undefined;
  const statRunes = Array.isArray(runes.statRunes)
    ? runes.statRunes.map(normalizeRune).filter((rune: RuneSnapshot | undefined): rune is RuneSnapshot => Boolean(rune))
    : undefined;
  const out: NonNullable<ActivePlayerDetailsSnapshot["runes"]> = {
    keystone: normalizeRune(runes.keystone),
    primaryRuneTree: normalizeRuneTree(runes.primaryRuneTree),
    secondaryRuneTree: normalizeRuneTree(runes.secondaryRuneTree),
    generalRunes,
    statRunes
  };
  return Object.values(out).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)) ? out : undefined;
}

function normalizeActivePlayerDetails(activePlayer: any): ActivePlayerDetailsSnapshot | undefined {
  if (!activePlayer || typeof activePlayer !== "object") return undefined;
  const out: ActivePlayerDetailsSnapshot = {
    summonerName: typeof activePlayer.summonerName === "string" ? activePlayer.summonerName : undefined,
    riotId: typeof activePlayer.riotId === "string" ? activePlayer.riotId : undefined,
    level: typeof activePlayer.level === "number" && Number.isFinite(activePlayer.level) ? activePlayer.level : undefined,
    currentGold: typeof activePlayer.currentGold === "number" && Number.isFinite(activePlayer.currentGold) ? activePlayer.currentGold : undefined,
    championStats: normalizeChampionStats(activePlayer.championStats),
    abilities: normalizeAbilities(activePlayer.abilities),
    runes: normalizeRunes(activePlayer.fullRunes ?? activePlayer.runes)
  };
  return Object.values(out).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)) ? out : undefined;
}

const CHAMPION_ROLE_HINTS: Record<string, PlayerRole[]> = {
  aatrox: ["top"], ahri: ["mid"], akali: ["mid", "top"], akshan: ["mid", "top"], alistar: ["support"], amumu: ["jungle", "support"], anivia: ["mid"], annie: ["mid", "support"], aphelios: ["adc"], ashe: ["adc", "support"], aurelionsol: ["mid"], aurora: ["mid", "top"], azir: ["mid"],
  bard: ["support"], belveth: ["jungle"], blitzcrank: ["support"], brand: ["support", "mid", "jungle"], braum: ["support"], briar: ["jungle"], caitlyn: ["adc"], camille: ["top"], cassiopeia: ["mid"], chogath: ["top"], corki: ["mid", "adc"],
  darius: ["top"], diana: ["jungle", "mid"], drmundo: ["top", "jungle"], draven: ["adc"], ekko: ["jungle", "mid"], elise: ["jungle"], evelynn: ["jungle"], ezreal: ["adc"], fiddlesticks: ["jungle"], fiora: ["top"], fizz: ["mid"], galio: ["mid", "support"], gangplank: ["top"], garen: ["top"], gnar: ["top"], gragas: ["top", "jungle", "support"], graves: ["jungle"], gwen: ["top", "jungle"],
  hecarim: ["jungle"], heimerdinger: ["support", "mid", "top"], hwei: ["mid", "support"], illaoi: ["top"], irelia: ["top", "mid"], ivern: ["jungle"], janna: ["support"], jarvaniv: ["jungle"], jax: ["top", "jungle"], jayce: ["top", "mid"], jhin: ["adc"], jinx: ["adc"], kaisa: ["adc"], kalista: ["adc"], karma: ["support", "mid", "top"], karthus: ["jungle", "mid"], kassadin: ["mid"], katarina: ["mid"], kayle: ["top", "mid"], kayn: ["jungle"], kennen: ["top", "mid"], khazix: ["jungle"], kindred: ["jungle"], kled: ["top"], kogmaw: ["adc"], ksante: ["top"],
  leblanc: ["mid"], leesin: ["jungle"], leona: ["support"], lillia: ["jungle", "top"], lissandra: ["mid"], lucian: ["adc", "mid"], lulu: ["support"], lux: ["support", "mid"], malphite: ["top", "support"], malzahar: ["mid"], maokai: ["support", "jungle", "top"], masteryi: ["jungle"], milio: ["support"], missfortune: ["adc"], monkeyking: ["top", "jungle"], mordekaiser: ["top"], morgana: ["support", "jungle", "mid"], naafiri: ["mid"], nami: ["support"], nasus: ["top"], nautilus: ["support"], neeko: ["mid", "support"], nidalee: ["jungle"], nilah: ["adc"], nocturne: ["jungle"], nunu: ["jungle"], olaf: ["top", "jungle"], orianna: ["mid"], ornn: ["top"], pantheon: ["support", "top", "mid"], poppy: ["top", "jungle", "support"], pyke: ["support"], qiyana: ["mid", "jungle"], quinn: ["top"], rakan: ["support"], rammus: ["jungle"], reksai: ["jungle"], rell: ["support"], renata: ["support"], renekton: ["top"], rengar: ["jungle", "top"], riven: ["top"], rumble: ["top", "mid"], ryze: ["mid", "top"], samira: ["adc"], sejuani: ["jungle", "top"], senna: ["support", "adc"], seraphine: ["support", "adc", "mid"], sett: ["top", "support"], shaco: ["jungle", "support"], shen: ["top", "support"], shyvana: ["jungle"], singed: ["top"], sion: ["top"], sivir: ["adc"], skarner: ["jungle", "top"], smolder: ["adc", "mid"], sona: ["support"], soraka: ["support"], swain: ["support", "mid", "adc"], sylas: ["mid", "jungle"], syndra: ["mid"], tahmkench: ["top", "support"], taliyah: ["jungle", "mid"], talon: ["mid", "jungle"], taric: ["support"], teemo: ["top"], thresh: ["support"], tristana: ["adc", "mid"], trundle: ["jungle", "top"], tryndamere: ["top"], twistedfate: ["mid"], twitch: ["adc", "support"], udyr: ["jungle", "top"], urgot: ["top"], varus: ["adc"], vayne: ["adc", "top"], veigar: ["mid", "adc"], velkoz: ["support", "mid"], vex: ["mid"], vi: ["jungle"], viego: ["jungle"], viktor: ["mid"], vladimir: ["mid", "top"], volibear: ["top", "jungle"], warwick: ["jungle", "top"], xayah: ["adc"], xerath: ["support", "mid"], xinzhao: ["jungle"], yasuo: ["mid", "top", "adc"], yone: ["mid", "top"], yorick: ["top"], yuumi: ["support"], zac: ["jungle", "top", "support"], zed: ["mid"], zeri: ["adc"], ziggs: ["adc", "mid"], zilean: ["support", "mid"], zoe: ["mid"], zyra: ["support", "jungle"]
};

function championKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function roleGuessFromLivePosition(position: unknown): RoleGuess | undefined {
  const normalized = typeof position === "string" ? position.trim().toUpperCase() : "";
  const roleByPosition: Record<string, PlayerRole> = {
    TOP: "top",
    JUNGLE: "jungle",
    MIDDLE: "mid",
    MID: "mid",
    BOTTOM: "adc",
    ADC: "adc",
    UTILITY: "support",
    SUPPORT: "support"
  };
  const role = roleByPosition[normalized];
  return role ? { role, confidence: 0.97, source: "live client position" } : undefined;
}

function roleGuessForPlayer(player: { championName: string; position?: unknown; summonerSpells?: string[]; scores: ScoreSnapshot }): RoleGuess {
  const positionGuess = roleGuessFromLivePosition(player.position);
  if (positionGuess) return positionGuess;

  const spells = player.summonerSpells ?? [];
  if (spells.some((spell) => /smite/i.test(spell))) return { role: "jungle", confidence: 0.98, source: "summoner spell" };
  const roles = CHAMPION_ROLE_HINTS[championKey(player.championName)] ?? [];
  if (roles.length === 1) return { role: roles[0]!, confidence: 0.82, source: "champion role profile" };
  if (roles.includes("support") && player.scores.creepScore <= 15) return { role: "support", confidence: 0.64, source: "champion profile + low CS" };
  if (roles.includes("adc") && player.scores.creepScore > 15) return { role: "adc", confidence: 0.64, source: "champion profile + CS" };
  if (roles.length > 0) return { role: roles[0]!, confidence: 0.55, source: "champion role profile" };
  return { role: "unknown", confidence: 0, source: "unavailable" };
}

export function normalizeLiveData(sessionId: string, liveData: any): NormalizedSnapshot {
  const gameTime = toNumber(liveData?.gameData?.gameTime);
  const game = normalizeGameMetadata(liveData);
  const isCasual = game.reviewMode === "casual_mode";
  const activePlayer = liveData?.activePlayer ?? {};
  const activeName = pickName(activePlayer);
  const allPlayers = Array.isArray(liveData?.allPlayers) ? liveData.allPlayers : [];
  const activeListPlayer = allPlayers.find((p: any) => pickName(p) === activeName) ?? allPlayers[0] ?? {};
  const championName = String(activeListPlayer?.championName ?? activePlayer?.championName ?? "Unknown");

  const playerScores = normalizeScores(activeListPlayer?.scores ?? activePlayer?.scores ?? {});
  const playerItems = normalizeItems(activeListPlayer?.items ?? activePlayer?.items ?? []);

  const normalizedPlayers: NormalizedPlayerSnapshot[] = allPlayers.map((player: any) => {
    const base = {
      riotId: player?.riotId,
      summonerName: player?.summonerName,
      championName: String(player?.championName ?? "Unknown"),
      livePosition: normalizeLivePosition(player?.position),
      team: normalizeTeam(player?.team),
      isBot: typeof player?.isBot === "boolean" ? player.isBot : undefined,
      isDead: typeof player?.isDead === "boolean" ? player.isDead : undefined,
      respawnTimer: typeof player?.respawnTimer === "number" && Number.isFinite(player.respawnTimer) ? player.respawnTimer : undefined,
      level: typeof player?.level === "number" && Number.isFinite(player.level) ? player.level : undefined,
      scores: normalizeScores(player?.scores ?? {}),
      items: normalizeItems(player?.items ?? []),
      summonerSpells: normalizeSpellNames(player),
      runes: normalizeRunes(player?.runes ?? player?.fullRunes)
    } satisfies Omit<NormalizedPlayerSnapshot, "role" | "roleConfidence" | "roleSource">;
    const guess = isCasual
      ? { role: "unknown" as const, confidence: 0, source: `${game.casualReason?.toUpperCase() ?? "casual"} mode` }
      : roleGuessForPlayer({ ...base, position: player?.position });
    return { ...base, role: guess.role, roleConfidence: guess.confidence, roleSource: guess.source };
  });

  const activeNormalized = normalizedPlayers.find((p) => pickComparableName(p) === pickComparableName({ riotId: activePlayer?.riotId, summonerName: activeName })) ?? normalizedPlayers[0];
  const activeGuess = activeNormalized
    ? { role: activeNormalized.role ?? "unknown", confidence: activeNormalized.roleConfidence ?? 0, source: activeNormalized.roleSource ?? "unavailable" }
    : isCasual
      ? { role: "unknown" as const, confidence: 0, source: `${game.casualReason?.toUpperCase() ?? "casual"} mode` }
      : roleGuessForPlayer({ championName, position: activeListPlayer?.position, summonerSpells: normalizeSpellNames(activeListPlayer), scores: playerScores });

  return {
    sessionId,
    timestampSec: gameTime,
    phase: phaseFromTime(gameTime),
    game,
    player: {
      riotId: activePlayer?.riotId ?? activeListPlayer?.riotId,
      summonerName: activeName,
      championName,
      livePosition: activeNormalized?.livePosition ?? normalizeLivePosition(activeListPlayer?.position),
      role: activeGuess.role,
      roleConfidence: activeGuess.confidence,
      roleSource: activeGuess.source
    },
    level: typeof activePlayer?.level === "number" ? activePlayer.level : undefined,
    currentGold: typeof activePlayer?.currentGold === "number" ? activePlayer.currentGold : undefined,
    scores: playerScores,
    items: playerItems,
    allPlayers: normalizedPlayers,
    activePlayerDetails: normalizeActivePlayerDetails(activePlayer)
  };
}

function pickComparableName(player: { riotId?: string; summonerName?: string }): string | undefined {
  return (player.riotId ?? player.summonerName)?.toLowerCase();
}

export function normalizeEvents(liveData: any): NormalizedEvent[] {
  const rawEvents = liveData?.events?.Events;
  if (!Array.isArray(rawEvents)) return [];

  return rawEvents.map((event: any): NormalizedEvent => {
    const rawEventName = String(event?.EventName ?? "Unknown");
    return {
      id: typeof event?.EventID === "number" ? event.EventID : `${rawEventName}-${event?.EventTime ?? Math.random()}`,
      type: mapEventType(rawEventName),
      timestampSec: toNumber(event?.EventTime),
      actorName: event?.KillerName || event?.Acer || event?.Recipient || event?.TurretKilled,
      victimName: event?.VictimName,
      assistingParticipantNames: Array.isArray(event?.Assisters) ? event.Assisters : undefined,
      rawEventName,
      eventData: sanitizeEventData(event)
    };
  });
}

function sanitizeEventData(event: any): Record<string, NormalizedEventDataValue> | undefined {
  if (!event || typeof event !== "object") return undefined;
  const out: Record<string, NormalizedEventDataValue> = {};
  for (const [key, value] of Object.entries(event)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const clean = value.filter((item): item is string | number | boolean => ["string", "number", "boolean"].includes(typeof item));
      if (clean.length > 0) out[key] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapEventType(name: string): NormalizedEventType {
  switch (name) {
    case "ChampionKill":
      return "champion_kill";
    case "DragonKill":
      return "dragon_kill";
    case "BaronKill":
      return "baron_kill";
    case "HeraldKill":
      return "rift_herald_kill";
    case "TurretKilled":
      return "turret_kill";
    case "InhibKilled":
      return "inhibitor_kill";
    case "GameStart":
      return "game_start";
    default:
      return "other";
  }
}

export function createMatchContextFromSnapshots(params: {
  sessionId: string;
  startedAtIso: string;
  endedAtIso?: string;
  snapshots: NormalizedSnapshot[];
  events: NormalizedEvent[];
}): MatchContext {
  const snapshots = [...params.snapshots].sort((a, b) => a.timestampSec - b.timestampSec);
  const latest = snapshots.at(-1);
  const first = snapshots[0];
  const player = latest?.player ?? first?.player ?? { championName: "Unknown", role: "unknown" as const };
  const game = latest?.game ?? first?.game;
  const durationSec = Math.max(0, latest?.timestampSec ?? 0);

  const deathEvents = params.events.filter((event) => {
    if (event.type !== "champion_kill") return false;
    return rawEventNameMatchesPlayer(event.victimName, player);
  });

  const aggregate: MatchAggregate = {
    durationSec,
    kills: latest?.scores.kills ?? 0,
    deaths: latest?.scores.deaths ?? deathEvents.length,
    assists: latest?.scores.assists ?? 0,
    teamKills: inferTeamKills(latest),
    csAt10: snapshotAtOrBefore(snapshots, 10 * 60)?.scores.creepScore,
    csAt15: snapshotAtOrBefore(snapshots, 15 * 60)?.scores.creepScore,
    csPerMin: durationSec > 0 ? ((latest?.scores.creepScore ?? 0) / durationSec) * 60 : 0,
    visionScore: latest?.scores.wardScore,
    deathsBefore10: deathEvents.filter((d) => d.timestampSec <= 10 * 60).length,
    firstDeathAtSec: deathEvents[0]?.timestampSec,
    deathTimestamps: deathEvents.map((d) => d.timestampSec),
    itemNamesFinal: latest?.items.map((item) => item.displayName) ?? [],
    totalSnapshots: snapshots.length
  };

  return {
    sessionId: params.sessionId,
    game,
    startedAtIso: params.startedAtIso,
    endedAtIso: params.endedAtIso,
    player,
    snapshots,
    events: dedupeEvents(params.events),
    aggregate
  };
}

function snapshotAtOrBefore(snapshots: NormalizedSnapshot[], timestampSec: number): NormalizedSnapshot | undefined {
  return snapshots.filter((s) => s.timestampSec <= timestampSec).at(-1);
}

function inferTeamKills(snapshot?: NormalizedSnapshot): number | undefined {
  if (!snapshot?.allPlayers || snapshot.allPlayers.length === 0) return undefined;
  const activeName = snapshot.player.summonerName ?? snapshot.player.riotId;
  const active = snapshot.allPlayers.find((p) => p.summonerName === activeName || p.riotId === activeName);
  if (!active) return undefined;
  return snapshot.allPlayers
    .filter((p) => p.team === active.team)
    .reduce((sum, p) => sum + p.scores.kills, 0);
}

function dedupeEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>();
  const out: NormalizedEvent[] = [];
  for (const event of events.sort((a, b) => a.timestampSec - b.timestampSec)) {
    const key = String(event.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

export interface StoredRawLiveDataSnapshot {
  snapshot: NormalizedSnapshot;
  rawLiveData?: unknown;
}

const RAW_LIVE_DATA_DEFAULT_TOKEN_BUDGET = 131_072;
const RAW_SNAPSHOT_TARGETS = [
  { checkpoint: "5m", timestampSec: 5 * 60 },
  { checkpoint: "10m", timestampSec: 10 * 60 },
  { checkpoint: "15m", timestampSec: 15 * 60 },
  { checkpoint: "20m", timestampSec: 20 * 60 }
] as const;

export function estimateJsonTokens(value: unknown): number {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil((raw?.length ?? 0) / 3);
}

export function buildRawLiveDataTelemetry(params: {
  snapshots: StoredRawLiveDataSnapshot[];
  events: NormalizedEvent[];
  player?: MatchContext["player"];
  tokenBudget?: number;
}): RawLiveDataTelemetry | undefined {
  const withRaw = params.snapshots
    .filter((entry) => isRiotAllGameData(entry.rawLiveData))
    .sort((a, b) => a.snapshot.timestampSec - b.snapshot.timestampSec);
  if (withRaw.length === 0) return undefined;

  const tokenBudget = params.tokenBudget ?? RAW_LIVE_DATA_DEFAULT_TOKEN_BUDGET;
  const allTokens = withRaw.reduce((sum, entry) => sum + estimateJsonTokens(entry.rawLiveData), 0);
  const warnings: string[] = [];

  if (allTokens <= tokenBudget) {
    return {
      source: "riot-live-client-allgamedata",
      endpoint: "/liveclientdata/allgamedata",
      tokenBudget,
      estimatedTokens: allTokens,
      totalStoredSnapshots: withRaw.length,
      includedSnapshots: withRaw.length,
      omittedSnapshots: 0,
      selectionReason: "All stored raw /allgamedata snapshots fit the raw telemetry budget.",
      snapshots: withRaw.map((entry, index) => ({
        checkpoint: index === withRaw.length - 1 ? "end" : formatRawCheckpoint(entry.snapshot.timestampSec),
        timestampSec: entry.snapshot.timestampSec,
        estimatedTokens: estimateJsonTokens(entry.rawLiveData),
        allGameData: entry.rawLiveData
      })),
      warnings
    };
  }

  const selected = selectRawSnapshotCandidates(withRaw, params.events, params.player);
  const included: RawLiveDataTelemetry["snapshots"] = [];
  let usedTokens = 0;
  for (const candidate of selected) {
    const estimatedTokens = estimateJsonTokens(candidate.entry.rawLiveData);
    if (estimatedTokens > tokenBudget) {
      warnings.push(
        `Raw /allgamedata snapshot at ${formatRawCheckpoint(candidate.entry.snapshot.timestampSec)} estimated ${estimatedTokens} tokens, above the ${tokenBudget} token raw telemetry budget, so it was omitted.`
      );
      continue;
    }
    if (usedTokens + estimatedTokens > tokenBudget) continue;
    usedTokens += estimatedTokens;
    included.push({
      checkpoint: candidate.checkpoint,
      timestampSec: candidate.entry.snapshot.timestampSec,
      estimatedTokens,
      allGameData: candidate.entry.rawLiveData
    });
  }

  const omitted = Math.max(0, withRaw.length - included.length);
  if (omitted > 0) {
    warnings.push(
      `${omitted} raw /allgamedata snapshots were omitted because the full stored snapshot history is estimated at ${allTokens} tokens, above the ${tokenBudget} token raw telemetry budget.`
    );
  }

  return {
    source: "riot-live-client-allgamedata",
    endpoint: "/liveclientdata/allgamedata",
    tokenBudget,
    estimatedTokens: usedTokens,
    totalStoredSnapshots: withRaw.length,
    includedSnapshots: included.length,
    omittedSnapshots: omitted,
    selectionReason:
      "Full raw /allgamedata payloads were prioritized for the final state, player-involved combat events, objective events, lane checkpoints, and start state because the complete repeated snapshot history did not fit the raw telemetry budget.",
    snapshots: included.sort((a, b) => a.timestampSec - b.timestampSec),
    warnings
  };
}

function isRiotAllGameData(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return Boolean(raw.gameData || raw.activePlayer || raw.allPlayers || raw.events);
}

function selectRawSnapshotCandidates(
  snapshots: StoredRawLiveDataSnapshot[],
  events: NormalizedEvent[],
  player?: MatchContext["player"]
): Array<{ checkpoint: string; entry: StoredRawLiveDataSnapshot }> {
  const out: Array<{ checkpoint: string; entry: StoredRawLiveDataSnapshot }> = [];
  const seen = new Set<number>();
  const add = (checkpoint: string, entry?: StoredRawLiveDataSnapshot): void => {
    if (!entry) return;
    const key = entry.snapshot.timestampSec;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ checkpoint, entry });
  };

  add("end", snapshots.at(-1));
  const playerCombat = events.filter((event) => event.type === "champion_kill" && (!player || rawEventInvolvesPlayer(event, player)));
  for (const event of playerCombat) {
    add(`player combat ${formatRawCheckpoint(event.timestampSec)}`, nearestRawSnapshot(snapshots, event.timestampSec));
  }
  for (const event of events) {
    if (event.type !== "champion_kill" && event.type !== "other" && event.type !== "game_start") {
      add(`${event.type} ${formatRawCheckpoint(event.timestampSec)}`, nearestRawSnapshot(snapshots, event.timestampSec));
    }
  }
  for (const target of RAW_SNAPSHOT_TARGETS) add(target.checkpoint, snapshotAtOrBeforeRaw(snapshots, target.timestampSec));
  add("start", snapshots[0]);

  return out;
}

function rawEventInvolvesPlayer(event: NormalizedEvent, player: MatchContext["player"]): boolean {
  return (
    rawEventNameMatchesPlayer(event.actorName, player) ||
    rawEventNameMatchesPlayer(event.victimName, player) ||
    Boolean(event.assistingParticipantNames?.some((name) => rawEventNameMatchesPlayer(name, player)))
  );
}

function rawEventNameMatchesPlayer(name: string | undefined, player: MatchContext["player"]): boolean {
  if (!name) return false;
  const playerTokens = rawNameVariants(player.riotId).concat(rawNameVariants(player.summonerName));
  const eventTokens = rawNameVariants(name);
  return eventTokens.some((token) => playerTokens.includes(token));
}

function rawNameVariants(value: string | undefined): string[] {
  const raw = value?.trim().toLowerCase();
  if (!raw) return [];
  const withoutTag = raw.split("#")[0];
  return Array.from(new Set([raw, withoutTag].filter((part): part is string => Boolean(part))));
}

function nearestRawSnapshot(snapshots: StoredRawLiveDataSnapshot[], timestampSec: number): StoredRawLiveDataSnapshot | undefined {
  let best: StoredRawLiveDataSnapshot | undefined;
  let bestDistance = Infinity;
  for (const entry of snapshots) {
    const distance = Math.abs(entry.snapshot.timestampSec - timestampSec);
    if (distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

function snapshotAtOrBeforeRaw(snapshots: StoredRawLiveDataSnapshot[], timestampSec: number): StoredRawLiveDataSnapshot | undefined {
  return snapshots.filter((entry) => entry.snapshot.timestampSec <= timestampSec).at(-1) ?? snapshots[0];
}

function formatRawCheckpoint(timestampSec: number): string {
  const safe = Math.max(0, Math.round(timestampSec));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
