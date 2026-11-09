# Third-party notices

## Codex Dream Skin

构建产物包含来自 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 Windows/macOS 运行时和相关软件文件。仓库内运行时以同步自上游 `main` 提交 `e0341de`（发布版本 `v1.5.16`）的代码为基础，后续由本项目持续修改；当前版本源为 `windows/VERSION` 与 `macos/VERSION`。

在上述基线之上，另定向吸收上游 `0b33497`（macOS 尊重退出取消）、`beb7e5f`（更新检查回退）、`5489590`（保留原生字体偏好）和 `b934408` 中的首页建议标签类名兼容修复。这不代表完整同步上游 `v1.5.18`；本项目保留独立版本号、发布地址和扩展功能。

这些软件文件按上游 MIT License 提供。Windows 发布目录中会附带：

- `THIRD_PARTY/Codex-Dream-Skin/LICENSE`
- `THIRD_PARTY/Codex-Dream-Skin/NOTICE.md`

macOS 应用将对应原文放在 `Contents/Resources/LICENSE.txt` 与 `Contents/Resources/NOTICE.md`。

上游 NOTICE 明确将其 `windows/assets/dream-reference.jpg` 排除在 MIT 软件许可证之外。构建脚本在组装发布包时保留该运行时文件名，但使用本仓库维护的 `windows/presets/paper-light.jpg` 覆盖其内容；上游受限图片不会进入发布包。

Codex Dream Skin 是非官方定制项目，与 OpenAI 不存在隶属、认可或赞助关系。OpenAI、Codex 和 ChatGPT 的商标、产品名称、标识及商业外观不因上述软件许可证而获得授权。

## Application icons

管理器中的 Codex、Claude 应用图标分别来自 OpenAI、Anthropic 应用原始资源，仅用于标识皮肤应用目标；来源和版本见 `ui/manager/src/assets/SOURCES.md`。图标的权利归各自权利人所有，不属于本项目 MIT 软件许可证的授权范围。

## Node.js

正式发布包包含 [Node.js](https://nodejs.org/) 的 Windows x64 可执行文件，用于运行随包附带的 JavaScript 工具。GitHub Actions 当前固定使用 Node.js `22.22.2`；本地构建会复制 `build.ps1 -NodeExecutable` 指定的 Windows x64 Node.js `>=22.22.2 <23`。

macOS 发布包同样包含 Node.js `22.22.2`，从官方 darwin-arm64 和 darwin-x64 压缩包经固定 SHA-256 校验后合成为 Universal 可执行文件，并由本项目作临时签名。其许可证位于应用的 `Contents/Resources/runtime/node/LICENSE` 和 `Contents/Resources/macos/runtime/node/LICENSE`，安装后随引擎保留，不使用 Codex 内部的 Node.js。

Node.js 按其许可证和随附的第三方许可条款提供。发布目录中会附带：

- `THIRD_PARTY/Node.js/LICENSE`

## Shared manager dependencies

当前唯一管理器使用 React 18.3.1、React DOM 18.3.1 和 scheduler 0.23.2；组装从实际 `node_modules` 复制原始 MIT LICENSE 到包内 `THIRD_PARTY/*-LICENSE.txt`。开发依赖及解析版本见根 `package.json`、`package-lock.json`；Vite/TypeScript 仅用于构建。

Windows 原生壳使用 Microsoft WebView2 SDK 1.0.2903.40、Newtonsoft.Json 13.0.3 和 .NET Framework 4.8。组装从 NuGet assets 指向的包中复制 WebView2 `LICENSE.txt`/`NOTICE.txt` 与 Newtonsoft `LICENSE.md`，放入 `THIRD_PARTY/<组件>/<版本>/`。WebView2 Evergreen Runtime 和 .NET Framework 4.8 由系统提供；ReferenceAssemblies.net48 仅为构建参考包。相关版本声明和锁位于 `hosts/windows/`。

Mac 原生壳使用系统 AppKit、WebKit、ImageIO、AVFoundation，无第三方 Swift 包。包内业务 Node 与平台 Node 各保留原始许可证；不使用 Codex 内部 Node。

构建资源清单见 `packaging/shared-resources.json`，依赖原文来源见 [材料目录](docs/dependency-materials/README.md)。分发时须核对实际包内组件、许可证及素材来源；历史构建结果不能替代当前分发包的核对。

## Built-in skin asset disclaimer

本软件内置的相关皮肤素材仅供非营利演示、学习与交流使用，不代表素材所涉及的作者、人物、角色、品牌或权利人参与、认可或赞助本项目。相关图片、人物肖像、角色形象、商标及其他权利归各自权利人所有，且不属于本项目根 MIT License 的授权范围。

本项目无意侵犯任何第三方权利。如权利人认为相关素材构成侵权，请通过项目 Issue 联系维护者并提供必要的权利证明；核实后将及时删除或替换相关素材。

本免责声明不构成版权、肖像权、商标权或再分发授权。使用、复制或分发相关皮肤素材时，使用者仍应自行确认并遵守适用的授权条件和法律要求。
