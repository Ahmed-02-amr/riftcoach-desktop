interface StatusPillProps {
  state: string;
  compact?: boolean;
}

const labels: Record<string, string> = {
  idle: "Idle",
  recording: "Recording",
  "league-not-running": "Waiting",
  error: "Attention needed"
};

export function StatusPill({ state, compact = false }: StatusPillProps) {
  return (
    <span className={`pill pill-${state} ${compact ? "pill-compact" : ""}`.trim()}>
      <span className="pill-dot" />
      {labels[state] ?? state.replaceAll("-", " ")}
    </span>
  );
}
