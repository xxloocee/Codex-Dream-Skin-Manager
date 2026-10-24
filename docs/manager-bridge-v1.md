# 管理器桥接契约 v1

协议标识 `dreamskin.manager/1`。本文区分已编码的方法与未来扩展，不以源码落盘代表平台验收。磁盘 schemaVersion 与桥接版本分别管理。P0–P5 标题保留阶段来源；当前目录与构建入口见 [宿主说明](../hosts/README.md)。

Node 默认 `--mode read`，声明 `system.hello`、`status.get`、`themes.list`、`themes.get`。显式 `--mode manager` 才声明 `skin.apply`、`operations.get`、`operations.confirm`，配置运行时 port 后声明 `skin.pause`、`skin.resume`、`skin.reset`、`skin.restore`、`runtime.repair`，配置库写入 port 后另声明 `themes.update`、`themes.copy`；`media.resolve` 仅在宿主传入配对的资源目录和媒体 origin 时声明。共享控制台与两个原生壳是唯一默认入口。`events.subscribe`/`events.unsubscribe`/`session.close`、`operations.list` 和 `runtime.upgrade` 的声明由相应能力决定；具体请求与响应以 `contracts/manager.mts` 为准。

## 1. 消息与会话

前端调用宿主受限桥接；宿主与 Node 业务进程用 UTF-8 NDJSON，一行一个 JSON 对象。宿主只转发允许的命令，Node 再验证类型和业务条件。宿主调用系统能力使用独立内部协议，不接受前端直接伪造的内部消息。

请求：

```json
{"protocol":"dreamskin.manager/1","kind":"request","requestId":"r1","method":"themes.list","params":{}}
```

成功响应：

```json
{"protocol":"dreamskin.manager/1","kind":"response","requestId":"r1","ok":true,"result":{"revision":"catalog-opaque","themes":[],"warnings":[]}}
```

失败响应：

```json
{"protocol":"dreamskin.manager/1","kind":"response","requestId":"r1","ok":false,"error":{"code":"BACKEND_UNAVAILABLE","message":"主题服务暂不可用","retryable":true}}
```

约束：请求 ID 在连接内唯一；响应只能有 result 或 error；未知方法、版本、不合法参数必须拒绝。握手先于其他命令，返回 backendSessionId、能力、平台与版本；业务进程重启后会话 ID 变化，旧资源和确认 token 失效。错误 message 用于诊断，UI 依赖 code 选择文案，不解析中英文异常字符串控制流程。

P1-A 具体字段：`requestId` 为 1–128 位 ASCII 字母/数字/冒号/下划线/短横线；无法解析请求或无法取得合法 ID 时，失败响应的 `requestId` 为 null。每连接只保留最近 1024 个请求 ID 以拒绝近期重复；持续使用不因累计请求断线。操作幂等由独立 operationId 与持久记录约束。NDJSON 最后一条也必须以换行结束；响应字节限制不含结尾换行。

`system.hello` 返回 `{backendSessionId, platform, versions: {bridge, node, application}, capabilities: {methods}}`；platform 为 windows/macos，application 未知为 null。methods 只列出当前配置下实现的方法。状态 sequence 在每次开始读取时递增，页面丢弃过期结果；它不是事件流序号；事件另带当前会话单调序号，不支持断线重放。

握手前及接收时限制单行 1 MiB，拒绝无限缓存和过长消息；列表用分页限制单条大小，默认 100 条、最大 200 条。媒体内容不嵌入消息。所有字符串、数组、字段长度还需运行时校验；平台日志输出不得混入 NDJSON。具体操作超时由后端按操作配置，超时不自动重试副作用。

## 2. 首批方法

