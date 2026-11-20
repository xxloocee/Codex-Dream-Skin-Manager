import type { ApplicationTarget } from "./ApplicationTarget";
import { LanguageContext, useText } from "./desktop";
import { useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { HelloResult, ThemeSummary } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import { MediaPreview } from "./MediaPreview";
import { Select } from "./Select";
import { SearchIcon, XIcon } from "./Icons";

const categories: Record<string, string> = {
  dynamic: "动态",
  landscape: "风景",
  people: "人物",
  anime: "动漫",
  city: "城市",
  animals: "萌宠",
  technology: "科技",
  art: "艺术",
};
const identity = (theme: ThemeSummary) => `${theme.ref.source}:${theme.ref.id}`;
const modified = (theme: ThemeSummary) => { const time = Date.parse(theme.modifiedAt ?? ""); return Number.isFinite(time) ? time : -Infinity; };

export function ThemeLibrary({
  client,
  platform,
  application = "codex",
  visible: pageVisible,
  themes,
  selected,
  activeThemeId = "",
  busy,
  loading,
  onChoose,
  commands,
}: {
  client: ManagerClient | null;
  platform?: HelloResult["platform"] | undefined;
  visible: boolean;
  application?: ApplicationTarget | undefined;
  themes: ThemeSummary[];
  selected: string;
  activeThemeId?: string | undefined;
  busy: boolean;
  loading: boolean;
  onChoose(theme: ThemeSummary): void;
  commands: ReactNode;
}) {
  const tr = useText();
  const language = useContext(LanguageContext);
  const [query, setQuery] = useState(""), [category, setCategory] = useState("all");
  const [source, setSource] = useState("all"), [kind, setKind] = useState("all"), [sort, setSort] = useState("catalog");
  const filtered = !!query || category !== "all" || source !== "all" || kind !== "all" || sort !== "catalog";

  const visible = useMemo(() => {
    const values = themes.filter(theme =>
      (category === "all" || theme.displayCategories.includes(category)) &&
      (source === "all" || theme.ref.source === source) &&
      (kind === "all" || (kind === "static" ? theme.mediaKind === "image" : theme.mediaKind !== "image")) &&
      `${theme.name} ${theme.tags.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    );
    return values.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, language, { numeric: true }) || identity(a).localeCompare(identity(b));
      if (sort === "modified") { const first = modified(a), second = modified(b); if (first !== second) return first > second ? -1 : 1; }
      return a.catalogOrder - b.catalogOrder || identity(a).localeCompare(identity(b));
    });
  }, [themes, query, category, source, kind, sort, language]);

  function clear() { setQuery(""); setCategory("all"); setSource("all"); setKind("all"); setSort("catalog"); }

  return (
    <section className="library modern-gallery-panel" aria-label={tr("主题库")} aria-busy={loading}>
      <div className="gallery-toolbar-two-rows">
        <div className="gallery-toolbar-row row-primary">
          <div className="gallery-toolbar-left">
            <div className="gallery-search-wrap">
              <SearchIcon className="gallery-search-icon" />
              <input
                type="search"
                aria-label={tr("搜索名称或标签")}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={tr("搜索主题或标签…")}
                className="gallery-search-input"
              />
              {query && (
                <button
                  type="button"
                  className="search-clear-btn"
                  aria-label={tr("清空搜索")}
                  onClick={() => setQuery("")}
                >
                  <XIcon />
                </button>
              )}
            </div>

            <div className="source-segmented" role="group" aria-label={tr("主题来源")}>
              {([["all", "全部"], ["preset", "内置"], ["saved", "我的"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`source-chip ${source === id ? "active" : ""}`}
                  aria-pressed={source === id}
                  onClick={() => setSource(id)}
                >
                  {tr(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="gallery-actions-wrap">
            {commands}
            <span className="gallery-count-badge" aria-live="polite">
              {visible.length}/{themes.length}
            </span>
          </div>
        </div>

        <div className="gallery-toolbar-row row-secondary">
          <div className="gallery-category-chips" role="group" aria-label={tr("分类")}>
            <button
              type="button"
              className={`category-chip ${category === "all" ? "active" : ""}`}
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              {tr("全部")}
            </button>
            {Object.entries(categories).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={`category-chip ${category === key ? "active" : ""}`}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                {tr(label)}
              </button>
            ))}
          </div>

          <div className="gallery-filters-right">
            <div className="gallery-sort-wrap">
              <Select
                aria-label={tr("素材")}
                value={kind}
                onChange={setKind}
                options={[
                  { value: "all", label: tr("全部素材") },
                  { value: "static", label: tr("静态图片") },
                  { value: "dynamic", label: tr("动态／视频") },
                ]}
              />
            </div>

            <div className="gallery-sort-wrap">
              <Select
                aria-label={tr("排序")}
                value={sort}
                onChange={setSort}
                options={[
                  { value: "catalog", label: tr("目录顺序") },
                  { value: "name", label: tr("名称排序") },
                  ...(platform === "macos" ? [{ value: "modified", label: tr("最近修改") }] : []),
                ]}
              />
            </div>

            {filtered && (
              <button type="button" className="filter-reset-chip" onClick={clear}>
                {tr("清除筛选")}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="theme-scroll modern-theme-scroll" tabIndex={0} aria-label={tr("主题库")}>
        <div className="theme-grid">
          {visible.map(theme => {
            const id = identity(theme);
            const isSelected = selected === id;
            const isInUse = activeThemeId === id;
            return (
              <button
                type="button"
                disabled={busy}
                aria-pressed={isSelected}
                className={`theme-card ${isSelected ? "active" : ""} ${isInUse ? "is-in-use" : ""}`}
                key={id}
                onClick={() => onChoose(theme)}
              >
                <div className="theme-thumbnail-wrapper">
                  {client ? (
                    <MediaPreview
                      key={theme.revision}
                      client={client}
                      target={{ kind: "theme", theme: theme.ref, revision: theme.revision, variant: "thumbnail" }}
                      name={theme.name}
                      mediaKind={theme.mediaKind}
                      application={application}
                      visible={pageVisible}
                      thumbnail
                    />
                  ) : (
                    <div className="theme-art">{tr("预览未连接")}</div>
                  )}
                  {isInUse && (
                    <span className="theme-in-use-pill" title={tr("当前正在使用的皮肤")}>
                      <span className="pill-dot" />
                      <span>{tr("当前")}</span>
                    </span>
                  )}
                  {theme.mediaKind === "video" && <span className="theme-video-pill">▶ {tr("视频")}</span>}
                  {theme.mediaKind === "animatedImage" && <span className="theme-video-pill">✦ {tr("动图")}</span>}
                </div>

                <div className="theme-card-caption">
                  <div className="theme-caption-top">
                    <span className="theme-caption-left">
                      <span className={`theme-status-indicator ${isInUse ? "active" : isSelected ? "selected" : ""}`} />
                      <span className="theme-card-name" title={theme.name}>{theme.name}</span>
                    </span>
                    <span className="theme-card-source">{theme.ref.source === "preset" ? tr("内置") : tr("我的")}</span>
                  </div>
                  {(theme.displayCategories.length > 0 || theme.tags.length > 0) && (
                    <div className="theme-card-tags">
                      {theme.displayCategories.slice(0, 2).map(cat => (
                        <span key={cat} className="theme-tag-chip category-badge">
                          {tr(categories[cat] ?? cat)}
                        </span>
                      ))}
                      {theme.tags
                        .filter(tag => !theme.displayCategories.some(c => categories[c] === tag || c === tag))
                        .slice(0, 2)
                        .map(tag => (
                          <span key={tag} className="theme-tag-chip">{tag}</span>
                        ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {loading && <p className="empty" role="status">{tr("正在读取主题库…")}</p>}
        {!loading && !visible.length && (
          <div className="empty">
            <p>{themes.length ? tr("没有符合条件的主题。") : tr("没有可读取的主题。")}</p>
            {filtered && <button type="button" onClick={clear}>{tr("清除筛选")}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
