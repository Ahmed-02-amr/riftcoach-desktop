import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function renderFatalError(error: unknown) {
  const root = document.getElementById("root");
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  if (!root) return;
  root.innerHTML = `
    <div class="startup-fallback">
      <div class="startup-card">
        <h1>RiftCoach renderer failed to start</h1>
        <p>Open DevTools from the app menu or check <code>%APPDATA%\\RiftCoach\\logs</code>.</p>
        <pre style="white-space:pre-wrap;overflow:auto;max-height:360px;color:#ffd1da;background:#0b1020;border-radius:12px;padding:12px;">${escapeHtml(detail)}</pre>
      </div>
    </div>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]!));
}

window.addEventListener("error", (event) => renderFatalError(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => renderFatalError(event.reason));

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Missing #root element");

  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  renderFatalError(error);
}
