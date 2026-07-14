# Architecture

## Runtime topology

```text
Windows Desktop App
  Electron main process
    - tray/menu/window lifecycle
    - Live Client Data polling
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

Each completed report creates one local `journal_entries` row containing the report's positive habit, highest-impact focus area, champion/role, and the rank/LP configured at review time. Report regeneration may refresh the coaching text, but it does not rewrite the historical rank/LP snapshot. Existing reports are backfilled once when the Journal is first loaded.

## Phase 7 visual review

Screenshot/VOD review is implemented as local capture and annotation infrastructure:

- opt-in capture;
- session-linked frame metadata;
- local file storage;
- timeline annotation model;
- future-ready `VisualObservation` schema.

The MVP does not rely on visual frames for real-time tactical advice.