| 方法 | 参数 | 结果 | 副作用 |
| --- | --- | --- | --- |
| `system.hello` | `{}` | 会话 ID、platform、versions、capabilities | 无业务写入 |
| `status.get` | `{}` | ManagerSnapshot | 读取/探测，不启动 Codex，不修复业务状态文件；manager 模式的内容核验可生成受预算限制的派生缓存 |
| `themes.list` | `{cursor?, limit?}` | `{revision, themes, nextCursor?, warnings}` | 无业务写入；目录错误不转换为空成功 |
| `themes.get` | `{theme: ThemeRef}` | ThemeDetails | 无业务写入；无效/删除条目返回明确错误 |
| `themes.active` | `{}` | ThemeDetails 或 null | 只读当前活动副本，不视为可编辑主题库条目；有 stateRoot 才声明 |
| `media.activePreview` | `{revision}` | MediaResource | 对活动副本生成短期预览，复用素材校验、版本和缓存生命周期；有 stateRoot 和资源服务才声明 |
| `media.resolve` | `{theme: ThemeRef, revision, variant: "thumbnail" | "preview"}` | `{resourceId, url, mimeType, expiresAt}` | 可创建派生缓存，不修改原始素材/主题 |
| `skin.apply` | `{operationId, theme: ThemeRef, expectedRevision, refresh?}` | OperationSnapshot | 普通应用可能先进入 awaitingConfirmation；带 refresh 仅允许当前会话热刷新 |
| `skin.pause` | `{operationId, expectedRuntimeRevision}` | OperationSnapshot | 暂停当前皮肤；分别记录期望与实际卸下，不启动/重启 Codex |
| `skin.resume` | `{operationId, expectedRuntimeRevision}` | OperationSnapshot | 继续当前活动副本；需要启动/重启时先确认 |
| `skin.reset` | `{operationId, expectedRuntimeRevision}` | OperationSnapshot | 应用平台默认主题；必要启动/重启先确认，保留库与覆盖 |
| `skin.restore` | `{operationId, expectedRuntimeRevision}` | OperationSnapshot | 始终先确认；选择性恢复外观配置、停止皮肤会话并归档备份 |
| `runtime.repair` | `{operationId, expectedRuntimeRevision}` | OperationSnapshot | 未暂停的活动副本连接修复；需要启动/重启先确认 |
| `runtime.upgrade` | `{operationId, expectedRuntimeRevision}` | OperationSnapshot | 当前完整包引擎交接，始终确认且绑定旧 watcher/活动内容 |
| `events.subscribe` / `events.unsubscribe` | `{}` | `{backendSessionId, subscribed}` | 当前连接事件观察开关，read/manager 均可用 |
| `session.close` | `{}` | `{backendSessionId, closing: true}` | 停止接受请求；响应后结束输入并排空已接受任务 |
| `operations.list` | `{cursor?, limit?}` | OperationPage | 固定 ledger 只读分页，游标绑定当前会话与账本版本 |
| `themes.update` | `{operationId, theme: ThemeRef, expectedRevision, patch}` | OperationSnapshot | 保存库配置/预设覆盖，不改活动目录、不应用/启动 |
| `themes.copy` | `{operationId, theme: ThemeRef, expectedRevision, patch, name}` | OperationSnapshot | 保存独立副本及原始素材/CSS/许可，不应用 |
| `files.select` | `{multiple: boolean}` | `{cancelled, sources, failures}` | 原生选择及稳定素材快照，不写主题库 |
| `sources.preview` | `{handle}` | MediaResource | 生成短期原生 PNG 预览，不修改源文件 |
| `sources.release` | `{handles: string[]}` | `{released}` | 撤销会话授权，已接受事务继续使用独立快照 |
| `themes.create` | `{operationId, handle, name, patch}` | OperationSnapshot | 逐项保存新主题或返回重复主题，不应用 |
| `files.saveOriginal` | `{theme: ThemeRef, revision}` | `{cancelled, saved}` | 原生保存对话框，仅向用户指定目标写原字节 |
| `files.playOriginal` | `{theme: ThemeRef, revision}` | `{opened}` | 系统媒体应用打开受限原素材副本，不代表播放已核验 |
| `files.selectPackages` | `{multiple: boolean}` | `{cancelled, sources, failures}` | 原生授权包快照；Windows .cdskin，Mac 另支持 ZIP |
| `packages.inspect` | `{handle}` | PackageDetails | 包格式/metadata/渲染参数/CSS/许可证/未验签提示/语义指纹 |
| `packages.preview` | `{handle}` | MediaResource | 包背景短期 PNG 预览，不应用 Safe CSS |
| `packages.release` | `{handles: string[]}` | `{released}` | 撤销授权，不删除已接受事务所需快照 |
| `themes.importPackage` | `{operationId, handle}` | OperationSnapshot | 锁内保存包或返回重复；不应用，不覆盖现有主题 |
| `files.exportPackage` | `{theme: ThemeRef, revision}` | `{cancelled, saved}` | 稳定读取并原生导出已保存内容为 formatVersion 1 |
| `themes.delete` | `{operationId, theme: ThemeRef, expectedRevision}` | OperationSnapshot | 先确认；库内隔离后预设回收站、自定义永久清理 |
| `library.recovery.list` | `{}` | `{entries, warnings}` | 同锁只读共享事务；最多 128 项，优先可处理项 |
| `library.recover` | `{operationId, transactionId, expectedRevision, action}` | OperationSnapshot | 先确认；仅处理来源与当前内容一致的单项事务 |
| `operations.get` | `{operationId}` | OperationSnapshot | 查询，不自动继续或重放 |
| `operations.confirm` | `{operationId, confirmationId, accepted}` | OperationSnapshot | 同意才继续对应动作，拒绝则取消尚未执行部分 |

能力只声明已接入 port 的方法。P2-A–D 已编码编辑/另存、素材/包导入导出、原生素材动作、删除及中断恢复；原生与包方法仅在 manager 模式同时配置对应资源、授权和库写入能力时声明。files 方法由宿主处理，不能当普通后端请求转发。P3-A/B 已编码暂停/继续、重置/选择性外观恢复及主动连接修复；P3-C 已接入内部公共 CDP/注入/watcher 生命周期，不新增网页方法。事件、会话退出、历史核对、运行时交接及社区/更新/维护均已接入；不保留旧入口转接。

删除/库恢复复用同会话五分钟一次性 operations.confirm，绑定主题 revision、完整树摘要/集合及实际活动/已应用/待执行/默认身份保护；执行在平台锁内重新检查，漂移拒绝，不自动更新确认。OperationSnapshot 可返回 deleted、cleanupPending、recoveryCompleted；从库移除与清理结果分开。恢复条目含 transactionId/theme/method/phase/revision/actions/message，action 仅 reconcile/finishImport/discardStage/cleanupDeleted；新操作 ID 不能等于原事务。恢复不会自动重放/批量清理，重复包暂存不能再发布。旧会话查询可读取持久完成收据，不覆写旧 owner 账本；收据写入不完整则保留 indeterminate。无来源旧目录、授权快照、旧 Mac journals 保留。

capabilities 是“实现支持情况”；快照中的 availability 是“当前是否可执行及原因”，两者不能混用。支持 apply 不意味着当前可以绕过重启确认。

主题详情中的 `availability.delete` 仅控制是否可发起删除检查：检查实现支持、当前写入忙碌及固定默认恢复主题，不再随每次 `themes.get` 运行完整删除预演。UI 继续禁用已知活动主题的删除；`themes.delete` 实际请求仍必须通过完整运行时/未完成事务/目录树保护检查，取得挑战并确认，执行前再次校验指纹和删除条件。详情中的允许状态不代表已授权删除。

### P5-B 可选确认展示元数据

`OperationSnapshot.confirmation` 在既有 ID、期限、reason、impact 之外可附带 `copy: {kind, subject?}`。kind 白名单为 `applyRestart`、`resumeRestart`、`resetRestart`、`repairRestart`、`restoreAppearance`、`upgradeRuntime`、`deletePreset`、`deleteSaved`、`recoverReconcile`、`recoverImport`、`recoverDiscard`、`recoverPreset`、`recoverSaved`。删除类型必须带 1–256 字符 subject；恢复类型可带相同限制的主题名/ID；其他类型不得带 subject。未知字段/类型或不合法 subject 不作为有效描述。

该字段由核心预检/库挑战生成，账本读取和平台结果读取只保留有效描述。共享 UI 还核对 kind 对应的 operation method，在显示时解析当前语言；subject 作为原始用户数据插入，恢复主题缺省时使用界面自有占位。缺失、无效或 method 不匹配均显示原 reason/impact，不解析人类文案推断确认类型。reason/impact 持续保留供旧消费者和诊断使用；新增字段不改变操作参数、确认 ID/期限/一次性消费、版本绑定、批准条件或实际执行。

共享 UI 自有异步提示保存 key/插值，而非提交时的翻译结果；本地标记错误可使用同一资源，后端异常与用户数据保留原文。用户主题、事务及恢复材料位于平台状态目录，不能当作构建缓存整体删除。

### P2-C 包授权、导入与导出

