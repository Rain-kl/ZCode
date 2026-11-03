# 子代理消息可见性与 Provider 继续边界

日期：2026-11-03

## 现象与证据

- 配对后的 `spawn_agent` 行把摘要主动作改成了打开子会话，`ToolLayout` 又在存在
  `summaryAction` 时强制关闭 disclosure，因此任务 `message` 虽已持久化并能由 renderer
  解析，用户仍没有入口查看。
- 事故会话中，异常轮次没有产生 `followup_task` 工具调用。对应 provider 响应只有普通
  text delta，没有 reasoning delta；UI 按协议把它展示成正文是正确行为。
- 异常请求以 `FINAL_ANSWER` 协作信箱的 assistant 消息结尾。消息式兼容接口把它当作
  assistant 续写前缀，随后继续输出内部计划文字，而不是开始新的工具决策。

## 决策

1. `summaryAction` 只代表摘要的业务主动作，不再改变工具详情的展开状态。配对子代理行
   同时提供“打开子会话”和“展开工具详情”两个独立控件。
2. canonical history 继续把协作信箱保存为带 provenance 的 assistant 消息；仅在 provider
   投影恰好以该消息结尾时追加一个临时 user-role system reminder，明确它不是回复前缀、
   也不是用户授权。该边界没有 `sourceEntry`，不入库且不参与真实用户索引。
3. 不根据文本长度、语言或内容猜测“思维链”，也不迁移历史正文。reasoning 与 text 仍以
   provider 的结构化流事件为唯一事实来源。

## 回归保护

- UI 契约测试用真实配对子代理上下文验证：先展开可见原始任务正文且不发生下钻，再点击
  子会话主动作。
- provider 投影测试验证尾部协作 assistant 后追加继续边界、边界不改变真实用户索引；若
  后面已有 tool/user 等输入则不重复追加。
- CSC01 Desktop 候选用例在父会话先展开 `spawn_agent` 详情核对任务正文，再打开子会话。

## 本轮验证

- Core provider 投影：59/59；UI 协作工具合同：12/12。
- `pnpm architecture:check --changed`：0 违规；`pnpm fork:check-removals`：通过。
- 根 `pnpm lint`：0 error、85 warning（均未由本次文件新增）。
- 根 `pnpm typecheck` 被未修改的 Office Xlsx、Electron plugin sandbox 与图片复制 E2E 共 6 个
  既有错误阻断；Core 在 fresh Desktop/Agent 构建链中已成功执行 `tsc`。
- CSC01 fixture checker 通过，保留 4 个既有正文 marker warning。fresh renderer 构建成功后，
  Agent bundle 在 `zcode-site-plugin` 的 `@zcode/shared/zcodeEndpoint` 解析处失败；复用已有 Agent
  bundle 再跑时又因 Electron 44.7.0 缺少 Chromium mapping 在加载 spec 前失败。因此本轮没有
  新的真实窗口 GREEN，也不将历史 artifact 当成本次源码证据。
