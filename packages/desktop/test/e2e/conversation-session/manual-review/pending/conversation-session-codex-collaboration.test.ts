import {
  TID_V4_SUBAGENT_OPEN_SIDE_PANE,
  TID_V4_SESSION_PANE,
  TID_V4_BACKGROUND_WORK_CANCEL,
  TID_TOOL_SUMMARY_TRIGGER,
  testId,
} from "@zcode/shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
} from "../../../helpers/desktop-app.js";
import { attemptAllCleanup } from "../../../helpers/attempt-all-cleanup.js";
import { releaseControlledReplay } from "../../../helpers/controlled-replay.js";
import { resolveSeededReplayBaseUrl } from "../../../helpers/custom-openai-provider-store.js";
import {
  getLatestUpstreamToolResultByToolCallId,
  getUpstreamRequestEvidence,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  waitForSuccessfulToolCallByToolCallId,
  waitForToolCallBlockByToolCallId,
} from "../../../helpers/conversation-session-tool.js";
import {
  clickV4BackgroundWorkCancel,
  clickV4Stop,
  getV4BackgroundWorks,
  getV4ComposerBackgroundWorkCounts,
  getV4PaneSnapshot,
  openV4RunningBackgroundWorks,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForLatestV4CommandAck,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const TIMEOUT = 180_000;
const CHILD_PREFIX = TID_V4_SUBAGENT_OPEN_SIDE_PANE;

describe("CSC01 Codex 六工具真实子会话 pending", () => {
  before(async function () {
    this.timeout(TIMEOUT);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");
  });

  after(async () => {
    // 不等待已被 abort 移除的 gate；只释放当前真实存在的受控响应。
    await attemptAllCleanup([
      async () => {
        const base = await resolveSeededReplayBaseUrl();
        if (!base) return;
        const response = await fetch(`${base}/__e2e__/gates`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok)
          throw new Error(`CSC01 cleanup gates: HTTP ${response.status}`);
        const gates = (await response.json()) as string[];
        await attemptAllCleanup(
          gates
            .filter((id) => id.startsWith("csc-child-"))
            .map((id) => async () => {
              const released = await fetch(
                `${base}/__e2e__/release/${encodeURIComponent(id)}`,
                {
                  method: "POST",
                  signal: AbortSignal.timeout(5000),
                },
              );
              if (released.status !== 204)
                throw new Error(
                  `CSC01 cleanup release ${id}: ${released.status}`,
                );
            }),
        );
      },
      async () => {
        if ((await getV4PaneSnapshot()).canStop) await clickV4Stop();
      },
      () => browser.electron.restoreAllMocks(),
      () => clearAppData(),
    ]);
  });

  it("accepted child 独立继续、邮件安全边界、同会话续跑与单目标 Stop", async function () {
    this.timeout(TIMEOUT);
    await sendV4Prompt(
      "E2E_CSC_START: delegate the bounded child task, list agents and send its message.",
    );
    await waitForV4TimelineContaining("E2E_CSC_ROOT_ACCEPTED");
    const parent = await waitForV4Pane(
      (pane) => !pane.canStop,
      "CSC01 parent must finish while child runs",
    );
    const childSessionId = await uniqueChildSession();
    expect(childSessionId).not.toBe(parent.sessionId);
    expect((await getV4ComposerBackgroundWorkCounts())?.subagentCount).toBe(1);
    for (const [id, name] of [
      ["csc-spawn", "spawn_agent"],
      ["csc-list-first", "list_agents"],
      ["csc-send", "send_message"],
    ] as const) {
      await assertRenderedTool(
        id,
        name,
        name === "spawn_agent" ? "in_progress" : "completed",
      );
    }
    expect(await childAnchor(childSessionId)).toBe("csc-spawn");
    expect(
      (await getLatestUpstreamToolResultByToolCallId("csc-send"))?.content,
    ).toBe("");

    // 配对后的摘要主动作负责下钻；独立 disclosure 必须仍能在父会话查看实际任务正文。
    await clickTestIdByDom(testId(TID_TOOL_SUMMARY_TRIGGER, "csc-spawn"));
    await waitForV4TimelineContaining("E2E_CSC_CHILD_BOOT: bounded child task");
    expect((await getV4PaneSnapshot()).sessionId).toBe(parent.sessionId);

    await clickTestIdByDom(testId(CHILD_PREFIX, childSessionId));
    await browser.waitUntil(
      async () =>
        browser.execute(
          (panePrefix, id) => {
            const panes = [
              ...document.querySelectorAll<HTMLElement>(
                `[data-testid^="${panePrefix}-"]`,
              ),
            ];
            return panes.some(
              (pane) =>
                pane.dataset.sessionId === id &&
                pane.textContent?.includes("E2E_CSC_CHILD_STREAM"),
            );
          },
          TID_V4_SESSION_PANE,
          childSessionId,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "CSC01 exact child transcript not visible",
      },
    );

    await releaseControlledReplay("csc-child-first");
    await waitForUpstreamRequest(
      {
        includes: [
          "E2E_CSC_CHILD_STREAM_END",
          "Message Type: MESSAGE",
          "E2E_CSC_MAIL",
          "csc-child-todo",
        ],
      },
      "CSC01 child did not consume assistant mailbox at complete response boundary",
    );
    await assertMailboxEnvelope(
      "E2E_CSC_MAIL",
      "/root/worker",
      "/root",
      "csc-child-todo",
    );
    expect(
      await getLatestUpstreamToolResultByToolCallId("csc-child-todo"),
    ).toMatchObject({
      isError: false,
    });
    await waitForUpstreamRequest(
      { includes: ["csc-child-report"] },
      "CSC01 child report tool result missing",
    );
    await browser.waitUntil(
      async () =>
        ((await getV4ComposerBackgroundWorkCounts())?.subagentCount ?? 0) === 0,
      { timeout: 30_000, timeoutMsg: "CSC01 child terminal missing" },
    );
    expect((await getV4PaneSnapshot()).canStop).toBe(false);
    await browser.waitUntil(
      async () =>
        browser.execute(
          (prefix, id) =>
            [
              ...document.querySelectorAll<HTMLElement>(
                `[data-testid^="${prefix}-"]`,
              ),
            ].some(
              (pane) =>
                pane.dataset.sessionId === id &&
                pane.textContent?.includes("E2E_CSC_CHILD_FINAL"),
            ),
          TID_V4_SESSION_PANE,
          childSessionId,
        ),
      { timeout: 30_000, timeoutMsg: "CSC01 child final transcript missing" },
    );
    // 用真实请求数观察负向边界；此窗口不驱动产品状态或替代任何完成屏障。
    const idleUntil = Date.now() + 1000;
    await browser.waitUntil(
      async () => {
        const rootRequests = await getUpstreamRequestEvidence({
          includes: ["E2E_CSC_START"],
          excludes: [
            "Your canonical task name is /root/worker.",
            "Generate a concise title",
            "CRITICAL: Respond with TEXT ONLY",
            "You are now acting as the memory extraction subagent",
          ],
        });
        expect(rootRequests).toHaveLength(3);
        return Date.now() >= idleUntil;
      },
      {
        timeout: 3000,
        interval: 100,
        timeoutMsg: "CSC01 idle observation did not finish",
      },
    );

    await sendV4Prompt(
      "E2E_CSC_RESUME: follow up the same worker with the second task.",
    );
    await waitForV4TimelineContaining("E2E_CSC_ROOT_RESUMED");
    await waitForV4Pane(
      (pane) => !pane.canStop,
      "CSC01 followup parent must finish",
    );
    await assertRenderedTool("csc-followup", "followup_task");
    const completed = await waitForSuccessfulToolCallByToolCallId(
      "csc-list-completed",
      ["/root/worker"],
    );
    expect(JSON.parse(completed.output).agents).toContainEqual({
      agent_name: "/root/worker",
      agent_status: { completed: null },
    });
    expect(
      (await getLatestUpstreamToolResultByToolCallId("csc-followup"))?.content,
    ).toBe("");
    await waitForUpstreamRequest(
      {
        includes: [
          "Your canonical task name is /root/worker.",
          "E2E_CSC_CHILD_SECOND",
        ],
      },
      "CSC01 followup never reached actual child provider request",
    );
    expect(await uniqueChildSession()).toBe(childSessionId);
    expect(await childAnchor(childSessionId)).toBe("csc-spawn");
    await openV4RunningBackgroundWorks();
    let workId = "";
    await browser.waitUntil(
      async () => {
        const work = await getV4BackgroundWorks();
        if (work.length !== 1 || !work[0]) return false;
        workId = work[0].workId;
        return Boolean(workId);
      },
      {
        timeout: 30_000,
        timeoutMsg: "CSC01 same child running control missing",
      },
    );
    expect(await clickV4BackgroundWorkCancel(workId)).toBe(true);
    expect(
      (await waitForLatestV4CommandAck("cancelBackgroundWork")).status,
    ).toBe("accepted");
    await browser.waitUntil(
      async () =>
        ((await getV4ComposerBackgroundWorkCounts())?.subagentCount ?? 0) === 0,
      { timeout: 30_000, timeoutMsg: "CSC01 native child Stop did not settle" },
    );

    await sendV4Prompt(
      "E2E_CSC_INSPECT: inspect the interrupted worker, list and wait, then finish.",
    );
    await waitForV4TimelineContaining("E2E_CSC_ROOT_INSPECTED");
    for (const [id, name] of [
      ["csc-interrupt", "interrupt_agent"],
      ["csc-list-final", "list_agents"],
      ["csc-wait", "wait_agent"],
    ] as const) {
      await assertRenderedTool(id, name);
    }
    await waitForSuccessfulToolCallByToolCallId("csc-interrupt", [
      "interrupted",
    ]);
    await waitForSuccessfulToolCallByToolCallId("csc-list-final", [
      "/root/worker",
      "interrupted",
    ]);
    expect(await uniqueChildSession()).toBe(childSessionId);
    expect((await getV4PaneSnapshot()).sessionId).toBe(parent.sessionId);
    await waitForUpstreamRequest(
      { includes: ["E2E_CSC_REPORT", "Message Type: MESSAGE", "csc-followup"] },
      "CSC01 idle root mailbox or followup result missing",
    );
    await assertMailboxEnvelope(
      "E2E_CSC_REPORT",
      "/root",
      "/root/worker",
      "csc-followup",
    );
  });
});

async function childAnchor(childSessionId: string): Promise<string | null> {
  return browser.execute(
    (prefix, id) =>
      document
        .querySelector(`[data-testid="${prefix}-${id}"]`)
        ?.closest<HTMLElement>("[data-tool-call-id]")?.dataset.toolCallId ??
      null,
    CHILD_PREFIX,
    childSessionId,
  );
}

async function assertRenderedTool(
  id: string,
  name: string,
  status: "completed" | "in_progress" = "completed",
): Promise<void> {
  await waitForSuccessfulToolCallByToolCallId(id);
  await waitForToolCallBlockByToolCallId(id);
  const view = await browser.execute(
    (callId, cancelPrefix, childPrefix) => {
      const row = document.querySelector<HTMLElement>(
        `[data-tool-call-id="${callId}"]`,
      );
      return row
        ? {
            visible: row.checkVisibility(),
            name: row.dataset.toolName,
            status: row.dataset.status,
            stop: Boolean(
              row.querySelector(
                `.lucide-circle-stop,[data-testid^="${cancelPrefix}-"]`,
              ),
            ),
            child: Boolean(
              row.querySelector(`[data-testid^="${childPrefix}-"]`),
            ),
          }
        : null;
    },
    id,
    TID_V4_BACKGROUND_WORK_CANCEL,
    CHILD_PREFIX,
  );
  expect(view).toMatchObject({ visible: true, name, status });
  if (name === "list_agents" || name === "wait_agent")
    expect(view).toMatchObject({ stop: false, child: false });
}

async function assertMailboxEnvelope(
  payload: string,
  recipient: string,
  sender: string,
  callId: string,
): Promise<void> {
  const records = await getUpstreamRequestEvidence({
    includes: [payload, callId, "Message Type: MESSAGE"],
  });
  const body = records[0]?.requestJson;
  if (
    !body ||
    typeof body !== "object" ||
    !("messages" in body) ||
    !Array.isArray(body.messages)
  )
    throw new Error(`CSC01 invalid provider request for ${payload}`);
  const assistant: string[] = [];
  const user: string[] = [];
  for (const message of body.messages) {
    if (
      !message ||
      typeof message !== "object" ||
      !("role" in message) ||
      !("content" in message)
    )
      throw new Error("CSC01 invalid provider message");
    const content =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .map((block: unknown) =>
                block &&
                typeof block === "object" &&
                "text" in block &&
                typeof block.text === "string"
                  ? block.text
                  : "",
              )
              .join("\n")
          : "";
    if (message.role === "assistant") assistant.push(content);
    if (message.role === "user") user.push(content);
  }
  const envelope = `Message Type: MESSAGE\nTask name: ${recipient}\nSender: ${sender}\nPayload:\n${payload}`;
  expect(assistant.join("\n").split(envelope)).toHaveLength(2);
  expect(user.join("\n")).not.toContain(payload);
}

async function uniqueChildSession(): Promise<string> {
  // 父轮结束可折叠工作历史；现有 helper 通过真实点击展开，身份仍只取实际 child 摘要。
  await waitForToolCallBlockByToolCallId("csc-spawn");
  let ids: string[] = [];
  await browser.waitUntil(
    async () => {
      ids = await browser.execute(
        (prefix) => [
          ...new Set(
            [
              ...document.querySelectorAll<HTMLElement>(
                `[data-testid^="${prefix}-"]`,
              ),
            ].map((element) =>
              (element.dataset.testid ?? "").slice(prefix.length + 1),
            ),
          ),
        ],
        CHILD_PREFIX,
      );
      return ids.length === 1 && Boolean(ids[0]);
    },
    {
      timeout: 30_000,
      timeoutMsg: "CSC01 expected exactly one actual child session",
    },
  );
  if (!ids[0]) throw new Error("CSC01 missing child session after readiness");
  return ids[0];
}
