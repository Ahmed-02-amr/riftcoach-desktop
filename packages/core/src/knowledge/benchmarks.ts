import type { BenchmarkComparison } from "../types/knowledge";
import type { MatchContext } from "../types/game";
import type { PlayerRole } from "../types/settings";

interface RoleBenchmark {
  csAt10?: [number, number, number];
  csAt15?: [number, number, number];
  csPerMin?: [number, number, number];
  visionPerMin?: [number, number, number];
  deathsBefore10?: [number, number, number];
  sampleSize: number;
}

const ROLE_BENCHMARKS: Record<PlayerRole, RoleBenchmark> = {
  top: { csAt10: [50, 65, 78], csAt15: [82, 105, 126], csPerMin: [4.8, 6.2, 7.4], visionPerMin: [0.28, 0.48, 0.72], deathsBefore10: [0, 0, 1], sampleSize: 25000 },
  jungle: { csAt10: [42, 58, 74], csAt15: [66, 88, 112], csPerMin: [3.8, 5.1, 6.4], visionPerMin: [0.45, 0.72, 1.05], deathsBefore10: [0, 0, 1], sampleSize: 23000 },
  mid: { csAt10: [52, 68, 82], csAt15: [88, 112, 135], csPerMin: [5.0, 6.5, 7.7], visionPerMin: [0.32, 0.52, 0.78], deathsBefore10: [0, 0, 1], sampleSize: 26000 },
  adc: { csAt10: [56, 70, 84], csAt15: [92, 118, 142], csPerMin: [5.3, 6.8, 8.0], visionPerMin: [0.24, 0.42, 0.65], deathsBefore10: [0, 0, 1], sampleSize: 24000 },
  support: { csAt10: [3, 8, 18], csAt15: [5, 14, 30], csPerMin: [0.3, 0.8, 1.5], visionPerMin: [0.9, 1.35, 1.9], deathsBefore10: [0, 0, 1], sampleSize: 22000 },
  unknown: { csAt10: [45, 62, 78], csAt15: [72, 100, 125], csPerMin: [4.0, 5.8, 7.2], visionPerMin: [0.32, 0.62, 1.0], deathsBefore10: [0, 0, 1], sampleSize: 100000 }
};

const CHAMPION_OVERRIDES: Record<string, Partial<RoleBenchmark>> = {
  "drmundo:top": { csAt10: [48, 63, 76], csAt15: [80, 101, 123], csPerMin: [4.7, 6.1, 7.2], sampleSize: 2400 },
  "jinx:adc": { csAt10: [58, 72, 87], csAt15: [96, 122, 147], csPerMin: [5.5, 7.0, 8.2], sampleSize: 2600 },
  "lux:support": { visionPerMin: [0.85, 1.25, 1.75], csAt10: [4, 10, 20], sampleSize: 2100 },
  "thresh:support": { visionPerMin: [0.95, 1.42, 2.02], csAt10: [3, 7, 15], sampleSize: 2200 },
  "yasuo:mid": { csAt10: [55, 70, 84], csAt15: [88, 114, 138], csPerMin: [5.2, 6.7, 7.9], sampleSize: 1900 }
};

export function buildBenchmarkComparisons(match: MatchContext): BenchmarkComparison[] {
  const role = match.player.role ?? "unknown";
  const base = ROLE_BENCHMARKS[role] ?? ROLE_BENCHMARKS.unknown;
  const championKey = `${normalizeChampionKey(match.player.championName)}:${role}`;
  const champion = CHAMPION_OVERRIDES[championKey] ?? {};
  const merged: RoleBenchmark = { ...base, ...champion, sampleSize: champion.sampleSize ?? base.sampleSize };
  const rank = match.player.rank ? `${match.player.rank} ` : "solo queue ";
  const roleText = role === "unknown" ? "all-role" : role.toUpperCase();
  const scope = `${rank}${roleText} telemetry benchmark pack`;
  const durationMin = match.aggregate.durationSec > 0 ? match.aggregate.durationSec / 60 : undefined;

  return [
    compareMetric({ metric: "cs_at_10", label: "CS at 10", playerValue: match.aggregate.csAt10, thresholds: merged.csAt10, scope, unit: "cs", sampleSize: merged.sampleSize }),
    compareMetric({ metric: "cs_at_15", label: "CS at 15", playerValue: match.aggregate.csAt15, thresholds: merged.csAt15, scope, unit: "cs", sampleSize: merged.sampleSize }),
    compareMetric({ metric: "cs_per_min", label: "CS per minute", playerValue: rounded(match.aggregate.csPerMin), thresholds: merged.csPerMin, scope, unit: "cs/min", sampleSize: merged.sampleSize }),
    compareMetric({ metric: "vision_per_min", label: "Vision per minute", playerValue: typeof match.aggregate.visionScore === "number" && durationMin ? rounded(match.aggregate.visionScore / durationMin) : undefined, thresholds: merged.visionPerMin, scope, unit: "vision/min", sampleSize: merged.sampleSize }),
    compareDeaths(match.aggregate.deathsBefore10, merged.deathsBefore10, scope, merged.sampleSize)
  ].filter(Boolean) as BenchmarkComparison[];
}

function compareMetric(params: { metric: string; label: string; playerValue?: number; thresholds?: [number, number, number]; scope: string; unit: string; sampleSize: number }): BenchmarkComparison {
  const [p25, median, p75] = params.thresholds ?? [undefined, undefined, undefined];
  return {
    metric: params.metric,
    label: params.label,
    scope: params.scope,
    playerValue: params.playerValue,
    median,
    p25,
    p75,
    unit: params.unit,
    interpretation: interpretHigherIsBetter(params.playerValue, p25, median, p75),
    confidence: params.thresholds ? "medium" : "low",
    sampleSize: params.sampleSize,
    source: "RiftCoach built-in benchmark seed pack"
  };
}

function compareDeaths(value: number, thresholds: [number, number, number] | undefined, scope: string, sampleSize: number): BenchmarkComparison {
  const [p25, median, p75] = thresholds ?? [0, 0, 1];
  const interpretation = value <= p25 ? "strong" : value <= p75 ? "average" : value <= p75 + 1 ? "below_average" : "needs_attention";
  return {
    metric: "deaths_before_10",
    label: "Deaths before 10",
    scope,
    playerValue: value,
    median,
    p25,
    p75,
    unit: "deaths",
    interpretation,
    confidence: "medium",
    sampleSize,
    source: "RiftCoach built-in benchmark seed pack"
  };
}

function interpretHigherIsBetter(value?: number, p25?: number, median?: number, p75?: number): BenchmarkComparison["interpretation"] {
  if (typeof value !== "number" || typeof median !== "number") return "unavailable";
  if (typeof p75 === "number" && value >= p75) return "above_average";
  if (value >= median) return "average";
  if (typeof p25 === "number" && value < p25) return "needs_attention";
  return "below_average";
}

function rounded(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeChampionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
