import { applicationNames, type ApplicationTarget } from "./ApplicationTarget";
import { useEffect, useRef, useState } from "react";
import type { CommunityPage, CommunityQuery, CommunityTheme, HelloResult, ThemeRef } from "../../../contracts/manager.mjs";
import type { ManagerClient } from "./client";
import type { CommunityActionRequest, CommunityDownloadUpdate } from "./CommunityPanel";
import { useMessage, useText } from "./desktop";
import { MediaPreview } from "./MediaPreview";
import { emptyParameters, previewParameters } from "./preview-model";
import { Select } from "./Select";
import { errorMessage } from "./ui-message";
import type { UiMessage } from "./ui-message";
import { communityCompatibilityMessages, communityPlatformName, mergeCommunityCompatibility } from "./community-compatibility";
import { SearchIcon, HeartIcon, DownloadIcon, SparklesIcon, TrashIcon, RefreshIcon, XIcon } from "./Icons";

const initial: CommunityQuery = { limit: 24, offset: 0, sort: "recent", query: "", appearance: "all" };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function CommunityLibrary({
  client,
  visible,
  busy,
  canApply,
  platform,
  engineVersion,
  downloadUpdate,
  onAction,
  onDelete,
  application = "codex",
  activeThemes,
}: {
  client: ManagerClient;
  visible: boolean;
  busy: boolean;
  canApply: boolean;
  downloadUpdate: CommunityDownloadUpdate | null;
  platform: HelloResult["platform"];
  engineVersion: string | null;
  application?: ApplicationTarget | undefined;
  activeThemes: (ThemeRef | null)[];
  onAction(theme: CommunityTheme, action: CommunityActionRequest["action"]): void;
  onDelete(local: NonNullable<CommunityTheme["downloaded"]>): void;
}) {
  const tr = useText(), msg = useMessage();
  const [opened, setOpened] = useState(false), [query, setQuery] = useState<CommunityQuery>(initial), [draft, setDraft] = useState("");
  const [page, setPage] = useState<CommunityPage | null>(null), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false), [error, setError] = useState<UiMessage>(""), [refresh, setRefresh] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const latestDownload = useRef(downloadUpdate);
  latestDownload.current = downloadUpdate;

  useEffect(() => {
    if (downloadUpdate) {
      setPage(previous =>
        previous
          ? { ...previous, items: previous.items.map(item => item.id === downloadUpdate.version ? { ...item, downloaded: downloadUpdate.downloaded } : item) }
          : previous
      );
    }
  }, [downloadUpdate]);
  useEffect(() => { if (visible) setOpened(true); }, [visible]);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    const updateAtStart = latestDownload.current;
    setLoading(true); setError(""); setPage(null);
    void client.call("community.list", query).then(value => {
      if (!active) return;
      const update = latestDownload.current;
      if (update && update !== updateAtStart) {
        value = { ...value, items: value.items.map(item => item.id === update.version ? { ...item, downloaded: update.downloaded } : item) };
      }
      setPage(value);
      setSelected(previous => value.items.some(theme => theme.id === previous) ? previous : value.items[0]?.id ?? "");
      scroll.current?.scrollTo({ top: 0 });
    }, error => {
      if (active) setError(errorMessage(error, "社区主题读取失败，请稍后重试。"));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client, opened, query, refresh]);

  const theme = page?.items.find(value => value.id === selected);
  const activeSelection = !!theme?.downloaded && activeThemes.some(ref => ref?.source === theme.downloaded!.theme.source && ref.id === theme.downloaded!.theme.id);
  const declaration = theme
    ? mergeCommunityCompatibility(mergeCommunityCompatibility({ applyCompatible: theme.applyCompatible, platforms: theme.platforms }, theme.compatibility), theme.downloaded?.compatibility)
    : undefined;

  function filter(patch: Partial<CommunityQuery>) { setQuery(previous => ({ ...previous, ...patch, offset: 0 })); }

  return (
    <div className="community-layout modern-community-layout">
      <section className="library modern-gallery-panel" aria-label={tr("社区主题库")} aria-busy={loading}>
        <div className="gallery-toolbar-two-rows">
          <form
            className="gallery-toolbar-row row-primary"
            onSubmit={event => {
              event.preventDefault();
              if (!loading) filter({ query: draft.trim() });
            }}
          >
            <div className="gallery-toolbar-left">
              <div className="gallery-search-wrap">
                <SearchIcon className="gallery-search-icon" />
                <input
                  type="search"
                  maxLength={80}
                  aria-label={tr("搜索主题名或作者")}
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder={tr("搜索社区主题名或作者…")}
                  className="gallery-search-input"
                />
                {(draft || query.query) && (
                  <button
                    type="button"
                    className="search-clear-btn"
                    aria-label={tr("清空搜索")}
                    onClick={() => {
                      setDraft("");
                      if (query.query && !loading) filter({ query: "" });
                    }}
                  >
                    <XIcon />
                  </button>
                )}
              </div>
              <button type="submit" className="gallery-action-btn" disabled={loading}>
                <SearchIcon />
                <span>{tr("搜索")}</span>
              </button>
            </div>

            <div className="gallery-actions-wrap">
              <button type="button" className="gallery-action-btn" disabled={loading} onClick={() => setRefresh(v => v + 1)}>
                <RefreshIcon />
                <span>{tr("刷新")}</span>
              </button>
              <span className="gallery-count-badge">
                {page ? tr("共 {total} 个主题", { total: page.total }) : ""}
              </span>
            </div>
          </form>

          <div className="gallery-toolbar-row row-secondary">
            <div className="gallery-category-chips" role="group" aria-label={tr("社区外观")}>
              {([["all", "全部外观"], ["light", "浅色"], ["dark", "深色"]] as const).map(([val, label]) => (
                <button
                  type="button"
                  key={val}
                  aria-pressed={query.appearance === val}
                  className={`category-chip ${query.appearance === val ? "active" : ""}`}
                  onClick={() => filter({ appearance: val })}
                >
                  {tr(label)}
                </button>
              ))}
            </div>

            <div className="gallery-filters-right">
              <div className="gallery-sort-wrap">
                <Select
                  aria-label={tr("社区排序")}
                  disabled={loading}
                  value={query.sort}
                  onChange={value => filter({ sort: value as CommunityQuery["sort"] })}
                  options={[
                    { value: "recent", label: tr("最新发布") },
                    { value: "popular", label: tr("下载热度") },
                    { value: "favorites", label: tr("收藏最多") },
                  ]}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="theme-scroll modern-theme-scroll" ref={scroll} tabIndex={0} aria-label={tr("社区主题列表")}>
          <div className="theme-grid">
            {page?.items.map(item => {
              const isSelected = selected === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`theme-card ${isSelected ? "active" : ""} ${item.downloaded ? "is-in-use" : ""}`}
                  aria-pressed={isSelected}
                  onClick={() => setSelected(item.id)}
                >
                  <div className="theme-thumbnail-wrapper">
                    <MediaPreview client={client} target={{ kind: "community", version: item.id, variant: "thumbnail" }} name={item.name} application={application} visible={visible} thumbnail />
                    {item.downloaded && (
                      <span className="theme-in-use-pill" title={tr("已下载")}>
                        <span className="pill-dot" />
                        <span>{tr("已下载")}</span>
                      </span>
                    )}
                  </div>
                  <div className="theme-card-caption">
                    <div className="theme-caption-top">
                      <span className="theme-caption-left">
                        <span className={`theme-status-indicator ${item.downloaded ? "active" : isSelected ? "selected" : ""}`} />
                        <span className="theme-card-name" title={item.name}>{item.name}</span>
                      </span>
                      <span className="theme-card-source" title={item.authorDisplayName}>@{item.authorDisplayName}</span>
                    </div>
                    <div className="theme-card-tags">
                      <span className="theme-tag-chip category-badge">
                        {item.appearance === "dark" ? tr("深色") : item.appearance === "light" ? tr("浅色") : tr("通用")}
                      </span>
                      <span className="theme-tag-chip">{size(item.packageBytes)}</span>
                      <span className="theme-card-likes">
                        <HeartIcon />
                        <span>{item.favoriteCount ?? item.downloadCount}</span>
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {loading && <p className="empty" role="status">{tr("正在读取社区主题…")}</p>}
          {error && (
            <div className="empty" role="alert">
              <p>{msg(error)}</p>
              <button type="button" onClick={() => setRefresh(v => v + 1)}>{tr("重试")}</button>
            </div>
          )}
          {!loading && !error && page && !page.items.length && (
            <div className="empty">
              <p>{tr("没有符合条件的社区主题。")}</p>
              {(query.query || query.appearance !== "all") && (
                <button type="button" onClick={() => { setDraft(""); setQuery(initial); }}>{tr("清除筛选")}</button>
              )}
            </div>
          )}
        </div>

        <div className="community-pagination-bar" aria-label={tr("社区分页")}>
          <span className="muted font-mono" role="status">
            {page ? tr("共 {total} 个主题 · 第 {page} 页", { total: page.total, page: Math.floor(page.offset / page.limit) + 1 }) : ""}
          </span>
          <div className="pagination-btns">
            <button
              type="button"
              className="btn-sm"
              disabled={loading || !page || page.offset === 0}
              onClick={() => setQuery(p => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))}
            >
              {tr("上一页")}
            </button>
            <button
              type="button"
              className="btn-sm"
              disabled={loading || !page || page.offset + page.limit >= page.total || page.offset + page.limit > 1000000}
              onClick={() => setQuery(p => ({ ...p, offset: p.offset + p.limit }))}
            >
              {tr("下一页")}
            </button>
          </div>
        </div>
      </section>

      <aside className="inspector modern-inspector-panel community-inspector" aria-label={tr("社区主题详情")}>
        {theme ? (
          <>
            <div className="inspector-viewport-wrapper">
              <div className="inspector-viewport-inner">
                <MediaPreview
                  key={theme.id}
                  client={client}
                  target={{ kind: "community", version: theme.id, variant: "preview" }}
                  name={theme.name}
                  parameters={previewParameters(emptyParameters, { appearance: application !== "codex" ? "auto" : theme.appearance ?? "auto" })}
                  application={application}
                  visible={visible}
                />
                <div className="terminal-header-overlay" aria-hidden="true">
                  <div className="terminal-dots"><span className="dot" /><span className="dot" /></div>
                  <span className="terminal-agent-label">{applicationNames[application]}</span>
                </div>
              </div>
            </div>

            <div className="inspector-content">
              <div className="inspector-title-row">
                <h2 className="inspector-theme-name" title={theme.name}>{theme.name}</h2>
                <span className="inspector-runtime-status">@{theme.authorDisplayName}</span>
              </div>

              <button
                type="button"
                className="primary inspector-btn-apply"
                disabled={busy || !canApply}
                onClick={() => onAction(theme, "apply")}
              >
                <SparklesIcon className="btn-icon" />
                <span>{tr(theme.downloaded ? `应用到 ${applicationNames[application]}` : `获取并应用到 ${applicationNames[application]}`)}</span>
              </button>

              {!theme.downloaded && (
                <button
                  type="button"
                  className="subtool-btn community-download-btn"
                  disabled={busy}
                  onClick={() => onAction(theme, "download")}
                >
                  <DownloadIcon className="btn-icon-sm" />
                  <span>{tr("仅下载到本地")}</span>
                </button>
              )}

              <dl className="community-metadata-grid">
                <div className="metadata-item"><dt>{tr("作者")}</dt><dd title={theme.authorDisplayName}>{theme.authorDisplayName}</dd></div>
                <div className="metadata-item"><dt>{tr("版本")}</dt><dd title={theme.version}>{theme.version}</dd></div>
                <div className="metadata-item"><dt>{tr("许可")}</dt><dd title={theme.license}>{theme.license}</dd></div>
                <div className="metadata-item"><dt>{tr("大小")}</dt><dd>{size(theme.packageBytes)}</dd></div>
                <div className="metadata-item">
                  <dt>{tr("支持平台")}</dt>
                  <dd>{declaration?.platforms?.length ? declaration.platforms.map(communityPlatformName).join(" / ") : tr("未声明")}</dd>
                </div>
                <div className="metadata-item">
                  <dt>{tr("下载")} / {tr("收藏")}</dt>
                  <dd>{theme.downloadCount} / {theme.favoriteCount}</dd>
                </div>
              </dl>

              {communityCompatibilityMessages(declaration, platform, engineVersion).map((value, index) => (
                <p className="notice" key={index}>{msg(value)}</p>
              ))}

              {theme.downloaded && (
                <div className="inspector-danger-footer">
                  <button
                    type="button"
                    className="btn-danger-ghost"
                    disabled={busy || activeSelection}
                    title={activeSelection ? tr("当前正在使用该主题，请先应用其他主题后再删除。") : undefined}
                    onClick={() => onDelete(theme.downloaded!)}
                  >
                    <TrashIcon className="btn-icon-sm" />
                    <span>{tr("删除已下载主题")}</span>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty inspector-empty">{tr("选择社区主题，查看预览与安装信息。")}</div>
        )}
      </aside>
    </div>
  );
}
