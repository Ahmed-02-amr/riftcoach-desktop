# Security

## Secrets

- App-owned OpenAI keys must live only in `apps/api`, never inside the packaged desktop app.
- User-provided direct API keys are stored with Electron `safeStorage`, which uses OS-backed encryption where available. The app refuses to persist secrets if OS encryption is unavailable.
- Logs redact tokens and local file paths where possible.

## Local data

- SQLite is stored under Electron `app.getPath("userData")`.
- Screenshots are opt-in and stored locally by default.
- Users can delete local sessions/reports/screenshots from the settings screen.

## Electron hardening

The renderer runs with:

- `contextIsolation: true`
- `nodeIntegration: false`
- safe preload bridge
- navigation/window-open restrictions

## Network

The desktop app calls only:

- Riot local Live Client Data API on `127.0.0.1:2999`;
- local Ollama on `127.0.0.1:11434` when enabled;
- configured cloud API URL when OpenAI/hybrid mode is enabled.
