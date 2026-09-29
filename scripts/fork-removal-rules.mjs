#!/usr/bin/env node
/**
 * fork 移除不变量的规则表（数据），扫描逻辑在 check-fork-removals.mjs。
 *
 * 拆开的原因：规则会随二开功能增长，跟扫描器混在一个文件里迟早撞上仓库的 max-lines(400)
 * 上限；两者职责也确实不同——这里是「哪些东西不许回来」，那里是「怎么扫」。
 *
 * 注意：本文件以字面量形式写着被移除的符号名，所以必须列进扫描器的 IGNORED_FILES，
 * 否则 absentPatterns 每次都会命中它自己。
 */

/**
 * 规则类型：
 * - absentFiles：这些路径必须不存在（被删除的文件不许复活）。
 * - absentPatterns：这些正则不许在任何被扫描文件中命中（被移除的符号/接口/端点不许复活）。
 * - absentPatternsInFile：这些正则不许在**指定文件**里命中。用于「代码保留为死代码、但入口必须缺席」的移除：
 *   此时被移除的符号名仍写在那个死代码文件里，全局缺席规则没法用，只能按路径钉。
 * - requiredFiles：这些路径必须存在（我们的实现不许被上游版本挤掉）。
 * - requiredPatterns：在指定文件里必须命中（我们那版接线不许被上游版本覆盖）。
 */
