# RiftCoach Knowledge Context

RiftCoach v0.3.0 keeps report generation telemetry-first. The model receives the user's actual match facts and expert-rule insights first, then optional context:

1. Built-in benchmark comparisons, such as CS at 10, CS/min, vision/min, and deaths before 10 for the detected role.
2. Curated matchup/role notes, such as lane plan, danger windows, and common mistakes.
3. Optional web-search snippets when `knowledgeMode` is `web-assisted` and web enrichment is enabled. RiftCoach defaults to built-in web search, with Ollama web-search kept as an alternate provider.

The model is instructed not to invent matchup facts. Web snippets are supporting context only; player telemetry, replay metadata, and expert-system insights remain the primary evidence. Saved reports now keep their `knowledgeContext` so the desktop UI can show which web snippets, if any, were attached.

## Riot Live Client payloads

For local Ollama with `local-only` privacy mode, report and review-chat prompts can include raw Riot Live Client `/liveclientdata/allgamedata` payloads. RiftCoach keeps a 131072-token budget for raw Riot telemetry inside the larger 262144-token context target.

If every stored raw snapshot fits, the prompt receives all stored `/allgamedata` payloads. If a full match of repeated snapshots is too large, RiftCoach still includes complete raw payloads for the highest-value timestamps first: final state, player-involved combat events, objective events, 5/10/15/20 minute checkpoints, and start. The prompt also receives warnings that say how many raw snapshots were included or omitted.

The coach is instructed to treat Live Client data as sampled evidence. It may use fields Riot supplies, such as active-player champion stats, abilities, runes, player scores/items, dead/respawn state, and event payloads. It must not claim unavailable data such as camera intent, exact wave state, exact pathing between samples, or exact HP at death unless a near timestamped raw snapshot or visual bookmark supplies it.

## Role detection

RiftCoach no longer requires users to pick a role each game. The normalizer infers role from live match data using summoner spells and champion-role profiles. The Settings fallback role is only used when automatic detection remains unknown.

## Web Enrichment

Web enrichment is off by default. The recommended provider is built-in web search, which runs from the desktop app and does not require Docker, a sidecar service, or an API key.

Ollama web-search remains available as an alternate provider through `https://ollama.com/api/web_search`, which requires an Ollama API key stored locally with Electron `safeStorage`.

VOD and `.rofl` replay reviews can also be web-enriched when `knowledgeMode` is `web-assisted`. Those visual-only reports use replay-review, map-awareness, wave, vision, and positioning queries. They intentionally do not create CS/vision benchmark comparisons or matchup claims because standalone uploads do not provide stable scoreboard telemetry.

Review chat follow-ups also use built-in search. Chat searches are question-specific, so a player can push back on a review, ask for matchup/build context, or ask for a clearer next-game plan without relying on the model's stale memory.

Recommended default for production beta:

- Knowledge mode: Built-in benchmarks and matchup notes
- Web enrichment: Off unless the user explicitly opts in
- Screenshots: Off unless the user explicitly opts in
