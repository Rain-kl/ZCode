# Task3b review P1：等待原 command 结算再释放

独立实际 runtime probe 推进一次 setImmediate 后，发现 shutdownCollaboration 已完成而不响应 abort
的 child provider Promise 仍 pending。先前 shutdown 回归只检查 abort listener 后的微任务间隙，证据不足。
closeBrowserSession 只负责封通知/浏览器；不能把它当作 execution drain。

先更新 runtime-integration 与模块合同，再加强现有测试实际 RED：browser 已提前关闭，模型 gate 仍未释放。
另补 interrupt 紧接 followup RED：旧模型未退出时 followup 提前返回忙错误。driver 现在只持有原始
admission.run Promise 的临时资源句柄，等待成功或失败实际结算；原 run 错误仍原样返回 controller/turn。
followup 的等待在 controller 串行通道外，release 等原 command 后才调用 closeBrowserSession。
不等待 controller.finish、不产生第二 accepted/status owner、不加第二 timeout，也不吞 release cause。

再补 controller RED：dispose 调用已排队但 callback 未运行时，child 新边界仍能排到 dispose 后。
这会形成 dispose→run→controller tail 等待环。dispose 调用的同步边界现在封住普通 admission，
enqueue 即时拒绝新调用；已开始的操作继续原有序列，maintenance重试仍可执行。

实际 GREEN：runtime+protocol-runtime-shutdown 5文件45/45；controller专用include3文件54/54。
真实模型收到abort仍hold gate，跨事件循环断言browser未关闭、宿主依赖仍可用，释放后才完成关闭；
followup等待旧轮退出后实际发起第二请求，childSessionId相同。定向类型/lint/架构记录随提交。

这只修P1 drain。profile越权、整树驻留、旧公共配置清理分别在后续独立提交，不把待修项写成完成。