宿主拦截 files.selectPackages/files.exportPackage；网页不发送路径或私有消息。私有 packages.register 只接受 paths，由核心读取稳定快照并返回 48 hex、30 分钟会话句柄；选择取消/全失败保留旧授权。每次最多 32 包、每包 160 MiB；输入随授权替换、释放、到期和操作终态回收，不使用历史累计额度。packages.inspect 返回 format/name/storageCategory/tags/storedParameters/previewParameters/hasCss/license/signatureIgnored/fingerprint；许可证作为纯文本展示，原字节仍写库。

共享 ZIP codec 严格验证目录/本地记录/descriptor/CRC/实际展开字节，拒绝 ZIP64、加密、多卷、链接、越界、重复和重叠；展开 192 MiB。`.cdskin` 仅 2–4 根文件；Mac ZIP 最多 32 条目、根或唯一一级目录，忽略 Finder 文件后复用官方/简化权威校验器。官方 manifest 原样保存于 packageOrigin，所有导入来源标明 signatureVerified false，签名不作为身份背书；普通 Mac ZIP 锁内另调用平台 injector --check-payload。

themes.importPackage 复用 operationId 幂等、busy、平台操作锁和确定 custom-clientUUID。登记前绑定快照，锁内重新解析/元数据与真实解码/Safe CSS 校验、隐藏暂存完整写入/sync/复读、rename 发布。resultTheme/resultRevision/disposition 表达创建或重复，重复为 succeeded/libraryChanged false；失败/结果未知不重试，关窗继续排空已接受任务。包语义指纹忽略内部 ID/文件名/缓存，归一化两端 accent/缺省渲染语义；保留 metadata/未知字段/CSS 存在性/许可证以及官方 license/publisher/provenance，区别于 P2-B 的纯渲染指纹。重复和提交前失败释放本操作 stage；已尝试提交但结果未明时保留恢复材料。

私有 packages.export 使用 ThemeRef+revision，读背景/CSS/LICENSE 与完整内容版本，重复比对字节，产出原生私有 48 hex .cdskin descriptor。两端宿主核对固定叶名称/扩展/大小/摘要，再以原子保存写用户选定目标；文件对话框等待最多 20 分钟。背景原字节/alpha/动图/视频保留，格式 1 不携带 originalImage，转换前来源另行保存。保存取消返回 cancelled true/saved false，包不进入系统媒体打开能力。

### P2-B 素材授权与原生文件动作

SourceGrant 为 `{handle, name, extension, byteLength, expiresAt}`；handle 是 48 hex 随机会话身份，30 分钟失效，name 只含用户选择文件的显示叶名称。一次最多 32 项，新一次选择成功后替换此前授权；取消或所有素材失败保留此前授权。单素材及转换来源各 128 MiB；快照位于 manager-operations/source-snapshots。授权替换、释放或到期时回收无使用者的本会话文件，已接受操作 pin 所需输入直到终态。新输入带创建者 PID 标记，仅在创建者退出且无持久请求引用时回收异常遗留；旧未标记和结果不明材料保留。Mac HEIC/TIFF 在受限快照中转换 PNG 并保留 originalImage。网页不持有来源路径，预览还是 PNG 资源，不作为原始素材导出。

`themes.create` 名称、分类、标签和参数沿用 P2-A patch 校验，patch 不再包含 name，name 放在命令字段。新请求须当前 operationId 会话及有效句柄；相同已知 ID 在句柄失效后仍可查询，异参冲突。接受前绑定快照，释放句柄不撤销已接受任务。每项 operation 的 method 为 themes.create，theme 为确定的新建目标，expectedRevision 为内部素材快照身份，不是已有主题的编辑 revision。resultTheme/resultRevision 表达真实创建或重复条目；disposition 为 created/duplicate/null，duplicate 要求 succeeded、libraryChanged false，created 要求 succeeded、libraryChanged true。主题名/分类/标签不参与去重，自动焦点与显式居中不同。

批量由 UI 逐项登记操作 ID 并顺序提交，停止只停止尚未提交项；已接受项继续排空。失败项和重复项分别显示，结果未知或请求/查询失联停止后续提交；恢复只查询已登记 ID，不重放素材导入，不重用另一会话的句柄。真实视频解码仍走旧权威校验入口，无条件时拒绝，不启动 Codex。

宿主私有消息为 `kind: native.request/native.response`，方法包括 sources.register / packages.register（paths）、media.original（theme/revision）、packages.export 和 files.release（fileName）。公网页桥接拒绝私有 kind 和保留的 native: 请求 ID 前缀。宿主生成独立 native:UUID 请求 ID、消费私有回复，再为原网页 ID 返回公开结果；私有媒体回复仅含固定媒体叶文件名、摘要/大小/扩展，不能穿透到网页。内部请求仍使用串行 NDJSON，不等待反向宿主 ACK。普通查询 60 秒，文件对话框请求单独允许 20 分钟；超时均不重试副作用。

原始素材动作先确认完整 theme revision，再复制 originalImage 或背景原字节，宿主校验 128 MiB/摘要/受限目录。宿主复制并校验摘要后发送私有 files.release 释放核心输出，关闭时清理宿主私有临时文件；播放另生成校验后的媒体扩展副本，只调用系统媒体关联。保存的目标由原生对话框授权，原子替换，取消返回 cancelled；opened 只表示系统接受打开。

## 3. 主题与媒体模型

ThemeRef：`{source: "preset" | "saved", id: string}`。source/id 是本机仓储中的身份，不保证不同机器同名主题内容相同；不得由客户端提供 themeDirectory/imagePath 替代引用。

ThemeSummary 包含：ref、name、storageCategory、displayCategories、tags、mediaKind（image/animatedImage/video）、catalogOrder、addedAt/modifiedAt（未知用 null）、revision。Mac 顺序需使用 GUI 预设 catalog 顺序，不用旧列表的目录字母序冒充 Windows 目录顺序。日期字段的来源保持明确，不把 birthtime 当作跨平台一致的导入时间。

revision 为适配器生成的不透明内容版本，至少覆盖本次操作依赖的配置、媒体和 CSS；不使用仅文件 mtime 判断内容未变。列表分页 cursor 绑定 catalog revision，库变化后拒绝旧 cursor 并要求从首页刷新。

P2-A 增加 LICENSE.txt 和 originalImage 的存在性/字节身份；有转换来源的主题库存储其哈希并复读确认，不把全库原始素材同时留在内存。新部署前需刷新旧内容版本/cursor/媒体缓存；renderer payload revision 算法不变，已知操作 ID 的查询不因当前库变更而拒绝。

