# Third-party notices

## Codex Dream Skin

构建产物包含来自 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 Windows 脚本和相关软件文件。GitHub Actions 生成的官方 CI 产物固定来源提交为 `3af1d6d62f3a0388cc640d2f497ac3100998938e`；本地构建的实际来源由传入 `build.ps1` 的 `-SkillRoot` 决定。

这些软件文件按上游 MIT License 提供。发布目录中会附带：

- `THIRD_PARTY/Codex-Dream-Skin/LICENSE`
- `THIRD_PARTY/Codex-Dream-Skin/NOTICE.md`

上游 NOTICE 明确将其 `windows/assets/dream-reference.jpg` 排除在 MIT 软件许可证之外。构建脚本在组装发布包时保留该运行时文件名，但使用本仓库维护的 `windows/presets/paper-light.jpg` 覆盖其内容；上游受限图片不会进入发布包。

Codex Dream Skin 是非官方定制项目，与 OpenAI 不存在隶属、认可或赞助关系。OpenAI、Codex 和 ChatGPT 的商标、产品名称、标识及商业外观不因上述软件许可证而获得授权。
