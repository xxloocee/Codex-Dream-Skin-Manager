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

const initial: CommunityQuery = { limit: 24, offset: 0, sort: "recent", query: "", appearance: "all" };
const size = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function CommunityLibrary({ client, visible, busy, canApply, platform, engineVersion, downloadUpdate, onAction, onDelete, application = "codex", activeThemes }: {
  client: ManagerClient; visible: boolean; busy: boolean; canApply: boolean; downloadUpdate: CommunityDownloadUpdate | null;
  platform: HelloResult["platform"]; engineVersion: string | null;
  application?: "codex" | "claude";
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
    if (downloadUpdate) setPage(previous => previous ? { ...previous, items: previous.items.map(item => item.id === downloadUpdate.version ? { ...item, downloaded: downloadUpdate.downloaded } : item) } : previous);
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
      if (update && update !== updateAtStart) value = { ...value, items: value.items.map(item => item.id === update.version ? { ...item, downloaded: update.downloaded } : item) };
      setPage(value); setSelected(previous => value.items.some(theme => theme.id === previous) ? previous : value.items[0]?.id ?? "");
      scroll.current?.scrollTo({ top: 0 });
    }, error => { if (active) setError(errorMessage(error, "社区主题读取失败，请稍后重试。")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, opened, query, refresh]);
  const theme = page?.items.find(value => value.id === selected);
  const activeSelection = !!theme?.downloaded && activeThemes.some(ref => ref?.source === theme.downloaded!.theme.source && ref.id === theme.downloaded!.theme.id);
  const declaration = theme ? mergeCommunityCompatibility(mergeCommunityCompatibility({ applyCompatible: theme.applyCompatible, platforms: theme.platforms }, theme.compatibility), theme.downloaded?.compatibility) : undefined;
  function filter(patch: Partial<CommunityQuery>) { setQuery(previous => ({ ...previous, ...patch, offset: 0 })); }
  return <div className="community-layout">
    <section className="library" aria-labelledby="community-heading" aria-busy={loading}>
      <div className="community-heading"><h2 id="community-heading">{tr("社区主题库")}</h2>
        <button disabled={loading} onClick={() => setRefresh(value => value + 1)}>{tr("刷新")}</button></div>
      <form className="library-filters community-filters" onSubmit={event => { event.preventDefault(); if (!loading) { filter({ query: draft.trim() }); } }}>
        <label className="search"><span>{tr("搜索主题名或作者")}</span><input type="search" maxLength={80} value={draft} onChange={event => setDraft(event.target.value)} aria-label={tr("搜索主题名或作者")} placeholder={tr("搜索主题名或作者")} /></label>
        <button type="submit" disabled={loading}>{tr("搜索")}</button>
        <label>{tr("排序")}<Select aria-label={tr("社区排序")} disabled={loading} value={query.sort} onChange={value => filter({ sort: value as CommunityQuery["sort"] })}
          options={[{ value: "recent", label: tr("最新发布") }, { value: "popular", label: tr("下载热度") }, { value: "favorites", label: tr("收藏最多") }]} /></label>
        <label>{tr("外观")}<Select aria-label={tr("社区外观")} disabled={loading} value={query.appearance} onChange={value => filter({ appearance: value as CommunityQuery["appearance"] })}
          options={[{ value: "all", label: tr("全部外观") }, { value: "light", label: tr("浅色") }, { value: "dark", label: tr("深色") }]} /></label>
      </form>
      <div className="theme-scroll" ref={scroll} tabIndex={0} aria-label={tr("社区主题列表")}>
        <div className="theme-grid community-grid">{page?.items.map(item => <button key={item.id} type="button" className={`theme-card ${selected === item.id ? "active" : ""}`}
          aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
          <MediaPreview client={client} target={{ kind: "community", version: item.id, variant: "thumbnail" }} name={item.name} application={application} visible={visible} thumbnail />
          <div className="theme-card-caption"><strong title={item.name}><span>{item.name}</span></strong><small className="community-author" title={item.authorDisplayName}>{item.authorDisplayName}</small>
            <div className="theme-card-badges"><small>{size(item.packageBytes)}</small><small>{tr("下载")} {item.downloadCount}</small>
              {item.downloaded && <small>{tr("已下载")}</small>}</div></div>
        </button>)}</div>
        {loading && <p className="empty" role="status">{tr("正在读取社区主题…")}</p>}
        {error && <div className="empty" role="alert"><p>{msg(error)}</p><button onClick={() => setRefresh(value => value + 1)}>{tr("重试")}</button></div>}
        {!loading && !error && page && !page.items.length && <div className="empty"><p>{tr("没有符合条件的社区主题。")}</p>
          {(query.query || query.appearance !== "all") && <button onClick={() => { setDraft(""); setQuery(initial); }}>{tr("清除筛选")}</button>}</div>}
      </div>
      <div className="community-pagination" aria-label={tr("社区分页")}>
        <span className="muted" role="status">{page ? tr("共 {total} 个主题 · 第 {page} 页", { total: page.total, page: Math.floor(page.offset / page.limit) + 1 }) : ""}</span>
        <button disabled={loading || !page || page.offset === 0} onClick={() => setQuery(previous => ({ ...previous, offset: Math.max(0, previous.offset - previous.limit) }))}>{tr("上一页")}</button>
        <button disabled={loading || !page || page.offset + page.limit >= page.total || page.offset + page.limit > 1000000} onClick={() => setQuery(previous => ({ ...previous, offset: previous.offset + previous.limit }))}>{tr("下一页")}</button>
      </div>
    </section>
    <aside className="inspector dashboard-inspector community-inspector" aria-label={tr("社区主题详情")}>
      {theme ? <>
        <MediaPreview key={theme.id} client={client} target={{ kind: "community", version: theme.id, variant: "preview" }} name={theme.name}
          parameters={previewParameters(emptyParameters, { appearance: application === "claude" ? "auto" : theme.appearance ?? "auto" })} application={application} visible={visible} />
        <div className="detail-body"><p className="eyebrow">{tr("社区主题")}</p><h2>{theme.name}</h2>
          <dl className="community-metadata"><dt>{tr("作者")}</dt><dd>{theme.authorDisplayName}</dd><dt>{tr("版本")}</dt><dd>{theme.version}</dd>
            <dt>{tr("许可")}</dt><dd>{theme.license}</dd><dt>{tr("大小")}</dt><dd>{size(theme.packageBytes)}</dd>
            <dt>{tr("支持平台")}</dt><dd>{declaration?.platforms?.length ? declaration.platforms.map(communityPlatformName).join(" / ") : tr("未声明")}</dd>
            <dt>{tr("下载")}</dt><dd>{theme.downloadCount}</dd><dt>{tr("收藏")}</dt><dd>{theme.favoriteCount}</dd></dl>
          <p className="muted">{tr("预览展示背景，实际外观以应用结果为准。")}</p>
          {communityCompatibilityMessages(declaration, platform, engineVersion).map((value, index) => <p className="muted" key={index}>{msg(value)}</p>)}
          <div className="editor-actions"><button className="primary" disabled={busy || !canApply} onClick={() => onAction(theme, "apply")}>{tr("应用主题")}</button>
            {theme.downloaded && <button disabled={busy || activeSelection} title={activeSelection ? tr("当前正在使用该主题，请先应用其他主题后再删除。") : undefined} onClick={() => onDelete(theme.downloaded!)}>{tr("删除已下载主题")}</button>}</div>
        </div>
      </> : <p className="muted">{tr("选择社区主题，查看预览与安装信息。")}</p>}
    </aside>
  </div>;
}
