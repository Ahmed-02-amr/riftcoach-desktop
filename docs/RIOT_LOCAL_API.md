# Riot Local Live Client Data API Notes

The desktop app reads only the local Live Client Data API served by the running game client during active games.

Current implementation:

```text
GET https://127.0.0.1:2999/liveclientdata/allgamedata
GET https://127.0.0.1:2999/liveclientdata/gamestats
```

The local HTTPS certificate is self-signed, so `LiveClientReader` uses an HTTPS request with `rejectUnauthorized: false` for this localhost-only integration.

RiftCoach stores the raw `/allgamedata` JSON beside each normalized snapshot. Local Ollama reviews in `local-only` privacy mode can receive those raw payloads directly, with a 131072-token raw telemetry budget. If all stored raw snapshots do not fit, the prompt includes full raw payloads for final state, player-involved combat events, objective events, lane checkpoints, and start first.

The app does not read game memory, inspect packets, automate inputs, or infer hidden information.

## League Client rank synchronization

Rank synchronization uses the League Client UX process rather than the in-game Live Client Data API. While League is open, RiftCoach discovers the installation's `lockfile`, reads its rotating localhost port and temporary password, and authenticates only to `127.0.0.1`:

```text
GET https://127.0.0.1:{temporary-port}/lol-ranked/v1/current-ranked-stats
GET https://127.0.0.1:{temporary-port}/lol-gameflow/v1/session
```

The first endpoint supplies the current Solo/Duo and Flex entries. The second identifies whether the active match is ranked and which queue it belongs to. Credentials remain in memory, are never written to RiftCoach settings, and expire whenever the League Client restarts.

RiftCoach captures a before-match snapshot when live recording begins. For ranked games it retries at approximately 15, 45, and 90 seconds after game end, stopping as soon as rank, LP, wins, losses, or provisional state changes. Normal games reuse the before-match rank and skip the retry delay. This local League Client API is separate from Riot's web developer API, so it does not require a developer key.

## Replay API

ROFL/ROFL2 metadata review does not use a local API. The file metadata envelope is parsed offline and the encrypted replay packet payload is left untouched.

The offline envelope is game data, not an image or video stream. It can provide final participant statistics, identity, champion/role, result-related fields, items, duration, patch, and replay identifiers. Visual information exists only after the League engine renders the encrypted replay packets; RiftCoach can then capture sampled frames or ask the Replay API to record WebM/PNG output.

Optional League-rendered evidence uses:

```text
GET/POST https://127.0.0.1:2999/replay/playback
GET      https://127.0.0.1:2999/replay/game
GET/POST https://127.0.0.1:2999/replay/render
GET/POST https://127.0.0.1:2999/replay/recording
```

Riot's Replay API is disabled by default. The Live Recorder's one-click setup discovers the League installation, copies `Config/game.cfg` to a timestamped backup, inserts or updates `EnableReplayApi=1` in `[General]`, and reads the file back to verify it. This setting is not needed for offline metadata reports.

## Match-v5 enrichment

When explicitly enabled, RiftCoach uses Riot Account-v1 to resolve the configured `Name#TAG` and Match-v5 to retrieve match details and timelines. The regional route is derived from the selected platform. The Riot API key is optional and stored locally with Electron safeStorage.
