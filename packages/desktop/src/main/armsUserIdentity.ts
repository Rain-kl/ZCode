export interface ArmsUserIdentitySyncDeps {
  // FORK(local-mode): SDK 被禁用时身份写入也必须停止，否则首窗前会访问未初始化的配置。
  enabled?: boolean;
  /** 设备维度 id，直接作为 ARMS user.name 上报 */
  deviceMid: string;
  /** 写入 ARMS user 配置（默认包装 armsRum.setConfig("user", ...)） */
  setUser: (user: { name: string }) => void;
}

export interface ArmsUserIdentitySync {
  /** 将 deviceMid 写入 ARMS user.name（带去重） */
  refresh: () => void;
}

/**
 * 主进程 ARMS RUM 用户身份同步：统一以 device_mid 作为 user.name 上报。
 *
 * 不写 user.id：SDK 会把 config.user.id 在事件合并时跳过、强制改写为内部随机值，
 * 无法注入；而 user.name 不受屏蔽。又因 setConfig("user", ...) 是整体替换 user 键
 * （非字段合并），这里只传 { name }，刻意不带 id，保持与 appARMSBootstrap.init 的
 * user.name 写法一致，避免反复覆盖。
 */
export function createArmsUserIdentitySync(deps: ArmsUserIdentitySyncDeps): ArmsUserIdentitySync {
  let lastWrittenName: string | null = null;

  function refresh(): void {
    // FORK(local-mode): 使用宿主同一个遥测开关，不以吞异常掩盖 SDK 未初始化。
    if (deps.enabled === false || deps.deviceMid === lastWrittenName) {
      return;
    }
    deps.setUser({ name: deps.deviceMid });
    // FORK(local-mode): 只有成功写入才更新去重事实，失败后允许下次正常重试。
    lastWrittenName = deps.deviceMid;
  }

  return { refresh };
}
