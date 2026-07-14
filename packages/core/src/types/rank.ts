export type RankedQueueType = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

export type RankSnapshotSource = "league-client" | "league-client-cache" | "manual";

export type RankSnapshotPhase = "before" | "after";

export interface RankedSnapshot {
  queueType: RankedQueueType;
  rank: string;
  tier: string;
  division?: string;
  lp: number;
  wins?: number;
  losses?: number;
  provisional?: boolean;
  source: RankSnapshotSource;
  syncedAtIso: string;
  matchQueueId?: number;
}

export interface RankSyncStatus {
  state: "syncing" | "synced" | "client-not-running" | "unranked" | "disabled" | "error";
  snapshot?: RankedSnapshot;
  lastError?: string;
  updatedAtIso: string;
}
