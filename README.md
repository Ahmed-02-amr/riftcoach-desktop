# RiftCoach Desktop

Windows-first League of Legends coaching desktop app.

This repository implements a production-oriented source project through the planned Phase 7:

1. Windows desktop shell with tray, settings, local logging, packaging config.
2. Local League Live Client Data session detection and snapshot recording.
3. Local expert rules engine for post-game insights.
4. Ollama local structured-output coach provider.
5. OpenAI cloud coach via a backend proxy, so app-owned API keys are never shipped in the desktop app.
6. Automatic coaching journal with recurring strength/focus patterns and rank/LP history.
7. Optional screenshot/VOD review with local screenshot capture, standalone local VOD/ROFL upload, VOD frame extraction, League replay capture, and visual annotation plumbing.

The app is designed as a post-game coach first. It intentionally avoids in-game tactical shot-calling, hidden-information inference, automation, packet inspection, or game-memory reading.

## Tech stack

- Electron + React + Vite + TypeScript
- Windows-first packaging with electron-builder NSIS
- SQLite local storage via `better-sqlite3` 12.x with Electron-targeted prebuilds for Windows dev
- Local AI via Ollama structured JSON responses
- Cloud AI via `apps/api` OpenAI proxy
- Shared TypeScript packages for rules, Riot local API client, storage, and AI providers

## Repository layout

```text
apps/
  desktop/   Electron desktop app
  api/       optional cloud proxy for OpenAI mode
packages/
  core/      game models, normalizer, rules, schemas, journal/profile types
  riot/      Riot Live Client Data API reader
  storage/   SQLite migrations and repositories
  ai/        OpenAI-proxy and Ollama providers
scripts/     Windows helper scripts
```

## Requirements

- Windows 10/11 for production packaging and game integration.
- Node.js `>=24.14 <25` for Windows desktop development.
- pnpm 9+.
- League of Legends installed for live session recording.
- Optional: Ollama running locally for private AI mode.
- Optional: cloud backend configured with `OPENAI_API_KEY` for OpenAI mode.

## Quick start on Windows

```powershell
pnpm install
pnpm build
pnpm --filter @riftcoach/desktop dev
```

## v0.4.0 Auto Journal and interface refresh

v0.4.0 replaces Training Objectives with an automatic Journal. Every completed review records the strongest habit, primary focus area, champion, role, and the configured rank/LP at that moment. The Journal aggregates recurring patterns and visualizes ranked progress without changing historical snapshots when the current profile is updated.

The desktop interface now uses a cohesive League-inspired navy, aged-gold, and teal system with code-native SVG icons, improved typography, consistent alignment, and a sidebar that collapses cleanly at the 960x620 minimum window size. Existing reports are imported into the Journal on first load. Legacy training tables remain in the local database only for upgrade safety and are no longer exposed by the app.

Build the versioned Windows installer with:

```powershell
pnpm --filter @riftcoach/desktop dist:win
```

The output is `apps/desktop/release/RiftCoach-0.4.0-Setup.exe`.

If `pnpm` is not available, install it without Corepack admin shims:

```powershell
npm install -g pnpm@9.15.4
```

To run the API proxy:

```powershell
copy apps\api\.env.example apps\api\.env
# edit apps\api\.env and set OPENAI_API_KEY
pnpm --filter @riftcoach/api dev
```

To package a Windows installer:

```powershell
.\scripts\package-windows.ps1
```

The NSIS installer is written to `apps/desktop/release`.


## Recorder status

RiftCoach is designed to stay open in the tray and start recording automatically when a live League match is available. Outside a match, the app shows a normal waiting state.

## VOD review

The Live Recorder tab can upload a local `.mp4`, `.mkv`, `.mov`, `.webm`, or League `.rofl` replay file and generate a VOD-first review without a recorded Live Client session. Video files are sampled with ffmpeg. `.rofl` files are opened with the League replay client, then RiftCoach uses Riot's local Replay API to seek through the replay and capture local desktop frames plus playback/game/render metadata. Riot's Replay API must be enabled in the League client config for `.rofl` reviews. When a matching recorded session exists, the video upload flow can attach the VOD to telemetry so frame bookmarks line up with deaths, fights, objectives, and lane checkpoints. Extracted frames, replay screenshots, and local visual observations stay on disk under the app data directory.

## AI and knowledge modes

RiftCoach defaults to Local Ollama mode. Post-game reports require the selected provider to be reachable; provider failures are shown directly instead of silently falling back to a rules-only report. Use Settings → Test Ollama with current values before generating reports. The Ollama generation timeout defaults to 10 minutes and can be adjusted in Settings.

RiftCoach can also enrich prompts with local benchmark comparisons, curated matchup notes, and optional web snippets. Web enrichment is off by default and now defaults to built-in web search, with no Docker or API key required. Ollama web-search remains available as an alternate provider with its API key stored locally through Electron safeStorage.

