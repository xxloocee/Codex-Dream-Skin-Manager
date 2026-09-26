import Foundation

// Port of Windows PreviewMath.CalculateCrop / CalculateFramingLayout.
// Shared by grid thumbnails, dashboard and the live settings preview.
enum ThemePreviewLayout {
  static func make(image: CGSize, viewport: CGSize, art: [String: Any]) -> CGRect {
    guard image.width > 0, image.height > 0, viewport.width > 0, viewport.height > 0 else { return .zero }
    func number(_ key: String, _ fallback: Double, _ low: Double, _ high: Double) -> CGFloat {
      let raw = art[key] as? Double ?? fallback
      return CGFloat(raw.isFinite ? min(high, max(low, raw)) : fallback)
    }
    let cover = max(viewport.width / image.width, viewport.height / image.height)
    let framed = art["framingEnabled"] as? Bool == true || ["positionX", "positionY", "zoom", "positionMode"].contains { art[$0] != nil }
    let zoom: CGFloat = framed ? number("zoom", 1, 1, 2) : 1
    let width = image.width * cover * zoom, height = image.height * cover * zoom
    if !framed {
      return CGRect(x: (viewport.width - width) * number("focusX", 0.5, 0, 1),
                    y: (viewport.height - height) * number("focusY", 0.5, 0, 1), width: width, height: height)
    }
    let free = art["positionMode"] as? String == "free"
    let rangeX = free ? (width + viewport.width) / 2 : max(0, (width - viewport.width) / 2)
    let rangeY = free ? (height + viewport.height) / 2 : max(0, (height - viewport.height) / 2)
    return CGRect(x: (viewport.width - width) / 2 + number("positionX", 0, -1, 1) * rangeX,
                  y: (viewport.height - height) / 2 + number("positionY", 0, -1, 1) * rangeY, width: width, height: height)
  }
}
