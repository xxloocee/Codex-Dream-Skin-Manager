import AppKit
import SwiftUI
import AVKit
import ImageIO
import CryptoKit

struct ManagerTheme: Identifiable {
  let id: String
  let name: String
  let category: String
  let tags: [String]
  let directory: URL
  let media: URL
  let config: [String: Any]
  var contentHash = ""
  var isPreset: Bool { id.hasPrefix("preset-") }
  var modified: Date { (try? directory.appendingPathComponent("theme.json").resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
  var video: Bool { media.pathExtension.lowercased() == "mp4" }
}

final class ManagerModel: ObservableObject {
  @Published var themes: [ManagerTheme] = []
  @Published var selectedID = ""
  @Published var status = "正在读取状态…"
  @Published var currentID = ""
  @Published var pendingID = ""
  @Published var draft: ManagerTheme?
  @Published var libraryRevision = 0
  @Published var log = ""
  var libraryAction: (String, [String], @escaping ([String: Any]?) -> Void) -> Void = { _, _, done in done(nil) }
  @Published var busy = false
  @Published var message = "选择皮肤预览，点击“应用皮肤”切换。"
  static let catalogOrder: [String: Int] = {
    guard let url = Bundle.main.url(forResource: "manager-catalog", withExtension: "json"),
          let data = try? Data(contentsOf: url),
          let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let themes = object["themes"] as? [[String: Any]] else { return [:] }
    var order: [String: Int] = [:]
    for (index, theme) in themes.enumerated() { if let id = theme["id"] as? String { order["preset-" + id] = index } }
    return order
  }()
  let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CodexDreamSkinStudio/themes")
  var action: (String, String?) -> Void = { _, _ in }
  var selected: ManagerTheme? { themes.first { $0.id == selectedID } }

  func reload() {
    do {
      let directories = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey], options: [.skipsHiddenFiles])
      themes = directories.compactMap { dir in
        guard let values = try? dir.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey]), values.isDirectory == true, values.isSymbolicLink != true,
              let data = try? Data(contentsOf: dir.appendingPathComponent("theme.json")), data.count <= 1_048_576,
              let config = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              config["schemaVersion"] as? Int == 1,
              let id = config["id"] as? String, id == dir.lastPathComponent,
              let image = config["image"] as? String, !image.isEmpty, image == (image as NSString).lastPathComponent,
              id.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"#, options: .regularExpression) != nil else { return nil }
        let media = dir.appendingPathComponent(image)
        guard let info = try? media.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey]), info.isSymbolicLink != true, info.isRegularFile == true else { return nil }
        return ManagerTheme(id: id, name: config["name"] as? String ?? id, category: config["category"] as? String ?? "custom", tags: config["tags"] as? [String] ?? [], directory: dir, media: media, config: config, contentHash: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
      }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
      libraryRevision += 1
      if !themes.contains(where: { $0.id == selectedID }) { selectedID = themes.first?.id ?? "" }
    } catch { message = "读取主题失败：\(error.localizedDescription)" }
  }
}

struct ThemeThumbnail: View {
  let url: URL
  var art: [String: Any] = [:]
  @State private var image: NSImage?
  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .topLeading) {
        Color.black.opacity(0.08)
        if let image {
          let layout = ThemePreviewLayout.make(image: image.size, viewport: geometry.size, art: art)
          Image(nsImage: image).resizable()
            .frame(width: layout.width, height: layout.height)
            .offset(x: layout.minX, y: layout.minY)
        } else {
          Image(systemName: "photo").foregroundStyle(.secondary)
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
      }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
    }
    .task(id: url) {
      image = nil
      let sourceURL = url
      let result: NSImage? = await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
          let cg: CGImage?
          if sourceURL.pathExtension.lowercased() == "mp4" {
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: sourceURL))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 700, height: 440)
            cg = try? generator.copyCGImage(at: .zero, actualTime: nil)
          } else if let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) {
            cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 700, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
          } else { cg = nil }
          continuation.resume(returning: cg.map { NSImage(cgImage: $0, size: NSSize(width: $0.width, height: $0.height)) })
        }
      }
      if !Task.isCancelled { image = result }
    }
  }
}

// Avoid the _AVKit_SwiftUI VideoPlayer overlay: it aborts during generic
// superclass metadata initialization on the user's macOS runtime.
struct ThemeVideoPreview: NSViewRepresentable {
  let url: URL

  func makeNSView(context: Context) -> AVPlayerView {
    let view = AVPlayerView()
    view.controlsStyle = .inline
    view.videoGravity = .resizeAspect
    view.player = makePlayer()
    return view
  }

  func updateNSView(_ view: AVPlayerView, context: Context) {
    let currentURL = (view.player?.currentItem?.asset as? AVURLAsset)?.url
    guard currentURL != url else { return }
    view.player?.pause()
    view.player = makePlayer()
  }

  static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) {
    view.player?.pause()
    view.player?.replaceCurrentItem(with: nil)
    view.player = nil
  }

  private func makePlayer() -> AVPlayer {
    let player = AVPlayer(url: url)
    player.isMuted = true
    return player
  }
}