For local Ollama reviews in `local-only` privacy mode, RiftCoach now exposes raw Riot Live Client `/liveclientdata/allgamedata` payloads to the model in addition to normalized telemetry. A single payload is normally small enough for the raw telemetry budget, but a full match of repeated snapshots may not be; when that happens RiftCoach includes complete raw payloads around the final state, player-involved combat, objectives, lane checkpoints, and start state first.

Saved reviews include a follow-up chat panel. Use it to challenge a vague review, ask what the best next-game focus should be, or turn the drill into a multi-game plan. Chat replies are grounded in the saved report, local telemetry, visual bookmarks, and optional built-in web snippets.

### Local Ollama mode

The desktop app calls `http://127.0.0.1:11434/api/chat` and requests a JSON response matching `CoachReportJsonSchema`.
By default it sends `num_ctx: 262144` and `num_predict: 8192`; both can be adjusted in Settings under the Ollama provider fields. Very large contexts require a model and machine that can actually handle them.

Recommended starting models:

- `qwen2.5:7b-instruct`
- `llama3.1:8b-instruct`
- `mistral-nemo`

### OpenAI cloud mode

The desktop app calls the backend proxy in `apps/api`. The OpenAI API key belongs on the server only.

### Hybrid mode

The desktop app stores raw local snapshots and screenshots locally, runs rules locally, and sends only summarized insights to the cloud proxy.

## Safety and product constraints

RiftCoach is designed for post-game coaching and gentle user-selected learning-goal reminders. It does not:

- automate player inputs;
- read process memory;
- inspect network packets;
- show hidden information;
- track enemy cooldowns from hidden state;
- issue tactical commands like “go Baron now.”

See `PRODUCT_POLICY.md` and `SECURITY.md`.

## Production hardening checklist

Before a public beta:

- Add Windows code signing certificate.
- Configure auto-update publishing.
- Add crash reporting with user opt-in.
- Run compatibility tests against the current League client.
- Complete Riot product review requirements for your distribution model.
- Add a privacy policy and data-processing terms.
- Gate cloud AI features behind auth, rate limits, and billing.

## Development notes

The code is structured to compile as a monorepo, but this zip does not include `node_modules` or a compiled Windows installer. Build and packaging require a Windows machine with npm registry access.


## Windows native dependency notes

This project is pinned for Windows desktop development on Node.js `>=24.14 <25`, Electron `41.7.1`, and `better-sqlite3` `12.9.0`. The root `.npmrc` intentionally installs native modules for Electron rather than plain Node so the desktop app can load SQLite without a `NODE_MODULE_VERSION` mismatch.

If `pnpm install` still tries to compile `better-sqlite3`, first delete `node_modules` and rerun install:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item pnpm-lock.yaml -ErrorAction SilentlyContinue
pnpm install
```

If a native module still falls back to `node-gyp`, install the Visual Studio Build Tools workload `Desktop development with C++`, then rerun `pnpm install`.

Useful commands:

```powershell
pnpm doctor
pnpm --filter @riftcoach/desktop rebuild:native
pnpm --filter @riftcoach/desktop dev
```

## Desktop dev note

`pnpm --filter @riftcoach/desktop dev` starts both the Vite renderer server and the Electron desktop shell. The page at `http://127.0.0.1:5173` is only the React renderer dev server. The real app is the separate **RiftCoach Electron window** and tray process. Opening the Vite URL in Chrome is useful for visual UI preview only; local League polling, SQLite IPC, screenshot capture, and tray behavior require Electron.

If the Electron window does not appear, run:

```powershell
pnpm --filter @riftcoach/desktop build
cd apps\desktop
$env:VITE_DEV_SERVER_URL="http://127.0.0.1:5173"
pnpm exec electron .
```

v0.1.2 fixes the Electron entry path, preload path, packaged renderer path, and tray resource path so the desktop shell launches from the built `dist-electron/main/main.js` file.

## v0.1.4 Windows packaging fix

If `scripts\package-windows.ps1` shows `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarn'`, update to v0.1.4. The helper scripts no longer call `corepack enable`; they use the already installed `pnpm` on your PATH.

If `electron-builder` reports `configuration.win has an unknown property 'publisherName'`, update to v0.1.4. The invalid `build.win.publisherName` field has been removed.


## v0.2.0 UI and Live API status polish

v0.2.0 upgrades the installed desktop UI from a minimal prototype shell into a cleaner command-center experience with status cards, report library, training metrics, and production-style settings sections. It also replaces raw connection errors with a normal waiting state outside active matches.

## v0.1.5 packaged blank-window fix

If the packaged app opens as a dark empty window, update to v0.1.5. The root cause was Vite production assets being emitted with absolute `/assets/...` URLs. Electron loads packaged HTML through `file://`, so those absolute URLs resolve outside the app and the renderer JavaScript never starts. v0.1.5 sets `base: "./"` in `apps/desktop/vite.config.ts` and adds `pnpm verify:renderer-assets` / `pnpm verify:desktop` so this cannot regress silently.

The packaged app also includes a visible startup fallback and renderer fatal-error screen so future renderer failures do not appear as an empty shell.
