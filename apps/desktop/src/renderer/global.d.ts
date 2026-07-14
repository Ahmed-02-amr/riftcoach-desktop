import type { RiftCoachApi } from "../preload/preload";

declare global {
  interface Window {
    riftcoach?: RiftCoachApi;
  }
}
