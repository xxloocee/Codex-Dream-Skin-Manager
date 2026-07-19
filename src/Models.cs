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
        public string ActiveThemeName = "未选择";
        public string ActiveThemeImage = "";
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
        public string EnableLabel = "启用皮肤";
        public string PauseLabel = "暂停皮肤";

        public static ActionAvailability FromStatus(DreamSkinStatus status, bool busy,
            bool hasSelection, bool hasValidCustomImage)
        {
            status = status ?? new DreamSkinStatus();
            string kind = string.IsNullOrWhiteSpace(status.StatusKind)
                ? (status.IsRunning ? "running" : "stopped") : status.StatusKind;
            bool unsafeState = string.Equals(kind, "stale", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(kind, "mismatch", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(kind, "uninspectable", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(kind, "error", StringComparison.OrdinalIgnoreCase);
            ActionAvailability result = new ActionAvailability();
            result.EnableLabel = status.IsRunning ? "重新应用" : "启用皮肤";
            result.PauseLabel = status.IsPaused ? "继续显示" : "暂停皮肤";
            result.CanRestore = !busy;
            if (busy || unsafeState) return result;
            result.CanEnable = true;
            result.CanPause = status.IsRunning || status.IsPaused;
            result.CanReset = status.SupportedActions.Exists(action =>
                string.Equals(action, "ResetTheme", StringComparison.OrdinalIgnoreCase));
            result.CanApplyTheme = hasSelection;
            result.CanSaveTheme = hasValidCustomImage;
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
        public string SafeArea = "auto";
        public string TaskMode = "auto";
        public string Accent = "";

        public void SetFocusPercent(double x, double y)
        {
            FocusX = Clamp(x / 100.0);
            FocusY = Clamp(y / 100.0);
        }

        public void Validate()
        {
            if (string.IsNullOrWhiteSpace(Name)) throw new ArgumentException("请输入主题名称。");
            if (string.IsNullOrWhiteSpace(ImagePath)) throw new ArgumentException("请选择背景图片。");
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
    }
}
