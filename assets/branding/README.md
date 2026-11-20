# Dream Skin Logo

`dream-skin.svg` 基于用户选定的 `dream-skin-logo/logo-symbol.svg`：保留 D 形图案、玻璃叠层、渐变和星芒光效，添加纯黑色（`#000000`）圆角底板。按主体与星芒的可见轮廓范围（不计漫射光晕）整体居中，中心位于 `(256, 256)`，底板外的圆角边缘透明。

D 字内部通过同一蒙版对玻璃层、底层彩晕和主体一起镂空，露出黑色底板，保留内侧高光。页头文字参照横版 Logo：Dream 为靛紫渐变，Skin 为紫粉渐变；深色界面使用同色系的较亮配色。

- `dream-skin.svg`：512×512 矢量源，管理器页头直接使用此文件。
- `dream-skin.png`：从 SVG 导出的 1024×1024 PNG，黑色底板、圆角外透明，供原生图标生成使用。
- `dream-skin-512.png`：同一居中图稿的 512×512 PNG。
- `../CodexDreamSkinManager.ico`：Windows 多尺寸图标，保留既有资源路径，供 EXE 与安装器使用。

更新设计时，先替换 SVG，再将其导出为 1024×1024 PNG；运行 `tools/create-icon.ps1`，再将生成的 `build/icon/CodexDreamSkinManager.ico` 复制到 `assets/CodexDreamSkinManager.ico`。macOS 构建中的 `macos/scripts/generate-app-icon.sh` 从同一 PNG 生成 ICNS。

图标转换无需修改应用名称、数据目录或更新协议。旧 Logo 概念与预览已移除。
