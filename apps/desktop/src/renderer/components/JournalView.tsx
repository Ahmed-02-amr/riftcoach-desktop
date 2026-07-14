import { useMemo, useState } from "react";
import type { AppSettings, JournalEntry } from "../types";
import { formatDate } from "../utils";
import { Icon } from "./Icon";

const TIERS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Emerald", "Diamond", "Master", "Grandmaster", "Challenger"];
const DIVISIONS = ["IV", "III", "II", "I"];

type Signal = { title: string; detail: string; count: number };

export function JournalView({
  entries,
  settings,
  onUpdateProfile
}: {
  entries: JournalEntry[];
  settings: AppSettings;
  onUpdateProfile: (rank: string, lp: number) => Promise<void>;
}) {
  const [editingRank, setEditingRank] = useState(false);
  const [rankDraft, setRankDraft] = useState(settings.playerRank ?? entries[0]?.rank ?? "");
  const [lpDraft, setLpDraft] = useState(settings.playerLp ?? entries[0]?.lp ?? 0);
  const [saving, setSaving] = useState(false);
  const strengths = useMemo(() => aggregateSignals(entries, "strength"), [entries]);
  const weaknesses = useMemo(() => aggregateSignals(entries, "weakness"), [entries]);
  const rankPoints = useMemo(() => [...entries].reverse().filter((entry) => entry.rank && entry.lp !== undefined).slice(-8), [entries]);
  const currentRank = settings.playerRank ?? entries[0]?.rank ?? "Unranked";
  const currentLp = settings.playerLp ?? entries[0]?.lp;
  const firstPoint = rankPoints[0];
  const lastPoint = rankPoints.at(-1);
  const delta = firstPoint && lastPoint ? rankValue(lastPoint.rank, lastPoint.lp) - rankValue(firstPoint.rank, firstPoint.lp) : 0;

  async function saveRank() {
    const cleanRank = rankDraft.trim();
    if (!cleanRank) return;
    setSaving(true);
    try {
      await onUpdateProfile(cleanRank, Math.max(0, Math.min(100, Math.round(lpDraft))));
      setEditingRank(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="journal-page">
      <section className="rank-band hex-panel">
        <div className="rank-summary">
          <div className="rank-crest"><Icon name="rank" size={34} /></div>
          <div>
            <span className="section-label">Current ranked snapshot</span>
            <h2>{currentRank}</h2>
            <strong>{currentLp === undefined ? "LP not set" : `${currentLp} LP`}</strong>
            {rankPoints.length > 1 && <p className={delta >= 0 ? "rank-gain" : "rank-loss"}>{delta >= 0 ? "+" : ""}{delta} LP across tracked reviews</p>}
          </div>
          <button className="secondary icon-button rank-edit-button" onClick={() => setEditingRank((value) => !value)}>
            <Icon name="trend" size={17} /> Update rank
          </button>
          {editingRank && (
            <form className="rank-editor" onSubmit={(event) => { event.preventDefault(); void saveRank(); }}>
              <label>Rank<input value={rankDraft} onChange={(event) => setRankDraft(event.target.value)} placeholder="Gold I" /></label>
              <label>LP<input type="number" min={0} max={100} value={lpDraft} onChange={(event) => setLpDraft(Number(event.target.value))} /></label>
              <button type="submit" disabled={saving || !rankDraft.trim()}>{saving ? "Saving" : "Save snapshot"}</button>
              <p>Your next completed review records this rank and LP in the journal.</p>
            </form>
          )}
        </div>
        <div className="rank-chart-wrap">
          <div className="chart-heading"><span>Rank / LP over time</span><small>{rankPoints.length} ranked reviews</small></div>
          <RankChart points={rankPoints} />
        </div>
      </section>

      <div className="signal-grid">
        <SignalRail title="Recurring strengths" tone="strength" signals={strengths} total={entries.length} />
        <SignalRail title="Focus areas" tone="focus" signals={weaknesses} total={entries.length} />
      </div>

      <section className="journal-log hex-panel">
        <div className="journal-section-heading">
          <div><span className="section-label">Review history</span><h2>Recent journal entries</h2></div>
          <span>{entries.length} automatic {entries.length === 1 ? "entry" : "entries"}</span>
        </div>
        {entries.length === 0 ? (
          <div className="journal-empty">
            <Icon name="journal" size={34} />
            <h3>Your journal starts with the next review</h3>
            <p>Every completed review will add one strength, one focus area, and the rank snapshot configured above.</p>
          </div>
        ) : (
          <div className="journal-rows">
            <div className="journal-table-head"><span>Match</span><span>Role / date</span><span>Strength</span><span>Focus area</span><span>Rank / LP</span></div>
            {entries.slice(0, 12).map((entry) => (
              <article className="journal-row" key={entry.id}>
                <div className="journal-match"><span className="champion-mark">{initials(entry.champion)}</span><div><strong>{entry.champion ?? "Unknown champion"}</strong><small>Review saved</small></div></div>
                <div><strong>{roleLabel(entry.role)}</strong><small>{formatDate(entry.createdAtIso)}</small></div>
                <div className="journal-signal positive"><span><Icon name="strength" size={17} /></span><strong>{entry.strengthTitle}</strong></div>
                <div className="journal-signal negative"><span><Icon name="focus" size={17} /></span><strong>{entry.weaknessTitle}</strong></div>
                <div className="journal-rank"><strong>{entry.lp === undefined ? "—" : `${entry.lp} LP`}</strong><small>{entry.rank ?? "Unranked"}</small></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SignalRail({ title, tone, signals, total }: { title: string; tone: "strength" | "focus"; signals: Signal[]; total: number }) {
  return (
    <section className={`signal-rail ${tone} hex-panel`}>
      <div className="signal-rail-title"><span><Icon name={tone === "strength" ? "strength" : "focus"} size={19} /></span><h2>{title}</h2></div>
      {signals.length === 0 ? <p className="signal-placeholder">Patterns appear after completed reviews.</p> : signals.map((signal) => (
        <article className="signal-item" key={signal.title}>
          <span className="signal-glyph"><Icon name={tone === "strength" ? "strength" : "focus"} size={22} /></span>
          <div><h3>{signal.title}</h3><p>{signal.detail}</p></div>
          <strong>{signal.count}<small> / {total}</small></strong>
        </article>
      ))}
    </section>
  );
}

function RankChart({ points }: { points: JournalEntry[] }) {
  if (points.length === 0) return <div className="chart-empty"><Icon name="trend" size={28} /><span>Add your rank, then complete a review to start the trend.</span></div>;
  const width = 760;
  const height = 220;
  const inset = { top: 26, right: 24, bottom: 42, left: 82 };
  const values = points.map((point) => rankValue(point.rank, point.lp));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(40, rawMax - rawMin);
  const min = rawMin - spread * 0.18;
  const max = rawMax + spread * 0.25;
  const x = (index: number) => inset.left + (points.length === 1 ? (width - inset.left - inset.right) / 2 : (index / (points.length - 1)) * (width - inset.left - inset.right));
  const y = (value: number) => inset.top + ((max - value) / (max - min)) * (height - inset.top - inset.bottom);
  const coordinates = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const area = `${inset.left},${height - inset.bottom} ${coordinates} ${x(points.length - 1)},${height - inset.bottom}`;
  const ticks = [0, 1, 2, 3].map((index) => min + ((max - min) * index) / 3);

  return (
    <svg className="rank-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Rank and LP history across completed reviews">
      <defs><linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#21d4c2" stopOpacity=".24"/><stop offset="1" stopColor="#21d4c2" stopOpacity="0"/></linearGradient></defs>
      {ticks.map((tick) => <g key={tick}><line x1={inset.left} x2={width - inset.right} y1={y(tick)} y2={y(tick)} className="chart-gridline"/><text x={inset.left - 10} y={y(tick) + 4} textAnchor="end" className="chart-axis-label">{formatRankScore(tick)}</text></g>)}
      <polygon points={area} fill="url(#chartArea)" />
      <polyline points={coordinates} className="chart-line" />
      {points.map((point, index) => { const value = rankValue(point.rank, point.lp); return <g key={point.id}><circle cx={x(index)} cy={y(value)} r={index === points.length - 1 ? 6 : 4.5} className="chart-point"/><text x={x(index)} y={y(value) - 13} textAnchor="middle" className="chart-value">{point.lp} LP</text><text x={x(index)} y={height - 16} textAnchor="middle" className="chart-index">{index + 1}</text><title>{point.rank} · {point.lp} LP · {formatDate(point.createdAtIso)}</title></g>; })}
    </svg>
  );
}

function aggregateSignals(entries: JournalEntry[], kind: "strength" | "weakness"): Signal[] {
  const map = new Map<string, Signal>();
  for (const entry of entries) {
    const title = kind === "strength" ? entry.strengthTitle : entry.weaknessTitle;
    const detail = kind === "strength" ? entry.strengthDetail : entry.weaknessDetail;
    const key = title.trim().toLocaleLowerCase();
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { title, detail, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 2);
}

function rankValue(rank?: string, lp?: number): number {
  const normalized = rank?.trim().toLocaleLowerCase() ?? "";
  const tierIndex = TIERS.findIndex((tier) => normalized.startsWith(tier.toLocaleLowerCase()));
  if (tierIndex < 0) return lp ?? 0;
  const division = DIVISIONS.findIndex((candidate) => new RegExp(`\\b${candidate.toLocaleLowerCase()}\\b`, "i").test(normalized));
  return tierIndex * 400 + Math.max(0, division) * 100 + (lp ?? 0);
}

function formatRankScore(value: number): string {
  const safe = Math.max(0, Math.round(value));
  const tierIndex = Math.min(TIERS.length - 1, Math.floor(safe / 400));
  const withinTier = safe - tierIndex * 400;
  const division = DIVISIONS[Math.min(3, Math.floor(withinTier / 100))];
  const lp = Math.max(0, Math.min(99, Math.round(withinTier % 100)));
  return `${TIERS[tierIndex]} ${division} · ${lp}`;
}

function initials(value?: string): string {
  if (!value) return "?";
  return value.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toLocaleUpperCase();
}

function roleLabel(role?: string): string {
  const labels: Record<string, string> = { top: "Top", jungle: "Jungle", mid: "Mid", adc: "ADC", support: "Support" };
  return labels[role ?? ""] ?? "Role unknown";
}
