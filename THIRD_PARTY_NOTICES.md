# Third-party notices

## Codex Dream Skin

构建产物包含来自 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 Windows 脚本和相关软件文件。GitHub Actions 生成的官方 CI 产物固定来源提交为 `3af1d6d62f3a0388cc640d2f497ac3100998938e`；本地构建的实际来源由传入 `build.ps1` 的 `-SkillRoot` 决定。

这些软件文件按上游 MIT License 提供。发布目录中会附带：

- `THIRD_PARTY/Codex-Dream-Skin/LICENSE`
- `THIRD_PARTY/Codex-Dream-Skin/NOTICE.md`

上游 NOTICE 明确将其 `windows/assets/dream-reference.jpg` 排除在 MIT 软件许可证之外。构建脚本在组装发布包时保留该运行时文件名，但使用本仓库维护的 `windows/presets/paper-light.jpg` 覆盖其内容；上游受限图片不会进入发布包。

Codex Dream Skin 是非官方定制项目，与 OpenAI 不存在隶属、认可或赞助关系。OpenAI、Codex 和 ChatGPT 的商标、产品名称、标识及商业外观不因上述软件许可证而获得授权。

## Node.js

正式发布包包含 [Node.js](https://nodejs.org/) 的 Windows x64 可执行文件，用于运行随包附带的 JavaScript 工具。GitHub Actions 当前固定使用 Node.js `22.22.2`；本地构建会复制 `build.ps1 -NodeExecutable` 指定的 Node.js 22 或更高版本。

Node.js 按其许可证和随附的第三方许可条款提供。发布目录中会附带：

- `THIRD_PARTY/Node.js/LICENSE`

## Built-in skin asset disclaimer

本软件内置的相关皮肤素材仅供非营利演示、学习与交流使用，不代表素材所涉及的作者、人物、角色、品牌或权利人参与、认可或赞助本项目。相关图片、人物肖像、角色形象、商标及其他权利归各自权利人所有，且不属于本项目根 MIT License 的授权范围。

本项目无意侵犯任何第三方权利。如权利人认为相关素材构成侵权，请通过项目 Issue 联系维护者并提供必要的权利证明；核实后将及时删除或替换相关素材。

本免责声明不构成版权、肖像权、商标权或再分发授权。使用、复制或分发相关皮肤素材时，使用者仍应自行确认并遵守适用的授权条件和法律要求。
