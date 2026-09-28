# Windows 状态读取单元测试

在仓库根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run-status-unit-tests.ps1
```

入口只编译并运行本次状态优化相关测试，不构建安装包、不运行完整集成或可视化测试。
需要 Windows 自带的 .NET Framework C# 编译器与 Windows PowerShell 5.1。

- `StatusReadTests.cs`：验证状态与列表的独立完成/失败、保留旧数据、静默刷新、读取参数、超时配置、正常应用和失联后的重启授权。WPF 窗口不显示，脚本依赖使用临时目录中的模拟实现。
- `status-read.unit.ps1`：执行真实管理脚本的读取分支，禁止调用 Node、渲染检查和写入初始化，验证空/单项列表、损坏主题隔离，以及 `PrepareOnly` 保留事务恢复。

测试不会连接真实 Codex，也不读写用户主题库。临时文件在结束时清理。
正常 `build.ps1` 流程也已接入这些测试。五分钟超时检查验证配置值，不实际等待五分钟；这些测试不替代真实机器上的性能和应用验证。
