# Changelog

## 0.4.0

- Replaced Training Objectives with an automatic Journal built from completed coaching reviews.
- Added immutable per-review journal snapshots for the recurring strength, primary focus area, champion, role, rank, and LP.
- Added rank/LP history visualization, recurring strength and weakness aggregation, and a chronological review journal.
- Added editable rank and LP profile fields; future reviews record the configured values without rewriting older entries.
- Backfills existing reports into the journal on first load while retaining legacy training tables for safe upgrades.
- Removed mission creation, automatic goal evaluation, and training-goal context from the active desktop workflow.
- Reworked the complete desktop UI with a restrained Hextech-inspired navy, gold, and teal visual system; consistent SVG icons; sharper typography; and aligned component geometry.
- Added responsive sidebar collapse and journal reflow for the 960x620 minimum desktop window, with compact layouts that avoid horizontal overflow.
- Added accessible labels for icon-only navigation, reduced-motion handling, and auto-dismissal for status messages.
- Verified the production build, Electron bundle, renderer asset paths, journal SQLite behavior, and the primary Journal interaction flow.

## 0.3.9

- Increased the default and Settings maximum Ollama context window to 262144 tokens.
- Added a raw Riot Live Client payload path for reviews and review chat: stored `/liveclientdata/allgamedata` JSON is now exposed to local Ollama prompts when privacy mode is `local-only`.
- Uses a 131072-token raw telemetry budget inside the 262144-token prompt target; if the full repeated snapshot history fits, every raw snapshot is included, otherwise full raw payloads are prioritized around the final state, player-involved combat, objectives, lane checkpoints, and start state.
- Expanded normalized telemetry with active-player champion stats, abilities, runes, richer item fields, player dead/respawn state, player levels, and full scalar event payloads.
- Tightened report and chat prompts so the coach treats Live Client values as sampled evidence and stops claiming unavailable Riot data such as camera intent, wave state, exact pathing, or exact HP-at-death unless a near raw snapshot or visual bookmark actually supplies it.

## 0.3.8

- Replaced the SearXNG/Docker search path with built-in web search that works from the desktop app without Docker, a local sidecar, or an API key.
- Migrates saved `webSearchProvider: "searxng"` settings back to `built-in` so existing installs stop trying `127.0.0.1:8080`.
- Updated report, VOD/ROFL, and review-chat enrichment to use the built-in provider by default.
- Removed the SearXNG sidecar files and Settings UI.

## 0.3.7

- Added persisted follow-up chat for saved reviews so players can challenge a report, ask for the best next action, and turn the review into a concrete next-game plan.
- Grounded review chat in the saved report, reconstructed match telemetry, visual bookmarks, active training goal, recent chat history, and optional web snippets.
- Added SearXNG as the default web-enrichment provider, including Settings controls, provider testing, report/VOD/ROFL enrichment support, and a local Docker sidecar under `sidecars/searxng`.
- Kept Ollama web-search as an alternate provider for existing users, while review chat recommends the SearXNG sidecar for question-specific searches.
- Added storage, IPC, preload, and renderer support for review chat messages, sources, and warnings.

## 0.3.6

- Removed the awkward benchmark-meta phrasing from repaired reports, including "not a benchmark grade" and "decision pattern behind...".
- Made CS-only repaired reports coach wave discipline directly with concrete triggers instead of saying "Treat low CS as the symptom."
- Increased report word budget defaults: Ollama output tokens now default to 8192 and Settings allows up to 65536.
- Prompt now asks for fuller summaries, explanations, timeline notes, and drill steps while keeping them concrete and measurable.

## 0.3.5

- Made post-game reviews decision-first instead of benchmark-first: CS, gold, vision, and benchmark deltas can support a review but no longer define the main mistake by themselves.
- Added an actionability guard that rewrites generic benchmark/report-card model output into concrete next-game coaching with triggers, replacement decisions, and measurable drills.
- Lowered CS/vision rule priority so timestamped death, objective, positioning, and tempo mistakes win when they provide better coaching evidence.

## 0.3.4

- Changed `.rofl` replay launch to a guided manual fallback when Windows or Riot permissions block automatic League launch.
- Increased the manual `.rofl` Replay API wait window to 180 seconds and added clearer error guidance for current-patch/manual replay opening.
- Clarified the VOD/ROFL upload UI so League replay files are presented as replay-client reviews, not normal video uploads.

## 0.3.3

- Added a Windows `Start-Process` fallback for `.rofl` replay launch when direct process creation returns `EPERM`.
- Waits for League launch success or failure before polling Riot's local Replay API, so launch errors are reported accurately.

