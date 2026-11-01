# 开发规范

以下约定同时适用于社区贡献者和 AI 开发工具。环境与构建方法见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 最小改动

- 先明确要解决的问题和修改范围，一个分支、一个 PR 只处理一件事；不夹带无关重构、格式化或依赖升级。
- 优先复用现有代码，用最短链路完成需求；不为预想需求添加框架、抽象、兼容分支或状态管理层。
- 状态更新直接使用操作结果，避免重复查询、校验和等待。应用或切换皮肤优先复用当前连接，仅在确有必要时重启 Codex。
- 校验和锁只保留保护输入边界、用户文件和必要写入一致性的部分；普通换肤不增加额外审批和状态门槛。

## 架构与代码归属

- `ui/manager/`：共享页面和交互；`core/`：共享业务与状态；`contracts/`：通信与数据契约。
- `runtime/`：公共注入、渲染、CDP 和 watcher；`platforms/`：平台适配；`hosts/windows/`、`hosts/macos/`：窗口、文件选择、媒体解码及系统集成等原生薄壳。
- 共享业务只实现一次，不复制到两端壳或脚本。平台差异留在适配层，不恢复旧 UI 或双轨入口。
- 公共注入资源只改 `runtime/` 和 `tools/selectors.json`，再运行 `node tools/sync-runtime-assets.mjs` 生成两端镜像；不要手改生成副本。新增平台脚本时同步 `packaging/shared-resources.json`。

## 分支与 PR

- 功能、修复和文档改动建议从最新的主仓库 `main` 新建分支；是否新建分支可按任务范围和当前分支状态决定，不要求每次修改或对话都新建分支，同一事项可继续使用未合并的现有分支。改动通过 PR 合并回 `main`，不得直接在 `main` 开发、提交或推送。Fork 贡献也以主仓库 `main` 为基线。
- 分支命名建议采用 `<type>/<short-description>`，使用小写英文和短横线，例如 `feature/theme-preview`、`fix/composer-background`、`docs/development-guide`；其他类型可用 `refactor/`、`chore/`、`test/`。通常不复用已合并分支；命名和新建分支均作为推荐规范，不作为开发的强制前置条件。
- PR 标题说明具体改动；按 [PR 模板](.github/pull_request_template.md) 填写问题或关联 Issue、实现方式、影响平台、验证结果和已知限制。涉及界面时附截图或交互说明，涉及数据或兼容性时说明影响与恢复方式。
- 验证写明实际命令和结果，未运行或不适用的项目说明原因，不把旧包、旧报告或编译成功当作功能验收。处理审查意见并满足适用的 CI 检查后，由维护者合并。

## 验证与交付

- 默认先完成一个功能块，不新增测试文件、不运行测试、构建、lint、类型检查或可视化验证；获得明确指示或项目规则明确要求后，再执行与改动相关的最小验证。
- 不提交构建产物、依赖目录、本机配置、用户主题状态或凭据；保留第三方许可和来源信息。
- AI 只执行已授权的任务，不擅自提交、推送、创建或合并 PR、发布，也不操作真实用户数据。报告实际修改、验证和未完成事项，不宣称未经验证的效果。

## 本地自动化（可选）

以下约定仅在已安装 `~/.catpaw/` 且工作区启用 `.catpaw/` 时适用，普通贡献无需安装。

<!-- CATPAW:BEGIN -->
# CatPaw Protocol

- This project uses the installed runtime at `~/.catpaw/`; read `~/.catpaw/runtime-policy.md` before routed work.
- The project-local `.catpaw/` native graph contains only Index, Milestone, Work Item, Plan, and Evidence; migration may retain a graph-external legacy archive.
- Select `Direct`, `Tracked`, or `Gated`, then follow `Think -> Plan -> Build -> Review -> Test -> Ship -> Reflect`.
- Reuse an active Milestone for authorized multi-Work progress; update artifacts and tell the user verification plus `Next` after each meaningful unit.
- Proactively use current-tool subagents for triggered Independent Checks. CatPaw external Agent routing is reciprocal `cc`/`cx` only.
- Do not copy runtime files into this project. Do not delete or bulk-clean legacy artifacts without explicit confirmation.
- No Lens, Agent, Evidence, CLI, hook, or method authorizes commit, push, PR, deploy, destructive actions, or secret access.
<!-- CATPAW:END -->
