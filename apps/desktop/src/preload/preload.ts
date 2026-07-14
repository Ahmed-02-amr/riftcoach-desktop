import { contextBridge, ipcRenderer } from "electron";

const api = {
  getStatus: () => ipcRenderer.invoke("status:get"),
  getRankStatus: () => ipcRenderer.invoke("rank:get-status"),
  syncRankNow: () => ipcRenderer.invoke("rank:sync-now"),
  onStatusUpdate: (callback: (status: any) => void) => {
    const listener = (_event: unknown, status: any) => callback(status);
    ipcRenderer.on("status:update", listener);
    return () => {
      ipcRenderer.removeListener("status:update", listener);
    };
  },
  onRankStatusUpdate: (callback: (status: any) => void) => {
    const listener = (_event: unknown, status: any) => callback(status);
    ipcRenderer.on("rank:update", listener);
    return () => {
      ipcRenderer.removeListener("rank:update", listener);
    };
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: any) => ipcRenderer.invoke("settings:save", settings),
  setApiToken: (token: string) => ipcRenderer.invoke("credentials:set-api-token", token),
  deleteApiToken: () => ipcRenderer.invoke("credentials:delete-api-token"),
  setWebSearchToken: (token: string) => ipcRenderer.invoke("credentials:set-web-search-token", token),
  deleteWebSearchToken: () => ipcRenderer.invoke("credentials:delete-web-search-token"),
  setRiotApiKey: (token: string) => ipcRenderer.invoke("credentials:set-riot-api-key", token),
  deleteRiotApiKey: () => ipcRenderer.invoke("credentials:delete-riot-api-key"),
  getReplaySetupStatus: () => ipcRenderer.invoke("replay:get-setup-status"),
  enableReplayApi: () => ipcRenderer.invoke("replay:enable-api"),
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  stopActiveSession: () => ipcRenderer.invoke("sessions:stop-active"),
  generateReport: (sessionId?: string) => ipcRenderer.invoke("sessions:generate-report", sessionId),
  listReports: () => ipcRenderer.invoke("reports:list"),
  getReport: (reportId: string) => ipcRenderer.invoke("reports:get", reportId),
  listReviewChatMessages: (reportId: string) => ipcRenderer.invoke("review-chat:list", reportId),
  sendReviewChatMessage: (reportId: string, content: string) => ipcRenderer.invoke("review-chat:send", reportId, content),
  listJournalEntries: () => ipcRenderer.invoke("journal:list"),
  listFrames: (sessionId: string) => ipcRenderer.invoke("visual:list-frames", sessionId),
  listObservations: (sessionId: string) => ipcRenderer.invoke("visual:list-observations", sessionId),
  listVodImports: (sessionId: string) => ipcRenderer.invoke("visual:list-vod-imports", sessionId),
  getFrameDataUrl: (filePath: string) => ipcRenderer.invoke("visual:get-frame-data-url", filePath),
  selectVod: () => ipcRenderer.invoke("visual:select-vod"),
  importVod: (sessionId: string, options?: { filePath?: string; videoStartOffsetSec?: number }) => ipcRenderer.invoke("visual:import-vod", sessionId, options),
  createVodReview: (options?: { filePath?: string; videoStartOffsetSec?: number }) => ipcRenderer.invoke("visual:create-vod-review", options),
  testOllama: (settings?: any) => ipcRenderer.invoke("providers:test-ollama", settings),
  testWebSearch: (settings?: any) => ipcRenderer.invoke("providers:test-web-search", settings),
  testRiotApi: (settings?: any) => ipcRenderer.invoke("providers:test-riot-api", settings),
  deleteLocalData: () => ipcRenderer.invoke("maintenance:delete-local-data")
};

contextBridge.exposeInMainWorld("riftcoach", api);

export type RiftCoachApi = typeof api;
