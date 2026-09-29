import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FORK_SEARCH_PROVIDERS_FILE,
  FORK_SEARCH_PROVIDERS_FILE_VERSION,
  parseForkSearchProvidersFile,
  resolveForkSearchProvidersFilePath,
} from "../src/fork/search-providers-contract.js";

const good = {
  version: 1,
  channels: [{ id: "a1", kind: "tavily", label: "工作用", enabled: true, apiKey: "tvly-secret" }],
};

test("保留顺序与字段", () => {
  const { file, problems } = parseForkSearchProvidersFile(good);
  assert.deepEqual(problems, []);
  assert.equal(file.version, FORK_SEARCH_PROVIDERS_FILE_VERSION);
  assert.deepEqual(file.channels, good.channels);
});

test("缺失 enabled 默认为 true，缺失 label 默认为空串", () => {
  const { file } = parseForkSearchProvidersFile({
    version: 1,
    channels: [{ id: "a1", kind: "tavily", apiKey: "k" }],
  });
  assert.equal(file.channels[0]?.enabled, true);
  assert.equal(file.channels[0]?.label, "");
});

test("非对象输入按 0 条处理并留下问题", () => {
  const { file, problems } = parseForkSearchProvidersFile(null);
  assert.deepEqual(file, EMPTY_FORK_SEARCH_PROVIDERS_FILE);
  assert.equal(problems.length, 1);
});

test("未知版本按 0 条处理，且版本被单独回报", () => {
  const { file, problems } = parseForkSearchProvidersFile({ version: 99, channels: good.channels });
  assert.deepEqual(file.channels, []);
  assert.equal(file.version, 99);
  assert.match(problems.join("\n"), /99/);
});

test("非数字版本按 0 条处理并留痕，原样回报该版本值", () => {
  const { file, problems } = parseForkSearchProvidersFile({
    version: "99",
    channels: good.channels,
  });
  assert.deepEqual(file.channels, []);
  assert.equal(file.version, "99");
  assert.ok(problems.length > 0);
  assert.match(problems.join("\n"), /99/);
});

test("version 缺失或为 undefined 时视为当前版本正常解析", () => {
  const { file: file1, problems: problems1 } = parseForkSearchProvidersFile({
    version: undefined,
    channels: good.channels,
  });
  assert.deepEqual(problems1, []);
  assert.equal(file1.version, FORK_SEARCH_PROVIDERS_FILE_VERSION);
  assert.deepEqual(file1.channels, good.channels);

  const { file: file2, problems: problems2 } = parseForkSearchProvidersFile({
    channels: good.channels,
  });
  assert.deepEqual(problems2, []);
  assert.equal(file2.version, FORK_SEARCH_PROVIDERS_FILE_VERSION);
  assert.deepEqual(file2.channels, good.channels);
});

test("EMPTY_FORK_SEARCH_PROVIDERS_FILE 内层数组已冻结且降级路径返回全新数组", () => {
  assert.ok(Object.isFrozen(EMPTY_FORK_SEARCH_PROVIDERS_FILE));
  assert.ok(Object.isFrozen(EMPTY_FORK_SEARCH_PROVIDERS_FILE.channels));

  const { file } = parseForkSearchProvidersFile(null);
  assert.notEqual(file.channels, EMPTY_FORK_SEARCH_PROVIDERS_FILE.channels);
  file.channels.push({
    id: "fresh",
    kind: "tavily",
    label: "",
    enabled: true,
    apiKey: "k",
  });
  assert.equal(EMPTY_FORK_SEARCH_PROVIDERS_FILE.channels.length, 0);
});

test("坏条目被丢弃，好条目保留", () => {
  const { file, problems } = parseForkSearchProvidersFile({
    version: 1,
    channels: [
      { id: "ok", kind: "tavily", apiKey: "k" },
      { id: "", kind: "tavily", apiKey: "k" },
      { id: "x", kind: "brave", apiKey: "k" },
      { id: "y", kind: "tavily" },
    ],
  });
  assert.deepEqual(file.channels.map((c) => c.id), ["ok"]);
  assert.equal(problems.length, 3);
});

test("问题列表绝不包含 apiKey 或 label（避免敏感信息进日志）", () => {
  const { problems } = parseForkSearchProvidersFile({
    version: 1,
    channels: [
      { id: "y", kind: "brave", label: "confidential-label", apiKey: "tvly-do-not-leak" },
    ],
  });
  assert.ok(problems.length > 0);
  assert.ok(!problems.join("\n").includes("tvly-do-not-leak"));
  assert.ok(!problems.join("\n").includes("confidential-label"));
});

test("保留空 key 渠道：清空 key 是用户的合法状态，不是坏条目", () => {
  const { file, problems } = parseForkSearchProvidersFile({
    version: 1,
    channels: [{ id: "a1", kind: "tavily", apiKey: "" }],
  });
  assert.deepEqual(problems, []);
  assert.equal(file.channels[0]?.apiKey, "");
});

test("路径拼接只有一处实现：homedir + .zcode/cli + fork/settings.json", () => {
  assert.equal(
    resolveForkSearchProvidersFilePath("/home/u"),
    "/home/u/.zcode/cli/fork/settings.json",
  );
});
