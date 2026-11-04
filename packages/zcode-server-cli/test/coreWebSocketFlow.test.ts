import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { ChannelClient, Emitter, VSBuffer } from "@zcode/rpc";
import {
  IZCodeAgentService,
  ServiceCollection,
  type IZCodeAgentService as AgentService,
} from "@zcode/services";
import { V4_WIRE_PROTOCOL_VERSION } from "@zcode/shared/zcode-protocol-v4";
import { WebSocket } from "ws";
import { openLoopbackCoreBridge } from "../../fork-remote-connector/src/module.js";
import { createCoreHttpServer } from "../src/server-core/http.js";

test(
  "loopback flow reaches only its Core scope, including saturation before subscription",
  { timeout: 5000 },
  async () => {
    const updates: Array<{
      state: string;
      __zcodeTrustedV4Connection: { connectionId: string; clientMode: string };
    }> = [];
    const applied = new Emitter<void>();
    const services = new ServiceCollection().register(IZCodeAgentService, {
      async subscribeConversationV4() {
        return { ack: { subscriptionId: "subscription" } };
      },
      async unsubscribeConversationV4() {},
      async setConnectionFlowStateV4(params: (typeof updates)[number]) {
        updates.push(params);
        applied.fire();
      },
      async queryConversationCommandsV4() {
        return { commands: [] };
      },
    } as unknown as AgentService);
    const http = await createCoreHttpServer(services, {
      ingressToken: "flow-fixture",
    });
    const bridges: Awaited<ReturnType<typeof openLoopbackCoreBridge>>[] = [];
    const clients: ChannelClient[] = [];
    async function attach() {
      const bridge = await openLoopbackCoreBridge({
        host: http.host,
        port: http.port,
        ingressToken: "flow-fixture",
      });
      bridges.push(bridge);
      const incoming = new Emitter<VSBuffer>();
      const client = new ChannelClient({
        onMessage: incoming.event,
        send: (buffer) => bridge.send(buffer.buffer),
      });
      clients.push(client);
      bridge.onMessage((bytes) => incoming.fire(VSBuffer.wrap(bytes)));
      const channel = client.getChannel(IZCodeAgentService.channelName);
      await channel.call("helloConversationV4");
      await channel.call("initializeConversationV4", [
        {
          kind: "clientHello",
          protocolVersion: V4_WIRE_PROTOCOL_VERSION,
          clientId: "flow-browser",
          appVersion: "fixture",
        },
      ]);
      return { bridge, channel };
    }
    function waitForUpdate(state: string, count: number) {
      return new Promise<void>((resolve) => {
        const check = () => {
          if (updates.filter((entry) => entry.state === state).length >= count) {
            listener.dispose();
            resolve();
          }
        };
        const listener = applied.event(check);
        check();
      });
    }
    try {
      const first = await attach();
      first.bridge.setFlowState("saturated");
      await first.channel.call("subscribeConversationV4", [
        { workspacePath: "/fixture", sessionId: "first" },
      ]);
      assert.equal(updates.at(-1)?.state, "saturated");
      assert.equal(updates.at(-1)?.__zcodeTrustedV4Connection.clientMode, "web-remote-replayable");
      const firstId = updates.at(-1)!.__zcodeTrustedV4Connection.connectionId;
      const second = await attach();
      await second.channel.call("subscribeConversationV4", [
        { workspacePath: "/fixture", sessionId: "second" },
      ]);
      first.bridge.setFlowState("drained");
      await waitForUpdate("drained", 1);
      assert.equal(updates.at(-1)!.__zcodeTrustedV4Connection.connectionId, firstId);
      await assert.rejects(
        first.channel.call("setConnectionFlowStateV4", [
          { workspacePath: "/fixture", state: "saturated" },
        ]),
        /flowControlForbidden/,
      );
      // 输出暂停时普通命令查询仍能完成，控制通道不会被输出流控一起锁住。
      first.bridge.setFlowState("saturated");
      await waitForUpdate("saturated", 2);
      assert.deepEqual(
        await first.channel.call("queryConversationCommandsV4", [{ workspacePath: "/fixture" }]),
        { commands: [] },
      );
      first.bridge.close();
      await waitForUpdate("closed", 1);
      first.bridge.setFlowState("drained");
      second.bridge.setFlowState("saturated");
      await waitForUpdate("saturated", 3);
      assert.notEqual(updates.at(-1)!.__zcodeTrustedV4Connection.connectionId, firstId);
      assert.equal(
        updates.filter((entry) => entry.__zcodeTrustedV4Connection.connectionId === firstId).at(-1)
          ?.state,
        "closed",
      );
    } finally {
      for (const client of clients) client.dispose();
      for (const bridge of bridges) bridge.close();
      await http.close();
      applied.dispose();
    }
  },
);

test("text control cannot select a foreign connection or enter the binary RPC stream", async () => {
  const http = await createCoreHttpServer(new ServiceCollection(), {
    ingressToken: "flow-fixture",
  });
  try {
    for (const message of [
      "not-json",
      JSON.stringify({
        __zcodeRpcControl: "connection-flow-v1",
        state: "drained",
        connectionId: "foreign",
      }),
    ]) {
      const socket = new WebSocket(`ws://${http.host}:${http.port}/ws?token=flow-fixture`);
      await once(socket, "open");
      const closed = once(socket, "close");
      socket.send(message);
      const [code, reason] = await closed;
      assert.equal(code, 1002);
      assert.match(String(reason), /Invalid Core transport control/);
    }
  } finally {
    await http.close();
  }
});
