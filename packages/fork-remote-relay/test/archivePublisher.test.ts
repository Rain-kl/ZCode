// 将同一发布器回归加入 fork 的 node:test 发现入口；构建脚本仍可用原生 Node 独立验证。
await import(new URL("../../../scripts/fork-remote-web/archive.test.mjs", import.meta.url).href);
