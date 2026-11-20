# macOS 应用交付说明

当前源码交付物是包含 `Dream Skin.app` 的 DMG，或应用 ZIP；签名更新 ZIP 为兼容旧客户端保留 `Codex Dream Skin.app` 内层目录。旧发布包的名字不会随源码修改。只分发完整应用；业务核心、平台引擎与 Node 均随应用打包。

## 给使用者

1. 从项目 Releases 下载适合设备的 DMG，按发布的 SHA-256 核对下载文件。
2. 先退出旧版本管理器，再将 `Dream Skin.app` 放入 Applications 并替换原安装；旧应用叫 `Codex Dream Skin.app` 时不要同时保留两个入口。不要在挂载的 DMG 上进行原地更新，也不需要删除主题数据。
3. 在共享主题库中选预设，或导入自己的图片、视频、`.cdskin` / 支持的 Mac ZIP 主题包。
4. 调整参数并保存；点击应用才切换 Codex。需要重启 Codex 时先保存工作，再在界面确认。
5. 暂停、继续和恢复原始外观均在管理器中完成。关闭窗口后可通过菜单栏或 Dock 重开；断线使用“重新连接”。

用户主题与素材不在应用内，升级应用不要求删除主题库。应用没有商业 Developer ID 公证时，首次打开可能需要 macOS 批准；不要关闭系统安全检查。

## 给维护者

根目录 `npm ci` 后，使用 `bash macos/scripts/build-app.sh` 组装应用，使用 `bash macos/scripts/build-dmg.sh` 制作 DMG。正式签名更新通道的仓库、公钥和清单配置见 [UPDATER.md](UPDATER.md)。

分发前另行取得构建、安装和实机验收指示。不要以旧脚本包、旧截图或历史报告替代当前应用结果。构建布局见 [宿主说明](../hosts/README.md)，验证约定见 [贡献说明](../CONTRIBUTING.md)。
