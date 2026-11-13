import type { ApplicationTarget } from "./ApplicationTarget";
import { LanguageContext, useText } from "./desktop";
import { useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { HelloResult, ThemeSummary } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { Select } from "./Select";

const categories: Record<string, string> = { dynamic: "动态", people: "人物", anime: "动漫", landscape: "风景", city: "城市", animals: "萌宠", technology: "科技", art: "艺术" };
const identity = (theme: ThemeSummary) => `${theme.ref.source}:${theme.ref.id}`;
const modified = (theme: ThemeSummary) => { const time = Date.parse(theme.modifiedAt ?? ""); return Number.isFinite(time) ? time : -Infinity; };

export function ThemeLibrary({ client, platform, application = "codex", visible: pageVisible, themes, selected, busy, loading, onChoose, commands }: {
  client: ManagerClient | null; platform?: HelloResult["platform"] | undefined; visible: boolean;
  application?: ApplicationTarget;
  themes: ThemeSummary[]; selected: string; busy: boolean; loading: boolean;
  onChoose(theme: ThemeSummary): void; commands: ReactNode;
}) {
  const tr = useText();
  const language = useContext(LanguageContext);
  const [query, setQuery] = useState(""), [category, setCategory] = useState("all");
  const [source, setSource] = useState("all"), [kind, setKind] = useState("all"), [sort, setSort] = useState("catalog");
  const filtered = !!query || category !== "all" || source !== "all" || kind !== "all" || sort !== "catalog";
  const visible = useMemo(() => {
    const values = themes.filter(theme => (category === "all" || theme.displayCategories.includes(category)) &&
      (source === "all" || theme.ref.source === source) && (kind === "all" || (kind === "static" ? theme.mediaKind === "image" : theme.mediaKind !== "image")) &&
      `${theme.name} ${theme.tags.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return values.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, language, { numeric: true }) || identity(a).localeCompare(identity(b));
      if (sort === "modified") { const first = modified(a), second = modified(b); if (first !== second) return first > second ? -1 : 1; }
      return a.catalogOrder - b.catalogOrder || identity(a).localeCompare(identity(b));
    });
  }, [themes, query, category, source, kind, sort, language]);
  function clear() { setQuery(""); setCategory("all"); setSource("all"); setKind("all"); setSort("catalog"); }
  return <section className="library" aria-label={tr("主题库")} aria-busy={loading}>
    <h2 className="library-heading">{tr("主题库")}</h2>
    <div className="library-filters">
      <label className="search"><span>{tr("搜索名称或标签")}</span><input type="search" aria-label={tr("搜索名称或标签")} value={query} onChange={event => setQuery(event.target.value)} placeholder={tr("主题名称或标签")} /></label>
      <label>{tr("分类")}<Select aria-label={tr("分类")} value={category} onChange={setCategory}
        options={[{ value: "all", label: tr("全部分类") }, ...Object.entries(categories).map(([value, label]) => ({ value, label: tr(label) }))]} /></label>
      <div className="source-filter" role="group" aria-label={tr("主题来源")}>
        {([["all", "全部"], ["preset", "内置"], ["saved", "我的"]] as const).map(([id, label]) => <button key={id} aria-pressed={source === id} onClick={() => setSource(id)}>{tr(label)}</button>)}
      </div>
      <label>{tr("排序")}<Select aria-label={tr("排序")} value={sort} onChange={setSort}
        options={[{ value: "catalog", label: tr("目录顺序") }, { value: "name", label: tr("名称排序") }, ...(platform === "macos" ? [{ value: "modified", label: tr("最近修改") }] : [])]} /></label>
      {platform === "macos" && <label>{tr("素材")}<Select aria-label={tr("素材")} value={kind} onChange={setKind}
        options={[{ value: "all", label: tr("全部素材") }, { value: "static", label: tr("静态图片") }, { value: "dynamic", label: tr("动态／视频") }]} /></label>}
    </div>
    <div className="library-commands">{commands}</div>
    <div className="theme-scroll" tabIndex={0} aria-label={tr("主题库")}>
    <div className="theme-grid">{visible.map(theme => {
      return <button disabled={busy} aria-pressed={selected === identity(theme)} className={`theme-card ${selected === identity(theme) ? "active" : ""}`} key={identity(theme)} onClick={() => onChoose(theme)}>
        {client ? <MediaPreview key={theme.revision} client={client} target={{ kind: "theme", theme: theme.ref, revision: theme.revision, variant: "thumbnail" }} name={theme.name}
          mediaKind={theme.mediaKind} application={application} visible={pageVisible} thumbnail /> : <div className="theme-art">{tr("预览未连接")}</div>}
        <div className="theme-card-caption">
          <strong title={theme.name}><i className={`category-dot category-${theme.displayCategories[0] ?? "art"}`} /><span>{theme.name}</span></strong>
          <div className="theme-card-badges">
            <small>{theme.ref.source === "preset" ? tr("内置") : tr("我的")}</small>
            {(theme.displayCategories.length ? theme.displayCategories : ["art"]).map(category =>
              <small className="theme-category-badge" key={category}>{tr(categories[category] ?? category)}</small>)}
          </div>
        </div>
      </button>;
    })}</div>
    {loading && <p className="empty" role="status">{tr("正在读取主题库…")}</p>}
    {!loading && !visible.length && <div className="empty"><p>{themes.length ? tr("没有符合条件的主题。") : tr("没有可读取的主题。")}</p>{filtered && <button onClick={clear}>{tr("清除筛选")}</button>}</div>}
    </div>
  </section>;
}
