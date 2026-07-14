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
}
