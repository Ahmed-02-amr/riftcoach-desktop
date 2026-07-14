# Architecture

## Runtime topology

```text
Windows Desktop App
  Electron main process
    - tray/menu/window lifecycle
    - Live Client Data polling
    - authenticated League Client rank synchronization
    - offline ROFL/ROFL2 metadata parsing
    - optional League Replay API orchestration
    - optional League-window VOD recording
    - screenshot capture
    - SQLite writes
    - AI orchestration
  Electron preload
    - safe IPC bridge
  React renderer
    - dashboard, reports, automatic journal, settings

Optional Cloud API
  - OpenAI proxy
  - auth/rate-limit boundary
  - cloud report generation
```

## Data flow

```text
Riot Live Client Data API
  -> LiveClientReader
  -> LiveSessionService
  -> SQLite snapshots
  -> createMatchContextFromLiveSnapshots
  -> Expert rules
  -> Insight ranker
  -> CoachLLMProvider
  -> CoachReport
  -> UI and immutable journal snapshot

League Client localhost API
  -> temporary lockfile credential discovery
  -> current ranked queues + active game queue
  -> pre-match and post-match rank snapshots
  -> match-linked LP delta
  -> Auto Journal ranked trend

ROFL / ROFL2 file
  -> metadata envelope parser (offline)
  -> participant selection from configured Riot ID
  -> normalized final snapshot
  -> optional Riot Match-v5 details + timeline
  -> optional Replay API frames / WebM render
  -> same expert rules, provider report, UI, and journal pipeline
```

## LLM design

The app does not send raw, noisy telemetry directly to an LLM. It first creates structured facts and rules-engine insights. The LLM provider receives a small coaching packet:

```ts
{
  match: MatchContext;
  insights: CoachInsight[];
  profile: { rank?: string; mainRole?: PlayerRole };
  privacyMode: PrivacyMode;
}
```

Every provider must return the same `CoachReport` schema. This allows switching between Ollama and the cloud OpenAI proxy without changing the UI. Provider failures are explicit so the user knows when a selected model is not actually being used.

## Journal design

Each completed report creates one local `journal_entries` row containing the report's positive habit, highest-impact focus area, and champion/role. A separate `rank_snapshots` table stores current, pre-match, and post-match rank state with the queue, LP, wins/losses, source, and synchronization time. Post-match synchronization may fill the matching Journal entry, but later profile changes cannot rewrite a different match's historical snapshot. Existing reports are backfilled when the Journal is first loaded.

## Phase 7 visual review

Screenshot/VOD review is implemented as local capture and annotation infrastructure:

- opt-in capture;
- session-linked frame metadata;
- local file storage;
- timeline annotation model;
- future-ready `VisualObservation` schema.

The MVP does not rely on visual frames for real-time tactical advice.

## Replay setup and privacy

Offline ROFL parsing is the primary replay path. `EnableReplayApi=1` is only required for League-rendered frames or WebM output. The one-click setup edits the discovered League `Config/game.cfg` in place after making a timestamped sibling backup; it does not require administrator rights for a normal per-user-writable Riot installation.

The AI evidence mode distinguishes final-scoreboard ROFL metadata from both visual-only reviews and real timelines. A final-stat-only report may discuss KDA, CS, vision, role, duration, items, and team totals, but it cannot attribute those results to wave state, pathing, resets, positioning, or a particular timestamp. Parser/import status is filtered from player-strength fields, and affected stored reports are repaired when Journal data is loaded.

Automatic live VOD capture is opt-in and uses ffmpeg `gdigrab` against the League game-window title. It records no audio and has no desktop-capture fallback. Match-v5 and replay rendering are also opt-in; Riot API credentials use the existing encrypted credential store.
