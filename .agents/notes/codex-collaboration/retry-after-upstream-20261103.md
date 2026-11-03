# Retry-After 上游等待边界对齐

2026-11-03 用户授权供应商 Retry-After 依照上游接受5分钟；保留原21请求物理预算和普通指数退避30秒，不盲改原全局普通间隔常量。单独新增最大hint常量和共享判据，runner/governor单向依赖contracts，避免第二层准入仍夹30秒或接受超长原始值。

合法hint为有限0..300000ms，与普通maxDelay配置独立；保留上游正向jitter min(20%,5000ms)，实际最高305秒。超过5分钟的hint一律回普通退避，即使未封顶指数值更大；governor只对合法正数hint设cooldown，不再按无限原始值冻结。原始事件诊断不改，quota stop不进入cooldown的分流不改，wait_agent不改。

先文档/测试，RED runner4+governor3，GREEN adapter235/235+governor48/48，contracts构建与adapter/bootstrap tsc通过。定向lint0错误6存量警告。所有普通上限常量消费者已检查。未新增依赖/owner，兼容公开contracts入口。

扩展10个adapter文件413/413通过：包括generate业务错误41秒与stream业务错误37秒的实际退避事件及fake clock，普通退避/21预算回归保留。真实Electron FRR01后续独立发现已有refresh marker在runtime restart冷恢复丢失，此为缺少durable transcript写入，不是Retry-After变更；父已知并暂停持久化实现待用户架构决断。
