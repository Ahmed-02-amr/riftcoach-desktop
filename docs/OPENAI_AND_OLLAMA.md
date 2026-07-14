# OpenAI and Ollama Modes

## Local Ollama

The desktop app calls the local Ollama API directly:

```text
POST http://127.0.0.1:11434/api/chat
```

The request includes `format: CoachReportJsonSchema`, so the model is asked to return a stable report object.

## OpenAI cloud proxy

The desktop app does not ship with your OpenAI API key. It calls `apps/api`, and the API server calls OpenAI.

```text
Desktop -> apps/api -> OpenAI Responses API
```

The desktop-to-api token can be stored through the app settings IPC path using Windows Credential Manager.

## Hybrid

Hybrid uses local rules and local storage, then sends structured insights to the cloud proxy. This avoids uploading raw screenshots by default.