ThemeDetails 包含 Summary、存储参数、有效预览参数、媒体尺寸/格式、警告和可操作性。存储参数保留缺省信息：缺失 focusX/focusY 用 null 表示自动，不用 0.5 替代；显式 0.5 与自动不同。取景同样保留显式/缺省信息。前端预览可使用有效参数，但不能据此回写完整主题文件。

P1-A 使用字段 `storedParameters`、`previewParameters`、`media`、`warnings`、`availability`。两组参数均包含 appearance、focusX/Y、positionX/Y、zoom、positionMode、framingEnabled、safeArea、taskMode、bubbleOpacity、surfaceOpacity、shellOpacity、accent；stored 中缺失字段为 null，preview 提供仅用于显示的缺省值。shellOpacity 表示全窗口背景遮罩的不透明度，范围为 0..1；缺失时保留深色 0.58、浅色 0.64 的动态默认值，不等同于显式 0.58。surfaceOpacity 仅控制独立面板。accent 为空/缺失为 null。media 的 width/height 本段为 null，并返回 `MEDIA_NOT_INSPECTED`；MIME 仅按旧素材扩展名映射，不表示解码校验或资源加载已通过。P1-A 不是共享主题写入或主题包权威校验器。

media.resolve 返回 URL 由宿主为当前会话映射，资源 ID 只引用已经校验过的本地素材/缓存；不接受任意 URL、路径或相对路径穿越。资源服务必须限制根目录、符号链接及 reparse point，设置正确 MIME，并拒绝通过媒体入口加载可执行页面。URL 过期/会话切换后重新 resolve。缓存未就绪或格式不支持需返回明确原因；不把原始视频当成可随意加载的 HTML 内容。

当前源码采用内部 `resource.register` 注册随机叶文件、SHA-256、用途和到期时间，宿主消费后不转发网页；公共结果固定为短期 PNG 资源。缓存最多 64 项/256 MiB、有效期 5 分钟；命中更新最近使用顺序，容量不足时淘汰最久未使用项，不因累计浏览返回 BUSY。淘汰、过期和关闭通过私有 `resource.release` 同步移除所属会话在两端宿主的登记，并清理核心缓存文件；释放先于新注册发送，消息不转发网页。单文件 128 MiB 与媒体检查保持有效。Windows 资源 origin 为 `https://media.dreamskin.invalid`，Mac 为 `dreamskin-media://resource`；宿主校验路径、大小、hash 和过期时间后生成图片/动画首帧/视频封面。页面产物为单 IIFE 和外部 CSS，避免 WKWebView 对 file ES module 的跨域请求。

Mac 接受异步解码前，在同一私有目录为素材建立唯一临时硬链接；排队、图片读取及视频解码/复读均使用该路径，完成或失败后清理，取消或重连仅阻止旧回调。核心可照常淘汰原文件；已接受任务的素材保留至解码结束，不会因淘汰中断。64 项/256 MiB 限制核心缓存，不包含解码期间仍被硬链接引用的素材；应用退出不等待解码完成。接受前原资源已被淘汰时仍返回加载失败。

## 4. 状态模型与旧接口映射

ManagerSnapshot：

```text
backendSessionId, sequence, observedAt
desired: { theme: ThemeRef | null, revision: string | null, paused: boolean | null }
engine: { health: healthy | stopped | stale | degraded | mismatch | unknown,
          runtimeSessionId: string | null }
renderer: { status: applied | removed | unknown | unavailable,
            theme: ThemeRef | null, revision: string | null,
            runtimeSessionId: string | null, verifiedAt: string | null }
operationIds: string[]
runtime?: { revision: string | null, activeRevision: string | null,
            engineRevision?: string | null, runningEngineRevision?: string | null,
            upgradeRequired?: boolean }
availability: { apply: { allowed: boolean, reasonCode: string | null },
                pause?: { allowed: boolean, reasonCode: string | null },
                resume?: { allowed: boolean, reasonCode: string | null },
                reset?: { allowed: boolean, reasonCode: string | null },
                restore?: { allowed: boolean, reasonCode: string | null },
                repair?: { allowed: boolean, reasonCode: string | null } }
diagnostics: { code, message }[]
```

这里的 nullable 表示“不知道”，不是 false。observedAt 只说明读取时间，verifiedAt 必须来自实际渲染验证，不能用状态文件更新时间填充。desired.revision 是提交的内容版本，renderer.revision 是当前会话实际验证的内容版本；原始库 revision 与注入器 expectedRevision 可以采用不同算法，但适配器必须保存并校验两者的映射。同 ID 编辑后，旧内容的 applied 不能作为新操作成功证据；无法得到内容版本时 revision 为 null，不能宣称匹配当前目标。

| 旧数据 | 映射约束 |
| --- | --- |
| Windows activeThemeId、isPaused | desired；身份由仓储解析，无法解析时保留诊断并返回 null |
| Windows statusKind/isRunning | engine 的输入；原始未知值归 unknown，不吞掉诊断 |
| Windows rendererStatus/rendererMessage | 只有当前会话与目标匹配的探测结果才能映射 applied/removed；不从 isRunning 推断 |
| Mac session/injectorAlive | engine/desired 的输入，不是 renderer 证据 |
| Mac appliedThemeId/cdpOk | 只作历史/连接诊断；不能仅凭这些字段设置 verifiedAt 或 applied |
| Mac operation/operationMessage | 作为旧引擎操作提示，不冒充有新 operationId 的完整操作账本 |

P3-A 的 runtime.revision 是状态字节、暂停标记、平台会话指纹和活动内容的 SHA-256 摘要，不等于库内容版本或 renderer payload revision；runtime.activeRevision 单独标识活动内容。暂停/继续请求使用刚读取的 runtime.revision，执行在原平台锁内重查，变化返回 RUNTIME_CHANGED 或保守的未核验结果。活动目录身份优先于库引用解析，离库活动主题仍可继续；没有活动副本则禁用继续。

P3-B 扩展运行时版本绑定默认内容、当前配置、安装前外观备份及 Windows 管理标记/未完成事务。默认/备份等摘要只在内部流转，网页只使用 runtime.revision。availability.reset 要求固定默认目标有效且当前连接允许；restore 要求可读 config/backup；repair 要求有效活动副本且未暂停。availability 的备份存在性不代表格式已验收，执行前原解析器会拒绝无效/不支持的恢复输入。

