export type IconName = "command" | "recorder" | "review" | "journal" | "settings" | "refresh" | "trend" | "strength" | "focus" | "rank";

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    command: <><path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4L12 2.8Z"/><path d="m8 9.2 4-2.3 4 2.3v4.6l-4 2.3-4-2.3V9.2Z"/></>,
    recorder: <><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/></>,
    review: <><path d="M6 3.5h11.5v17H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M8.5 8h5.5M8.5 12h6.5M8.5 16h4"/></>,
    journal: <><path d="M3.5 5.5c2.6-1.3 5.2-.9 8.5 1v13c-3.3-1.9-5.9-2.3-8.5-1V5.5Z"/><path d="M20.5 5.5c-2.6-1.3-5.2-.9-8.5 1v13c3.3-1.9 5.9-2.3 8.5-1V5.5Z"/></>,
    settings: <><circle cx="12" cy="12" r="3.1"/><path d="M19.2 13.6 21 15l-2 3.5-2.2-.9a7.8 7.8 0 0 1-2.7 1.6L13.8 22h-4l-.4-2.8a7.8 7.8 0 0 1-2.6-1.6l-2.2.9-2-3.5 1.9-1.4a8.2 8.2 0 0 1 0-3.2L2.6 9l2-3.5 2.2.9a7.8 7.8 0 0 1 2.6-1.6L9.8 2h4l.4 2.8a7.8 7.8 0 0 1 2.6 1.6l2.2-.9L21 9l-1.8 1.4a8.2 8.2 0 0 1 0 3.2Z"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M18.2 15.5A7.5 7.5 0 1 1 19.8 9"/></>,
    trend: <><path d="m4 17 5-5 3.2 3.2L20 7.4"/><path d="M15.5 7.4H20v4.5"/></>,
    strength: <><path d="m7 4 10 10M14.6 3.4l6 6-3 1-2 2-1 3-6-6 3-1 2-2 1-3Z"/><path d="m8.5 12.5-4.7 4.7 3 3 4.7-4.7"/></>,
    focus: <><path d="M12 3 20 7v5c0 4.5-3.2 7.3-8 9-4.8-1.7-8-4.5-8-9V7l8-4Z"/><path d="M12 7v6M12 17h.01"/></>,
    rank: <><path d="m12 2.8 7.5 4.4v8.7L12 21.2l-7.5-5.3V7.2L12 2.8Z"/><path d="m8 8 4 3 4-3M12 11v6"/></>
  };
  return <svg {...common} className={className}>{paths[name]}</svg>;
}
