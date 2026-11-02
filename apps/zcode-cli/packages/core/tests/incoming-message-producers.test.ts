import { describe, expect, it, vi } from "vitest";
import { MessageHistoryImpl } from "../src/agent/message-history.js";
import { persistBackgroundTaskNotificationBatch } from "../src/runtime/methods/background-notifications.js";
import { formatTaskNotification } from "../src/runtime-task/notification.js";

function runtime() {
  return {
    sessionId: "parent",
    ensureContextInitialized: vi.fn(),
    messageHistory: new MessageHistoryImpl(),
    persistSyntheticUserNoticeForSession: vi.fn(),
    sessionStore: undefined,
  };
}

describe("incoming message trusted producers", () => {
  it.each([false, true])(
    "keeps a background batch raw with one marker midTurn=%s",
    async (midTurn) => {
      const target = runtime();
      await persistBackgroundTaskNotificationBatch.call(
        target as never,
        [
          { id: "1", text: "one", traceContext: {} },
          { id: "2", text: "two", traceContext: {} },
        ] as never,
        midTurn,
      );
      expect(target.messageHistory.toRuntimeEntries()).toEqual([
        {
          message: { role: "user", content: "one\n\ntwo" },
          metadata: {
            source: "legacy_synthetic",
            inputPresentation: midTurn ? "task_notification_steer" : "task_notification",
          },
        },
      ]);
      expect(target.persistSyntheticUserNoticeForSession).toHaveBeenCalledOnce();
    },
  );
  it.each(["local_agent", "local_bash", "local_workflow", "monitor_mcp"] as const)(
    "stores only raw notification payload for %s",
    (taskType) => {
      const text = formatTaskNotification({
        taskId: "task",
        taskType,
        status: "completed",
        summary: "done",
      });
      expect(text).toMatch(/^<task-notification>/);
      expect(text).not.toContain("[SYSTEM NOTIFICATION");
    },
  );
});