P3-C 的公共 watcher mode/epoch/session registry 仅是引擎内状态，不作为网页 renderer 结果，也不能代替 runtime.revision。Windows 继续校验原 browserId anchor/总操作预算并以既有指纹覆盖公共模块，Mac 保留严格暂停、setup 屏障和 control/full ack。页面只收到既有只读核验产生的事实；P3-D 另行实现跨进程事件订阅与升级协调。当前源码与分发清单未运行验证，不能据此宣称连接/显示或包完整性已通过。

暂停期望来自平台标记，不证明皮肤已卸下。removed 必须由暂停状态下当前同一浏览器会话的只读移除核验得出；确认 Codex 未运行则 unavailable，无证据则 unknown。继续仍使用精确 payload/内容映射核验 applied，不根据 watcher 存活推断成功。engine 健康与上述渲染事实独立。

当前 manager 模式已编写两端真实 inspect：持有平台操作锁，读取 injector verify 并比较稳定快照与活动主题的归一化内容、CSS、payload revision 和核验前后浏览器会话。只有先前成功应用留下的 current 映射可用于后续核验；既有旧主题没有映射、内容已变或探测失败时继续返回 unknown/null。不能从旧状态补出 applied。此路径尚未在两端运行验收。

## 5. 应用、确认与幂等

operationId 采用 `backendSessionId:UUID`，由客户端在握手后生成并在调用前保留，页面重建后能查询。各声明支持的写方法可以登记当前会话前缀的首次 ID；operations.get/operations.confirm 的未知 ID 返回 OPERATION_UNKNOWN。已知 ID 同参数返回原操作，同 ID 不同参数报 OPERATION_CONFLICT。未知旧会话 ID 不得执行，即使客户端认为它是首次请求也要求明确重新发起。

后端必须在返回操作已接受或调用任何业务副作用之前，原子持久化 ID、规范化请求摘要、预期 revision 和 queued 状态；持久化失败则不执行。同 ID 并发请求通过互斥完成一次登记，不能启动两个脚本。记录位于平台数据根新增的 manager-operations 目录，不改旧 schema。同一会话内不删除 ID/请求摘要；详细日志可裁剪，但保留去重墓碑。跨会话已知 ID 只查询/对账，不自动继续旧确认或重放；清理后的旧 ID 因会话前缀失效而拒绝，不能重新当作新请求。具体日志保留上限在 P1 定义，达到上限可拒绝新操作，不能为腾空间破坏去重边界。

OperationSnapshot 至少包含：id、method、state、stage、theme、expectedRevision、committedRevision、verifiedRendererRevision、startedAt、updatedAt、confirmation、effects、error、最终 snapshot。state 为 queued/running/awaitingConfirmation/succeeded/failed/cancelled/indeterminate。

effects 分别表达 themeCommitted、rendererApplied、codexRestarted（均为 true/false/null），避免部分提交伪装为全成功或完全未发生。succeeded 要求本次提交内容版本与目标运行会话的渲染核验通过；runtimeSessionId 是平台适配器基于已核验浏览器/进程身份生成的不透明标识，与业务进程 backendSessionId 不同。操作结果保存目标 runtimeSessionId；旧会话验证不得用于新会话成功声明。保存成功但未显示只能返回未完成/失败或 indeterminate，并说明已发生的影响。

执行顺序：

1. 校验身份、revision、能力、请求 ID；查询真实状态，取得写操作互斥。排队期间不长时间持有旧脚本锁。
2. 无副作用预检目标配置、媒体及启动条件。涉及重启时创建确认请求，释放短期锁；等待确认期间不得启动该重启路径。
3. confirmation 包含随机 ID、操作 ID、原因、影响说明和到期时间（默认 5 分钟），由后端生成且单次使用。UI 只能转交用户决定。
4. 同意后重新核验 revision 和重启前提，在实际负责写入的锁内再次检查 revision 后执行；环境/目标改变时使确认失效并重新预检。不能用一个布尔 restart=true 长期授权。适配器不能持有不可重入旧锁再启动会重复加锁的脚本：优先将 expectedRevision 检查下沉到旧脚本的同一锁内，或使用其已有受校验 lock-token 机制；具体选型按平台确认。
5. 使用锁内验证的稳定内容快照调用受限平台流程、读取实际结果、刷新状态后完成。实际重启边界再核对进程/会话身份与已确认前提；条件改变则拒绝并重新预检/确认。若连接在热应用中失效，需要重启时重新走确认，不默认升级权限。
6. 拒绝前尚未写入则 cancelled；若主题已经保存但需要恢复，effects 必须反映部分提交。取消不等于回滚已提交结果，不强杀事务脚本。

业务进程崩溃/通信超时后，将无法确定结果的运行操作标为 indeterminate，先核对既有事务、状态与 renderer；不得自动重放应用或重启。持久日志本身不能保证 exactly-once，旧脚本需通过恢复/对账消除不确定性。历史 ID 不在保留范围内时返回 OPERATION_UNKNOWN，并要求用户刷新/明确重新发起，不能透明重试。

P1 不提供通用 cancelRunning；仅允许拒绝等待中的确认。后续增加取消必须定义事务安全点。

### P3-A 暂停与继续

两方法仅接受 operationId/expectedRuntimeRevision，不接受网页指定主题、路径、PID、port 或脚本。继续使用活动目录的配置/背景/CSS，不改用库中已编辑版本，也不要求活动目录拥有库内 originalImage/许可证文件。预检与锁内执行绑定运行时版本，忙碌边界与应用/库操作共用；需要启动/重启的继续必须使用当前连接五分钟一次性确认，前提变化不复用旧许可。暂停不触发启动或重启。

OperationSnapshot 的 expectedRevision 在这两类操作中保存运行时版本，requestedActiveRevision 保存可空活动内容版本。无活动主题的暂停使用仅操作账本内的 `{source: "saved", id: "runtime-session"}` 占位引用，它不是库主题。effects 新增可选 pausedCommitted/rendererRemoved（true/false/null），结果另有 rendererUnavailable；pausedCommitted 表示所请求的暂停/继续期望已提交，true 在继续中表示暂停状态已解除。

暂停 succeeded 要求期望提交且当前会话实际移除通过，或确认无进程、rendererUnavailable=true；后一种不能称为核验卸下。继续 succeeded 要求期望提交、活动内容提交版本等于 requestedActiveRevision，并有当前会话实际 payload 核验。其余结果按已知副作用区分 failed/indeterminate。适配器先保存 manager-operations/runtime-results 收据再写主账本，旧连接查询可合并完成收据而不重放；子进程完成至收据保存间仍有未知窗口，缺收据不推断成功。继续成功才更新 current 映射；暂停不覆盖它。

