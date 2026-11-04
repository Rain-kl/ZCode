# 自建 Relay 部署与运行

本页是操作清单，不把未执行的公网验收写成已通过。所有命令从仓库根目录执行，Node 版本以 `mise.toml` 为准。

## 1. 构建并部署 Worker

Worker 的 `assets.directory` 指向 `packages/web/dist`，因此必须先构建 Web：

```sh
pnpm --filter @zcode/web build
pnpm --filter @zcode/fork-remote-relay exec wrangler deploy --config wrangler.jsonc
```

`wrangler.jsonc` 当前是一个 Worker 名称和一套 DO migration。staging 与 production 必须使用不同 Worker 名称、Cloudflare 账号或部署配置，不能共享 DO namespace 后误以为数据隔离。自定义域名必须启用 TLS；`zcode server connect` 只接受 HTTPS，`http://localhost` 仅用于本机调试。

部署前确认 Web 构建产物属于当前提交；旧 `packages/web/dist` 可能让页面能打开但缺少本次登录入口。

## 2. 设置单租户认证

在安全终端中生成密码哈希，密码从 stdin 提供，不放进 argv、Shell 历史、Git 或聊天：

```sh
read -s -p "Relay password: " ZCODE_RELAY_PASSWORD; echo
(
  cd packages/fork-remote-relay
  printf '%s\n' "$ZCODE_RELAY_PASSWORD" | ../../node_modules/.bin/tsx scripts/password-hash.ts
)
unset ZCODE_RELAY_PASSWORD
```

将输出的 PBKDF2 哈希作为 `AUTH_PASSWORD_HASH`，再设置至少 32 字节随机 `AUTH_SECRET`、固定 `AUTH_USERNAME` 和 `AUTH_EPOCH`。使用 Wrangler secret 或等价的受管 secret 注入，不要把生产值写进 `wrangler.jsonc`、`--var`、Shell 脚本或日志。例如：

```sh
pnpm --filter @zcode/fork-remote-relay exec wrangler secret put AUTH_USERNAME --config wrangler.jsonc
pnpm --filter @zcode/fork-remote-relay exec wrangler secret put AUTH_PASSWORD_HASH --config wrangler.jsonc
pnpm --filter @zcode/fork-remote-relay exec wrangler secret put AUTH_SECRET --config wrangler.jsonc
pnpm --filter @zcode/fork-remote-relay exec wrangler secret put AUTH_EPOCH --config wrangler.jsonc
```

`AUTH_EPOCH` 是唯一的会话撤销开关：轮换 epoch 后，已经签发的浏览器与 Server 会话全部失效，需要重新登录。`AUTH_SECRET` 少于 32 字节会导致认证失败。Worker 当前不提供账号注册或管理后台，单租户值由部署者维护。

## 3. Server 配置与启动

在云主机安装可用的 ZCode Server 运行包，并预先配置模型 provider。远程控制不开放 ZCode 入站端口，也不需要 Cloudflare Tunnel；Server 只主动发出 HTTPS/WSS。

独立安装（Linux/macOS x64/arm64；curl、Python 3.8+；使用随包 Node）：

```sh
# 默认正式版；当前最新正式版无 Server companion 时明确失败
curl -fsSL https://raw.githubusercontent.com/Rain-kl/ZCode/canary/scripts/install-server.sh | sh
# 开发版
curl -fsSL https://raw.githubusercontent.com/Rain-kl/ZCode/canary/scripts/install-server.sh | sh -s -- dev
export PATH="$HOME/.local/bin:$PATH"
```

安装器与 SSH 共用 `~/.zcode/server` 的安装、版本指针和稳定入口，`~/.local/bin/zcode` 只做转发。安装不配置 Relay，新装不启动服务；更新沿用既有任务保护、降级检查与空闲实例重启流程，不传 force 参数。需要停止窗口时先 down、安装后再 up。旧脚本的命令可迁移，旧运行包和业务数据保留，其他来源的 zcode 不覆盖。详细合同见 [server-installer.md](../../specs/server-installer.md)。

交互配置：

```sh
zcode server connect
zcode server up
```

非交互配置：

```sh
printf '%s\n' "$RELAY_PASSWORD" |
  zcode server connect --url https://relay.example.com --username owner --password-stdin
zcode server up -d
```

密码不要出现在命令行；上例中的变量应由受管 secret/受限环境提供。`connect` 成功后配置位于 canonical server-root 的 `config/remote-connection.json`，密码不落盘。修改 endpoint 或账号前先执行 `zcode server down`，再重新 `connect`，然后启动。

常用查看和停止：

```sh
zcode server logs
zcode server logs -f
zcode server down
```

`logs -f` 的 Ctrl+C 只退出日志跟踪，不停止 Server。`down` 会停止远控 connector、Core 和该实例的生命周期；不会删除项目、会话、配置或历史日志。

## 4. 部署后检查

按顺序检查：

1. `https://<relay>/` 重定向到 `/remote/v4`，且该路径返回当前 Web SPA；
2. 一个带哈希的 `/assets/...` 资源返回实际文件，而不是 HTML；
3. 未知 `/api/not-real` 返回 JSON 404；
4. 匿名、错误密码和正确账号密码的登录结果分别为 401、401、200；
5. Server 日志出现认证/登记和 `auth_ack waiting`，设备列表显示在线；
6. 手机或电脑浏览器登录、选择设备后可进入工作区并发送受控测试请求；真实模型回复必须单独实测，不能用页面能打开代替。

若只完成本地 workerd 和 Web 构建，没有公网 Worker，不得声称公网闭环已通过。若没有真机模型回复，也必须在交付说明中保留“模型和公网未验证”的边界。

## 5. 资源与安全边界

- Relay 只保存设备、票据和连接元数据，不保存任务、快照、队列或 `data.payload` 正文；
- 密码、Bearer、WS token/query、cookie、API key 不写入持久日志；
- Worker/DO 的请求量、休眠、CPU、DO 存储和资产版本需要按 Cloudflare 账户实际监测；
- 生产认证值轮换、自定义域名、TLS、备份/回滚和 Cloudflare 账户权限属于部署者责任；
- 当前版本不提供多租户、注册、组织、权限角色、通知、离线只读或 WebDAV 替换。