## 0.3.2

- Fixed standalone `.rofl` review launch on Windows machines without a `.rofl` file association by starting the League game executable directly.
- Added `RIFTCOACH_LEAGUE_EXE` as an override for non-default League install paths.
- Clarified the Live Recorder UI by separating live recording, standalone file review, and attach-video-to-session flows.

## 0.3.1

- Added standalone League `.rofl` replay reviews through Riot's local Replay API, with replay seeking, playback/game/render metadata, and local desktop frame capture.
- Extended standalone VOD reviews to support web enrichment and saved report knowledge context.
- Added a report knowledge panel so web sources and enrichment warnings are visible after generation.
- Improved visual-only prompts so VOD/ROFL reviews do not invent scoreboard, CS, vision, matchup, or item telemetry.
- Added the toxic roast coach tone to the desktop settings flow.

## 0.3.0

- Increased the default Ollama report-generation timeout from 60 seconds to 10 minutes and added a Settings control from 1 to 30 minutes.
- Added a knowledge-context layer that feeds benchmark comparisons and curated matchup notes into the selected model instead of relying only on model memory.
- Added optional Ollama web-search enrichment for benchmark/matchup snippets, with local encrypted API-key storage and a web-lookup test button.
- Removed user-facing technical Live Client API explanations from the main UI and replaced them with product-oriented recorder states.
- Removed the requirement to set a role every game: RiftCoach now infers role from live match data using summoner spells and champion-role profiles, with the saved role used only as a fallback.
- Updated report prompts to include role-confidence, benchmark, matchup, and web-source context while keeping model output schema-validated.

## 0.2.1

- Removed demo-report generation from the desktop UI, preload bridge, and IPC layer.
- Removed silent deterministic fallback from desktop report generation and the OpenAI proxy. Reports now require the configured provider and surface provider errors directly.
- Defaulted new installs and legacy deterministic settings to Local Ollama mode.
- Added Ollama diagnostics that test the current unsaved form values and report whether the selected model is installed.
- Prevented periodic background refresh from overwriting unsaved settings edits.
- Added encrypted local storage controls for the optional cloud proxy bearer token.

## 0.2.0

- Reworked the renderer into a polished desktop command center with a professional sidebar, hero panel, KPI cards, recorder-health explainer, improved report library, training metrics, and cleaner settings sections.
- Changed Live Client API offline handling so `ECONNREFUSED 127.0.0.1:2999` is treated as the expected waiting state outside an active League match rather than an alarming error.
- Persisted the latest recorder status in the main process so UI refreshes do not revert the app to a misleading idle state.
- Added clearer empty states and first-run guidance for sessions and missions.

## 0.1.5

- Fixed packaged Electron blank window by setting Vite `base: "./"` so production renderer assets load correctly through `file://`.
- Added `pnpm verify:renderer-assets` and `pnpm verify:desktop` to catch absolute renderer asset paths before packaging.
- Added a visible HTML startup fallback and renderer fatal-error screen instead of a silent dark window.
- Logged renderer console messages to the Electron log for troubleshooting.
- Hid the default Windows menu bar for a more production-like desktop shell.
- Added first-run testing scaffolding for early installer verification. This path was removed before the production-oriented provider workflow in 0.2.1.

## 0.1.4

- Removed invalid electron-builder config field `build.win.publisherName`.
- Added `author` metadata to package files to remove the packaging warning.
- Removed `corepack enable` from Windows helper scripts because it can fail with `EPERM` when Node is installed under `C:\Program Files\nodejs` and PowerShell is not elevated.
- Added `apps/desktop/tsup.config.ts` so Electron and better-sqlite3 stay external during main/preload builds.
- Added `pnpm verify:electron-bundle` to catch accidental bundling of the Electron npm launcher package.

## 0.1.3

- Fixed Electron main/preload bundling so `electron` remains an Electron runtime module instead of resolving to the npm launcher package.

## 0.1.2

- Fixed Electron package entry point: `dist-electron/main/main.js`.
- Fixed preload path for tsup's preserved `dist-electron/preload/preload.js` output.
- Fixed packaged renderer path to load `dist/index.html` from the app root.
- Fixed development tray icon path.
- Added defensive renderer load/preload logging.
- Added browser preview fallback so `http://127.0.0.1:5173` shows a diagnostic UI instead of a blank page when opened outside Electron.
- Added `dev:renderer` for intentional browser-only UI work.

## 0.1.1

- Windows Node 24 / Electron 41 native dependency alignment.