### P3-B 重置、原始外观与连接修复

三方法复用运行时版本、持久操作、共享 busy、同连接五分钟一次性确认及收据查询。重置固定 Windows preset-paper-light、Mac preset-gothic-void-crusade（保留已知 gothic-void-crusade 别名），内容缺失/无效拒绝，不改用任意第一项；保留用户参数覆盖。修复使用活动目录，暂停时拒绝，不改用库版本；正常连接先热应用，失败不自动升级为重启。Windows recoveryRequired 的显式修复允许在当前确认下 fresh-session 启动，仍保留注册包、进程、端口和签名边界，不保证不安全身份可恢复。

两项内容动作的 requestedActiveRevision 分别保存默认/活动目标内容版本，成功仍需期望提交及精确 renderer/payload 核验。恢复没有主题目标，使用操作专属 runtime-session 占位，requestedActiveRevision 为 null；始终先确认，旧脚本只恢复其管理的外观键，不覆盖整份 config、不卸载或删除主题库。关闭进程前重新核对身份，配置写入前重查外观输入；Windows 未完成 appearance transaction 保守拒绝，Mac 使用同一主题锁及继承令牌。选择性恢复后复读配置再归档备份，保留原始字节，部分阶段失败不冒充全失败或全成功。

effects 增加可选 appearanceRestored/runtimeDetached/backupArchived（true/false/null），恢复 succeeded 要求这三项为 true 且 codexRestarted 为已知值。正常打开应用不等于 renderer 已核验；rendererRemoved/rendererApplied 保留各自证据要求，配置恢复成功与当前实际显示分别展示。恢复收据仍有平台子进程完成至落盘之间的中断窗口；缺收据保持 indeterminate，不重放。

### P2-A 编辑与另存

patch 为 `{name?, storageCategory?, tags?, parameters?}`；parameters 为 ThemeParameters 的部分字段。省略保持，参数 null 移除显式值/恢复缺省；关闭 framing 同时移除旧位置/缩放/范围字段，不能把缺省焦点补成显式 0.5。新 metadata 使用两端共同旧限制；既有 metadata 在只改参数时原样保留。preset 原位更新仅接受参数；修改名称/分类/标签走 copy。copy 的 name 单列参数，不在 patch 内重复。未知字段/原素材/CSS/许可保留，编辑后失效旧指纹缓存。细节与限制见 P2 规划。

库写入与 skin.apply 使用同一持久账本和后端忙碌边界；两端 worker 在跨进程锁内重查完整 revision。Windows 内置写 preset-settings，Windows 自定义/Mac 写原库 theme.json；不再调用会同步修改活动主题的旧 UpdateTheme。平台仅持锁，补丁和另存写入规则由共享 worker 实现。主题库写入只使用共享 worker；平台脚本保留跨进程串行锁与系统操作。

OperationSnapshot.method 增加 `themes.update`/`themes.copy`；effects 增加可选 libraryChanged（旧 skin.apply 账本可缺省），编辑记录另有 nullable resultTheme/resultRevision。保存成功只说明 libraryChanged=true 及结果内容版本，不把 themeCommitted/rendererApplied 设置为 true。未发布为 failed，结果不明为 indeterminate。已知副作用在后续账本写入失败时尽量保留；旧会话未完成保存/复制不重放。调用方用 operations.get 查询，不能自动重试保存。

“保存并应用”是 UI 明确串联的两个独立操作：保存 succeeded 且重新读取内容版本仍一致，才生成新 apply ID；启动/重启仍需 P1 一次性确认。保存后关闭页面、保存超时或结果不明，不自动应用；保存成功、后续失败要保留部分成功提示。保存与应用分别报告结果。

正在使用的主题保存修改后，UI 先后读取真实状态，绑定同一主题、未暂停的活动副本和浏览器会话，以 `refresh: {activeRevision, runtimeSessionId, opacityOnly?: true}` 请求热刷新。两个版本标识均为 64 位十六进制。此约束计入幂等摘要并持久化到操作账本；执行前及平台锁内重新检查。连接丢失、版本或会话改变时失败，不创建重启确认、不启动或重启 Codex。查询收据也只有同一会话且 `codexRestarted=false` 才能恢复为成功。

动态主题仅改变气泡/面板不透明度时使用 `opacityOnly=true`。运行中的 watcher 必须与当前完整包引擎匹配；媒体字节、主题身份、其它参数及 CSS/renderer 版本通过兼容指纹核对。通过后只更新现有页面的两个 CSS 变量及版本标识，保留视频节点、Blob URL 和播放位置，不解码或重新绑定视频。不兼容、旧引擎或更新失败均保留未确认结果，不降级为整包注入。旧引擎需由用户明确更新，不能用透明度保存隐式升级。

操作、库事务、维护和更新历史只回收确定终态：保留最近 256 条及 30 天内记录，未完成、不可读和结果不明记录保留；内存终态缓存与保留记录同步，不以历史总数阻断新请求。日志文件 sync 后更新；Windows 没有 Node 目录 fsync，不能保证断电后的目录项持久性。发布成功在平台操作锁内先写收据，再写 current.json（requestFile 为叶文件名），标记 settled 后回收已取代的 settled 快照/请求；Inspect 持同一锁且不发布，当前及未确认快照保留。正常退出关闭后端 stdin 并排空已接受事务；Mac 关闭窗口仅隐藏，仍保留会话；写事务超时不强杀、不重放。未知旧会话的非终结记录查询返回 indeterminate，不改另一进程拥有的记录。

## 6. 事件及错误

### P4-D 更新方法

仅 manager 模式并配置 UpdatePort/原生资源时声明。更新不是 runtime.upgrade：前者下载并安装管理器平台包，后者只交接至当前已安装的皮肤运行时。

| 方法 | 参数 | 结果 / 边界 |
| --- | --- | --- |
| `updates.check` | `{background: boolean}` | UpdateCheck：48 位 hex handle、五分钟 expiresAt、通道/版本/是否更新、固定 releaseUrl、installMode/reason/trust |
| `updates.install` | `{operationId, handle, accepted: true}` | UpdateOperation；持久意图、重新检查完整批准绑定后下载/校验/安装器移交 |
| `updates.get` | `{operationId}` | 只读原记录和绑定 helper 结果，不重放安装 |
| `updates.openRelease` | `{handle}` | 原生宿主经内部 updates.authorizeOpen 获取批准的固定发布页，返回 opened；网页不能传 URL |
| `updates.quit` | `{operationId}` | 原生宿主经 updates.authorizeQuit 取得正常退出许可；只允许本会话 Mac handoff 且无业务操作 |

