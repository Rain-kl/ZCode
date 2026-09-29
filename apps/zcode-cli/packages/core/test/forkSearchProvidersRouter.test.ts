import test from "node:test";
import assert from "node:assert/strict";
import type { ModelTextResult } from "@zcode/contracts";
import {
  SearchChannelsExhaustedError,
  runSearchChannels,
  type SearchChannel,
} from "../src/fork/search-providers/router.js";

const result = (text: string): ModelTextResult => ({ text, finishReason: "stop", usage: {} });
const request = { query: "q" };

function channel(
  kind: string,
  label: string,
  behaviour: () => Promise<ModelTextResult>,
): SearchChannel & { calls: number } {
  const fake = {
    kind,
    label,
    calls: 0,
    async search() {
      fake.calls += 1;
      return await behaviour();
    },
  };
  return fake;
}

test("首个成功即返回，后续渠道不被调用", async () => {
  const first = channel("server", "服务端搜索", async () => result("ok"));
  const second = channel("tavily", "工作用", async () => result("nope"));
  const outcome = await runSearchChannels({ channels: [first, second], request });
  assert.equal(outcome.result.text, "ok");
  assert.equal(outcome.channelKind, "server");
  assert.deepEqual(outcome.attempts, []);
  assert.equal(second.calls, 0);
});

test("前一个失败则降级，并把失败记进 attempts", async () => {
  const failing = channel("server", "服务端搜索", async () => {
    throw new Error("通道不支持 web_search");
  });
  const working = channel("tavily", "工作用", async () => result("from tavily"));
  const outcome = await runSearchChannels({ channels: [failing, working], request });
  assert.equal(outcome.result.text, "from tavily");
  assert.equal(outcome.channelKind, "tavily");
  assert.equal(outcome.attempts.length, 1);
  assert.equal(outcome.attempts[0]?.channelKind, "server");
  assert.equal(outcome.attempts[0]?.channelLabel, "服务端搜索");
  assert.match(outcome.attempts[0]?.reason ?? "", /通道不支持 web_search/);
});

test("全部失败抛出，并保留逐条原因与顺序", async () => {
  const a = channel("server", "服务端搜索", async () => {
    throw new Error("401 鉴权失败");
  });
  const b = channel("tavily", "工作用", async () => {
    throw new Error("超时");
  });
  await assert.rejects(
    () => runSearchChannels({ channels: [a, b], request }),
    (error: unknown) => {
      assert.ok(error instanceof SearchChannelsExhaustedError);
      assert.deepEqual(
        error.failures.map((f) => f.channelKind),
        ["server", "tavily"],
      );
      assert.match(error.message, /401 鉴权失败/);
      assert.match(error.message, /超时/);
      return true;
    },
  );
});

test("没有任何渠道时抛出而非返回空结果", async () => {
  await assert.rejects(
    () => runSearchChannels({ channels: [], request }),
    (error: unknown) => {
      assert.ok(error instanceof SearchChannelsExhaustedError);
      assert.equal(error.failures.length, 0);
      return true;
    },
  );
});

test("非 Error 抛出物也会被描述成原因，不吞掉", async () => {
  const weird = channel("tavily", "工作用", async () => {
    throw "plain string failure";
  });
  await assert.rejects(
    () => runSearchChannels({ channels: [weird], request }),
    (error: unknown) => {
      assert.ok(error instanceof SearchChannelsExhaustedError);
      assert.match(error.failures[0]?.reason ?? "", /plain string failure/);
      return true;
    },
  );
});
