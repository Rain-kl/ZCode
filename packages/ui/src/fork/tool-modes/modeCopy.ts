/**
 * 工具模式卡片的中文/英文文案键。
 *
 * 为什么单独一层：卡片正文与标题只存在于 locale 文件里（渲染层 import 不到 core 的工具分类，
 * 也不该把工具名抄进来），所以「档位有没有文案」是一个跨模块的约定。键的拼法收在这里，
 * 组件与测试共用同一份，测试才能对着 `FORK_TOOL_MODES` 逐个断言——缺一条就是界面上少一张卡片
 * 的正文（formatMessage 会把键名原样吐出来），而不是编译期报错。
 *
 * 见 docs/features/tool-modes/design.md 第 8 节。
 */
import type { ForkToolMode } from "@zcode/shared";

/** 卡片标题：极简 / 基础 / 标准。 */
export function forkToolModeTitleId(mode: ForkToolMode): string {
  return `settings.toolGroups.mode.${mode}`;
}

/** 卡片正文：该档换来的工具面概述（分组名，不是逐工具清单）。 */
export function forkToolModeSummaryId(mode: ForkToolMode): string {
  return `settings.toolGroups.mode.${mode}.summary`;
}
