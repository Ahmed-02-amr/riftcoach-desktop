export interface RiotLiveClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface RiotGameStats {
  gameMode?: string;
  gameTime: number;
  mapName?: string;
  mapNumber?: number;
  mapTerrain?: string;
}

export interface RiotLiveClientHealth {
  reachable: boolean;
  gameTime?: number;
  error?: string;
}

export interface RiotReplayPlayback {
  time?: number;
  length?: number;
  paused?: boolean;
  seeking?: boolean;
  speed?: number;
  [key: string]: unknown;
}

export interface RiotReplayGame {
  gameTime?: number;
  gameMode?: string;
  mapName?: string;
  mapNumber?: number;
  [key: string]: unknown;
}

export interface RiotReplayRender {
  cameraMode?: string;
  cameraPosition?: unknown;
  cameraRotation?: unknown;
  fieldOfView?: number;
  [key: string]: unknown;
}

export interface RiotReplayRecording {
  recording?: boolean;
  path?: string;
  codec?: "webm" | "png" | string;
  startTime?: number;
  endTime?: number;
  currentTime?: number;
  width?: number;
  height?: number;
  framesPerSecond?: number;
  enforceFrameRate?: boolean;
  replaySpeed?: number;
  lossless?: boolean;
  [key: string]: unknown;
}

export interface RiotReplayHealth {
  reachable: boolean;
  playback?: RiotReplayPlayback;
  error?: string;
}
