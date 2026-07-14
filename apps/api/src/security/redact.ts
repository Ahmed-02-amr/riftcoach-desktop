export function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-REDACTED")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "C:\\REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer REDACTED");
}
