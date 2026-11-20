# 测试入口

当前测试针对共享管理器与保留的平台运行时。遵循根目录 `AGENTS.md`，得到明确指示后再执行；构建入口不会自动运行这些测试。

## 共享管理器

先准备根目录依赖，使用 Node.js 22.22.2。获准后在仓库根目录执行：

```powershell
npm run test:shared
```

该命令编译共享核心，并运行共享管理器、主题库事务、worker、透明度刷新、社区和更新清单测试，覆盖协议、主题操作、社区及签名更新链路。其中有 macOS/POSIX 场景，执行 Windows 限定验证时应按实际范围选择文件并筛选用例，不能把过滤的用例当作已通过。

Dream Skin 品牌迁移的 Windows 限定命令、90 项正式回归结果及安装验证边界见 [品牌迁移验证记录](../docs/brand-migration-validation.md)。

## 平台运行时

Windows：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\tests\run-tests.ps1
```

macOS：

```bash
cd macos
npm test
```

其他运行时、选择器和发布检查的调用入口见 `.github/workflows/cross-platform-runtime.yml`。`portable-node-runtime.test.ps1` 和 `runtime-version.test.ps1` 是需要显式传入各自参数的独立检查，不能直接替代真实应用验收。

`fixtures/` 保留媒体回归所需的小型样本。自动检查结果不代表真实 Codex 的换肤效果、连接速度或完整平台兼容性已通过验收。
