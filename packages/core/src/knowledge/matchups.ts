import type { MatchContext, NormalizedPlayerSnapshot } from "../types/game";
import type { MatchupTip } from "../types/knowledge";
import type { PlayerRole } from "../types/settings";

const GENERIC_TIPS: Record<PlayerRole, Omit<MatchupTip, "champion" | "role" | "opponentChampion">> = {
  top: {
    matchupDifficulty: "unknown",
    lanePlan: ["Use the first death and CS benchmarks to decide whether lane safety or wave collection is the next focus.", "Avoid fighting when a large enemy wave makes trades unfavorable."],
    dangerWindows: ["before first recall", "when the wave is pushing away from you", "objective setup without teleport or side-lane pressure"],
    commonMistakes: ["Trading inside the enemy wave", "walking past river without vision", "missing side waves after lane phase"],
    source: "RiftCoach curated role fundamentals",
    confidence: "medium"
  },
  jungle: {
    matchupDifficulty: "unknown",
    lanePlan: ["Keep first clear tempo clean, then match plays to lane priority instead of forcing low-percentage fights."],
    dangerWindows: ["first scuttle without lane priority", "dragon/herald setup after a slow reset"],
    commonMistakes: ["arriving late to objectives", "forcing ganks while camps are inefficiently sequenced"],
    source: "RiftCoach curated role fundamentals",
    confidence: "medium"
  },
  mid: {
    matchupDifficulty: "unknown",
    lanePlan: ["Use wave state to create roam windows; do not roam after losing an uncollected wave."],
    dangerWindows: ["level 2/3 all-in windows", "river fights without wave priority"],
    commonMistakes: ["roaming on bad wave states", "using key cooldowns before jungle pressure arrives"],
    source: "RiftCoach curated role fundamentals",
    confidence: "medium"
  },
  adc: {
    matchupDifficulty: "unknown",
    lanePlan: ["Prioritize farm and survival until your first major item unless the matchup gives a clear advantage."],
    dangerWindows: ["enemy engage support level 2", "farming past river without support or vision"],
    commonMistakes: ["standing parallel to engage support", "trading over last hits", "missing mid-game waves"],
    source: "RiftCoach curated role fundamentals",
    confidence: "medium"
  },
  support: {
    matchupDifficulty: "unknown",
    lanePlan: ["Win vision and roam timing around wave crashes; do not abandon ADC on a bad wave."],
    dangerWindows: ["failed roam while bot wave is frozen", "objective setup without control vision"],
    commonMistakes: ["roaming without wave timing", "late objective vision", "over-forcing engage after lane is lost"],
    source: "RiftCoach curated role fundamentals",
    confidence: "medium"
  },
  unknown: {
    matchupDifficulty: "unknown",
    lanePlan: ["Use the detected mistakes and benchmark comparisons as the main coaching signal."],
    dangerWindows: ["early deaths", "objective setup", "mid-game farm drop"],
    commonMistakes: ["taking fights before item spikes", "ignoring waves before objectives"],
    source: "RiftCoach curated role fundamentals",
    confidence: "low"
  }
};

const MATCHUP_CARDS: Record<string, Omit<MatchupTip, "champion" | "role" | "opponentChampion">> = {
  "drmundo:top:darius": {
    matchupDifficulty: "hard",
    lanePlan: ["Farm safely with Q instead of taking extended early trades.", "Treat first durability components as the point where you can start absorbing more pressure.", "Keep the wave closer to your side when Darius has Ghost available."],
    dangerWindows: ["levels 1-3", "wave pushing away from you", "Darius Ghost all-in windows"],
    commonMistakes: ["taking long trades before durability", "walking up without Q available", "letting Darius stack passive inside the wave"],
    source: "RiftCoach curated matchup card",
    confidence: "high"
  },
  "jinx:adc:nautilus": {
    matchupDifficulty: "hard",
    lanePlan: ["Stand behind minions and track hook angles before contesting CS.", "Give up low-value last hits if Nautilus can threaten level 2 or fog-of-war engage.", "Your lane goal is stable farm into first item, not forcing early kills."],
    dangerWindows: ["enemy level 2", "support missing from lane brush", "farming past river without vision"],
    commonMistakes: ["walking parallel to hook support", "greeding cannon while engage cooldowns are up", "pushing without tracking enemy jungle"],
    source: "RiftCoach curated matchup card",
    confidence: "high"
  },
  "jinx:adc:draven": {
    matchupDifficulty: "hard",
    lanePlan: ["Avoid extended trades before items and preserve health for farm windows.", "Respect Draven axe positioning and support engage threat.", "Stabilize the wave near your side when possible."],
    dangerWindows: ["levels 1-3", "enemy support engage cooldowns", "first recall if Draven cashes in early"],
    commonMistakes: ["matching Draven's early trade pattern", "contesting wave when support is not in position"],
    source: "RiftCoach curated matchup card",
    confidence: "high"
  },
  "ahri:mid:yasuo": {
    matchupDifficulty: "even",
    lanePlan: ["Use wave control and short trades instead of throwing charm through minions.", "Punish Yasuo after mobility or wind wall is committed.", "Roam after crashing cannon waves rather than leaving a frozen wave."],
    dangerWindows: ["level 2 dash trades", "post-6 all-in with jungle nearby"],
    commonMistakes: ["wasting charm through minions", "roaming on a bad wave", "standing in dash path through your own minions"],
    source: "RiftCoach curated matchup card",
    confidence: "high"
  }
};

export function buildMatchupTips(match: MatchContext): MatchupTip[] {
  const role = match.player.role ?? "unknown";
  const opponent = findLikelyLaneOpponent(match, role);
  const champion = match.player.championName;
  const key = `${normalizeChampionKey(champion)}:${role}:${normalizeChampionKey(opponent?.championName ?? "")}`;
  const exact = opponent ? MATCHUP_CARDS[key] : undefined;
  const card = exact ?? GENERIC_TIPS[role] ?? GENERIC_TIPS.unknown!;
  return [{ champion, role, opponentChampion: opponent?.championName, ...card }];
}

function findLikelyLaneOpponent(match: MatchContext, role: PlayerRole): NormalizedPlayerSnapshot | undefined {
  const latest = match.snapshots.at(-1);
  if (!latest?.allPlayers?.length) return undefined;
  const activeName = (match.player.summonerName ?? match.player.riotId ?? "").toLowerCase();
  const active = latest.allPlayers.find((p) => [p.summonerName, p.riotId].filter(Boolean).some((name) => String(name).toLowerCase() === activeName));
  const enemyTeam = active?.team === "ORDER" ? "CHAOS" : active?.team === "CHAOS" ? "ORDER" : undefined;
  if (!enemyTeam) return undefined;
  const enemies = latest.allPlayers.filter((p) => p.team === enemyTeam);
  return enemies.find((p) => p.role === role) ?? enemies.find((p) => (p.role ?? "unknown") !== "unknown") ?? enemies[0];
}

function normalizeChampionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
