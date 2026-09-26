import AppKit
import SwiftUI
import CryptoKit

struct ThemeSettingsView: View {
  @ObservedObject var model: ManagerModel
  let theme: ManagerTheme
  var isDraft = false
  @State private var name = ""
  @State private var category = "custom"
  @State private var tags = ""
  @State private var appearance = "auto"
  @State private var focusX = 0.5
  @State private var focusY = 0.5
  @State private var positionX = 0.0
  @State private var positionY = 0.0
  @State private var positionMode = "locked"
  @State private var framing = false
  @State private var zoom = 1.0
  @State private var bubble = 0.0
  @State private var surface = 0.8
  @State private var safeArea = "auto"
  @State private var taskMode = "auto"
  @State private var accent = Color.indigo
  @State private var accentHex = ""
  @State private var originalHash = ""
  private let categories = ["dream": "梦幻", "nature": "自然", "cyber": "科技", "minimal": "简约", "dark": "暗色", "warm": "暖色", "custom": "自定义", "uncategorized": "未分类"]

  var body: some View {
    HStack(alignment: .top, spacing: 18) {
      VStack(alignment: .leading, spacing: 14) {
        Text(isDraft ? "新主题预览" : theme.name).font(.title2.bold())
        GeometryReader { geometry in
          ZStack(alignment: .bottom) {
            ThemeThumbnail(url: theme.media, art: previewArt)
              .frame(width: geometry.size.width, height: geometry.size.height)
            VStack(alignment: .leading, spacing: 12) {
              Text("消息气泡示意").padding(10).background(Color(nsColor: .windowBackgroundColor).opacity(bubble)).cornerRadius(8)
              Text("输入消息…").frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color(nsColor: .windowBackgroundColor).opacity(surface)).cornerRadius(10)
            }.padding(18)
          }.clipped().cornerRadius(12)
        }.frame(height: 290)
        Text("取景采用 Windows 同款计算；透明度为示意，实际界面随窗口比例变化。").font(.caption).foregroundStyle(.secondary)
        if isDraft { Button("重新选择素材") { model.action("chooseDraft", nil) }.disabled(model.busy) }
        Text(theme.media.lastPathComponent).foregroundStyle(.secondary).lineLimit(2)
        Spacer()
      }.frame(width: 315).padding(.top, 18)
      ScrollView {
        Form {
          Section("主题信息") {
            TextField("名称", text: $name)
            Picker("分类", selection: $category) { ForEach(categories.keys.sorted(), id: \.self) { Text(categories[$0]!).tag($0) } }
            TextField("标签（逗号分隔，最多 8 个）", text: $tags)
            Picker("外观", selection: $appearance) { Text("跟随系统").tag("auto"); Text("浅色").tag("light"); Text("深色").tag("dark") }
            HStack {
              TextField("强调色（留空移除）", text: $accentHex)
              ColorPicker("选择颜色", selection: $accent, supportsOpacity: false).onChange(of: accent) { value in
                if let color = NSColor(value).usingColorSpace(.deviceRGB) {
                  accentHex = String(format: "#%02X%02X%02X", Int((color.redComponent * 255).rounded()), Int((color.greenComponent * 255).rounded()), Int((color.blueComponent * 255).rounded()))
                }
              }
              Button("清除") { accentHex = "" }
            }
          }
          Section("焦点与显示") {
            setting("焦点水平位置", value: $focusX, range: 0...1)
            setting("焦点垂直位置", value: $focusY, range: 0...1)
            Picker("文字安全区", selection: $safeArea) { Text("自动").tag("auto"); Text("左侧").tag("left"); Text("右侧").tag("right"); Text("居中").tag("center"); Text("关闭").tag("none") }
            Picker("任务页模式", selection: $taskMode) { Text("自动").tag("auto"); Text("氛围").tag("ambient"); Text("横幅").tag("banner"); Text("完整").tag("full"); Text("关闭").tag("off") }
            setting("消息气泡不透明度", value: $bubble, range: 0...1)
            setting("工具面板不透明度", value: $surface, range: 0...1)
          }
          Section("自定义取景") {
            Toggle("启用自定义取景", isOn: $framing)
            Group {
              setting("水平位置", value: $positionX, range: -1...1)
              setting("垂直位置", value: $positionY, range: -1...1)
              setting("缩放", value: $zoom, range: 1...2)
              Picker("移动范围", selection: $positionMode) { Text("锁定区域内").tag("locked"); Text("不锁定区域").tag("free") }
            }.disabled(!framing)
            Button("复位取景") { focusX = 0.5; focusY = 0.5; positionX = 0; positionY = 0; zoom = 1; positionMode = "locked" }
          }
          HStack {
            Button("恢复已存参数") { if isDraft { load() } else { model.reload() } }
            if !isDraft { Button("另存为新主题") { save(copy: true, apply: false) } }
            Button(isDraft ? "保存主题" : "保存修改") { save(copy: false, apply: !isDraft && model.currentID == theme.id) }
            Button("保存并应用") { save(copy: false, apply: true) }.buttonStyle(.borderedProminent)
          }.disabled(model.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          Text(isDraft ? "保存主题只加入主题库；保存并应用会切换当前皮肤。" : "保存修改保留主题身份；编辑当前使用的主题时会重新应用。").font(.caption).foregroundStyle(.secondary)
        }.formStyle(.grouped)
      }
    }.padding(12).onAppear { load() }
  }
  private var previewArt: [String: Any] {
    var value: [String: Any] = ["focusX": focusX, "focusY": focusY, "framingEnabled": framing]
    if framing { value["positionX"] = positionX; value["positionY"] = positionY; value["zoom"] = zoom; value["positionMode"] = positionMode }
    return value
  }
  private func setting(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
    HStack { Text(title).frame(width: 140, alignment: .leading); Slider(value: value, in: range); Text(String(format: "%.0f%%", value.wrappedValue * 100)).monospacedDigit().frame(width: 45) }
  }
  private func load() {
    name = theme.name; category = theme.category
    tags = theme.tags.joined(separator: ", ")
    appearance = theme.config["appearance"] as? String ?? "auto"
    let art = theme.config["art"] as? [String: Any] ?? [:]
    focusX = art["focusX"] as? Double ?? 0.5; focusY = art["focusY"] as? Double ?? 0.5
    positionX = art["positionX"] as? Double ?? 0; positionY = art["positionY"] as? Double ?? 0
    zoom = art["zoom"] as? Double ?? 1; bubble = art["bubbleOpacity"] as? Double ?? 0
    surface = art["surfaceOpacity"] as? Double ?? 0.8
    positionMode = art["positionMode"] as? String ?? "locked"
    safeArea = art["safeArea"] as? String ?? "auto"; taskMode = art["taskMode"] as? String ?? "auto"
    framing = art["framingEnabled"] as? Bool ?? ["positionX", "positionY", "zoom", "positionMode"].contains { art[$0] != nil }
    let colors = theme.config["colors"] as? [String: Any] ?? [:]
    let hex = colors["accent"] as? String ?? ""
    if let value = UInt32(hex.dropFirst(), radix: 16), hex.count == 7 {
      accent = Color(red: Double((value >> 16) & 255)/255, green: Double((value >> 8) & 255)/255, blue: Double(value & 255)/255)
    }
    accentHex = hex
    originalHash = theme.contentHash
  }
  private func save(copy: Bool, apply: Bool) {
    guard !model.busy else { return }
    var config = theme.config
    config["name"] = name.trimmingCharacters(in: .whitespacesAndNewlines)
    config["category"] = category
    config["tags"] = tags.replacingOccurrences(of: "，", with: ",").split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    config["appearance"] = appearance
    var art = theme.config["art"] as? [String: Any] ?? [:]
    art["focusX"] = focusX; art["focusY"] = focusY; art["safeArea"] = safeArea; art["taskMode"] = taskMode
    art["bubbleOpacity"] = bubble; art["surfaceOpacity"] = surface; art["framingEnabled"] = framing
    for key in ["positionX", "positionY", "zoom", "positionMode"] { art.removeValue(forKey: key) }
    if framing { art["positionX"] = positionX; art["positionY"] = positionY; art["zoom"] = zoom; art["positionMode"] = positionMode }
    config["art"] = art
    var colors = theme.config["colors"] as? [String: Any] ?? [:]
    let hex = accentHex.trimmingCharacters(in: .whitespacesAndNewlines)
    colors.removeValue(forKey: "accent")
    if !hex.isEmpty { colors["accent"] = hex }
    config["colors"] = colors
    let request: [String: Any] = ["expectedHash": originalHash, "copy": copy, "config": config, "mediaPath": theme.media.path]
    let requestURL = model.root.deletingLastPathComponent().appendingPathComponent("requests/gui-" + UUID().uuidString + ".json")
    do {
      try FileManager.default.createDirectory(at: requestURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONSerialization.data(withJSONObject: request).write(to: requestURL, options: .atomic)
      model.libraryAction(isDraft ? "create" : "save", isDraft ? [requestURL.path] : [theme.id, requestURL.path]) { result in
        try? FileManager.default.removeItem(at: requestURL)
        guard let id = result?["id"] as? String else { return }
        model.selectedID = id
        if isDraft { model.draft = nil }
        if apply { model.action("apply", id) }
      }
    } catch { model.message = "保存请求失败：\(error.localizedDescription)" }
  }
}
