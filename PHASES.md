# Implemented Phases

## Phase 1 — Windows desktop shell

Implemented:

- Electron main/preload/renderer split.
- React dashboard.
- Tray app.
- Safe IPC bridge.
- Local SQLite database.
- Settings screen.
- NSIS packaging config.
- Windows login setting.

## Phase 2 — League live session detector

Implemented:

- Polls Riot local Live Client Data API.
- Detects active/ended session.
- Stores snapshots and events.
- Handles Live Client API downtime as normal outside active games.

## Phase 3 — Post-game rules engine

Implemented rules:

- early deaths;
- CS benchmark;
- vision activity;
- objective-adjacent deaths;
- death clusters;
- kill participation;
- jungle tempo;
- item progression gap;
- visual bookmark insights.

## Phase 4 — Ollama local coach

Implemented:

- Ollama `/api/chat` provider.
- JSON schema structured output.
- health check.
- provider-health diagnostics.

## Phase 5 — OpenAI cloud coach

Implemented:

- `apps/api` cloud proxy.
- Server-side OpenAI key usage.
- optional bearer token between desktop and proxy.
- schema-constrained report generation.
- explicit cloud-provider errors instead of silent fallback.

## Phase 6 — Automatic coaching journal

Implemented:

- automatic journal entries from completed reviews;
- recurring strength and focus-area aggregation;
- immutable rank/LP snapshots per review;
- rank/LP history visualization;
- backfill of existing reports into journal history.

## Phase 7 — Screenshot/VOD review foundation

Implemented:

- opt-in screenshot capture during sessions;
- frame metadata in SQLite;
- local frame files under app data;
- visual bookmark observations near death timestamps;
- VOD import for recorded sessions;
- standalone local VOD upload that creates a VOD-first review session;
- local ffmpeg/ffprobe-powered frame extraction;
- VOD timer offset support for recordings that start before or after in-game 0:00;
- VOD visual observations around deaths, fights, objectives, and lane/mid-game checkpoints;
- cautious local pixel-scan observations for extracted VOD frames;
- report UI thumbnails for saved visual evidence.

Polished in v0.2.x:

- professional desktop command-center UI;
- clearer Live Client API waiting state;
- provider-backed report generation with visible failure states;
- status persistence between refreshes.

Not included in this source zip:

- compiled Windows installer in Git-tracked source;
- code signing certificate;
- full computer-vision model for semantic screenshot interpretation;
- public auth/billing;
- Riot production approval workflow artifacts.
