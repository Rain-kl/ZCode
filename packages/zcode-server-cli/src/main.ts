// FORK(local-mode): 服务端入口采用与桌面相同的上游请求门禁。
import "@zcode/shared/upstream-network-policy/node";
import { dirname } from "node:path";
// FORK(cloud-web-access): connect 的交互输入由 Server CLI 的终端边界提供。
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { runServerCli } from "./cli.js";
import { resolveBundledAgentWiring } from "./runtime/agentWiring.js";
import { createUpdateDaemonHandoff } from "./runtime/updateHandoff.js";
// FORK-BEGIN(cloud-web-access): 前台/Supervisor 共享 canonical 实例日志，启动器进程不污染日志。
import { installPersistentServerLogger } from "./fork/cloud-web-access/module.js";
import { resolveCanonicalServerLayout } from "./runtime/paths.js";
// FORK-END(cloud-web-access)

// 自动接线只作为本次 CLI 的显式依赖传入，不能污染全局 env；candidate release 启动时
// Supervisor 会按 candidate runtime 重新计算，避免继承旧 release 的 zcode.cjs。
const bundledAgentWiring = await resolveBundledAgentWiring(
  dirname(fileURLToPath(import.meta.url)),
  process.env,
);

// FORK-BEGIN(cloud-web-access): server up 和 Core 子进程共享本实例持久日志；connect 密码不进入 argv。
const cliArgs = process.argv.slice(2);
const rootIndex = cliArgs.indexOf("--server-root");
const explicitRoot = rootIndex >= 0 ? cliArgs[rootIndex + 1] : undefined;
const foregroundUp = cliArgs[0] === "server" && cliArgs[1] === "up" && !cliArgs.includes("-d");
const serveProcess =
  cliArgs[0] === "serve" && (!cliArgs.includes("--daemon") || cliArgs.includes("--supervisor"));
const disposePersistentLogger =
  foregroundUp || serveProcess
    ? await installPersistentServerLogger(await resolveCanonicalServerLayout(explicitRoot))
    : undefined;

async function promptLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive input requires a terminal");
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
}

async function promptSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive password input requires a terminal");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let password = "";
    const finish = (error?: Error): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    };
    const onData = (chunk: string | Buffer): void => {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          finish(new Error("Interactive connect cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = Array.from(password).slice(0, -1).join("");
          continue;
        }
        if (character >= " " && character !== "\u007f") password += character;
      }
    };
    process.stdin.on("data", onData);
  });
}
// FORK-END(cloud-web-access)

// FORK-BEGIN(cloud-web-access): 公开 server 命令使用无回显密码输入，并在退出前冲刷日志。
void runServerCli(
  cliArgs,
  {
    stdout: process.stdout,
    stderr: process.stderr,
    confirm: promptLine,
    promptSecret,
  },
  {
    bundledAgentWiring,
    updateDaemonHandoff: createUpdateDaemonHandoff(),
  },
).then((exitCode) => {
  process.exitCode = exitCode;
  return disposePersistentLogger?.();
});
// FORK-END(cloud-web-access)
