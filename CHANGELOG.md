# Changelog

## [3.17.162](https://github.com/Rain-kl/ZCode/compare/v3.16.162...v3.17.162) (2026-10-24)

- 切断匿名营销活动、广告素材及动作追踪；停用 ARMS、应用埋点和 OTLP 导出。
- 统一拦截上游账号、套餐/权益、反馈、云分享、远端灰度及要求登录的手机远控请求。
- 仅保留官方插件市场/资源、远程运行时下载及公开文档的匿名读取；Main、Host、CLI、Server、Web 和 Electron 沙箱共用默认拒绝策略与防回归守卫。

## [3.16.151](https://github.com/Rain-kl/ZCode/compare/v3.15.1...v3.16.151) (2026-10-17)

### Features

* **edit-stale-guard:** Edit/Write stale 判据优先用内容哈希 ([2dd2288](https://github.com/Rain-kl/ZCode/commit/2dd228893dc3e78a8e22db95acc8639dccd66634))
  * 误报：豁免只对严格整读生效，range Read（offset/limit）的 read-state 条目拿不到它，
  * 漏报：mtime 不前进且 size 相同时 edit.ts 直接返回「未变」且不比对内容，write.ts 的最终

* **edit-stale-guard:** 读路径补齐整文件内容哈希并写入 read-state ([2f93b11](https://github.com/Rain-kl/ZCode/commit/2f93b111019849c95cc08766799f6dad9f1527e5))
  * adapters/src/fork/edit-stale-guard/content-hash.ts：哈希的唯一定义处（sha256: 前缀），
  * text-range-reader.ts：快速路径与流式路径都给 revision 补整文件 hash（不取被切片、
  * core：ReadFileStateEntry 增可选 contentHash；Read、Bash 回填、Edit、Write 四个写入方

* **identity-preset:** context_prefix 的头/尾说明归入「注入动态提示词」开关 ([9e3850c](https://github.com/Rain-kl/ZCode/commit/9e3850c94e00593098441be5390e2b30d025c710))

* **identity-preset:** 当前日期归入「注入动态提示词」开关 ([b593401](https://github.com/Rain-kl/ZCode/commit/b5934014f776cef37e574ac6d7180660d037605d))

* **identity-preset:** 新增「注入 skills 清单」开关 ([116e0c5](https://github.com/Rain-kl/ZCode/commit/116e0c5ddb1eeffdde47a334815570fbe3a2d378))
  * 只停那条消息，不摘掉 Skill 工具——模型仍可调用，只是不知道有哪些技能。
  * context_prefix（# agentsMd + # currentDate）不受影响，它是独立的一条 meta-user 消息。

* **identity-preset:** 系统指令新增「注入动态提示词」开关 ([2a550c8](https://github.com/Rain-kl/ZCode/commit/2a550c809af45f56761aa194ab28c45ef5953618))
  * 状态归属：功能级开关落在 presets/active.json 的 injectDynamic（缺省注入）。
  * 类型拆两层：IdentityPresetContent（id/name/content）与 ResolvedIdentityPreset
  * builder 门控改为 `!hasCustomSystemPrompt && injectDynamic`；功能未启用时恒为 true，
  * 面板新增一行开关（沿用现有 SettingsRow 结构）+ 中英文案 + test-id。

* **identity-preset:** 重排系统指令面板，新建改为标题右侧小窗 ([55b781e](https://github.com/Rain-kl/ZCode/commit/55b781ea84715cd304d1af402d44937ee584203b))
  * 行统一走 SettingsRow（border-t 分隔、控件右对齐），卡片走 SettingsGroupCard
  * 表单走 SettingsFormTextarea + SettingsFormActions；原生 select 换仓库的 Select
  * 字段标签走 CommandForm 同款（label 在输入框上方），删掉 placeholder-as-label 的键
  * 总开关关闭时「当前配置」显示「ZCode 默认」且不摆徽标：关着开关却显示某个预设名
  * 配置缺失用 warning 语义色而非中性灰（DESIGN.md：语义色只用于真实语义状态）
  * 补加载骨架态（首次拉取与"确实没有配置"分开）

* **local-mode:** 删除云账号额度链路调用点，使其成为死代码 ([7c56f30](https://github.com/Rain-kl/ZCode/commit/7c56f3014247d8151dfc1ffd41c4edae632ad24a))
  * pnpm exec tsx --test .../forkLocalModeCloudUsageRemoval.test.ts → 3 passed / 0 failed
  * pnpm typecheck exit 0
  * pnpm lint 0 error（70 warnings 与改动前同基线）
  * pnpm architecture:check --changed：OK，0 violations
  * pnpm fork:check-removals：0 违规
  * 未验证：未启动应用确认日志消失（工作区有并发会话在施工，不便起 dev 构建）

* **local-mode:** 同步范围纳入用户级子代理与自定义命令 ([e0e5aaa](https://github.com/Rain-kl/ZCode/commit/e0e5aaafc5d1b38019de1055c81118102c449844))
  * agents/   子代理配置，.md/.markdown
  * commands/ 自定义斜杠命令，.md

* **local-mode:** 本地模式——去云账号 + WebDAV 配置同步 ([361b697](https://github.com/Rain-kl/ZCode/commit/361b697ec7dd7a611694f08f3e07dac43f1dd604))
  * 关闭启动登录门禁、不渲染登录页、屏蔽手动登录/登出、停用会话过期与账号断连提醒
  * 停用后台账号链路：启动静默会话恢复、JWT 失效广播、账号 provider 下发到 Agent
  * 移除左下角「连接使用 / 升级」，保留「使用统计」；模型设置不再有智谱预置卡与套餐行，
  * 自定义提供商路径完全保留（新增/编辑/删除/选择模型）
  * 远端按时间命名的 zip 备份包（zcode-YYYYMMDD-HHmmss.zip，包内 manifest + setting 白名单 + provider_config），
  * 同步引擎四分支：仅本地变→上传（内容哈希去重）、仅远端变→恢复、双变→冲突询问、无变化→跳过；
  * 恢复前自动备份当前本地配置；远端不可达不阻塞应用，状态项可重试（退避）
  * 设置 → 基础设置 → 同步：连接配置与状态、自动同步开关、保留份数、备份列表（恢复/删除）、冲突横幅
  * 首屏 WebDAV 引导（可跳过，跳过记入 fork 状态文件）；应用级冲突弹窗（以本地为准备份 /
  * 内核单测 31 passed（zip 往返、假 WebDAV 服务端上传列表下载删除与 401/404、状态机全分支、
  * pnpm typecheck / lint（70 warnings, 0 errors）/ architecture:check 全部通过
  * dev 应用 + 本地假 WebDAV 端到端：首屏引导与跳过、设置页配置→自动首份备份→云端备份→
  * AGENTS.md 新增「二开标准（Fork）」与「Git 提交规范」
  * FEATURES.md 登记 local-mode；docs/features/local-mode/{design,implementation}.md 与

* **nonstream-via-stream:** 非流式请求改由流式通道承载 ([767a707](https://github.com/Rain-kl/ZCode/commit/767a7076a0cf0a0ce7f40f48d25f323fcdd1f30d))

* **offpeak-removal:** 移除闲时任务入口，工具面不再进模型上下文 ([c2f9c50](https://github.com/Rain-kl/ZCode/commit/c2f9c501e3d453bf7fe72e8b17f66a4db5f1cb15))

* **reload-command:** /reload 覆盖设置热重载（提示词与工具注入就地生效） ([b18f96a](https://github.com/Rain-kl/ZCode/commit/b18f96a3bc5c9570d4a0995407c70b3669eeb76a))
  * 新命令 /reload：重读系统指令与工具档位，就地重建提示词前缀与工具面，下一轮起生效、
  * core：档位解析单点化到 fork/tool-modes/file-port.ts（原 bootstrap resolver 与用例迁入并删除），
  * 命令链路：命令信封 reload、intent/steer/activeTurnKind 联合扩 kind、内置帮助目录、surface、
  * 文档：FEATURES reload-command 条目、docs/features/reload-command/{design,implementation}.md、

* **reload-command:** 回执改为转录内灰字标记（对齐 /compact） ([ca7f3cf](https://github.com/Rain-kl/ZCode/commit/ca7f3cfd83990b8051a3964554d77d69b6c4d0b5))
  * 新增 ForkReloadCompleted 会话事件（payload 带 sourceCommandId）→ 产品投影落 timelineMarker
  * UI：ConversationRowView 增加分隔线渲染（刷新图标 +「已重载提示词与工具面」中英文案）；
  * 分享面：公开投影 allow-list 与只读时间线标签同步透出
  * 维护轮 TurnStarted 带 executionKind: controlOnly（0ms 控制轮不进 Agent 工时与时长推导）
  * 文档：design/implementation/决策记录 2.5 同步（首版 toast 方案被用户否决的经过与代价）

* **rpc-channel-manifest:** Initialize 握手携带已注册通道清单 ([2af92a0](https://github.com/Rain-kl/ZCode/commit/2af92a0b834c089630dde56567d9dc83f830e8b3))
  * ChannelServer 在既有的 ResponseType.Initialize 里带上已注册通道名数组，
  * registerChannel 在清单已发出且是新通道时补发清单，避免运行期新增的通道
  * ChannelClient 保存清单并暴露 channelNames() / isInitialized()；
  * 空清单按「未知」而非「全部不可用」处理：注册完成前发送会得到空清单，
  * 日志/遥测装饰器透传 channelNames，否则包一层就会让下游退回「清单未知」。

* **rpc-channel-manifest:** UI 可选服务可用性与调用时机分离 ([76a0c92](https://github.com/Rain-kl/ZCode/commit/76a0c92f3706b3ebb4ece1cc2630bd0f7420c679))
  * available 保留原语义（清单是否提供该通道），缺席即 undefined → 显示既有
  * 所有调用与订阅改由 usable（清单已到且含该通道）门控：清单到达前不发任何
  * useChannelAvailabilityReady 订阅 onDidChange：清单到达「可用」时自动重算，

* **rpc-channel-manifest:** 客户端按清单决定是否为可选服务建代理 ([c8b867e](https://github.com/Rain-kl/ZCode/commit/c8b867e084c39e7f52baa8503e2c34bac7a37b2c))
  * RemoteServiceAccess 上 IServiceAccessor 的可选成员（media-preview、
  * 用 getter 而非构造期赋值：desktop 的 deferInit 链路下 Initialize 可能晚于
  * 代理按清单引用缓存：ProxyChannel.toService 每次调用返回新对象，不缓存会让
  * 新增 channelAvailability（IChannelAvailability）给 UI 提供「可用性事实 +
  * 判定逻辑抽成纯函数 isChannelAvailable，边界与装配顺序均有单测：

* **search-providers:** host 渠道文件服务 ([648c7f9](https://github.com/Rain-kl/ZCode/commit/648c7f9f4f99ad8d8df76fce4b61b9f9aa2698f1))

* **search-providers:** Tavily 适配器与失败分类 ([899e161](https://github.com/Rain-kl/ZCode/commit/899e161c8deab2f177bba84a30ffda4277eb8b99))

* **search-providers:** WebSearch 处理器接入渠道链 ([750faca](https://github.com/Rain-kl/ZCode/commit/750facaa3483f4b11013c7d4fd9ca20325ab879b))

* **search-providers:** 搜索栏目移至 Agent 能力分组并改名网络搜索 ([aadab15](https://github.com/Rain-kl/ZCode/commit/aadab15d7899cde9a1b4dd787f98f837932416b9))

* **search-providers:** 暴露门改为渠道数 ([48221d3](https://github.com/Rain-kl/ZCode/commit/48221d351fd882dcd7c384b8d764d2273e460110))

* **search-providers:** 渠道加载器与 mtime 缓存 ([8fb8a56](https://github.com/Rain-kl/ZCode/commit/8fb8a562a251593c20f137626dbdffd8d2cfc8a2))

* **search-providers:** 渠道接口与降级路由 ([eb4bcaf](https://github.com/Rain-kl/ZCode/commit/eb4bcaf4fe0ac56b68574b2b61574c831c37f28c))

* **search-providers:** 渠道文件契约与容错解析 ([e827d7b](https://github.com/Rain-kl/ZCode/commit/e827d7bcba0c5b1553402dda0078b29256b3eaf7))

* **search-providers:** 渠道文件纳入 WebDAV 同步清单 ([5d72f25](https://github.com/Rain-kl/ZCode/commit/5d72f25bcbbba5ff3516a355fd74ccf14dc97046))

* **search-providers:** 设置页搜索栏目 ([9152a66](https://github.com/Rain-kl/ZCode/commit/9152a667d30429309f6df40fa9efafbb334f50d1))

* **theme:** 亮色主题对话区改纯白、侧边栏改 [#f7f8f9](https://github.com/Rain-kl/ZCode/issues/f7f8f9) ([9380713](https://github.com/Rain-kl/ZCode/commit/93807139f1b5abc601c0bb96a123de0620e8db2e)), closes [#f8f8f8]() [#f0f0f0]() [#f8f8f8]()

* **theme:** 首次启动默认 12px 字号 + 跟随系统主题 ([11ea210](https://github.com/Rain-kl/ZCode/commit/11ea21064da1f71bb2e90148cd2ee249a62ca7af))
  * 字号：lib/uiFontSize.ts 的 DEFAULT_UI_FONT_SIZE_PX 14 → 12，同时 styles.css 的
  * 主题：store/index.ts 与 useTheme.ts 的兜底值 zai-dark → system。两者互为兜底，
  * system 在所有主题消费点都能正确解析：resolveTheme / useResolvedThemeHeroPalette
  * 12px 恰好等于 MIN_UI_FONT_SIZE_PX，即可选区间（12–20）的下界。
  * ProviderLogo / CodingPlanEmbeddedWebviewDialog 里的 "zai-dark" 是「store context 缺席」
  * pnpm typecheck exit 0
  * pnpm lint 0 error（70 条 warning 与改动前同数，改动的 4 个文件无告警）
  * pnpm architecture:check --changed：OK，0 violations
  * pnpm fork:check-removals：0 违规
  * 未验证：未启动应用看实际首屏（工作区里有并发会话在施工，不便起 dev 构建）

* **tool-modes:** 功能组宿主存储、服务面与访问层接线 ([cf74dde](https://github.com/Rain-kl/ZCode/commit/cf74dde7b0c83988e168214eb86f86519dfc9c2d))
  * packages/desktop/src/host/fork/tool-modes/{store,service,index}.ts：
  * packages/services/src/fork/toolModes.ts：服务面 + 描述符（通道 fork-tool-modes）
  * 访问层四处接线：services 导出、accessor 字段、client 的 manifest-gated 服务

* **tool-modes:** 功能组设计文档与三档工具契约 ([922af67](https://github.com/Rain-kl/ZCode/commit/922af6730ffd8959962c44eec03634165aa6b48c))
  * docs/features/tool-modes/design.md：三档定义（极简 8 / 基础 33 / 标准 38+动态）、
  * packages/shared/src/fork/tool-modes-contract.ts：三档工具集合的唯一来源、
  * 契约测试 4 条：包含关系与去重、denylist 派生、解析回落、mcpEnabled 语义

* **tool-modes:** 档位落到 runtime 配置，并纳入 WebDAV 同步清单 ([875b282](https://github.com/Rain-kl/ZCode/commit/875b282ad4ee5abec0ca96c21b9ccc4fcf006a71))
  * bootstrap/src/fork/tool-modes.ts：读 <storageRoot>/tool-groups.json →
  * core/src/index.ts 导出 fork/tool-modes；create-app 装配后调用并记 info 日志
  * WebDAV 同步清单加一行：tool-groups.json（file-json，缺省即标准档）

* **tool-modes:** 档位选择改为三张并列卡片 ([7435b54](https://github.com/Rain-kl/ZCode/commit/7435b54e55af68e4ebc7fd12adc84eb56ba23fc5))
  * 档位全集上提到 @zcode/shared 的运行时数组 FORK_TOOL_MODES：isForkToolMode 与界面卡片列表
  * 新增 packages/ui/test/forkToolGroupsSection.test.ts：按 FORK_TOOL_MODES 断言两种语言的卡片
  * test-id 改名 settings-tool-groups-mode-select → -mode-card（按下标生成）
  * 文档同步 design/implementation/FEATURES，新增 .agents/notes/tool-modes/decisions.md

* **tool-modes:** 设置 → Agent 能力 → 功能组栏目 ([3d1adb0](https://github.com/Rain-kl/ZCode/commit/3d1adb023b1e1bc46cbf80bcc116f9fc62ff2e75))
  * ui/src/fork/tool-modes：useForkToolMode 控制器 + ToolGroupsSection
  * 接线：settingsNavigation（联合类型 + 守卫）、settingsPageConfig（agentCapabilities 组）、
  * 逐工具清单不在这里：工具名权威来源是 core 的注册表，界面只呈现档位与后果

* **webfetch-direct-passthrough:** 短正文直通，跳过加工模型 ([3c449cc](https://github.com/Rain-kl/ZCode/commit/3c449cc2c715f07ad2c0f1892678b828faece210))

* **webfetch-direct-return:** 取消摘要阶段，正文直返并改由结果预算封顶 ([d963f2f](https://github.com/Rain-kl/ZCode/commit/d963f2fabc48bd64addb990b355d0617d18b020b))

* **webfetch-direct-return:** 落盘判据改为 15000 字，预览提高到 10000 字 ([2e1a4e7](https://github.com/Rain-kl/ZCode/commit/2e1a4e7652136cd977e80279d93e6d62f273761a))
  * 落盘判据改用 entry.maxModelChars = MAX_WEBFETCH_PERSIST_CHARS = 15,000（字符）。
  * 落盘预览从共享信封的 2000 提高到 10,000 字符，且只影响 WebFetch：
  * 单测 12 例通过（新增「落盘判据是字符数 15000，字节预算不参与实际判定」与
  * 用重建后的 bundle 起新进程做端到端实测（zcode -p，新会话 sess_ee18ebb8）：
  * pnpm lint 0 error、pnpm test:unit 7 组全通过、pnpm --dir apps/zcode-cli typecheck 27/27、


### Bug Fixes

* **ci:** look up app.asar entries with the host path separator ([add03ed](https://github.com/Rain-kl/ZCode/commit/add03ed061e41c78e2b0ff2018146f98e32c2db4))
  * build the extractFile lookup path by re-joining the path segments with the host separator
  * compare archive entries after normalizing separators on both sides
  * report the archive entry count and same-basename entries when an entry is really missing
  * run the CLI only when executed directly so the helpers can be unit tested

* **identity-preset:** 修复渲染层白屏——node-only 导出不得进 @zcode/services 桶 ([78cfd9b](https://github.com/Rain-kl/ZCode/commit/78cfd9b2bfaac9cfd58ee20017713ae18ac05196)), closes [#root]()

* **identity-preset:** 修正 ReadProfilesResult 的映射类型，修复 @zcode/core 构建失败 ([3a7c2ed](https://github.com/Rain-kl/ZCode/commit/3a7c2edec4e1ef99842fb05af6be67bfc58bae71))

* **local-mode:** WebDAV 报错展开 cause 链，区分传输层失败与服务端错误状态 ([1acfa31](https://github.com/Rain-kl/ZCode/commit/1acfa31fa1121a091eadcf37a78e51933baa6507))
  * 新增 error-message.ts：describeForkWebdavError 展开 cause 链（最多 5 层，带 name/message/code，
  * webdav-client.ts 新增 WebdavTransportError：连接层失败时补上请求方法与 URL 后抛出，
  * 新增 forkWebdavErrorMessage.test.ts（4 例），钉住「消息必须能展开到最内层原因」

* **local-mode:** 连接测试失败时补一条日志 ([7b77a7f](https://github.com/Rain-kl/ZCode/commit/7b77a7fdc0ba0558a284b1867b7d90759a4da433))

* **search-providers:** shouldExposeWebSearch 改为普通形参并补全生产形态测试 ([01fae06](https://github.com/Rain-kl/ZCode/commit/01fae06082c56860e6f579329ad27ea1609b0134))

* **search-providers:** 修复中断重抛、移除可选链断言并完善错误上下文 ([2476995](https://github.com/Rain-kl/ZCode/commit/2476995f1ee6311b8a42ec5f2eacafd4fc642a46))

* **search-providers:** 修复渠道通道导入标记、补充并发测试、收紧文件权限 ([1b77265](https://github.com/Rain-kl/ZCode/commit/1b77265f5577f564c6dcc6cf004f37734645ae06))

* **search-providers:** 修复版本解析、深冻结防污染与敏感字段断言 ([224a4f1](https://github.com/Rain-kl/ZCode/commit/224a4f13c9e7e5b26d9d10c25ef76d33c75664e9))

* **search-providers:** 修复设置页搜索栏目拖拽、异常处理、草稿状态与二次确认 ([a1f56bf](https://github.com/Rain-kl/ZCode/commit/a1f56bf94fa566f58e43bfb6856c20f320037a0d))

* **search-providers:** 统一 Tavily 结果空值语义并消除测试可选链假阳性 ([057cdfb](https://github.com/Rain-kl/ZCode/commit/057cdfb433eebe934230bd0cf7a3c615f6a9190b))

* **search-providers:** 规范 WebDAV 同步清单测试的跨平台路径比对 ([c6e6cc4](https://github.com/Rain-kl/ZCode/commit/c6e6cc4bf69ed4e031f7f97cb21bf2baed535510))

* **search-providers:** 规范 WebSearch 导入标记并补齐渠道链顺序契约测试 ([35b25bc](https://github.com/Rain-kl/ZCode/commit/35b25bc4cada9eadb5a189631e9f7a31a807b21e))

* **tool-modes:** 机制改为 allowlist（denylist 会让 MCP 漏出控制） ([b75d0c2](https://github.com/Rain-kl/ZCode/commit/b75d0c269b86374190e0663d895b81e4b6cb54dc))
  * resolveForkToolModeDenylist → resolveForkToolModeAllowlist：
  * 白名单覆盖 MCP：runtime/methods/mcp.ts 把同一份 allowlist 传给 MCP 注册，
  * 设计文档同步：执行链路、机制理由、风险条款（新增工具不会自动进极简/基础，

* **tool-modes:** 补提交 create-app 的档位接线 ([451a4d9](https://github.com/Rain-kl/ZCode/commit/451a4d9a6f515cfe657bcf70b7ca5b4d29b78bc1))

* **webfetch-direct-passthrough:** 补上批量/调度层的预算透传（此前静默丢弃） ([f77f743](https://github.com/Rain-kl/ZCode/commit/f77f743b112ac202e1f40d92fa71cfd4fa710c38))

* **webfetch-direct-return:** 更正落盘预览口径，并补端到端实测记录 ([35c7c0b](https://github.com/Rain-kl/ZCode/commit/35c7c0bb8ef2b82384c731bab8512e00f0aea888))
  * design.md 增加「触发线 ≠ 预览大小」对照表并说明 32KiB 的实际意义是决定多少页面需要多走一次读文件；
  * FEATURES.md 同步更正（超限页面单次抓取的上下文代价约 2 KB）；
  * 新增单测「落盘后的模型可见预览由共享信封决定，远小于落盘触发线」钉住这条差异


### Documentation

* **edit-stale-guard:** 功能文档与 FEATURES.md 条目 ([3557618](https://github.com/Rain-kl/ZCode/commit/35576188fb0e671c11554d570e96869d854d561e))
  * docs/features/edit-stale-guard/design.md：背景、两个缺陷（含 file:line 证据与实测复现）、
  * docs/features/edit-stale-guard/implementation.md：落地位置、7 个上游文件 20 处标记清单、
  * FEATURES.md：新增 edit-stale-guard 条目（状态 / 需求背景 / 修改内容 / 修改文件 / 上游改动

* **release:** 记录作业门禁与 GitHub 跳过语义（避免 publish 再被静默判掉） ([bedf35d](https://github.com/Rain-kl/ZCode/commit/bedf35d9bcfed7e48298fed1671bc12b0fb2e6f2))
  * 无 if 的作业隐式条件是 success()，它要求依赖图上所有祖先作业成功；被跳过的
  * 三渠道判定表；新增作业只要 needs 链上可能有 skipped 就必须显式写条件
  * verify 在单测前构建 CLI 包的原因（测试 import 上游 tool 入口，exports 指向 dist）
  * 补一条边界：被跳过时整个 run 仍显示 success，判断发布要看 publish 的结论

* **rpc-channel-manifest:** 设计/实现文档与 FEATURES 登记 ([00386fe](https://github.com/Rain-kl/ZCode/commit/00386fee5ba551f9769525ce8d3cf3d15fba7301))
  * deferInit/ready() 核查结论：唯一构造点传 false，全仓穷举无生产调用方，
  * 桌面端验收是「旧 host + 新 renderer 混跑」而非全新实例复验，如实标注。
  * 上游若自带服务能力协商则整体摘除本功能，摘除范围见实现文档 §2。

* **search-providers:** 修正文档与代码不符处并统一标记统计口径 ([d11d619](https://github.com/Rain-kl/ZCode/commit/d11d61920116a006deb6f89ee7439c32fe1293cf))

* **search-providers:** 实现计划（10 个任务，TDD 分步） ([154c734](https://github.com/Rain-kl/ZCode/commit/154c734caa39187f3071c2c7e8983576fd4ea419))

* **search-providers:** 实现记录与 FEATURES 登记 ([72ad7a9](https://github.com/Rain-kl/ZCode/commit/72ad7a9ed0f3cbe98820a99f2926ad16422a7d14))

* **search-providers:** 网络搜索渠道链设计文档（服务端搜索 + Tavily 降级） ([559e70a](https://github.com/Rain-kl/ZCode/commit/559e70a5c032ab2db12bca4fb11ddf731daaf194))
  * 用户添加的多条 Tavily 渠道，自上而下降级；渠道数为 0 时不暴露 WebSearch。

* **search-providers:** 记录暴露门与执行链的判据不对称及 TOCTOU 窗口 ([d1f9d73](https://github.com/Rain-kl/ZCode/commit/d1f9d7345b26d5b3312d102beec94304c8c21fa4))

* **search-providers:** 预检修正计划里的 6 处测试缺陷 ([56efc8b](https://github.com/Rain-kl/ZCode/commit/56efc8b1e63da31a8152a6cbca901d245ad30c91))
  * Task 3：HttpClientRequest.body 是 Uint8Array，断言前必须解码
  * Task 3：去掉 as unknown as 断言
  * Task 5：shouldExposeWebSearch 需导出才可测
  * Task 6：WebSearchOutput 没有 truncated 字段（那是 WebFetch 的）
  * Task 7：测试用非空断言，违反本计划自己的约束
  * Task 9：测试 import 了未导出的 HIDDEN_SETTINGS_SECTIONS

* **tool-modes:** 回写实现记录与功能索引 ([1693277](https://github.com/Rain-kl/ZCode/commit/16932777b84e40c891955027b6d247c6a251d62c))

* **webfetch-direct-return:** 补记 bundle 重建后的产物核验 ([a86967b](https://github.com/Rain-kl/ZCode/commit/a86967bc8c4719bc63ee0e209fdeb64f60d8eb27))


### Refactorings

* **tool-modes:** 三档工具名单搬到 core，消除跨包镜像 ([727d982](https://github.com/Rain-kl/ZCode/commit/727d98295333e186eec4579c61bd8d8554ad81cb))
  * 新增 core/src/fork/tool-modes/mode-tools.ts：三档**分类**（不复制全集），
  * 新增 core/test/forkToolModeTools.test.ts：把「分类完整性」变成断言——
  * @zcode/shared 契约只留模式、状态 schema 与解析；移除工具名清单、


### Other Changes

* AGENTS.md ([035d201](https://github.com/Rain-kl/ZCode/commit/035d201081143add89bad237626d93ab763ebb1e))

* AGENTS.md ([e7b5289](https://github.com/Rain-kl/ZCode/commit/e7b5289588ef33b5ece30f0a0cccd4b34f9cd190))

* AGENTS.md ([2b5b76b](https://github.com/Rain-kl/ZCode/commit/2b5b76bfaace811bc04175f23b7b434283261db9))

* AGENTS.md ([c5ec9a5](https://github.com/Rain-kl/ZCode/commit/c5ec9a58f82a45efe4dbd5957a22e68e296fa31b))
  * 契约退化成「备份包 = manifest + 条目名 → 文本」；引擎对资源无知
  * 新增 `fork/webdav-sync/`（业务侧）：`manifest.ts` 一行一个资源（归档名 + 本地路径 +
  * WebDAV 引擎（`fork/webdav/**`）只认「条目名 → 文本」快照与一个哈希；`local-snapshot.ts`
  * 宿主注入 `resolveBase` 与快照端口，服务选项不再逐个出现具体资源路径
  * 新增同步资源现在只改清单一行（由「扩展点」测试钉住该性质）
  * 契约新增 presets 条目常量与 ForkWebdavPresetsSnapshot；备份包内容多一个可选字段
  * 打包写入 presets/active.json 与 presets/profiles/<id>.md；解包读回，无条目时不产生该字段
  * 内容哈希纳入预设正文：只改提示词也会触发上传（否则永远不上传）
  * 本地快照读/写 presets 目录：只收合法 id 的 <id>.md；恢复时整目录覆盖，
  * 读取侧校验 zip 条目名（拒嵌套路径与非法 id）；写入侧 yazl 自身拒绝 `..`
  * 宿主装配传入 presets 目录（storage root，与 agent 侧同路径）

* Makefile ([0baa473](https://github.com/Rain-kl/ZCode/commit/0baa473afbe6706aecbea3726fc602e6fde1f231))
