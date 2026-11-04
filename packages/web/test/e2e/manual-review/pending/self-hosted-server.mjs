// CWA29: real Core services, SQLite, Agent CLI and browser; only the model and Relay account are fixtures.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../../../../../..");
if (!process.env.ZCODE_CWA29_FIXTURE_ROOT) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "zcode-cwa29-"));
  const child = spawn(
    process.execPath,
    [...process.execArgv, import.meta.filename, ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        HOME: fixtureRoot,
        ZCODE_DATA_BASE_DIR: fixtureRoot,
        ZCODE_CWA29_FIXTURE_ROOT: fixtureRoot,
        ZCODE_AGENT_SERVER_COMMAND: process.execPath,
        ZCODE_AGENT_SERVER_ARGS_JSON: JSON.stringify([
          resolve(root, "apps/zcode-cli/packages/cli/dist/zcode.cjs"),
          "app-server",
          "--stdio",
        ]),
      },
    },
  );
  const [code] = await once(child, "exit");
  process.exit(code ?? 1);
}

const fixtureRoot = process.env.ZCODE_CWA29_FIXTURE_ROOT;
const artifacts = join(fixtureRoot, "artifacts");
await mkdir(artifacts, { recursive: true });
await import("@zcode/shared/upstream-network-policy/node");
const { chromium } = await import("playwright-core");
const { createServer: createViteServer } = await import("vite");
const { createFakeRelayV2 } = await import("@zcode/shared/testing/fake-relay-v2");
const { createServerHostServices, disposeServiceResourcesAndWait, getAppConfigDir } =
  await import("../../../../../services/src/node.ts");
const { IProjectService, ISourceServerWorkspaceService, ISettingService } =
  await import("../../../../../services/src/index.ts");
const { createHeadlessRemoteWorkspaceHost } =
  await import("../../../../../zcode-server-cli/src/fork/cloud-web-access/module.ts");
const { createCoreHttpServer } =
  await import("../../../../../zcode-server-cli/src/server-core/http.ts");
const { createForkRemoteConnector, openLoopbackCoreBridge } =
  await import("../../../../../fork-remote-connector/src/module.ts");
const { NodePersonalProviderConfigRepository } =
  await import("../../../../../provider-node/src/index.ts");
const {
  ProviderConfig,
  ProviderApiConfig,
  ApiKeyAccessConfig,
  ModelConfig,
  ModelPropertiesConfig,
  ModelOptionSpecsConfig,
} = await import("../../../../../provider/src/index.ts");

