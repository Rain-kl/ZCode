import type { ForkRefreshTimelineReader } from "./contract.js";

export function createEmptyRefreshTimelineReader(): ForkRefreshTimelineReader {
  return { completions: () => [] };
}