核心版本为规范稳定三段，无前导零，≤64 字符，以 BigInt 比较，最新≤当前不发起安装。三通道 windows-release、macos-release、macos-gui 分开，模式 manual/windows-installer/macos-signed；配置签名通道失败不回退普通通道。Windows 固定静态清单和普通版本，Mac 未配置签名时沿用静态清单/受限发布页跳转备用与引擎 VERSION；配置签名时按独立 GUI version、配置仓库/公钥检查。正式应用身份为 Windows CodexDreamSkinManager / Mac cc.dreamskin.manager；不再有独立预览通道或安装身份。

提案绑定当前/最新版本、通道、安装身份、Windows installer SHA-256 或 Mac exact 签名 manifest 摘要/包 hash/配置/公钥字节。提交前 UI 明确勾选批准，核心复查绑定；Windows wrapper 下载前再次检查 version/hash，双清单和包 hash 校验沿用；Mac prepare 再次检查 exact manifest 摘要、签名/架构/大小/hash/codesign/bundle/GUI version及下一通道/公钥。目标必须是当前 Resources 所属 app、bundle/GUI version匹配、父目录可写、非 /Volumes；外置 helper 正常等待退出，保留旧 app并失败恢复。公开结果不含暂存/安装路径。

manager-operations/update-ledger 独立保存并按共同终态保留策略回收，不使用 ThemeRef、主操作历史或 skin.apply 账本。UpdateOperation 的 queued/running/handoff/installed/failed/indeterminate 表示批准/下载校验/移交/替换并接受打开/失败/未知；Windows handoff不表示安装成功，Mac installed不表示 UI/皮肤运行验收。Mac每操作 helper结果文件可只读核对；无结果、跨会话未完成或旧移交保留未知，不能用旧记录退出新管理器。下载/安装中以及 Mac 等待退出期间，核心拒绝主题/运行时 writer。退出授权后停止接收新请求，以 EOF 排空；helper 不杀管理器/Codex。

UI空闲且窗口可见时，启动后及每24小时检查；后台失败安静，同通道/版本在本地通知存储中去重，存储不可用时会话去重。系统通知归 P4-E。检查响应预算180秒，失败不冒充最新版；后台/查询均不自动下载或安装。所有实际验证后置。

### P4-C 社区方法

仅 manager 模式且配置包快照、库/操作与社区网络/应用适配时声明以下方法。网页不能指定 HTTP 地址、headers、下载目录、解压路径或平台脚本；两宿主允许列表显式加入这四项。系统 URL 注册与唤起路由由 P4-E 完成。

| 方法 | 参数 | 结果 / 边界 |
| --- | --- | --- |
| `community.inspect` | `{link}` | CommunityProposal：随机 48 位 hex handle、五分钟 expiresAt、固定 source、严格 CommunityMetadata；只读取元数据 |
| `community.download` | `{handle, accepted: true}` | CommunityDownload：已校验私有 SourceGrant 与 PackageDetails；批准才下载，不写库/活动主题 |
| `community.import` | `{operationId, handle}` | 验证社区包句柄后复用 themes.importPackage 的持久操作与唯一 writer；结果 method 为 themes.importPackage |
| `community.apply` | `{operationId, importOperationId}` | 绑定成功包导入的 resultTheme/resultRevision，独立 skin.apply 操作；单独确认及平台 exact 原主题回滚 |

链接严格为 `dreamskin://apply?version=ver_[a-z0-9]{8,64}`。元数据固定 `/v1/themes/{version}`，下载固定其 `/download`，来源仅 HTTPS api.dreamskin.cc，不跟随重定向、不带 Cookie/凭据、不接受压缩；请求 20 秒、整体 60 秒。JSON 64 KiB/严格 UTF-8，ZIP ≤160 MiB。社区名/作者/许可安全显示字段、id、三段 version、applyCompatible、长度/hash 必须合法；下载实际 bytes 与批准元数据完全匹配，官方 manifest 的 themeId/version/name/publisher.displayName/license 再绑定元数据，平台/minClientVersion/ZIP 内容/Safe CSS/素材验证沿用原校验器。签名仍未验证，不能展示认证发布者。每会话单网络请求、最多八个票据；已完成票据按期限或容量回收，失败批准不自动重试。关闭检测到的会话取消未完成网络请求，已持久化写事务继续排空。

内部 `.community.zip` 快照仅由批准后的下载创建，两端允许官方 ZIP，Windows 原生选包仍只允许 .cdskin。单包/会话 512 MiB/保留 1 GiB 预算沿用。导入新建独立 custom 条目或按内容与许可去重，原社区同 ID 覆盖行为不进入此 writer。已知 import ID 在句柄过期后仍查询原结果，不再次下载/导入。

应用始终独立确认，平台 fingerprint/active 完整 revision/目标 revision 在事务锁内重查。无已核验活动基线、暂停或异常时拒绝，先通过已有控制建立基线。Windows 复用社区启动/重启及谨慎回滚，Mac 的共享候选和回滚均禁止自动重启；原 Mac 入口行为保持。effects 新增可选 rollbackVerified：true 表示应用失败而 exact active-before 已恢复并核验，state=failed/stage=rolledBack；不等于应用成功。未知/接管/回滚失败保持 indeterminate，可选 recoveryTransaction 为 `.community-apply-{UUID}` 安全标识，私有事务材料保留。恢复历史最多 128 目录/1 GiB，超限拒绝而不自动清理。

成功/已核验回滚收据继续使用 apply-results 和主账本；查询只读取，缺最终收据时私有请求中的 operationId 可恢复事务标识，不能推断成功/恢复。子进程、收据和主账本之间仍有中断窗口；未知不重放，恢复材料仍由现有管理器处理，本块不新增任意路径或自动恢复入口。已知失败/取消后用户可明确准备新的应用，生成新 ID/新确认；未知不可使用该入口。下载前端预算 240 秒容纳校验/素材检查，超时仍不自动重试。

P3-D 的运行时升级不下载、不覆盖安装目录，只在原平台锁中把 watcher 交接到当前完整包。expectedRuntimeRevision 绑定包内引擎指纹、原状态/活动内容/外观及平台身份；暂停、活动无效、包缺失或需先修复的身份拒绝。Windows fresh-session 可能重启 Codex，Mac 已有 CDP 时只交接 watcher；始终同连接五分钟一次性确认。effects.runtimeUpgraded 独立于 themeCommitted/rendererApplied；只有新 watcher 身份与包指纹匹配、内容提交和精确显示都核验才成功。engine-session 绑定新 PID/创建时间/脚本/Node 路径，当前进程元组仍已核验时才用于 runningEngineRevision；无法证明时为 null。

