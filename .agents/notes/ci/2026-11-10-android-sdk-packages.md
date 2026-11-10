# Android SDK 初始化失败

Run 42813435573 的 Android job 129820508537 在 SDK 初始化阶段失败：默认包清单包含 tools，SDK Manager 返回 Failed to find package 'tools'，后续编译与签名步骤均未执行。

SDK 初始化现在显式选择 Platform Tools、Android 36.1 平台和 36.1.0 Build Tools。回归用例在修复前失败、修复后通过；本地按该清单运行 SDK Manager 成功。发布流程与分片契约共 15 项通过，类型检查通过，Lint 为 0 错误与 85 个既有警告。
