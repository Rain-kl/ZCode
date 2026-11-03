# 协作迁移收尾证据

本批仅收敛本功能文档、真实工作历史展开的 E2E 前置和残留开发文档引用，不新增产品状态所有者。
Task1/2/3 的实现和增量修正已分别通过规格/质量审查；Task4为 `478f3541`，桌面基础验收为
`4f264af7`。Task4最终审查结论在 implementation-plan/implementation 同批记录。

最终规范与质量均APPROVE。规范实际探针抓出的配对child具体错误丢失已单独修复并提交
`56d3fac1`：spec→正式DOM RED→56/56GREEN，原成功spawn结果不变，新旧错误随唯一child row更新。
最终质量独立UI114/114、bootstrap16/16、客户端移除契约1/1通过，无剩余开发或质量阻断。

## 最终执行

- 根 typecheck exit0；CLI32包typecheck全部通过。
- 根 lint102warnings/0errors；架构0违规；fork-removals39758文件通过，10个超过5MB按原规则跳过。
  最后P2后再跑根typecheck exit0、lint102warnings/0errors、架构0违规、removals36961文件通过
  （9个大于5MB跳过）；扫描数量受临时构建/验收文件生命周期影响，保留各次真实结果。
- CLI Lint原生pnpm入口问题用临时JS转调原pnpm后执行原检查器，实际5个max-lines错误、71warnings。
  fs1642、background-tasks942、cold-event-merge805、transcript-hydration1722、product-projection5241。
  后三者本任务确有触碰；不能全部称为无关错误。旧hydration删除172物理行，cold merge减少2行，
  未通过disable或无关大拆分掩盖检查失败。
- commit478f3541后bootstrap依赖build9/9、真实协议HTTP4/4（11.41秒）：首token前500、可见流断开、
  21次请求预算耗尽后进程仍可接续、send_message空成功与assistant信封。
- 最新Desktop/Agent构建的正式steer5/5、48.2秒（artifact165743-477）；同bundle六工具CSC01
  1/1、19秒（artifact170402-103）。测试按真实history trigger展开父completed工作历史，
  opaque child、原anchor、模型wire、nativeStop与list/wait DOM断言保持。
- 最后ordinaryfork已有自身root的reader组合晚于GUI构建，以query12/12、bootstrap448/448证明。
  UI/shared398/398，TUI25/25、CLI12/12、contracts20/20及managed/removal契约另列在client Note。

根早期typecheck曾遇用户WebDAV正在删除字段/移动文件，保留失败日志；其施工完成后实际复跑成功。
全量UT、手机GUI、Windows/Linux与全部provider协议未执行，不将协议测试冒充实机结果。
CSC01保持manual-review/pending，不能自动转正。

## 工作区与提交

用户`.gitignore`、未跟踪`codex/`、发布/WebDAV提交保留。不移动main，不把共享canary上的其他
提交合入main；仅本地提交本功能自有文件，无push/发版。FEATURES只修改codex-collaboration段，
提交前检查同文件用户修改是否已入其独立提交，避免整文件卷入无关内容。
