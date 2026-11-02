# Task3b：保留用例的最终 fixture 对齐与检查

生产修复已在e9bef5e5稳定，整批spec已批准，quality仍在进行。本批仅修测试和记录，无生产逻辑改动。

最终43文件首轮实际536pass/6fail。三scope persistent-memory fixture仍为自定义profile请求Grep，
但父默认embedded目录没有Grep，按已审批权限交集合同只能提供Write。将额外工具标记改父实际Bash，
同步父可见Tools:Bash,Write文本断言。保留三scope精确memory prompt、真实Write调用与落盘内容、
Edit/Read排除和目录创建断言。TaskOutput契约精确字符串移除旧Agent/remote子任务指导，保留非子任务
Bash/workflow能力、输入schema/default/错误边界。不恢复旧工具，不削弱任何Write实执行验证。

RED已是首轮完整真实失败；修后两文件13/13GREEN。首轮另外两个Workflow失败（5秒timeout、spy0）
在无并发build独立2/2PASS、测试0.894s，未延长timeout/改变产品。扩大复跑为539pass/3fail，其3项在
最后文本断言改动前已加载旧模块，由精确13项GREEN覆盖；不为凑同一次全绿而重复42已绿文件。

最终其余证据：CLI typecheck32/32，根typecheck0exit，根lint102warning0error，架构0违规，removal
guard36816文件PASS。public/controller专用include6文件57/57；Bash封口+普通fork隔离2/2（其余158skip），
prompt recorder实际node:test5/5。完整CLI lint真实3max-lines errors/71warnings，未伪写通过。
根统一build/http，不在本子任务重复，实际OpenAI4cases范围仍非Anthropic/完整六工具GUI全生命周期。

精确日志：/tmp/zcode-task3b-final-{review-tests,review-tests-green,fixture-green,workflow-isolated,
public-tests,bash-fork,prompt-recorder,cli-types,root-types,root-lint,cli-lint,architecture,removals}.log。
完整37路径选择在/tmp/zcode-task3b-final-review-tests.txt；源码与测试精确151owned路径由7个scoped
commits集合生成/tmp/zcode-task3b-review-files.txt（避免混入共享分支用户release提交）。本批后为153路径。

未覆盖与已知旧产品失败继续引用初批Note，不为本迁移恢复WebFetch/OffPeak/SearchChannel旧合同。
仅显式暂存自己文件，用户.gitignore与codex/保留；不推送。
