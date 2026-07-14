export function formatDuration(totalSeconds?: number): string {
  if (typeof totalSeconds !== "number") return "--:--";
  const min = Math.floor(totalSeconds / 60);
  const sec = Math.floor(totalSeconds % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}
