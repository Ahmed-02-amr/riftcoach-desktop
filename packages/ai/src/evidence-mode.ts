import { isVerifiedVisualObservation, type MatchContext } from "@riftcoach/core";

export function hasScoreboardTelemetry(match: MatchContext): boolean {
  const latest = [...match.snapshots].sort((a, b) => a.timestampSec - b.timestampSec).at(-1);
  return Boolean(
    latest &&
    match.player.championName &&
    !/^unknown champion$/i.test(match.player.championName) &&
    (latest.allPlayers?.length || latest.scores.creepScore || latest.scores.kills || latest.scores.deaths || latest.scores.assists)
  );
}

export function isVisualOnlyMatch(match: MatchContext): boolean {
  if (match.game?.gameMode === "VOD_REVIEW") return true;
  return match.game?.gameMode === "ROFL_REPLAY" && !hasScoreboardTelemetry(match);
}

export function isFinalStatsOnlyRoflMatch(match: MatchContext): boolean {
  if (!isRoflWithoutTimeline(match)) return false;
  const hasUsefulVisuals = (match.visualObservations ?? []).some(isVerifiedVisualObservation);
  return !hasUsefulVisuals;
}

export function isRoflWithoutTimeline(match: MatchContext): boolean {
  return match.game?.gameMode === "ROFL_REPLAY" && hasScoreboardTelemetry(match) && match.snapshots.length <= 1 && match.events.length === 0;
}