export const REGISTRY = [
  {
    // 见 FEATURES.md 的 github-update 条目与 docs/features/github-update/design.md
    featureId: "github-update",
    absentFiles: [
      {
        path: "packages/desktop/src/main/manifestUpdateProvider.ts",
        reason: "上游服务端 manifest 更新 provider，已由 GitHub Release feed 取代",
      },
      {
        path: "packages/desktop/src/main/forceUpdateGuard.ts",
        reason: "启动强更 gate，二开版本不接入上游强制下线",
      },
      {
        path: "packages/desktop/src/main/forceUpdatePrompt.ts",
        reason: "强更原生对话框，随强更 gate 一并移除",
      },
      { path: "packages/shared/src/forceUpdate.ts", reason: "强更最低版本比较，已无消费方" },
    ],
    absentPatterns: [
      { pattern: /\bmaybeBlockStartupForForceUpdate\b/, reason: "启动强更 gate 调用入口" },
      { pattern: /\brequestForceAutoUpdate\b/, reason: "强更触发的自动升级入口" },
      { pattern: /\bForceAutoUpdateState\b/, reason: "强更状态类型" },
      { pattern: /\bManifestUpdateProvider\b/, reason: "上游服务端 manifest provider" },
      { pattern: /\bgetForceUpdateConfig\b/, reason: "强更配置的 RPC 服务方法" },
      { pattern: /\bgetForceUpdateMinimalVersionFromConfig\b/, reason: "强更最低版本解析" },
      { pattern: /\bresolveForceUpdateRequirement\b/, reason: "强更判定" },
      { pattern: /\bForceUpdateConfig\b/, reason: "强更配置类型" },
      { pattern: /configs\.forceUpdate\b/, reason: "client/configs 的强更字段" },
      { pattern: /forceUpdate\.minimalVersion/, reason: "强更最低版本字段" },
      {
        pattern: /\/api\/v1\/releases\/electron\/manifest/,
        reason: "上游 Electron 更新 manifest 端点",
      },
    ],
    requiredFiles: [
      {
        path: "packages/desktop/src/main/fork/github-update/feed.ts",
        reason: "GitHub Release feed 解析（本 fork 更新源）",
      },
      {
        path: "packages/desktop/test/forkGithubUpdateFeed.test.ts",
        reason: "feed 单测",
      },
    ],
    requiredPatterns: [
      {
        path: "packages/desktop/src/main/autoUpdater.ts",
        // 必须匹配调用点而不是 import：只写符号名的话，光靠 import 行就能满足规则，
        // 上游版本把接线换掉也照样「通过」。
        pattern: /applyForkGithubUpdateFeed\(\s*autoUpdater\b/,
        reason:
          "autoUpdater 必须仍由 fork 的 GitHub feed 接线（上游版本胜出会退回服务端 manifest）",
      },
      {
        path: "packages/desktop/src/main/autoUpdater.ts",
        pattern: /resolveUpdateReleaseChannel\(\s*options\.settingService\s*\)/,
        reason: "初始化时必须按持久化的 preview 设置解析通道，否则 feed 基址与 channel 会对不上",
      },
      {
        path: "packages/desktop/electron-builder.config.js",
        pattern: /detectUpdateChannel:\s*true/,
        reason: "关掉它会让 dev 包写 latest*.yml，顶掉稳定通道的更新元数据",
      },
      {
        path: ".github/workflows/release.yml",
        pattern: /latest-mac\.yml/,
        reason: "发布流水线必须上传 macOS 更新元数据，否则客户端报找不到 channel 文件",
      },
      {
        path: ".github/workflows/release.yml",
        // 独立匹配赋值语句：只匹配 canary-build 的话，注释里的字样就能满足规则。
        pattern: /pointer_tag="canary-build"/,
        reason: "preview 通道的固定指针 Release",
      },
    ],
  },
  {
    // 见 FEATURES.md 的 webfetch-direct-return 条目与 docs/features/webfetch-direct-return/design.md。
    // 上游 WebFetch 是两段式：抽正文 → 再调一次模型压成摘要交给调用方。本 fork 取消整个加工阶段，
    // 正文直接返回，上下文封顶交给工具结果预算。
    //
    // 最危险的失败形态是「加工阶段悄悄回来」：不报错、不影响类型检查，产品表现只是每次抓取多付
    // 4~20 秒，并把正文换成一份摘要。因此这里既钉文件缺席、也钉行为缺席，还钉我们那版直返接线在位。
    //
    // 被取代的 webfetch-direct-passthrough（按阈值决定跳过/不跳过摘要）连同它的判定、剩余预算投影
    // 与单测一并退役，路径列在 absentFiles 里。
    featureId: "webfetch-direct-return",
    absentFiles: [
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch-processing.ts",
        reason: "加工阶段入口：上游版本胜出会把摘要重新接回 WebFetch",
      },
      {
        path: "apps/zcode-cli/packages/core/src/fork/webfetch-direct-passthrough/policy.ts",
        reason: "被取代功能的直通判定与字数口径",
      },
      {
        path: "apps/zcode-cli/packages/core/src/fork/webfetch-direct-passthrough/remaining-tokens.ts",
        reason: "被取代功能的剩余上下文预算投影，已无消费方",
      },
      {
        path: "apps/zcode-cli/packages/core/test/forkWebfetchDirectPassthrough.test.ts",
        reason: "被取代功能的单测",
      },
    ],
    absentPatterns: [],
    absentPatternsInFile: [
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch.ts",
        pattern: /runWithModelInvocationContext|web_fetch_processing|processFetchedContent/,
        reason:
          "WebFetch handler 不得再调用任何加工模型：上游版本胜出会让每次抓取多付一次模型往返",
      },
      {
        path: "apps/zcode-cli/packages/contracts/src/tools/webfetch.ts",
        pattern: /^\s*prompt:/m,
        reason:
          "prompt 参数必须缺席——它没有接收方，留着等于让模型传入一个会被静默忽略的字段",
      },
    ],
    requiredFiles: [
      {
        path: "apps/zcode-cli/packages/core/test/forkWebfetchDirectReturn.test.ts",
        reason: "直返正文、参数缺席与封顶配置的单测",
      },
    ],
    requiredPatterns: [
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch.ts",
        // 匹配取数而不是 import：只写符号名的话，光靠 import 行就能满足规则，
        // 上游版本把结果换成加工产物也照样「通过」。
        pattern: /result:\s*fetched\.content/,
        reason: "工具结果必须直接来自抽取正文（上游版本胜出会换成摘要产物）",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch.ts",
        pattern: /maxModelChars:\s*MAX_WEBFETCH_PERSIST_CHARS/,
        reason:
          "上下文封顶必须接在字符阈值上，否则「取消摘要」会退化成整页正文进上下文",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch.ts",
        pattern: /previewChars:\s*MAX_WEBFETCH_PERSIST_PREVIEW_CHARS/,
        reason:
          "落盘预览长度必须显式覆写为 10000 字符；上游版本胜出会退回共享信封的 2000，抓取正文被截得过短",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch-constants.ts",
        pattern: /MAX_WEBFETCH_PERSIST_CHARS\s*=\s*15_000/,
        reason: "落盘字符阈值的定义点（改值属产品决策，须同步改本规则与设计文档）",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch-constants.ts",
        pattern: /MAX_WEBFETCH_PERSIST_PREVIEW_CHARS\s*=\s*10_000/,
        reason: "落盘预览长度的定义点（同上）",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/result-persistence-format.ts",
        pattern: /previewChars\?: number/,
        reason: "共享信封必须保留 previewChars 覆写入口，否则 WebFetch 无法单独放宽预览长度",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch-constants.ts",
        pattern: /FORK\(webfetch-direct-return\)/,
        reason: "移除标记必须在位（上游整段覆盖该文件时会连同标记一起消失，正好暴露）",
      },
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/webfetch-content.ts",
        pattern: /FORK\(webfetch-direct-return\)/,
        reason: "同上",
      },
      {
        path: "apps/zcode-cli/packages/contracts/src/tools/webfetch.ts",
        pattern: /FORK\(webfetch-direct-return\)/,
        reason: "同上",
      },
    ],
  },
  {
    // 见 FEATURES.md 的 offpeak-removal 条目与 docs/features/offpeak-removal/design.md。
    // 闲时任务要云端取号服务 + Coding Plan 连接，本 fork 不接云账号、只用自定义提供商，
    // 所以工具面里不该再有它们（它们会随每一次模型请求进入上下文），入口整体撤掉。
    // 实现本身保留为死代码（文件都还在），因此用不了全局缺席规则——只能按路径钉住这三处入口。
    featureId: "offpeak-removal",
    absentFiles: [],
    absentPatterns: [],
    absentPatternsInFile: [
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/index.ts",
        // 三种真实拼写都要抓：小写开头的标识符（offPeakPort / offPeakCreateToolEntry）、
        // 大写开头的类型与字符串字面量（OffPeakCreate）、常量（OFF_PEAK_*）。
        // 故意不匹配 `offpeak-removal` 与 `off-peak.js`——前者是本功能 id，后者是保留为死代码的文件名。
        pattern: /offPeak|OffPeak|OFF_PEAK/,
        reason:
          "工具注册表不得再引用闲时工具：一旦合回上游条目，两个工具（含描述与 8 条模型指令）会重新进入每一次模型请求",
      },
      {
        path: "apps/zcode-cli/packages/core/src/runtime/helpers/runtime-tools.ts",
        pattern: /includeOffPeak/,
        reason: "运行时工具装配不得再有闲时开关（有开关就等于留了一扇能被重新打开的门）",
      },
      {
        path: "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts",
        pattern: /createProtocolOffPeakPort\(/,
        reason: "协议宿主不得再创建闲时端口：创建路径必须整体不可达",
      },
    ],
    requiredFiles: [
      {
        path: "apps/zcode-cli/packages/core/test/forkOffPeakRemoval.test.ts",
        reason: "工具面缺席与源码级不变量单测",
      },
    ],
    requiredPatterns: [
      {
        path: "apps/zcode-cli/packages/core/src/tool/handlers/index.ts",
        pattern: /FORK\(offpeak-removal\)/,
        reason: "移除标记必须在位（上游整段覆盖该文件时会连同标记一起消失，正好暴露）",
      },
      {
        path: "apps/zcode-cli/packages/core/src/runtime/helpers/runtime-tools.ts",
        pattern: /FORK\(offpeak-removal\)/,
        reason: "同上",
      },
      {
        path: "apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts",
        pattern: /FORK\(offpeak-removal\)/,
        reason: "同上",
      },
    ],
  },
];