operations.list 返回 `{revision, operations, warnings, nextCursor?}`，limit 1–200、默认 50，页面使用 20。列表省略每项嵌套 snapshot，点击后查 operations.get；旧会话嵌套快照不可覆盖当前状态。坏记录仅提示，不删除；跨窗口未完成 queued/awaitingConfirmation/running 统一保守返回 indeterminate，不写回、不消费旧确认。正常关闭会持久取消未消费确认并排空已接受任务，退出后再次取消新出现的确认；业务退出不停止 watcher、不卸下当前皮肤。EOF/信号/显式关闭走同一路径，强杀和持久化失败仍可能未知。

应用完成收据绑定 ID/方法/主题/内容版本，运行时收据绑定 ID/方法/运行时版本，库事务增加可选 expectedRevision 并绑定方法。收据落盘后主账本更新；查询只合并匹配的完成结果，不执行 writer。旧收据缺新增绑定时保守不作成功依据；保留旧记录，不搬库、不改主题 schema 或 .cdskin。共享核心是唯一业务入口；平台子进程只接收内部固定请求，不对网页开放路径或脚本。

P3-D 已编码当前连接事件及两端宿主转发，仍保留每 15 秒/窗口激活与手动只读刷新、操作查询兜底。所有行为尚未统一验证。

事件携带 protocol、kind=event、backendSessionId、sequence、event；status.changed 另带 snapshot，operation.changed 另带 operation，status.invalidated/session.closing 无负载。sequence 在单个后端会话递增，与状态 sequence 分离；页面/宿主丢弃旧会话和旧序号。订阅返回当前会话/subscribed，初次状态异步送达；状态/操作通知按键合并最多 32 项并等待输出背压，不保证每个中间状态都送达，不提供消息日志或断线恢复。status.invalidated 清空可操作快照，session.closing 禁用会话动作；读请求可重复，副作用不自动重放。

首批错误码：PROTOCOL_UNSUPPORTED、INVALID_REQUEST、METHOD_UNSUPPORTED、BACKEND_UNAVAILABLE、THEME_NOT_FOUND、THEME_INVALID、THEME_CHANGED、CATALOG_CHANGED、MEDIA_UNSUPPORTED、RESOURCE_EXPIRED、BUSY、CONFIRMATION_EXPIRED、OPERATION_CONFLICT、OPERATION_UNKNOWN、RUNTIME_CHANGED、RUNTIME_UNAVAILABLE、RENDERER_UNVERIFIED、IO_ERROR、TIMEOUT。

retryable 只表示条件可能恢复，不授权客户端重试副作用。旧脚本的自由文本错误在适配器分类，不能猜测错误内容并自动重启；无法可靠分类时返回诊断及保守结果。

## 7. P1 已编码范围与待验收项

- 已编写请求运行时校验、消息大小和版本拒绝、素材资源入口、原生壳限制与操作日志；所有当前新增范围尚未统一验证，本文件不是已验收的安全边界。
- 适配器复用旧发布、启动与 verify；Windows 视频仍走单 Codex 会话，mismatch/uninspectable 通过当前管理器的恢复/修复能力处理。Mac 冷视频保留旧 CDP 解码前提，不绕过校验；这些限制不等于 P1 平台退出条件已通过。
- 模拟后端可以用于开发 UI，但真实应用完成声明必须来自相应平台的实际结果，不能用模拟状态代替。
- 不要求前端先订阅才能执行只读请求；副作用状态始终可以通过 operations.get/status.get 恢复。

## 8. P4-E 桌面能力与维护（源码契约，未验收）

| 方法 | 参数 | 结果 / 边界 |
| --- | --- | --- |
| `desktop.get` | `{}` | language、resolvedLanguage、hostVersion、login；登录项明确区分 unsupported/enabled/disabled/requiresApproval/unavailable |
| `desktop.language` | `{language: "system" \| "zh-CN" \| "en-US"}` | 保存原生偏好并返回更新后信息；页面不重载、不重建编辑草稿 |
| `desktop.open` | `{target}` | themes/images/state/website/gallery/studio 固定枚举；返回 opened，不接受任意 URL 或路径 |
| `desktop.login` | `{enabled: boolean}` | Mac 仅当前 app 的 SMAppService，返回实际状态；Windows 不支持 |
| `desktop.intents` | `{}` | 最多八条有界原生导航意图；每条 id/page/section/link，领取不执行业务动作 |
| `desktop.notifyUpdate` | `{handle}` | 核心从有效更新提案提供通道/版本，宿主生成固定通知并返回 delivered；不接受网页自拟内容 |
| `maintenance.inspect` | `{}` | Mac 引擎包/已部署版本和当前可准备动作；Windows 不声明 |
| `maintenance.prepare` | `{action}` | engine.install/engine.uninstall；返回随机 handle、五分钟期限及影响说明，绑定当前候选 |
| `maintenance.execute` | `{operationId, handle, accepted: true}` | 当前会话批准，持久意图后异步执行；同 ID 同批准只返回原记录，冲突拒绝 |
| `maintenance.get` | `{operationId}` | 只读原维护记录；queued/running/succeeded/failed/indeterminate，旧会话中断转待核对，不执行或自动重试 |

`desktop.*` 由宿主拦截，经内部 `desktop.authorize` 将原方法/原参数交给核心校验，再执行受限原生能力；内部授权响应不交给页面。主题、运行时、更新和维护写入互斥。Mac 维护在跨进程主题锁内重新检查批准绑定，安装继承原锁；卸载专用恢复参数要求内部模式及继承锁，先恢复/归档备份，再保留部署引擎；不自动处理旧桌面入口或 SwiftBar。

两端正式入口接受 `dreamskin://apply?version=ver_[a-z0-9]{8,64}` 后进入有界队列。页面领取仅导航及填入输入框；已有社区草稿时必须明确处理，不自动读元数据、下载或应用。Mac 菜单只导航，共享窗口关闭隐藏、Dock 重开，正常退出关闭后端输入以排空已接受工作。Windows 通过独立 mutex 和当前用户管道激活既有窗口。

本节描述已写源码和预定边界；单实例、协议注册、登录项/通知权限、维护锁/批准漂移、恢复及两端打包均待统一验证，不能据此声明平台验收通过。
