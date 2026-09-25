# Windows 皮肤启用状态链路排查

排查日期：2026-09-25。范围是 WPF 管理器及 Windows 运行时；未检查 macOS 实现，未操作本机 Codex 会话或用户配置。

## 状态来源与调用链

皮肤状态包含三类不同事实，不能由一个进程布尔值代替：

| 来源 | 记录的事实 | 不能据此推断的事实 |
| --- | --- | --- |
| `active-theme` 及暂停标记 | 用户选择的主题、期望是否暂停 | 当前窗口已经显示/卸下了该主题 |
| `state.json` | watcher 的 PID/启动时间/运行时指纹，Codex 的 port/browserId | watcher 一定还活着，或 CSS 一定已从窗口移除 |
| 经 browserId 绑定的 CDP renderer 校验 | 当前活动主题是否通过渲染校验，或皮肤是否已卸下 | watcher 是否健康、后续页面是否会持续注入 |

管理器打开时：

```text
MainWindow.Loaded
  -> RefreshStatusAsync
  -> DreamSkinService.GetStatusAsync
  -> manager-actions.ps1 -Action Status
     -> 读取活动主题、state.json、暂停标记
     -> Get-ManagerInjectorStatus：核验进程身份与运行时指纹
     -> Get-DreamSkinLiveRendererStatus：独立校验记录的浏览器会话
  -> ParseStatus
  -> UpdateStatusDisplay / ActionAvailability
```

应用选中主题时：

```text
重新读状态
  -> 身份不可核验：用户确认后走 ApplyThemeAndRecover
  -> 其他状态：CheckStartup 确认是否需要用户授权重启
     -> 如需启动/重连，保存主题时 DeferLiveApply
     -> 正常连接则实时应用并读取 rendererApplied
     -> 需要启动或实时应用未发生：StartAsync
        -> 核验 CDP / 协调旧 watcher / 启动新 watcher / 渲染校验
  -> 刷新真实状态
```

管理器退出本身未发现停止 watcher 的代码。watcher 退出也不会自动卸掉已注入的 CSS。因此，用户看到皮肤仍在，并不能证明持续注入服务仍健康。

## 已确认缺陷及修改

### 1. 保留了皮肤，却删除恢复记录

`start-dream-skin.ps1` 的启动校验失败分支，会停止新 watcher。若先前的校验结果已证明皮肤可见，`skinLooksRendered` 分支刻意让 Codex 保持打开；但原来仍删除 `state.json`。

结果是重开管理器读不到会话信息，直接返回 stopped，也失去了用原 port/browserId 检测和卸下皮肤的入口。

修改：保留可见皮肤时保留原会话记录。已停止的 PID 仍按 stale 或身份异常处理，不伪装成正常运行。带 `ResultToken` 的事务回滚若确认 Codex 已关闭且 watcher 已停止，仍清除旧记录。

### 2. 进程状态错误地阻断渲染状态检测

原 `Status` 仅在 `identity.Running` 时校验 renderer。watcher 已退出、运行时指纹过期等情况会跳过检测，而 C# 也没有读取已有的 `rendererStatus`/`rendererMessage` 字段。

修改：有记录的 port/browserId 时独立探测 renderer；进程身份检查保持不变。C# 接收并展示渲染信息。确认皮肤存在但 watcher 不健康时显示“皮肤仍在显示，需重新连接”；其他 stale 状态显示需要恢复。探测异常保留进程诊断和主题列表，不当成健康状态。

该校验要求活动主题/运行时匹配。校验失败只表示无法确认，不证明窗口绝对没有任何旧皮肤。状态文件已被旧版本删除的历史会话也无法凭空恢复其 browserId。

### 3. 恢复代码在实时应用失败后不可达

原 `ApplySelectedThemeAsync` 已判断 degraded 需要 Start，但先调用 ApplyTheme。只要 watcher 仍在、CDP 会话已失效，实时应用就会抛错，使后续 Start 根本执行不到。

修改：确认需要启动/重连后，先仅保存主题，再由启动流程协调会话。正常实时应用时读取 `rendererApplied`，避免把“watcher 在状态读取后退出，因此只保存了主题”误报成应用成功。若状态读取后连接失效，通过专用的 `DREAM_SKIN_LIVE_APPLY_FAILED` 错误分类进入一次启动恢复；校验、写文件等其他异常不被吞掉。需要重启 Codex 时继续遵守原有确认机制；先前未授权重启且连接恰好失效时，启动流程仍会拒绝强行重启并提示重试。

### 4. 暂停只更新文件，界面却可能报告成功

原 Pause 只在 watcher 被判定 Running 时卸下 renderer。watcher 退出但 CSS 仍在时，只写暂停标记便返回；UI 未读取 `rendererRemoved`，并且根据缓存状态选择暂停/继续。

修改：存在记录的浏览器会话时仍尝试经 browserId 校验的 live remove。UI 允许控制已确认仍显示的孤立皮肤，操作前重新读状态，检查 `rendererRemoved`/`rendererApplied`。继续时若 watcher 已失效，改走检查与启动流程；无法确认实际效果时不再报告成功。

## 静态审查与验证边界

- 已逐条审阅 WPF → 服务协议 → PowerShell → watcher/renderer 的调用分支，并由独立检查者复核修改。
- 已查看相关现有测试的覆盖情况；尚无本轮运行结果。
- 按项目要求，未新增/修改测试文件，未运行测试、构建、lint、类型检查、服务或可视化验证。
- 没有读取本机用户主题状态、Codex 对话或配置；不能把上述静态因果当作用户机器上的现场复现。
- 既有 CatPaw 看板被 CLI 报告 4 个错误，`work start` 预览返回 `invalid-board`；未擅自修复或改写已有任务，本文件保留本次排查与后续验证入口。

## 下一步验收

获得测试指示后，优先覆盖以下场景，再决定是否扩大验证范围：

1. 皮肤正常显示时关闭并重开管理器，状态和所选主题一致。
2. watcher 退出但 renderer 保留皮肤，重开后显示需重连，并能暂停、继续、切换主题。
3. watcher 存活但 browserId 已失效，应用其他主题能到达启动恢复；拒绝重启时不关闭 Codex。
4. 启动校验失败但可见皮肤被保留，state 仍可读且不谎报健康；确实关闭会话的事务回滚清除 state。
5. Status 与 ApplyTheme/Pause 之间 watcher 退出，不把单纯写文件报告为窗口操作成功。
6. 运行时更新、暂停标记、PID 复用、视频主题和渲染探测失败的交叉场景。

可从 `tests/ManagerTests.cs`、`tests/manager-actions.integration.ps1` 和 `windows/tests/start-verified-skin-preserved.tests.ps1` 扩展既有隔离入口。现有 stale 状态文案断言需要随新的恢复提示一起更新；本轮遵守不修改测试的约束。