struct ManagerView: View {
  @ObservedObject var model: ManagerModel
  @State private var search = ""
  @State private var category = "全部"
  @State private var mediaFilter = "全部"
  @State private var tab = 0
  @State private var sourceFilter = "全部"
  @State private var sort = "目录顺序"
  @State private var showLog = false
  @State private var showVideo = false
  private let categories = ["dream": "梦幻", "nature": "自然", "cyber": "科技", "minimal": "简约", "dark": "暗色", "warm": "暖色", "custom": "自定义"]
  private var visibleThemes: [ManagerTheme] {
    let filtered = model.themes.filter {
      (search.isEmpty || ($0.name + " " + $0.tags.joined(separator: " ")).localizedCaseInsensitiveContains(search)) &&
      (category == "全部" || $0.category == category) &&
      (sourceFilter == "全部" || (sourceFilter == "内置" ? $0.isPreset : !$0.isPreset)) &&
      (mediaFilter == "全部" || (mediaFilter == "动态" ? $0.video : !$0.video))
    }
    switch sort {
    case "名称排序": return filtered.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    case "最近修改": return filtered.sorted { $0.modified > $1.modified }
    default: return filtered.sorted {
      let left = ManagerModel.catalogOrder[$0.id] ?? ($0.isPreset ? 1000 : 2000)
      let right = ManagerModel.catalogOrder[$1.id] ?? ($1.isPreset ? 1000 : 2000)
      return left == right ? $0.id < $1.id : left < right
    }
    }
  }
  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 14) {
        Image(systemName: "paintpalette.fill").font(.largeTitle).foregroundStyle(.indigo)
        VStack(alignment: .leading, spacing: 4) {
          Text("Codex Dream Skin").font(.title2.bold())
          Text("主题管理器 · macOS").foregroundStyle(.secondary)
        }
        Spacer()
        if model.busy { ProgressView().controlSize(.small) }
        Text(model.status).foregroundStyle(.secondary)
        Button("检查更新") { model.action("updates", nil) }.disabled(model.busy)
        Button { model.reload(); model.action("refresh", nil) } label: { Image(systemName: "arrow.clockwise") }.help("刷新主题和运行状态")
      }.padding(22)
      Divider()
      TabView(selection: $tab) {
        dashboard.tabItem { Label("控制台", systemImage: "square.grid.2x2") }.tag(0)
        imports.tabItem { Label("导入图片", systemImage: "square.and.arrow.down") }.tag(1)
        settings.tabItem { Label("主题设置", systemImage: "slider.horizontal.3") }.tag(2)
      }.padding(16)
      Divider()
      HStack {
        Text(model.message).font(.callout).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
        Spacer()
        Button("操作记录") { showLog = true }
        Button("安装 / 修复引擎") { model.action("repair", nil) }.disabled(model.busy)
        Button("主题文件夹") { NSWorkspace.shared.open(model.root) }
      }.padding(14)
    }.frame(minWidth: 1020, minHeight: 680)
      .sheet(isPresented: $showLog) {
        VStack(alignment: .leading) {
          Text("操作记录").font(.headline)
          ScrollView { Text(model.log.isEmpty ? model.message : model.log).font(.system(.body, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
          Button("关闭") { showLog = false }
        }.padding(20).frame(width: 700, height: 420)
      }
  }
  private var dashboard: some View {
    HStack(alignment: .top, spacing: 20) {
      VStack(alignment: .leading, spacing: 14) {
        HStack { Text("主题库").font(.title2.bold()); Text("\(visibleThemes.count) 款").foregroundStyle(.secondary); Spacer() }
        TextField("搜索名称或标签", text: $search).textFieldStyle(.roundedBorder)
        HStack {
          Picker("分类", selection: $category) {
            Text("全部分类").tag("全部")
            ForEach(Set(model.themes.map(\.category)).sorted(), id: \.self) { Text(categories[$0] ?? $0).tag($0) }
          }
          Picker("类型", selection: $mediaFilter) { ForEach(["全部", "静态", "动态"], id: \.self) { Text($0) } }.frame(width: 155)
        }
        HStack {
          Picker("来源", selection: $sourceFilter) { ForEach(["全部", "内置", "我的"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
          Picker("排序", selection: $sort) { ForEach(["目录顺序", "名称排序", "最近修改"], id: \.self) { Text($0) } }.frame(width: 175)
        }
        HStack {
          Button("添加图片") { model.action("importBatch", nil) }
          Button("导入主题包") { model.action("importPackages", nil) }
          Button("清除筛选") { search = ""; category = "全部"; sourceFilter = "全部"; mediaFilter = "全部" }
        }.disabled(model.busy)
        ScrollView {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 175), spacing: 14)], spacing: 14) {
            ForEach(visibleThemes) { theme in
              Button { model.selectedID = theme.id } label: {
                VStack(alignment: .leading, spacing: 8) {
                  ThemeThumbnail(url: theme.media, art: theme.config["art"] as? [String: Any] ?? [:]).frame(height: 112).clipped().cornerRadius(9)
                  HStack {
                    Text(theme.name).font(.callout.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 0)
                    if theme.video { Image(systemName: "play.circle.fill") }
                    if model.currentID == theme.id { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                  }
                }.padding(8).background(model.selectedID == theme.id ? Color.accentColor.opacity(0.13) : Color(nsColor: .controlBackgroundColor))
                  .cornerRadius(12).overlay(RoundedRectangle(cornerRadius: 12).stroke(model.selectedID == theme.id ? Color.accentColor : Color.gray.opacity(0.15), lineWidth: 1))
              }.buttonStyle(.plain)
            }
          }
          if visibleThemes.isEmpty { Text("没有符合条件的主题").foregroundStyle(.secondary).padding(40) }
        }
      }
      Divider()
      VStack(alignment: .leading, spacing: 16) {
        Text("主题预览").font(.headline)
        if let theme = model.selected {
          ThemeThumbnail(url: theme.media, art: theme.config["art"] as? [String: Any] ?? [:])
            .frame(height: 195).clipped().cornerRadius(12)
          Text(theme.name).font(.title2.bold())
          Text(theme.tags.joined(separator: " · ")).font(.callout).foregroundStyle(.secondary)
          if theme.video {
            Button("播放原始视频…") { showVideo = true }
              .sheet(isPresented: $showVideo) {
                VStack {
                  Text("原始视频 · 取景效果见主题预览").font(.headline)
                  ThemeVideoPreview(url: theme.media).frame(width: 720, height: 440)
                  Button("关闭") { showVideo = false }
                }.padding(18)
              }
          }
          Button("应用皮肤") { model.action("apply", theme.id) }.buttonStyle(.borderedProminent).controlSize(.large).disabled(model.busy)
          HStack {
            Button("调整设置") { tab = 2 }
            Button("下载素材") { exportMedia(theme) }
          }
          HStack {
            Button("导出主题包") { model.action("exportPackage", theme.id) }
            Button("删除主题", role: .destructive) { model.action("delete", theme.id) }
              .disabled(theme.id == model.currentID || theme.id == model.pendingID || theme.id == "preset-gothic-void-crusade")
          }.disabled(model.busy)
        } else { Text("请先导入或选择一款皮肤").foregroundStyle(.secondary) }
        Divider()
        HStack {
          Button("暂停皮肤") { model.action("pause", nil) }
          Button("恢复显示") { model.action("resume", nil) }
        }.disabled(model.busy)
        Button("恢复默认主题") { model.action("apply", "preset-gothic-void-crusade") }.disabled(model.busy || !model.themes.contains { $0.id == "preset-gothic-void-crusade" })
        Button("恢复原貌", role: .destructive) { model.action("restore", nil) }.disabled(model.busy)
        Spacer()
      }.frame(width: 310)
    }.padding(12)
  }
  @ViewBuilder private var imports: some View {
    if let theme = model.draft {
      ThemeSettingsView(model: model, theme: theme, isDraft: true).id(theme.id)
    } else {
      VStack(spacing: 22) {
        Image(systemName: "photo.on.rectangle.angled").font(.system(size: 52)).foregroundStyle(.indigo)
        Text("把喜欢的画面变成皮肤").font(.title.bold())
        Text("选择素材，预览并编辑参数，再保存或应用。").foregroundStyle(.secondary)
        HStack {
          Button("选择图片 / 视频") { model.action("chooseDraft", nil) }.buttonStyle(.borderedProminent)
          Button("批量添加（自动去重）") { model.action("importBatch", nil) }
          Button("导入 .cdskin / ZIP") { model.action("importPackages", nil) }
        }.controlSize(.large).disabled(model.busy)
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
  @ViewBuilder private var settings: some View {
    VStack {
      Picker("编辑主题", selection: $model.selectedID) { ForEach(model.themes) { Text($0.name).tag($0.id) } }.padding(.horizontal)
      if let theme = model.selected { ThemeSettingsView(model: model, theme: theme).id(theme.id + "-" + String(model.libraryRevision)) }
      else { Text("请先在控制台选择主题").frame(maxWidth: .infinity, maxHeight: .infinity) }
    }
  }
  private func exportMedia(_ theme: ManagerTheme) {
    let panel = NSSavePanel()
    var source = theme.media
    if let original = theme.config["originalImage"] as? String,
       original == (original as NSString).lastPathComponent, !original.isEmpty {
      let candidate = theme.directory.appendingPathComponent(original)
      if let info = try? candidate.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey]), info.isRegularFile == true, info.isSymbolicLink != true { source = candidate }
    }
    panel.nameFieldStringValue = source.lastPathComponent
    guard panel.runModal() == .OK, let target = panel.url else { return }
    do {
      guard target.standardizedFileURL != source.standardizedFileURL else { return }
      let data = try Data(contentsOf: source)
      try data.write(to: target, options: .atomic)
      model.message = "素材已保存：\(target.lastPathComponent)"
    } catch { model.message = "保存失败：\(error.localizedDescription)" }
  }
}

