# Source Server 发布

## 目标

Source Server 与 Desktop 使用同一提交计算版本，但拥有独立的构建、发布与并发队列。Server 构建完成并通过归档完整性校验后立即发布，不等待 Desktop 的 macOS、Windows、静态检查或单测。

## 通道

| 通道     | 触发条件                        | 版本                  | GitHub Release                                     |
| -------- | ------------------------------- | --------------------- | -------------------------------------------------- |
| `dev`    | 推送到 `canary`，或手动选择 dev | `<根版本>-dev.<sha8>` | 固定 tag `server-canary-build`，始终只保留当前版本 |
| `stable` | 推送 `v*.*.*` tag               | tag 去掉 `v`          | 不可变 tag `server-v<version>`                     |

开发通道的 Release 是可变下载入口。新的 canary 成功发布后替换 descriptor 与四个平台归档，并清理旧的 `server-v*-dev.*` Release 和 tag。正式版必须保持版本固定，不得覆盖已经公开的同版本内容。

## 所有权与发布顺序

- Source Server workflow 是 Server 产物的唯一发布者；Desktop workflow 不构建、不上传也不等待 Server。
- 每个 workflow 独立串行同一 ref，不共享 concurrency group，因此 Desktop 构建不会占用 Server 的发布队列。
- 版本只由触发提交与根版本确定。Desktop 和 Server 在同一 canary 提交上计算出的完整版本必须一致。
- 发布前必须验证 descriptor、四个平台集合、文件大小、SHA-256、包内版本与目标平台，并运行 Linux x64 入口冒烟。
- 开发通道先完成新 Release，再清理历史开发版；清理失败必须使发布失败，避免遗留包继续堆积。
- 正式版先以 draft 上传归档，再上传 descriptor，全部就绪后公开；已公开的正式版只允许校验和复用。

## 消费规则

- dev Desktop 与 `install-server.sh dev` 直接从 `server-canary-build` 读取 descriptor，以其中的完整 dev 版本作为待安装版本。dev 不等待 Desktop `canary-build` 更新，也不要求提交哈希相等；正式通道仍严格要求 descriptor 与客户端版本一致。
- stable Desktop 与稳定安装脚本继续从 `server-v<version>` 下载。
- 显式下载源、测试源与本地开发产物策略不变。

## Release 列表顺序

GitHub 不支持置顶 prerelease。Desktop 的 `canary-build` 与 Server 的 `server-canary-build` 每次成功发布时重新公开固定 tag 对应的 Release，使当前 canary 回到 Releases 列表前部；稳定版仍由 GitHub 的 latest 规则管理。

## 验收场景

1. canary 推送后，Server workflow 不依赖 Desktop workflow，四个平台包完成后即可更新 `server-canary-build`。
2. Desktop 任一构建或测试失败不影响已成功的 Server 发布；Server 失败也不阻塞 Desktop 自身发布判定。
3. 连续两个 canary 发布后，固定 Server Release 中只存在后一版本的 descriptor 与四个归档，旧开发版 Release/tag 已清理。
4. 同一提交重跑时可复用当前已校验的归档；不同提交必须替换开发通道内容。
5. 正式版仍拒绝覆盖同版本但不同内容的归档。
6. dev 安装脚本和 dev Desktop 只接受 descriptor 声明为合法 dev 版本的包，并把该版本传给安装器；stable 仍拒绝任何版本不一致。
