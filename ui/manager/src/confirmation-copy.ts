import { confirmationCopy } from "../../../contracts/manager.mjs";
import type { ConfirmationCopy, OperationSnapshot } from "../../../contracts/manager.mjs";
import { translateText } from "./ui-copy";
import { diagnosticText } from "./diagnostic-copy";

const restartImpact = "正在进行的 Codex 工作可能中断，是否继续？";
const entries: Record<ConfirmationCopy["kind"], { method: OperationSnapshot["method"]; reason: string; impact: string }> = {
  applyRestart: { method: "skin.apply", reason: "需要启动或重启 Codex 以建立皮肤会话。", impact: "正在进行的 Codex 工作可能中断。继续后将重新检查当前会话，再应用所选主题。" },
  resumeRestart: { method: "skin.resume", reason: "继续当前皮肤需要启动或重启 Codex。", impact: restartImpact },
  resetRestart: { method: "skin.reset", reason: "应用默认主题需要启动或重启 Codex。", impact: restartImpact },
  repairRestart: { method: "runtime.repair", reason: "连接修复需要启动或重启 Codex。", impact: restartImpact },
  restoreAppearance: { method: "skin.restore", reason: "恢复安装前的原始外观，需要停止皮肤会话，并可能关闭后正常重开 Codex。", impact: "仅还原皮肤管理的外观配置键，保留其他配置、主题库和活动副本；安装前备份将归档。正在进行的工作可能中断。" },
  upgradeRuntime: { method: "runtime.upgrade", reason: "将皮肤运行时交接到当前完整包的引擎，可能关闭并重启 Codex。", impact: restartImpact },
  deletePreset: { method: "themes.delete", reason: "删除“{subject}”？", impact: "内置主题及其素材将移入系统回收站或废纸篓。若清理失败，会保留隔离素材供恢复。" },
  deleteSaved: { method: "themes.delete", reason: "删除“{subject}”？", impact: "自定义主题及其本地素材将永久删除，无法撤销。失败时可能需要完成隔离素材清理。" },
  recoverReconcile: { method: "library.recover", reason: "处理 {subject}？", impact: "仅核对已发布内容并记录可确认结果，不重放原操作。" },
  recoverImport: { method: "library.recover", reason: "处理 {subject}？", impact: "重新校验完整暂存后发布到主题库；不会应用或启动 Codex。" },
  recoverDiscard: { method: "library.recover", reason: "处理 {subject}？", impact: "永久删除这一事务保留的暂存素材，不修改已发布主题。" },
  recoverPreset: { method: "library.recover", reason: "处理 {subject}？", impact: "完成已移除内置主题的系统回收站或废纸篓处理。" },
  recoverSaved: { method: "library.recover", reason: "处理 {subject}？", impact: "永久清理这一已移除主题的隔离素材。" },
};

export function confirmationText(language: "zh-CN" | "en-US", operation: OperationSnapshot): { reason: string; impact: string } | null {
  const original = operation.confirmation;
  if (!original) return null;
  const copy = confirmationCopy(original.copy), entry = copy && entries[copy.kind];
  if (!entry || entry.method !== operation.method) return { reason: diagnosticText(language, original.reason), impact: diagnosticText(language, original.impact) };
  // Subject is user data. The fallback label is ours; never translate the actual
  // name or infer a kind by matching the original human-readable description.
  return { reason: translateText(language, entry.reason, { subject: copy?.subject ?? translateText(language, "未完成事务") }),
    impact: translateText(language, entry.impact) };
}
