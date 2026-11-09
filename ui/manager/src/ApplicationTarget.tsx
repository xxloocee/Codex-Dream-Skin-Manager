import { useText } from "./desktop";
import { useEffect, useRef } from "react";
import codexIcon from "./assets/codex.png";
import claudeIcon from "./assets/claude.png";

export type ApplicationTarget = "codex" | "claude";

function ApplicationIcon({ source }: { source: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    // Bundled icons decode in memory because the manager CSP excludes data: image URLs.
    const bytes = Uint8Array.from(atob(source.slice(source.indexOf(",") + 1)), value => value.charCodeAt(0));
    void createImageBitmap(new Blob([bytes], { type: "image/png" })).then(bitmap => {
      if (active) canvas.current?.getContext("2d")?.drawImage(bitmap, 0, 0, 96, 96);
      bitmap.close();
    }).catch(error => console.error("Application icon decode failed", error));
    return () => { active = false; };
  }, [source]);
  return <canvas ref={canvas} className="application-icon" width={96} height={96} aria-hidden="true" />;
}

export function ApplicationTargets({ value, onChange, disabled }: {
  value: ApplicationTarget; onChange(value: ApplicationTarget): void;
  disabled: boolean;
}) {
  const tr = useText();
  return <div className="application-targets" role="group" aria-label={tr("应用目标")}>
      {(["codex", "claude"] as const).map(target => <button key={target} className={`application-target target-${target}`} aria-pressed={value === target}
        aria-label={target === "codex" ? "Codex" : "Claude Desktop"} disabled={disabled}
        title={`${target === "codex" ? "Codex" : "Claude Desktop"}${disabled ? ` · ${tr("请先完成当前操作或保存主题草稿。")}` : ""}`} onClick={() => onChange(target)}>
        <ApplicationIcon source={target === "codex" ? codexIcon : claudeIcon} />
      </button>)}
  </div>;
}
