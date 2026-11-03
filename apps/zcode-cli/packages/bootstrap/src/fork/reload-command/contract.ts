import type { ForkRefreshCompletedTimelinePart, MessageWithParts } from "@zcode/contracts";

/** Independent transcript carriers never open model/work turns. */
export interface ForkRefreshTimelineReader {
  completions(message: MessageWithParts): readonly ForkRefreshCompletedTimelinePart[];
}
