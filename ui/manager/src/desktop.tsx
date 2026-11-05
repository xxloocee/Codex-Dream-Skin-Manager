import { createContext, useContext } from "react";
import type { LanguagePreference } from "../../../contracts/manager.mjs";
import { translateText } from "./ui-copy";
import { renderMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
export const LanguageContext = createContext<"zh-CN" | "en-US">("zh-CN");
export const copy = {
  console: ["控制台", "Console"], community: ["社区主题库", "Community"], import: ["导入图片", "Import media"], settings: ["主题设置", "Theme settings"],
  system: ["系统与信息", "System and information"], language: ["语言", "Language"], follow: ["跟随系统", "Follow system"],
  updates: ["软件更新", "Software updates"], maintenance: ["平台维护", "Platform maintenance"],
  refresh: ["刷新信息", "Refresh information"], themes: ["打开主题目录", "Open themes folder"], images: ["打开素材目录", "Open images folder"], state: ["打开状态目录", "Open state folder"],
  website: ["官方网站", "Website"], gallery: ["主题社区", "Theme gallery"], studio: ["在线编辑器", "Online studio"],
  login: ["登录时启动", "Launch at login"], enable: ["启用登录项", "Enable login item"], disable: ["关闭登录项", "Disable login item"],
  unsupported: ["此平台不支持登录项", "Login items are unavailable on this platform"], enabled: ["已启用", "Enabled"], disabled: ["未启用", "Disabled"],
  requiresApproval: ["需要在系统设置中批准", "Approval is required in System Settings"], unavailable: ["系统能力不可用", "System capability unavailable"],
  host: ["管理器宿主", "Manager host"], engine: ["包内引擎", "Bundled engine"], deployed: ["已部署引擎", "Deployed engine"],
  install: ["准备安装或修复引擎", "Prepare engine installation or repair"],
  uninstall: ["准备恢复并卸载引擎", "Prepare appearance restoration and engine removal"], approve: ["我已阅读影响并批准执行", "I have read the impact and approve this operation"],
  execute: ["执行本次批准", "Execute approved operation"], cancel: ["取消", "Cancel"], query: ["查询原记录", "Query existing record"],
  unknown: ["结果待核对，不自动重试。请保留原记录并核对平台状态。", "The result is uncertain. Keep this record and inspect platform state; no automatic retry occurs."],
  codex: ["打开 Codex / 运行控制", "Open Codex / Runtime controls"],
  codexHint: ["启动、继续或连接修复请使用控制台按钮；需要重启时保留既有确认。", "Use the console to start, resume or repair the connection. Restart confirmation remains required."],
  records: ["维护操作记录", "Maintenance records"], missing: ["未部署或无法读取", "Not deployed or unavailable"],
  completed: ["平台阶段已完成；运行效果仍需核对。", "The platform phase completed; runtime behavior still requires inspection."],
  incoming: ["已收到社区链接，请确认后查看；不会自动下载或应用。", "A community link was received. Review it before checking; nothing downloads or applies automatically."],
  blockedLink: ["有未完成操作或社区草稿，保留收到的链接；请先完成或取消当前步骤。", "An operation or community draft is active. The received link is retained; finish or cancel the current step."],
  useLink: ["清空社区草稿并填入此链接", "Clear community draft and use this link"], ignoreLink: ["忽略此链接", "Dismiss this link"],
  preparing: ["正在读取维护信息…", "Reading maintenance information…"],
  queued: ["已排队", "Queued"], running: ["正在处理", "Running"], succeeded: ["已完成", "Completed"], failed: ["未完成", "Failed"], indeterminate: ["结果待核对", "Needs reconciliation"],
  restoring: ["正在查询原记录…", "Querying the existing record…"], bridge: ["桥接协议", "Bridge protocol"],
  systemError: ["系统操作未完成。", "The system action did not complete."],
  maintenanceError: ["维护结果未确认，请查询原记录。", "The maintenance result is uncertain. Query the existing record."],
  submitted: ["本次批准已提交；请查询原记录，不会自动重复执行。", "This approval was submitted. Query the existing record; the operation will not repeat automatically."],
  installImpact: ["安装或修复部署引擎，可能重建预设和外观固定项。请先关闭 Codex；不启动 Codex，不创建桌面启动器。", "Install or repair the deployed engine. Presets and appearance pins may be recreated. Close Codex first; this does not launch Codex or create desktop launchers."],
  uninstallImpact: ["先恢复原外观并脱离皮肤会话，必要时重启 Codex；成功后保留部署引擎。主题、素材、备份和当前管理器保留；登录项需另行关闭。", "Restore the original appearance and detach the skin session, restarting Codex if needed, then retain the deployed engine outside its installation location. Themes, media, backups and this manager are retained. Disable the login item separately."],
} satisfies Record<string, readonly [string, string]>;
export type CopyKey = keyof typeof copy;
export function useCopy() { const language = useContext(LanguageContext); return (key: CopyKey) => copy[key][language === "zh-CN" ? 0 : 1]; }
export function useText() { const language = useContext(LanguageContext); return (value: string, values?: Record<string, string | number>) => translateText(language, value, values); }
export function useMessage() { const language = useContext(LanguageContext); return (value: UiMessage) => renderMessage(language, value); }
export function preference(value: string): LanguagePreference { return value === "zh-CN" || value === "en-US" ? value : "system"; }
