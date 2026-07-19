using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Web.Script.Serialization;

namespace CodexDreamSkinManager
{
    internal sealed class ThemePackageData
    {
        public string Id = "custom";
        public string Name = "";
        public string ImagePath = "";
        public string Category = "custom";
        public List<string> Tags = new List<string>();
        public string Appearance = "auto";
        public double FocusX = 0.5;
        public double FocusY = 0.5;
        public string SafeArea = "auto";
        public string TaskMode = "auto";
        public string Accent = "";
    }

    internal static class ThemePackageService
    {
        private const long MaxPackageBytes = 32L * 1024 * 1024;
        private const long MaxExpandedBytes = 48L * 1024 * 1024;
        private const long MaxImageBytes = 16L * 1024 * 1024;
        private static readonly HashSet<string> AllowedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "dream", "nature", "cyber", "minimal", "dark", "warm", "custom", "uncategorized"
        };

        public static ThemePackageData ReadPackage(string packagePath, string extractionRoot)
        {
            string fullPackage = Path.GetFullPath(packagePath);
            if (!File.Exists(fullPackage)) throw new FileNotFoundException("主题包不存在。", fullPackage);
            if (new FileInfo(fullPackage).Length > MaxPackageBytes) throw new InvalidDataException("主题包超过 32 MB。 ");
            string fullRoot = Path.GetFullPath(extractionRoot);
            Directory.CreateDirectory(fullRoot);

            using (FileStream stream = File.OpenRead(fullPackage))
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                if (archive.Entries.Count < 2 || archive.Entries.Count > 4)
                    throw new InvalidDataException("主题包只能包含清单和主题图片。 ");
                long expanded = 0;
                ZipArchiveEntry manifestEntry = null;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    ValidateRootEntry(entry);
                    expanded += entry.Length;
                    if (expanded > MaxExpandedBytes) throw new InvalidDataException("主题包解压后超过 48 MB。 ");
                    if (string.Equals(entry.FullName, "manifest.json", StringComparison.OrdinalIgnoreCase))
                    {
                        if (manifestEntry != null) throw new InvalidDataException("主题包包含重复清单。 ");
                        manifestEntry = entry;
                    }
                }
                if (manifestEntry == null || manifestEntry.Length > 1024 * 1024)
                    throw new InvalidDataException("主题包缺少有效 manifest.json。 ");
                Dictionary<string, object> manifest = ReadManifest(manifestEntry);
                ThemePackageData data = ParseManifest(manifest);
                string imageName = ReadString(manifest, "image", "");
                ValidateImageEntryName(imageName);
                ZipArchiveEntry imageEntry = null;
                foreach (ZipArchiveEntry entry in archive.Entries)
                    if (string.Equals(entry.FullName, imageName, StringComparison.OrdinalIgnoreCase)) imageEntry = entry;
                if (imageEntry == null || imageEntry.Length < 1 || imageEntry.Length > MaxImageBytes)
                    throw new InvalidDataException("主题包图片缺失、为空或超过 16 MB。 ");
                if (archive.Entries.Count != 2) throw new InvalidDataException("主题包包含未引用文件。 ");

