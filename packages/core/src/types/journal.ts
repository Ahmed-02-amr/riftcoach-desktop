export interface JournalEntry {
  id: string;
  reportId: string;
  sessionId: string;
  champion?: string;
  role?: string;
  createdAtIso: string;
  strengthTitle: string;
  strengthDetail: string;
  weaknessTitle: string;
  weaknessDetail: string;
  rank?: string;
  lp?: number;
  rankBefore?: string;
  lpBefore?: number;
  lpDelta?: number;
  rankQueue?: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
  rankSource?: "league-client" | "league-client-cache" | "manual";
  rankSyncedAtIso?: string;
}
