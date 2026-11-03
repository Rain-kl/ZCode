# 开发渠道 Source Server 版本门

日期：2026-11-03

## 现场证据

Desktop 连接 Source Server 时提示：

```text
Source Server 3.17.162-dev.c1ea55a4 must be upgraded to at least 3.17.162-dev.cb9b2489
```

两端都处于 dev 渠道，后缀是提交哈希。`c1ea55a4` 是后生成的提交，但按 SemVer prerelease 的字符串比较会排在 `cb9b2489` 前面，因此被错误判为旧版本。安装探测在握手前先执行这条比较，握手后的 compatibility manifest 比较也使用相同排序模型。

## 决策

渠道由 Desktop compatibility manifest 的 `productVersion` 决定。产品版本为 `-dev` prerelease 时，Desktop 跳过 Source Server 最低兼容版本比较，不显示升级要求；正式版仍保持原有严格门禁。开发渠道仍要求 Server 返回 compatibility manifest，缺失时继续 fail closed，因此本次只移除不可排序的版本判断，不跳过握手协议能力检查。

## 回归

共享兼容策略先写测试：dev controller 连接更高哈希和正式版旧 Server 两种分支。实现前测试因渠道策略不存在而失败；实现后覆盖 dev 放行且不产生更新提示、正式版旧 Server 继续被判需要升级。
