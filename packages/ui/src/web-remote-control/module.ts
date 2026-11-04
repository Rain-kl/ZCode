// 依赖与 architecture-policy.yaml 同步；新增文件必须属于此 managed 边界。
export const webRemoteControlUiModule = {
  id: "web-remote-control-ui",
  // FORK(cloud-web-access): 远控弹层组合自建 Relay 配置表单；见 FEATURES.md 的 cloud-web-access 条目。
  requires: ["mobile-ui", "services", "shared", "ui", "cloud-web-access-ui"],
  provides: ["web-remote-control-ui"],
  publicEntrypoints: [
    "index.ts",
    "contract.ts",
    "WebRemoteControlDeviceHeader.tsx",
    "app/useWebRemoteControlAuthSync.ts",
  ],
} as const;