                string targetDirectory = Path.Combine(fullRoot, "cdskin-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(targetDirectory);
                string targetImage = Path.GetFullPath(Path.Combine(targetDirectory, imageName));
                if (!targetImage.StartsWith(targetDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("主题包图片路径越界。 ");
                try
                {
                    using (Stream input = imageEntry.Open())
                    using (FileStream output = new FileStream(targetImage, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        input.CopyTo(output);
                    data.ImagePath = targetImage;
                    return data;
                }
                catch
                {
                    try { Directory.Delete(targetDirectory, true); } catch { }
                    throw;
                }
            }
        }

        public static void WritePackage(string packagePath, ThemePackageData data)
        {
            if (data == null) throw new ArgumentNullException("data");
            ValidateData(data);
            string sourceImage = Path.GetFullPath(data.ImagePath);
            if (!File.Exists(sourceImage)) throw new FileNotFoundException("导出主题图片不存在。", sourceImage);
            FileInfo imageInfo = new FileInfo(sourceImage);
            if (imageInfo.Length < 1 || imageInfo.Length > MaxImageBytes) throw new InvalidDataException("导出主题图片为空或超过 16 MB。 ");
            string extension = Path.GetExtension(sourceImage).ToLowerInvariant();
            if (extension != ".jpg" && extension != ".jpeg" && extension != ".png" && extension != ".webp")
                throw new InvalidDataException("导出主题图片格式不受支持。 ");
            string imageName = "art" + extension;
            string fullPackage = Path.GetFullPath(packagePath);
            string directory = Path.GetDirectoryName(fullPackage);
            Directory.CreateDirectory(directory);
            string temporary = Path.Combine(directory, ".cdskin-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Create))
                {
                    ZipArchiveEntry manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                    using (StreamWriter writer = new StreamWriter(manifestEntry.Open(), new UTF8Encoding(false)))
                        writer.Write(BuildManifest(data, imageName));
                    ZipArchiveEntry imageEntry = archive.CreateEntry(imageName, CompressionLevel.Optimal);
                    using (Stream input = File.OpenRead(sourceImage))
                    using (Stream output = imageEntry.Open()) input.CopyTo(output);
                }
                if (File.Exists(fullPackage)) File.Replace(temporary, fullPackage, null);
                else File.Move(temporary, fullPackage);
            }
            finally { if (File.Exists(temporary)) try { File.Delete(temporary); } catch { } }
        }

        private static void ValidateRootEntry(ZipArchiveEntry entry)
        {
            string name = entry.FullName;
            if (string.IsNullOrWhiteSpace(name) || name.EndsWith("/", StringComparison.Ordinal) ||
                name.EndsWith("\\", StringComparison.Ordinal) || Path.IsPathRooted(name) ||
                name.IndexOf('/') >= 0 || name.IndexOf('\\') >= 0 || name == "." || name == "..")
                throw new InvalidDataException("主题包包含越界或目录条目。 ");
            int unixMode = (entry.ExternalAttributes >> 16) & 0xF000;
            if (unixMode == 0xA000) throw new InvalidDataException("主题包不能包含符号链接。 ");
            string extension = Path.GetExtension(name);
            if (string.Equals(extension, ".zip", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(extension, ".cdskin", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("主题包不能嵌套压缩包。 ");
        }

        private static Dictionary<string, object> ReadManifest(ZipArchiveEntry entry)
        {
            string json;
            using (StreamReader reader = new StreamReader(entry.Open(), Encoding.UTF8, true)) json = reader.ReadToEnd();
            try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json); }
            catch (Exception ex) { throw new InvalidDataException("manifest.json 不是有效 JSON。", ex); }
        }

        private static ThemePackageData ParseManifest(Dictionary<string, object> manifest)
        {
            if (manifest == null || ReadInt(manifest, "formatVersion") != 1)
                throw new InvalidDataException("主题包 formatVersion 必须为 1。 ");
            Dictionary<string, object> art = ReadObject(manifest, "art");
            Dictionary<string, object> palette = ReadObject(manifest, "palette");
            ThemePackageData data = new ThemePackageData();
            data.Id = ReadString(manifest, "id", "custom");
            data.Name = ReadString(manifest, "name", "").Trim();
            data.Category = ReadString(manifest, "category", "custom");
            data.Appearance = ReadString(manifest, "appearance", "auto");
            data.FocusX = ReadDouble(art, "focusX", 0.5);
            data.FocusY = ReadDouble(art, "focusY", 0.5);
            data.SafeArea = ReadString(art, "safeArea", "auto");
            data.TaskMode = ReadString(art, "taskMode", "auto");
            data.Accent = ReadString(palette, "accent", "").ToUpperInvariant();
            object tags;
            if (manifest.TryGetValue("tags", out tags))
            {
                IList values = tags as IList;
                if (values == null) throw new InvalidDataException("主题包标签必须是数组。 ");
                foreach (object value in values) if (value != null) data.Tags.Add(Convert.ToString(value));
            }
            ValidateData(data);
            return data;
        }

        private static void ValidateData(ThemePackageData data)
        {
            if (string.IsNullOrWhiteSpace(data.Name) || data.Name.Length > 80) throw new InvalidDataException("主题包名称无效。 ");
            if (string.IsNullOrWhiteSpace(data.Category) || !AllowedCategories.Contains(data.Category))
                throw new InvalidDataException("主题包分类无效。 ");
            if (data.Tags.Count > 8 || data.Tags.Exists(tag => string.IsNullOrWhiteSpace(tag) || tag.Length > 20))
                throw new InvalidDataException("主题包标签无效。 ");
            if (data.Appearance != "auto" && data.Appearance != "light" && data.Appearance != "dark") throw new InvalidDataException("主题包外观无效。 ");
            if (double.IsNaN(data.FocusX) || double.IsInfinity(data.FocusX) || double.IsNaN(data.FocusY) ||
                double.IsInfinity(data.FocusY) || data.FocusX < 0 || data.FocusX > 1 || data.FocusY < 0 || data.FocusY > 1)
                throw new InvalidDataException("主题包焦点无效。 ");
            if (data.SafeArea != "auto" && data.SafeArea != "left" && data.SafeArea != "right" && data.SafeArea != "center" && data.SafeArea != "none")
                throw new InvalidDataException("主题包安全区无效。 ");
            if (data.TaskMode != "auto" && data.TaskMode != "ambient" && data.TaskMode != "banner" && data.TaskMode != "off")
                throw new InvalidDataException("主题包任务模式无效。 ");
            if (!string.IsNullOrEmpty(data.Accent) && !System.Text.RegularExpressions.Regex.IsMatch(data.Accent, "^#[0-9A-F]{6}$"))
                throw new InvalidDataException("主题包强调色无效。 ");
        }

        private static void ValidateImageEntryName(string name)
        {
            if (string.IsNullOrWhiteSpace(name) || Path.IsPathRooted(name) || Path.GetFileName(name) != name)
                throw new InvalidDataException("主题包图片路径无效。 ");
            string extension = Path.GetExtension(name).ToLowerInvariant();
            if (extension != ".jpg" && extension != ".jpeg" && extension != ".png" && extension != ".webp")
                throw new InvalidDataException("主题包图片格式无效。 ");
        }

        private static string BuildManifest(ThemePackageData data, string imageName)
        {
            Dictionary<string, object> manifest = new Dictionary<string, object>();
            manifest["formatVersion"] = 1;
            manifest["id"] = string.IsNullOrWhiteSpace(data.Id) ? "custom" : data.Id;
            manifest["name"] = data.Name;
            manifest["image"] = imageName;
            manifest["category"] = string.IsNullOrWhiteSpace(data.Category) ? "custom" : data.Category;
            manifest["tags"] = data.Tags.ToArray();
            manifest["appearance"] = data.Appearance;
            manifest["art"] = new Dictionary<string, object> { { "focusX", data.FocusX }, { "focusY", data.FocusY }, { "safeArea", data.SafeArea }, { "taskMode", data.TaskMode } };
            Dictionary<string, object> palette = new Dictionary<string, object>();
            if (!string.IsNullOrWhiteSpace(data.Accent)) palette["accent"] = data.Accent;
            manifest["palette"] = palette;
            return new JavaScriptSerializer().Serialize(manifest);
        }

        private static Dictionary<string, object> ReadObject(Dictionary<string, object> data, string key)
        {
            object value;
            return data != null && data.TryGetValue(key, out value) ? value as Dictionary<string, object> ?? new Dictionary<string, object>() : new Dictionary<string, object>();
        }

        private static string ReadString(Dictionary<string, object> data, string key, string fallback)
        {
            object value;
            return data != null && data.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
        }

        private static int ReadInt(Dictionary<string, object> data, string key)
        {
            int result;
            return int.TryParse(ReadString(data, key, "0"), out result) ? result : 0;
        }

        private static double ReadDouble(Dictionary<string, object> data, string key, double fallback)
        {
            object value;
            if (data == null || !data.TryGetValue(key, out value) || value == null) return fallback;
            double result;
            if (!double.TryParse(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture),
                System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out result))
                throw new InvalidDataException("主题包焦点不是有效数字。 ");
            return result;
        }
    }
}
