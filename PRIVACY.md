# Privacy Model

RiftCoach is designed so the useful coaching pipeline can run locally.

## Local-only mode

- Live snapshots stay on the user machine.
- Screenshots stay on the user machine.
- Imported VOD files and extracted VOD frames stay on the user machine.
- Standalone VOD and `.rofl` replay reviews create local session/report records from extracted or captured frames; the original video/replay file is not copied or uploaded by RiftCoach.
- `.rofl` replay reviews use the locally running League replay client and Riot's local Replay API for playback/game/render metadata.
- AI inference happens through local Ollama.

## Hybrid/cloud mode

By default, only structured match facts and ranked insights are sent to the cloud proxy. Raw screenshots, VOD files, and extracted VOD frames are not uploaded unless the user explicitly opts in.

When web enrichment is enabled, RiftCoach sends League coaching search queries to Ollama web search and saves returned source snippets in the local report JSON. Original screenshots, VOD files, and `.rofl` files are not sent to web search.

## Deletion

The desktop app exposes a local delete function for sessions, snapshots, reports, screenshots, and training goals.
