import test from "node:test";
import assert from "node:assert/strict";
import type { ModelTextResult } from "@zcode/contracts";
import {
  SearchChannelsExhaustedError,
  runSearchChannels,
  type SearchChannel,
  type SearchChannelRequest,
} from "../src/fork/search-providers/router.js";

const result = (text: string): ModelTextResult => ({ text, finishReason: "stop", usage: {} });
const request: SearchChannelRequest = { query: "q", maxResults: 5 };

function channel(
  kind: string,
  label: string,
  behaviour: (req: SearchChannelRequest) => Promise<ModelTextResult>,
): SearchChannel & { calls: number; receivedRequests: SearchChannelRequest[] } {
  const fake = {
    kind,
    label,
    calls: 0,
    receivedRequests: [] as SearchChannelRequest[],
    async search(req: SearchChannelRequest) {
      fake.calls += 1;
      fake.receivedRequests.push(req);
      return await behaviour(req);
    },
  };
  return fake;
}

test("首个成功即返回，后续渠道不被调用，且透传入参与返回标签", async () => {
  const first = channel("server", "服务端搜索", async () => result("ok"));
  const second = channel("tavily", "工作用", async () => result("nope"));
  const outcome = await runSearchChannels({ channels: [first, second], request });
  assert.equal(outcome.result.text, "ok");
  assert.equal(outcome.channelKind, "server");
  assert.equal(outcome.channelLabel, "服务端搜索");
  assert.deepEqual(outcome.attempts, []);
  assert.equal(first.calls, 1);
  assert.deepEqual(first.receivedRequests, [request]);
  assert.equal(second.calls, 0);
  assert.deepEqual(second.receivedRequests, []);
});

test("前一个失败则降级，并把失败记进 attempts 与透传参数", async () => {
  const failing = channel("server", "服务端搜索", async () => {
    throw new Error("通道不支持 web_search");
  });
  const working = channel("tavily", "工作用", async () => result("from tavily"));
  const outcome = await runSearchChannels({ channels: [failing, working], request });
  assert.equal(outcome.result.text, "from tavily");
  assert.equal(outcome.channelKind, "tavily");
  assert.equal(outcome.channelLabel, "工作用");
  assert.equal(outcome.attempts.length, 1);
  const [firstAttempt] = outcome.attempts;
  assert.ok(firstAttempt, "期望记录到一次失败尝试");
  assert.equal(firstAttempt.channelKind, "server");
  assert.equal(firstAttempt.channelLabel, "服务端搜索");
  assert.match(firstAttempt.reason, /通道不支持 web_search/);
  assert.deepEqual(failing.receivedRequests, [request]);
  assert.deepEqual(working.receivedRequests, [request]);
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
      if (!(error instanceof SearchChannelsExhaustedError)) {
        return false;
      }
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
      if (!(error instanceof SearchChannelsExhaustedError)) {
        return false;
      }
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
      if (!(error instanceof SearchChannelsExhaustedError)) {
        return false;
      }
      const [firstFailure] = error.failures;
      assert.ok(firstFailure, "期望记录到一次失败信息");
      assert.match(firstFailure.reason, /plain string failure/);
      return true;
    },
  );
});

test("首个渠道抛出 AbortError 时立即重抛且不降级调用后续渠道", async () => {
  const abortError = new Error("This operation was aborted");
  abortError.name = "AbortError";
  const first = channel("server", "服务端搜索", async () => {
    throw abortError;
  });
  const second = channel("tavily", "工作用", async () => result("should not be called"));

  await assert.rejects(
    () => runSearchChannels({ channels: [first, second], request }),
    (error: unknown) => {
      assert.ok(!(error instanceof SearchChannelsExhaustedError), "取消不应包装为 SearchChannelsExhaustedError");
      assert.equal(error, abortError);
      return true;
    },
  );
  assert.equal(first.calls, 1);
  assert.equal(second.calls, 0, "后续渠道不应被调用");
});

test("传入前已中断的信号直接抛出，不调用任何渠道", async () => {
  const first = channel("server", "服务端搜索", async () => result("ok"));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => runSearchChannels({ channels: [first], request: { ...request, signal: controller.signal } }),
    (error: unknown) => {
      assert.ok(!(error instanceof SearchChannelsExhaustedError), "取消不应包装为 SearchChannelsExhaustedError");
      if (error instanceof Error) {
        assert.equal(error.name, "AbortError");
      }
      return true;
    },
  );
  assert.equal(first.calls, 0, "任何渠道均不应被调用");
});

test("无 message 的 Error 回退到 name 作为原因", async () => {
  const nameless = channel("server", "服务端搜索", async () => {
    throw new TypeError("");
  });
  await assert.rejects(
    () => runSearchChannels({ channels: [nameless], request }),
    (error: unknown) => {
      if (!(error instanceof SearchChannelsExhaustedError)) {
        return false;
      }
      const [firstFailure] = error.failures;
      assert.ok(firstFailure, "期望记录到一次失败信息");
      assert.equal(firstFailure.reason, "TypeError");
      return true;
    },
  );
});

test("抛出非 Error 普通对象时通过 JSON 序列化保留上下文", async () => {
  const plainObject = channel("tavily", "工作用", async () => {
    throw { code: 429, detail: "rate limit" };
  });
  await assert.rejects(
    () => runSearchChannels({ channels: [plainObject], request }),
    (error: unknown) => {
      if (!(error instanceof SearchChannelsExhaustedError)) {
        return false;
      }
      const [firstFailure] = error.failures;
      assert.ok(firstFailure, "期望记录到一次失败信息");
      assert.match(firstFailure.reason, /"code":429/);
      assert.match(firstFailure.reason, /"detail":"rate limit"/);
      return true;
    },
  );
});