let modelCalls = 0;
const marker = "E2E_CWA29_MODEL_REPLY";
const model = createHttpServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body || "{}");
  modelCalls++;
  if (input.stream) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: "cwa29", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: marker }, finish_reason: null }] })}\n\n`,
    );
    response.end(
      `data: ${JSON.stringify({ id: "cwa29", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`,
    );
  } else {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "cwa29",
        choices: [{ message: { role: "assistant", content: marker }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }
});
model.listen(0, "127.0.0.1");
await once(model, "listening");
const configDir = getAppConfigDir();
const personal = new NodePersonalProviderConfigRepository({
  filePath: join(configDir, "provider_config.json"),
  pollingIntervalMs: false,
});
await personal.update((current) => ({
  ...current,
  providers: current.providers.setRule({
    providerId: "cwa29",
    providerName: "CWA29",
    config: new ProviderConfig({
      group: "standard-personal",
      access: new ApiKeyAccessConfig({ apiKey: "fixture-only" }),
      api: new ProviderApiConfig({
        type: "openai-chat-completions",
        baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
      }),
      personalModelIds: ["cwa29-model"],
    }),
  }),
  models: current.models.setExact(
    "cwa29",
    "cwa29-model",
    new ModelConfig({
      enabled: true,
      properties: new ModelPropertiesConfig({
        requiresMfjsToolSchema: false,
        contextWindow: 200000,
        inputFormat: { supportsText: true },
        outputFormat: { supportsText: true },
        supportsToolCall: true,
        supportsJsonSchemaOutput: false,
        supportsNativeWebSearch: false,
        supportsMidConversationSystem: false,
      }),
      optionSpecs: new ModelOptionSpecsConfig({
        reasoningLevel: { values: ["disabled"], map: "{}" },
        maxOutputTokens: { max: 32000, map: '{"max_completion_tokens":maxOutputTokens}' },
      }),
    }),
  ),
  defaultModelSelection: {
    providerId: "cwa29",
    modelId: "cwa29-model",
    options: { reasoningLevel: "disabled" },
  },
}));
personal.dispose();

const sourceServerId = "cwa29-server";
const { services, workspaceIdentityMapper } = await createServerHostServices({
  sourceServerId,
  zcodeBuiltinProviderConfigFilePath: resolve(
    root,
    "apps/zcode-cli/packages/cli/dist/provider/zcode-builtin.json",
  ),
});
await services.get(ISettingService).update({ locale: "en-US" });
const projects = services.get(IProjectService);
const projectPath = join(fixtureRoot, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "E2E_CWA29_FILE.txt"), "E2E_CWA29_FILE_CONTENT");
const emptyHost = process.argv.includes("--empty");
const sameRootProjects = process.argv.includes("--same-root");
let project = emptyHost
  ? undefined
  : await projects.saveProject({
      hostId: "local",
      name: "E2E_CWA29_PROJECT",
      roots: [projectPath],
    });
if (sameRootProjects)
  await projects.saveProject({
    hostId: "local",
    name: "E2E_CWA29_SECOND_PROJECT",
    roots: [projectPath],
  });
const host = createHeadlessRemoteWorkspaceHost({
  sourceServerId,
  projectService: projects,
  workspaceService: services.get(ISourceServerWorkspaceService),
  fallbackWorkspacePath: fixtureRoot,
});
services.register(IProjectService, host.projectServiceForAttachment);
const http = await createCoreHttpServer(services, {
  serverId: sourceServerId,
  ingressToken: "fixture-ingress",
  workspaceIdentityMapper,
});
let terminalConnections = 0;
let expectedTerminalConnections = Infinity;
let afterTerminalReconnect;
const relay = await createFakeRelayV2({
  users: { "fixture-jwt": "owner" },
  onMessage({ role, message }) {
    if (role === "terminal" && message.type === "auth_init") terminalConnections++;
    // 收到新连接的配对查询，说明浏览器已消费 auth_ack 并恢复了 transport。
    if (
      role === "terminal" &&
      terminalConnections >= expectedTerminalConnections &&
      message.type === "pair_status_query"
    )
      afterTerminalReconnect?.();
  },
});
const device = await (
  await fetch(`${relay.httpUrl}/api/v1/remote/device`, {
    method: "POST",
    headers: { authorization: "Bearer fixture-jwt", "content-type": "application/json" },
    body: JSON.stringify({ device_mid: "cwa29-mid" }),
  })
).json();
const connector = createForkRemoteConnector({
  endpoint: relay.httpUrl,
  sessionToken: "fixture-jwt",
  deviceSid: device.data.device_sid,
  deviceMid: "cwa29-mid",
  deviceName: "CWA29 Server",
  platform: process.platform,
  appVersion: "3.17.162",
  logger: {
    info() {},
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
  },
  ...host,
  openCoreBridge: () =>
    openLoopbackCoreBridge({ host: http.host, port: http.port, ingressToken: "fixture-ingress" }),
});
await connector.start();
const vite = await createViteServer({
  root: resolve(root, "packages/web"),
  configFile: resolve(root, "packages/web/vite.config.ts"),
  server: {
    host: "127.0.0.1",
    port: 0,
    hmr: false,
    proxy: {
      "/api/v1/remote": { target: relay.httpUrl, ws: true, changeOrigin: true },
    },
  },
  optimizeDeps: { include: ["@pierre/diffs/worker/worker.js"] },
});
await vite.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: sameRootProjects ? 1280 : 390, height: 844 },
});
await context.addInitScript(() =>
  localStorage.setItem(
    "zcode:self-hosted-remote-session",
    JSON.stringify({
      token: "fixture-jwt",
      userInfo: { id: "owner", username: "owner", displayName: "CWA29 Owner" },
    }),
  ),
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.text().includes("v4.sessions_index.scope_endpoint_mismatch"))
    errors.push(message.text());
});
try {
  await page.goto(
    `${vite.resolvedUrls.local[0]}remote/v4?sid=${device.data.device_sid}&mid=cwa29-mid&app_version=3.17.162`,
  );
  const onboarding = page.getByTestId("onboarding-page");
  await page.getByTestId("project-section").or(onboarding).first().waitFor({ timeout: 60000 });
  if (await onboarding.isVisible()) await page.keyboard.press("Escape");
  if (emptyHost) {
    await page.getByTestId("virtual-project-add").click();
    await page.getByTestId("virtual-project-name").fill("E2E_CWA29_CREATED_PROJECT");
    await page.getByTestId("virtual-project-browse").click();
    const directory = page.getByTestId("virtual-project-directory-browser");
    await directory.getByRole("button", { name: "project", exact: true }).click();
    await directory.getByTestId("directory-browser-confirm").click();
    await page.getByTestId("virtual-project-save").click();
    await page.getByTestId("project-folder-trust-confirm").click();
    await page.getByTestId("virtual-project-save").waitFor({ state: "hidden" });
    project = (await projects.readProjects()).find(
      (item) => item.name === "E2E_CWA29_CREATED_PROJECT",
    );
    assert.ok(project);
  } else {
    const row = page.locator(`[data-project-id="${project.id}"]`).first();
    await row.waitFor({ timeout: 60000 });
    await row.getByTestId("virtual-project-create-task").click();
  }
  const input = page.locator('[data-testid="v4-composer-input"][contenteditable="true"]');
  await input.waitFor({ timeout: 60000 });
  await input.fill("E2E_CWA29_FIRST_SEND");
  if (sameRootProjects) {
    // 用户已选非默认项目，刷新不能让首屏默认项目夺走草稿归属。
    await page.reload();
    await input.waitFor({ timeout: 60000 });
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="v4-composer-input"]')
        ?.textContent?.includes("E2E_CWA29_FIRST_SEND"),
    );
  }
  await input.press("Enter");
  await page.getByText(marker, { exact: true }).first().waitFor({ timeout: 60000 });
  const tree = await projects.readTree();
  assert.equal(tree.tasks.length, 1);
  assert.equal(tree.tasks[0].projectId, project.id);
  assert.equal(tree.tasks[0].workspacePath, projectPath);
  const taskId = tree.tasks[0].taskId;
  await page.screenshot({ path: join(artifacts, "reply.png") });
  await page.reload();
  const task = page.locator(`[data-session-id="${taskId}"]`).first();
  const history = page.getByText(marker, { exact: true }).first();
  await Promise.race([task.waitFor({ timeout: 60000 }), history.waitFor({ timeout: 60000 })]);
  if (!(await history.isVisible())) await task.click();
  await history.waitFor({ timeout: 60000 });
  const connectedBefore = terminalConnections;
  expectedTerminalConnections = connectedBefore + 1;
  const reconnected = new Promise((done) => {
    afterTerminalReconnect = done;
  });
  relay.disconnect({ role: "terminal", deviceSid: device.data.device_sid });
  let timeout;
  try {
    await Promise.race([
      reconnected,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Browser did not reconnect to Relay")), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    afterTerminalReconnect = undefined;
  }
  assert.ok(terminalConnections > connectedBefore);
  await input.fill("E2E_CWA29_AFTER_RECONNECT");
  await input.press("Enter");
  await page.getByText(marker, { exact: true }).nth(1).waitFor({ timeout: 60000 });
  const backHome = page.getByRole("button", { name: "Back to task home", exact: true });
  if (await backHome.isVisible()) await backHome.click();
  const files = page
    .locator(`[data-project-id="${project.id}"]`)
    .first()
    .getByTestId("virtual-project-files");
  await files.click();
  await page
    .getByTestId("workspace-file-tree-panel")
    .getByText("E2E_CWA29_FILE.txt", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(artifacts, "files.png") });
  assert.equal((await projects.readTree()).tasks.length, 1);
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify({
      taskId,
      projectId: project.id,
      modelCalls,
      terminalConnections,
      errors,
      ok: true,
    }),
  );
  console.log(`CWA29 passed; artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  await writeFile(
    join(artifacts, "failure.txt"),
    `${String(error)}\n${errors.join("\n")}\n${await page.locator("body").innerText()}`,
  );
  console.error(`CWA29 failed; artifacts: ${artifacts}`);
  throw error;
} finally {
  await browser.close();
  await vite.close();
  connector.stop();
  await relay.close();
  await http.close();
  await disposeServiceResourcesAndWait(services);
  await new Promise((done) => model.close(done));
}
