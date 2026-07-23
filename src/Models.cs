using System;
using System.Collections.Generic;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace CodexDreamSkinManager
{
    internal sealed class DreamSkinStatus
    {
        public bool IsRunning;
        public bool IsPaused;
        public string StatusKind = "stopped";
        public string StatusMessage = "";
        public string ActiveThemeId = "";
        public string ActiveThemeName = "未选择";
        public string ActiveThemeImage = "";
        public double ActiveFocusX = 0.5;
        public double ActiveFocusY = 0.5;
        public double ActivePositionX;
        public double ActivePositionY;
        public double ActiveZoom = 1.0;
        public string ActivePositionMode = "locked";
        public bool ActiveFramingEnabled;
        public string Message = "";
        public string ManagerApiVersion = "";
        public int ThemeSchemaVersion;
        public int StateSchemaVersion;
        public string InjectorVersion = "";
        public string NodeVersion = "";
        public string CodexVersion = "";
        public List<string> SupportedActions = new List<string>();
        public List<ThemeOption> Themes = new List<ThemeOption>();
    }

    internal sealed class ImageValidationResult
    {
        public string Path = "";
        public string Format = "";
        public int Width;
        public int Height;
        public long Bytes;
        public bool CanPreview;
        public string PreviewMessage = "";
    }

    internal sealed class BatchImportItem
    {
        public string ImagePath = "";
        public string Name = "";
        public string Appearance = "auto";
        public double FocusX = 0.5;
        public double FocusY = 0.5;
        public double PositionX;
        public double PositionY;
        public double Zoom = 1.0;
        public string PositionMode = "locked";
        public bool FramingEnabled = true;
        public string SafeArea = "auto";
        public string TaskMode = "auto";
        public string Accent = "";
        public string Category = "custom";
        public List<string> Tags = new List<string>();
    }

    internal sealed class BatchImportResultItem
    {
        public string Name = "";
        public string Status = "";
        public string Message = "";
        public string ThemeDirectory = "";
    }

    internal sealed class BatchImportResult
    {
        public int Imported;
        public int Skipped;
        public int Failed;
        public List<BatchImportResultItem> Results = new List<BatchImportResultItem>();
    }

    internal sealed class ThemeDeletionResult
    {
        public string Id = "";
        public string Name = "";
        public bool Deleted;
        public bool CleanupPending;
    }

    internal sealed class PreviewCrop
    {
        public double X;
        public double Y;
        public double Width;
        public double Height;
    }

    internal sealed class PreviewPoint
    {
        public double X;
        public double Y;
    }

    internal sealed class PreviewLayout
    {
        public double X;
        public double Y;
        public double Width;
        public double Height;
    }

    internal static class PreviewMath
    {
        public static PreviewCrop CalculateCrop(double imageWidth, double imageHeight,
            double viewportWidth, double viewportHeight, double focusX, double focusY)
        {
            PreviewCrop crop = new PreviewCrop { X = 0, Y = 0, Width = 1, Height = 1 };
            if (imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return crop;
            focusX = Clamp(focusX);
            focusY = Clamp(focusY);
            double imageAspect = imageWidth / imageHeight;
            double viewportAspect = viewportWidth / viewportHeight;
            if (imageAspect > viewportAspect)
            {
                crop.Width = viewportAspect / imageAspect;
                crop.X = (1 - crop.Width) * focusX;
            }
            else if (imageAspect < viewportAspect)
            {
                crop.Height = imageAspect / viewportAspect;
                crop.Y = (1 - crop.Height) * focusY;
            }
            return crop;
        }

        public static PreviewLayout CalculateFramingLayout(double imageWidth, double imageHeight,
            double viewportWidth, double viewportHeight, double positionX, double positionY,
            double zoom, string positionMode)
        {
            PreviewLayout layout = new PreviewLayout();
            if (imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return layout;
            positionX = ClampSigned(positionX);
            positionY = ClampSigned(positionY);
            zoom = Math.Max(1, Math.Min(2, zoom));
            double coverScale = Math.Max(viewportWidth / imageWidth, viewportHeight / imageHeight);
            layout.Width = imageWidth * coverScale * zoom;
            layout.Height = imageHeight * coverScale * zoom;
            bool free = string.Equals(positionMode, "free", StringComparison.OrdinalIgnoreCase);
            double rangeX = free ? (layout.Width + viewportWidth) / 2 : Math.Max(0, (layout.Width - viewportWidth) / 2);
            double rangeY = free ? (layout.Height + viewportHeight) / 2 : Math.Max(0, (layout.Height - viewportHeight) / 2);
            layout.X = (viewportWidth - layout.Width) / 2 + positionX * rangeX;
            layout.Y = (viewportHeight - layout.Height) / 2 + positionY * rangeY;
            return layout;
        }

        public static bool UsesCustomFraming(bool framingEnabled, double positionX, double positionY,
            double zoom, string positionMode)
        {
            return framingEnabled || string.Equals(positionMode, "free", StringComparison.OrdinalIgnoreCase) ||
                Math.Abs(positionX) > 0.0001 || Math.Abs(positionY) > 0.0001 || zoom > 1.0001;
        }

        public static PreviewPoint CalculateMarker(double viewportWidth, double viewportHeight,
            double focusX, double focusY)
        {
            return new PreviewPoint {
                X = Math.Max(0, viewportWidth) * Clamp(focusX),
                Y = Math.Max(0, viewportHeight) * Clamp(focusY)
            };
        }

        private static double Clamp(double value)
        {
            return Math.Max(0, Math.Min(1, value));
        }

        private static double ClampSigned(double value)
        {
            return Math.Max(-1, Math.Min(1, value));
        }
    }

    internal sealed class ActionAvailability
    {
        public bool CanEnable;
        public bool CanPause;
        public bool CanRestore;
        public bool CanReset;
        public bool CanApplyTheme;
        public bool CanSaveTheme;
        public bool CanSaveApply;
        public bool RestartAfterApply;
        public bool RequiresRecovery;
        public string EnableLabel = "启用皮肤";
        public string PauseLabel = "暂停皮肤";

        public static ActionAvailability FromStatus(DreamSkinStatus status, bool busy,
            bool hasSelection, bool hasValidCustomImage)
        {
            status = status ?? new DreamSkinStatus();
            string kind = string.IsNullOrWhiteSpace(status.StatusKind)
                ? (status.IsRunning ? "running" : "stopped") : status.StatusKind;
            bool stale = string.Equals(kind, "stale", StringComparison.OrdinalIgnoreCase);
            bool recoveryState = string.Equals(kind, "mismatch", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(kind, "uninspectable", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(kind, "error", StringComparison.OrdinalIgnoreCase);
            bool stopped = string.Equals(kind, "stopped", StringComparison.OrdinalIgnoreCase);
            ActionAvailability result = new ActionAvailability();
            result.EnableLabel = status.IsRunning ? "重新应用" : "启用皮肤";
            result.PauseLabel = status.IsRunning && status.IsPaused ? "继续显示" : "暂停皮肤";
            result.RestartAfterApply = recoveryState || stopped || stale;
            result.RequiresRecovery = recoveryState;
            result.CanRestore = !busy;
            if (busy) return result;
            result.CanApplyTheme = hasSelection;
            result.CanSaveTheme = hasValidCustomImage;
            if (recoveryState) return result;
            result.CanEnable = true;
            result.CanPause = status.IsRunning;
            result.CanReset = status.SupportedActions.Exists(action =>
                string.Equals(action, "ResetTheme", StringComparison.OrdinalIgnoreCase));
            result.CanSaveApply = hasValidCustomImage;
            return result;
        }
    }

    internal sealed class ThemeOption
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string ImagePath { get; set; }
        public string ThemeDirectory { get; set; }
        public bool IsPreset { get; set; }
        public string Category { get; set; }
        public List<string> Tags { get; set; }
        public string Source { get; set; }
        public int Order { get; set; }
        public string AddedAt { get; set; }
        public string Appearance { get; set; }
        public double FocusX { get; set; }
        public double FocusY { get; set; }
        public double PositionX { get; set; }
        public double PositionY { get; set; }
        public double Zoom { get; set; }
        public string PositionMode { get; set; }
        public bool FramingEnabled { get; set; }
        public string SafeArea { get; set; }
        public string TaskMode { get; set; }
        public string Accent { get; set; }

        public ThemeOption()
        {
            Id = "";
            Name = "";
            ImagePath = "";
            ThemeDirectory = "";
            Category = "custom";
            Tags = new List<string>();
            Source = "saved";
            AddedAt = "";
            Appearance = "auto";
            FocusX = 0.5;
            FocusY = 0.5;
            PositionX = 0;
            PositionY = 0;
            Zoom = 1.0;
            PositionMode = "locked";
            FramingEnabled = false;
            SafeArea = "auto";
            TaskMode = "auto";
            Accent = "";
        }

        public string SourceLabel { get { return IsPreset ? "内置" : "我的"; } }

        public string CategoryLabel
        {
            get
            {
                switch (Category)
                {
                    case "dream": return "梦幻";
                    case "nature": return "自然";
                    case "cyber": return "赛博";
                    case "minimal": return "极简";
                    case "dark": return "深色";
                    case "warm": return "暖色";
                    default: return "未分类";
                }
            }
        }

        public string CategoryColor
        {
            get
            {
                switch (Category)
                {
                    case "dream": return "#B65CFF";
                    case "nature": return "#29966F";
                    case "cyber": return "#168AA3";
                    case "minimal": return "#77808C";
                    case "dark": return "#3B4F75";
                    case "warm": return "#D47B3D";
                    default: return "#98A1AD";
                }
            }
        }

        public Uri ImageUri
        {
            get
            {
                Uri uri;
                return Uri.TryCreate(ImagePath, UriKind.Absolute, out uri) ? uri : null;
            }
        }

        public ImageSource ThumbnailImage
        {
            get
            {
                return ThemeThumbnailCache.Get(ImagePath);
            }
        }

        public override string ToString()
        {
            return Name;
        }
    }

    internal static class ThemeThumbnailCache
    {
        private const int Capacity = 64;
        private static readonly object Sync = new object();
        private static readonly Dictionary<string, ImageSource> Cache = new Dictionary<string, ImageSource>(StringComparer.OrdinalIgnoreCase);
        private static readonly Queue<string> Order = new Queue<string>();

        public static int CachedCount { get { lock (Sync) return Cache.Count; } }

        public static ImageSource Get(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return null;
            FileInfo info;
            try { info = new FileInfo(path); }
            catch { return null; }
            string key = info.FullName + "|" + info.Length + "|" + info.LastWriteTimeUtc.Ticks;
            lock (Sync)
            {
                ImageSource existing;
                if (Cache.TryGetValue(key, out existing)) return existing;
            }
            ImageSource image;
            try
            {
                BitmapImage bitmap = new BitmapImage();
                bitmap.BeginInit();
                bitmap.CacheOption = BitmapCacheOption.OnLoad;
                bitmap.DecodePixelWidth = 224;
                bitmap.UriSource = new Uri(info.FullName, UriKind.Absolute);
                bitmap.EndInit();
                bitmap.Freeze();
                image = bitmap;
            }
            catch { return null; }
            lock (Sync)
            {
                if (!Cache.ContainsKey(key))
                {
                    Cache[key] = image;
                    Order.Enqueue(key);
                    while (Order.Count > Capacity)
                    {
                        string oldest = Order.Dequeue();
                        Cache.Remove(oldest);
                    }
                }
                return Cache[key];
            }
        }
    }

    internal static class ThemeLibraryFilter
    {
        public static List<ThemeOption> Apply(IEnumerable<ThemeOption> themes, string search,
            string category, string source, string sort)
        {
            string query = (search ?? "").Trim();
            string categoryValue = string.IsNullOrWhiteSpace(category) ? "all" : category;
            string sourceValue = string.IsNullOrWhiteSpace(source) ? "all" : source;
            List<ThemeOption> result = new List<ThemeOption>();
            foreach (ThemeOption theme in themes ?? new ThemeOption[0])
            {
                if (!MatchesCategory(theme.Category, categoryValue)) continue;
                if (!string.Equals(sourceValue, "all", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(theme.Source, sourceValue, StringComparison.OrdinalIgnoreCase)) continue;
                if (query.Length > 0 && !ContainsText(theme.Name, query) &&
                    !(theme.Tags ?? new List<string>()).Exists(tag => ContainsText(tag, query))) continue;
                result.Add(theme);
            }
            if (string.Equals(sort, "name", StringComparison.OrdinalIgnoreCase))
                result.Sort((left, right) => StringComparer.CurrentCultureIgnoreCase.Compare(left.Name, right.Name));
            else
                result.Sort((left, right) => left.Order != right.Order ? left.Order.CompareTo(right.Order) :
                    StringComparer.CurrentCultureIgnoreCase.Compare(left.Name, right.Name));
            return result;
        }

        private static bool ContainsText(string value, string query)
        {
            return (value ?? "").IndexOf(query, StringComparison.CurrentCultureIgnoreCase) >= 0;
        }

        private static bool MatchesCategory(string themeCategory, string filterCategory)
        {
            if (string.Equals(filterCategory, "all", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(filterCategory, "uncategorized", StringComparison.OrdinalIgnoreCase))
                return string.Equals(themeCategory, "uncategorized", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(themeCategory, "custom", StringComparison.OrdinalIgnoreCase);
            return string.Equals(themeCategory, filterCategory, StringComparison.OrdinalIgnoreCase);
        }
    }

    internal sealed class CustomThemeOptions
    {
        public string ImagePath = "";
        public string Name = "";
        public string Appearance = "auto";
        public double FocusX = 0.5;
        public double FocusY = 0.5;
        public double PositionX;
        public double PositionY;
        public double Zoom = 1.0;
        public string PositionMode = "locked";
        public string SafeArea = "auto";
        public string TaskMode = "auto";
        public string Accent = "";

        public void SetFocusPercent(double x, double y)
        {
            FocusX = Clamp(x / 100.0);
            FocusY = Clamp(y / 100.0);
        }

        public void SetFramingPercent(double x, double y, double zoomPercent)
        {
            PositionX = ClampSigned(x / 100.0);
            PositionY = ClampSigned(y / 100.0);
            Zoom = ClampZoom(zoomPercent / 100.0);
        }

        public void Validate()
        {
            if (string.IsNullOrWhiteSpace(Name)) throw new ArgumentException("请输入主题名称。");
            if (string.IsNullOrWhiteSpace(ImagePath)) throw new ArgumentException("请选择背景图片。");
            if (double.IsNaN(PositionX) || double.IsInfinity(PositionX) ||
                double.IsNaN(PositionY) || double.IsInfinity(PositionY) ||
                double.IsNaN(Zoom) || double.IsInfinity(Zoom) ||
                PositionX < -1 || PositionX > 1 || PositionY < -1 || PositionY > 1 || Zoom < 1 || Zoom > 2)
                throw new ArgumentException("图片位置或缩放超出允许范围。");
            if (PositionMode != "locked" && PositionMode != "free")
                throw new ArgumentException("图片移动模式无效。");
            Accent = ValidateAccent(Accent);
        }

        public static string ValidateAccent(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            if (!System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9A-Fa-f]{6}$"))
                throw new ArgumentException("强调色必须是 #RRGGBB 格式。");
            return value.ToUpperInvariant();
        }

        private static double Clamp(double value)
        {
            return Math.Max(0, Math.Min(1, value));
        }

        private static double ClampSigned(double value)
        {
            return Math.Max(-1, Math.Min(1, value));
        }

        private static double ClampZoom(double value)
        {
            return Math.Max(1, Math.Min(2, value));
        }
    }
}
