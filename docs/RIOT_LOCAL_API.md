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
