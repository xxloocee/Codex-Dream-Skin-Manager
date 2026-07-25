using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Collections;
using System.IO.Compression;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Web.Script.Serialization;

namespace CodexDreamSkinManager
{
    internal static class ManagerTests
    {
        private static readonly List<string> Failures = new List<string>();
        private static int PassCount;

        [STAThread]
        private static int Main()
        {
            Run("Finds windows scripts next to executable", delegate
            {
                string root = CreateLayout();
                try
                {
                    AssertEqual(Path.Combine(root, "windows", "scripts"),
                        DreamSkinService.FindScriptsDirectory(root));
                }
                finally
                {
                    Directory.Delete(root, true);
                }
            });

            Run("Rejects missing scripts directory", delegate
            {
                AssertThrows(delegate { DreamSkinService.FindScriptsDirectory(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"))); });
            });

            Run("Quotes PowerShell literals", delegate
            {
                AssertEqual("'C:\\A B\\it''s.png'", PowerShellRunner.QuoteLiteral("C:\\A B\\it's.png"));
            });

            Run("Round-trips Chinese PowerShell arguments and output as UTF-8", delegate
            {
                string script = Path.Combine(Path.GetTempPath(), "dream-skin-utf8-" + Guid.NewGuid().ToString("N") + ".ps1");
                File.WriteAllText(script, "param([string]$Value)\nWrite-Output $Value\n", new UTF8Encoding(true));
                try
                {
                    ScriptResult result = PowerShellRunner.RunAsync(script,
                        new[] { ScriptArgument.Parameter("-Value"), ScriptArgument.Literal("中文主题 O'Brien") },
                        10000).GetAwaiter().GetResult();
                    AssertEqual("中文主题 O'Brien", result.Output);
                }
                finally { File.Delete(script); }
            });

            Run("Round-trips Chinese PowerShell errors as UTF-8", delegate
            {
                string script = Path.Combine(Path.GetTempPath(), "dream-skin-utf8-error-" + Guid.NewGuid().ToString("N") + ".ps1");
                File.WriteAllText(script, "throw '恢复失败：中文错误'\n", new UTF8Encoding(true));
                try
                {
                    try
                    {
                        PowerShellRunner.RunAsync(script, new ScriptArgument[0], 10000).GetAwaiter().GetResult();
                        throw new Exception("Expected the PowerShell command to fail.");
                    }
                    catch (InvalidOperationException ex)
                    {
                        if (!ex.Message.Contains("恢复失败：中文错误"))
                            throw new Exception("Decoded error: " + ex.Message);
                        AssertTrue(!ex.Message.Contains("#< CLIXML"));
                        AssertTrue(!ex.Message.Contains("FullyQualifiedErrorId"));
                    }
                }
                finally { File.Delete(script); }
            });

            Run("Keeps parameter-looking user values literal", delegate
            {
                string script = Path.Combine(Path.GetTempPath(), "dream-skin-literal-" + Guid.NewGuid().ToString("N") + ".ps1");
                File.WriteAllText(script, "param([string]$Name,[switch]$KeepCurrent)\nWrite-Output ($Name + '|' + $KeepCurrent)\n", new UTF8Encoding(true));
                try
                {
                    ScriptResult result = PowerShellRunner.RunAsync(script, new[] {
                        ScriptArgument.Parameter("-Name"), ScriptArgument.Literal("-KeepCurrent")
                    }, 10000).GetAwaiter().GetResult();
                    AssertEqual("-KeepCurrent|False", result.Output);
                }
                finally { File.Delete(script); }
            });

            Run("Maps status JSON", delegate
            {
                DreamSkinStatus status = DreamSkinService.ParseStatus("{\"isRunning\":true,\"isPaused\":false,\"activeThemeId\":\"forest-mist\",\"activeTheme\":\"森林薄雾\",\"activeFocusX\":0.7,\"activeFocusY\":0.4,\"activePositionX\":0.2,\"activePositionY\":-0.1,\"activeZoom\":1.3,\"activePositionMode\":\"free\",\"activeFramingEnabled\":true,\"themes\":[]}");
                AssertTrue(status.IsRunning);
                AssertEqual("forest-mist", status.ActiveThemeId);
                AssertEqual("森林薄雾", status.ActiveThemeName);
                AssertClose(0.2, status.ActivePositionX);
                AssertClose(-0.1, status.ActivePositionY);
                AssertClose(1.3, status.ActiveZoom);
                AssertEqual("free", status.ActivePositionMode);
                AssertTrue(status.ActiveFramingEnabled);
            });

            Run("Maps structured status and capabilities", delegate
            {
                DreamSkinStatus status = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"mismatch\",\"statusMessage\":\"进程身份不匹配\",\"managerApiVersion\":\"1.1\",\"themeSchemaVersion\":1,\"stateSchemaVersion\":3,\"nodeVersion\":\"v24.18.0\",\"codexVersion\":\"1.2.3\",\"supportedActions\":[\"Status\",\"ValidateImage\",\"ResetTheme\"],\"themes\":[]}");
                AssertEqual("mismatch", ReadMember(status, "StatusKind"));
                AssertEqual("进程身份不匹配", ReadMember(status, "StatusMessage"));
                AssertEqual("1.1", ReadMember(status, "ManagerApiVersion"));
                AssertEqual("3", ReadMember(status, "StateSchemaVersion"));
                IEnumerable actions = ReadMemberObject(status, "SupportedActions") as IEnumerable;
                AssertTrue(actions != null && Contains(actions, "ValidateImage"));
                AssertTrue(Contains(actions, "ResetTheme"));
                AssertTrue(!Contains(actions, "EmergencyRestore"));
            });

            Run("Maps theme catalog metadata", delegate
            {
                DreamSkinStatus status = DreamSkinService.ParseStatus("{\"isRunning\":false,\"themes\":[{\"id\":\"cloud\",\"name\":\"云端遐想\",\"category\":\"dream\",\"tags\":[\"云层\",\"柔光\"],\"source\":\"preset\",\"order\":7,\"addedAt\":\"2026-07-17T00:00:00Z\",\"appearance\":\"light\",\"focusX\":0.62,\"focusY\":0.41,\"positionX\":0.3,\"positionY\":-0.2,\"zoom\":1.4,\"positionMode\":\"free\",\"framingEnabled\":true,\"safeArea\":\"left\",\"taskMode\":\"ambient\",\"accent\":\"#7B78D6\"}]}");
                ThemeOption theme = status.Themes[0];
                AssertEqual("dream", ReadMember(theme, "Category"));
                AssertEqual("preset", ReadMember(theme, "Source"));
                AssertEqual("7", ReadMember(theme, "Order"));
                IEnumerable tags = ReadMemberObject(theme, "Tags") as IEnumerable;
                AssertTrue(tags != null && Contains(tags, "柔光"));
                AssertEqual("light", ReadMember(theme, "Appearance"));
                AssertClose(0.62, Convert.ToDouble(ReadMemberObject(theme, "FocusX")));
                AssertClose(0.41, Convert.ToDouble(ReadMemberObject(theme, "FocusY")));
                AssertClose(0.3, Convert.ToDouble(ReadMemberObject(theme, "PositionX")));
                AssertClose(-0.2, Convert.ToDouble(ReadMemberObject(theme, "PositionY")));
                AssertClose(1.4, Convert.ToDouble(ReadMemberObject(theme, "Zoom")));
                AssertEqual("free", ReadMember(theme, "PositionMode"));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(theme, "FramingEnabled")));
                AssertEqual("left", ReadMember(theme, "SafeArea"));
                AssertEqual("ambient", ReadMember(theme, "TaskMode"));
                AssertEqual("#7B78D6", ReadMember(theme, "Accent"));
            });

            Run("Ships a 31 theme preset catalog", delegate
            {
                string presetRoot = Path.Combine(Environment.CurrentDirectory, "windows", "presets");
                string catalogPath = Path.Combine(presetRoot, "catalog.json");
                Dictionary<string, object> catalog = new JavaScriptSerializer()
                    .Deserialize<Dictionary<string, object>>(File.ReadAllText(catalogPath, Encoding.UTF8));
                AssertEqual("1", Convert.ToString(catalog["schemaVersion"]));
                ArrayList themes = catalog["themes"] as ArrayList;
                AssertTrue(themes != null);
                AssertEqual("31", themes.Count.ToString());
                string[] originalThemeIds = {
                    "romantic-rose", "sakura-dawn", "cloud-reverie", "moonlit-garden",
                    "forest-mist", "alpine-dawn", "ocean-glass", "bamboo-rain",
                    "cyber-neon", "hologram-city", "neon-circuit", "synthwave-grid",
                    "paper-light", "glass-workspace", "soft-geometry", "monochrome-lines",
                    "midnight-aurora", "obsidian-glow", "starfield", "rainy-night",
                    "amber-dusk", "peach-sunrise", "candle-atelier", "autumn-window"
                };
                // The shipped catalog is a stable prefix; future presets must append after it.
                for (int index = 0; index < originalThemeIds.Length; index++)
                {
                    Dictionary<string, object> originalTheme = themes[index] as Dictionary<string, object>;
                    AssertTrue(originalTheme != null);
                    AssertEqual(originalThemeIds[index], Convert.ToString(originalTheme["id"]));
                }
                HashSet<string> ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                Dictionary<string, int> categories = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                Dictionary<string, object> authorizedTheme = null;
                Dictionary<string, object> peopleAiTheme = null;
                Dictionary<string, object> arinaTheme = null;
                foreach (object value in themes)
                {
                    Dictionary<string, object> row = value as Dictionary<string, object>;
                    AssertTrue(row != null);
                    string id = Convert.ToString(row["id"]);
                    string category = Convert.ToString(row["category"]);
                    string image = Convert.ToString(row["image"]);
                    AssertTrue(ids.Add(id));
                    AssertTrue(File.Exists(Path.Combine(presetRoot, image)));
                    categories[category] = categories.ContainsKey(category) ? categories[category] + 1 : 1;
                    if (id == "violet-thunder") authorizedTheme = row;
                    if (id == "people-ai-red-horizon") peopleAiTheme = row;
                    if (id == "arina-hashimoto") arinaTheme = row;
                }
                foreach (string category in new[] { "dream", "nature", "cyber", "minimal", "dark", "warm" })
                    AssertTrue(categories.ContainsKey(category) && categories[category] >= 4);

                AssertTrue(authorizedTheme != null);
                AssertEqual("dark", Convert.ToString(authorizedTheme["category"]));
                AssertEqual("dark", Convert.ToString(authorizedTheme["appearance"]));
                AssertEqual("right", Convert.ToString(authorizedTheme["safeArea"]));
                AssertEqual("ambient", Convert.ToString(authorizedTheme["taskMode"]));
                AssertClose(0.52, Convert.ToDouble(authorizedTheme["focusX"]));
                AssertClose(0.43, Convert.ToDouble(authorizedTheme["focusY"]));
                string authorizedImagePath = Path.Combine(
                    presetRoot, Convert.ToString(authorizedTheme["image"]));
                using (System.Drawing.Image image = System.Drawing.Image.FromFile(authorizedImagePath))
                {
                    AssertEqual("2560", image.Width.ToString());
                    AssertEqual("1440", image.Height.ToString());
                }
                AssertTrue(new FileInfo(authorizedImagePath).Length < 16L * 1024L * 1024L);

                AssertTrue(peopleAiTheme != null);
                AssertEqual("人民的AI", Convert.ToString(peopleAiTheme["name"]));
                AssertEqual("cyber", Convert.ToString(peopleAiTheme["category"]));
                AssertEqual("light", Convert.ToString(peopleAiTheme["appearance"]));
                AssertEqual("left", Convert.ToString(peopleAiTheme["safeArea"]));
                AssertEqual("ambient", Convert.ToString(peopleAiTheme["taskMode"]));
                AssertEqual("#D72E35", Convert.ToString(peopleAiTheme["accent"]));
                AssertClose(0.78, Convert.ToDouble(peopleAiTheme["focusX"]));
                AssertClose(0.5, Convert.ToDouble(peopleAiTheme["focusY"]));
                string peopleAiImagePath = Path.Combine(
                    presetRoot, Convert.ToString(peopleAiTheme["image"]));
                using (System.Drawing.Image image = System.Drawing.Image.FromFile(peopleAiImagePath))
                {
                    AssertEqual("2560", image.Width.ToString());
                    AssertEqual("1440", image.Height.ToString());
                }
                AssertTrue(new FileInfo(peopleAiImagePath).Length < 16L * 1024L * 1024L);

                AssertTrue(arinaTheme != null);
                AssertEqual("桥本有菜", Convert.ToString(arinaTheme["name"]));
                AssertEqual("dream", Convert.ToString(arinaTheme["category"]));
                AssertEqual("auto", Convert.ToString(arinaTheme["appearance"]));
                AssertEqual("left", Convert.ToString(arinaTheme["safeArea"]));
                AssertEqual("ambient", Convert.ToString(arinaTheme["taskMode"]));
                AssertClose(0.72, Convert.ToDouble(arinaTheme["focusX"]));
                AssertClose(0.45, Convert.ToDouble(arinaTheme["focusY"]));
                string arinaImagePath = Path.Combine(presetRoot, Convert.ToString(arinaTheme["image"]));
                using (System.Drawing.Image image = System.Drawing.Image.FromFile(arinaImagePath))
                {
                    AssertEqual("2560", image.Width.ToString());
                    AssertEqual("1440", image.Height.ToString());
                }
                AssertTrue(new FileInfo(arinaImagePath).Length < 16L * 1024L * 1024L);
            });

            Run("Ships four Ergouzi theme variants", delegate
            {
                string presetRoot = Path.Combine(Environment.CurrentDirectory, "windows", "presets");
                Dictionary<string, object> catalog = new JavaScriptSerializer()
                    .Deserialize<Dictionary<string, object>>(File.ReadAllText(
                        Path.Combine(presetRoot, "catalog.json"), Encoding.UTF8));
                ArrayList themes = catalog["themes"] as ArrayList;
                Dictionary<string, string[]> expected = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase) {
                    { "ergouzi-paper-comet-light", new[] { "dream", "light", "#E96F79", "0.75", "0.44" } },
                    { "ergouzi-paper-comet-dark", new[] { "dream", "dark", "#F07D9B", "0.75", "0.44" } },
                    { "ergouzi-signal-star-light", new[] { "cyber", "light", "#E775A7", "0.76", "0.45" } },
                    { "ergouzi-signal-star-dark", new[] { "cyber", "dark", "#F080B4", "0.76", "0.45" } }
                };
                foreach (Dictionary<string, object> row in themes)
                {
                    string id = Convert.ToString(row["id"]);
                    if (!expected.ContainsKey(id)) continue;
                    string[] values = expected[id];
                    AssertEqual(values[0], Convert.ToString(row["category"]));
                    AssertEqual(values[1], Convert.ToString(row["appearance"]));
                    AssertEqual(values[2], Convert.ToString(row["accent"]));
                    AssertClose(Convert.ToDouble(values[3]), Convert.ToDouble(row["focusX"]));
                    AssertClose(Convert.ToDouble(values[4]), Convert.ToDouble(row["focusY"]));
                    AssertEqual("left", Convert.ToString(row["safeArea"]));
                    AssertEqual("ambient", Convert.ToString(row["taskMode"]));
                    string imagePath = Path.Combine(presetRoot, Convert.ToString(row["image"]));
                    using (System.Drawing.Image image = System.Drawing.Image.FromFile(imagePath))
                    {
                        AssertEqual("2560", image.Width.ToString());
                        AssertEqual("1440", image.Height.ToString());
                    }
                    AssertTrue(new FileInfo(imagePath).Length < 16L * 1024L * 1024L);
                    expected.Remove(id);
                }
                AssertEqual("0", expected.Count.ToString());
            });

            Run("Ships six optimized 16 by 9 themes", delegate
            {
                string presetRoot = Path.Combine(Environment.CurrentDirectory, "windows", "presets");
                Dictionary<string, object> catalog = new JavaScriptSerializer()
                    .Deserialize<Dictionary<string, object>>(File.ReadAllText(
                        Path.Combine(presetRoot, "catalog.json"), Encoding.UTF8));
                ArrayList themes = catalog["themes"] as ArrayList;
                string[] optimizedIds = {
                    "romantic-rose", "sakura-dawn", "cyber-neon",
                    "midnight-aurora", "amber-dusk", "forest-mist"
                };
                foreach (string expectedId in optimizedIds)
                {
                    Dictionary<string, object> selected = null;
                    foreach (object value in themes)
                    {
                        Dictionary<string, object> row = value as Dictionary<string, object>;
                        if (string.Equals(Convert.ToString(row["id"]), expectedId,
                            StringComparison.OrdinalIgnoreCase)) selected = row;
                    }
                    AssertTrue(selected != null);
                    string imagePath = Path.Combine(presetRoot, Convert.ToString(selected["image"]));
                    using (System.Drawing.Image image = System.Drawing.Image.FromFile(imagePath))
                    {
                        AssertEqual("2048", image.Width.ToString());
                        AssertEqual("1152", image.Height.ToString());
                    }
                    AssertTrue(new FileInfo(imagePath).Length < 16L * 1024L * 1024L);
                    AssertEqual("left", Convert.ToString(selected["safeArea"]));
                    AssertTrue(Convert.ToDouble(selected["focusX"]) >= 0.7);
                    if (expectedId == "romantic-rose")
                    {
                        ArrayList tags = selected["tags"] as ArrayList;
                        AssertTrue(tags != null && tags.Contains("庭院") && !tags.Contains("人物"));
                    }
                }
            });

            Run("Filters and sorts the theme library", delegate
            {
                List<ThemeOption> themes = new List<ThemeOption> {
                    CreateThemeForFilter("b", "Beta", "cyber", "preset", 2, new[] { "霓虹", "城市" }),
                    CreateThemeForFilter("a", "Alpha", "dream", "preset", 1, new[] { "云层", "柔光" }),
                    CreateThemeForFilter("c", "Gamma", "dark", "saved", 3, new[] { "雨", "个人" }),
                    CreateThemeForFilter("d", "Delta", "custom", "saved", 4, new[] { "个人" }),
                    CreateThemeForFilter("e", "Epsilon", "uncategorized", "preset", 5, new string[0])
                };
                Type filterType = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.ThemeLibraryFilter", true);
                MethodInfo apply = filterType.GetMethod("Apply", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                IList search = apply.Invoke(null, new object[] { themes, "柔光", "all", "all", "catalog" }) as IList;
                AssertEqual("a", ReadMember(search[0], "Id"));
                IList source = apply.Invoke(null, new object[] { themes, "", "all", "saved", "name" }) as IList;
                AssertEqual("2", source.Count.ToString());
                AssertEqual("d", ReadMember(source[0], "Id"));
                IList category = apply.Invoke(null, new object[] { themes, "", "cyber", "all", "catalog" }) as IList;
                AssertEqual("b", ReadMember(category[0], "Id"));
                IList byName = apply.Invoke(null, new object[] { themes, "", "all", "all", "name" }) as IList;
                AssertEqual("a", ReadMember(byName[0], "Id"));
                IList uncategorized = apply.Invoke(null, new object[] { themes, "", "uncategorized", "all", "catalog" }) as IList;
                AssertEqual("2", uncategorized.Count.ToString());
            });

            Run("Reads and writes safe cdskin packages", delegate
            {
                string root = Path.Combine(Path.GetTempPath(), "dream-skin-package-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                try
                {
                    string image = CreateJpeg(root, "art.jpg");
                    string package = Path.Combine(root, "valid.cdskin");
                    CreateCdskin(package, "{\"formatVersion\":1,\"id\":\"sample\",\"name\":\"示例主题\",\"image\":\"art.jpg\",\"category\":\"custom\",\"tags\":[\"测试\"],\"appearance\":\"dark\",\"art\":{\"focusX\":0.7,\"focusY\":0.4,\"positionX\":0.35,\"positionY\":-0.25,\"zoom\":1.6,\"positionMode\":\"free\",\"safeArea\":\"left\",\"taskMode\":\"ambient\"},\"palette\":{\"accent\":\"#112233\"}}", image, null);
                    Type serviceType = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.ThemePackageService", true);
                    MethodInfo read = serviceType.GetMethod("ReadPackage", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                    object data = read.Invoke(null, new object[] { package, Path.Combine(root, "extract") });
                    AssertEqual("示例主题", ReadMember(data, "Name"));
                    AssertEqual("custom", ReadMember(data, "Category"));
                    AssertEqual("dark", ReadMember(data, "Appearance"));
                    AssertClose(0.7, Convert.ToDouble(ReadMemberObject(data, "FocusX")));
                    AssertClose(0.35, Convert.ToDouble(ReadMemberObject(data, "PositionX")));
                    AssertClose(-0.25, Convert.ToDouble(ReadMemberObject(data, "PositionY")));
                    AssertClose(1.6, Convert.ToDouble(ReadMemberObject(data, "Zoom")));
                    AssertEqual("free", ReadMember(data, "PositionMode"));
                    AssertTrue(Convert.ToBoolean(ReadMemberObject(data, "FramingEnabled")));
                    AssertTrue(Contains(ReadMemberObject(data, "Tags") as IEnumerable, "测试"));
                    AssertTrue(File.Exists(ReadMember(data, "ImagePath")));
                    BatchImportItem item = MainWindow.CreateBatchImportItem((ThemePackageData)data);
                    AssertEqual("custom", ReadMember(item, "Category"));
                    AssertEqual("free", ReadMember(item, "PositionMode"));
                    AssertTrue(Convert.ToBoolean(ReadMemberObject(item, "FramingEnabled")));
                    AssertTrue(Contains(ReadMemberObject(item, "Tags") as IEnumerable, "测试"));
                    string exported = Path.Combine(root, "roundtrip.cdskin");
                    serviceType.GetMethod("WritePackage", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                        .Invoke(null, new object[] { exported, data });
                    object roundtrip = read.Invoke(null, new object[] { exported, Path.Combine(root, "roundtrip-extract") });
                    AssertEqual("示例主题", ReadMember(roundtrip, "Name"));
                    AssertEqual("#112233", ReadMember(roundtrip, "Accent"));
                    AssertClose(0.35, Convert.ToDouble(ReadMemberObject(roundtrip, "PositionX")));
                    AssertEqual("free", ReadMember(roundtrip, "PositionMode"));

                    string legacy = Path.Combine(root, "legacy.cdskin");
                    CreateCdskin(legacy, "{\"formatVersion\":1,\"id\":\"legacy\",\"name\":\"旧主题\",\"image\":\"art.jpg\",\"category\":\"custom\",\"appearance\":\"auto\",\"art\":{\"focusX\":0.7,\"focusY\":0.4,\"safeArea\":\"auto\",\"taskMode\":\"auto\"},\"palette\":{}}", image, null);
                    object legacyData = read.Invoke(null, new object[] { legacy, Path.Combine(root, "legacy-extract") });
                    AssertClose(0, Convert.ToDouble(ReadMemberObject(legacyData, "PositionX")));
                    AssertClose(0, Convert.ToDouble(ReadMemberObject(legacyData, "PositionY")));
                    AssertClose(1, Convert.ToDouble(ReadMemberObject(legacyData, "Zoom")));
                    AssertEqual("locked", ReadMember(legacyData, "PositionMode"));
                    AssertTrue(!Convert.ToBoolean(ReadMemberObject(legacyData, "FramingEnabled")));
                    string legacyRoundtrip = Path.Combine(root, "legacy-roundtrip.cdskin");
                    serviceType.GetMethod("WritePackage", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                        .Invoke(null, new object[] { legacyRoundtrip, legacyData });
                    object legacyRoundtripData = read.Invoke(null,
                        new object[] { legacyRoundtrip, Path.Combine(root, "legacy-roundtrip-extract") });
                    AssertTrue(!Convert.ToBoolean(ReadMemberObject(legacyRoundtripData, "FramingEnabled")));
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Rejects unsafe cdskin package entries", delegate
            {
                string root = Path.Combine(Path.GetTempPath(), "dream-skin-unsafe-package-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                try
                {
                    string image = CreateJpeg(root, "art.jpg");
                    string manifest = "{\"formatVersion\":1,\"id\":\"sample\",\"name\":\"示例\",\"image\":\"art.jpg\",\"appearance\":\"auto\",\"art\":{\"focusX\":0.5,\"focusY\":0.5,\"safeArea\":\"auto\",\"taskMode\":\"auto\"},\"palette\":{}}";
                    string traversal = Path.Combine(root, "traversal.cdskin");
                    CreateCdskin(traversal, manifest, image, "../escape.jpg");
                    Type serviceType = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.ThemePackageService", true);
                    MethodInfo read = serviceType.GetMethod("ReadPackage", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                    AssertInvocationThrows(read, new object[] { traversal, Path.Combine(root, "extract-a") });

                    string wrongVersion = Path.Combine(root, "wrong-version.cdskin");
                    CreateCdskin(wrongVersion, manifest.Replace("\"formatVersion\":1", "\"formatVersion\":2"), image, null);
                    AssertInvocationThrows(read, new object[] { wrongVersion, Path.Combine(root, "extract-b") });

                    string extraFiles = Path.Combine(root, "extra-files.cdskin");
                    CreateCdskin(extraFiles, manifest, image, "extra.txt", "extra-2.txt", "extra-3.txt");
                    AssertInvocationThrows(read, new object[] { extraFiles, Path.Combine(root, "extract-c") });

                    string stringTags = Path.Combine(root, "string-tags.cdskin");
                    CreateCdskin(stringTags, manifest.Replace("\"appearance\":\"auto\"", "\"tags\":\"abc\",\"appearance\":\"auto\""), image, null);
                    AssertInvocationThrows(read, new object[] { stringTags, Path.Combine(root, "extract-d") });

                    string wrongArtType = Path.Combine(root, "wrong-art-type.cdskin");
                    CreateCdskin(wrongArtType, manifest.Replace("\"art\":{\"focusX\":0.5,\"focusY\":0.5,\"safeArea\":\"auto\",\"taskMode\":\"auto\"}", "\"art\":[]"), image, null);
                    AssertInvocationThrows(read, new object[] { wrongArtType, Path.Combine(root, "extract-d2") });

                    string wrongPaletteType = Path.Combine(root, "wrong-palette-type.cdskin");
                    CreateCdskin(wrongPaletteType, manifest.Replace("\"palette\":{}", "\"palette\":1"), image, null);
                    AssertInvocationThrows(read, new object[] { wrongPaletteType, Path.Combine(root, "extract-d3") });

                    string invalidFocus = Path.Combine(root, "invalid-focus.cdskin");
                    CreateCdskin(invalidFocus, manifest.Replace("\"focusX\":0.5", "\"focusX\":\"invalid\""), image, null);
                    AssertInvocationThrows(read, new object[] { invalidFocus, Path.Combine(root, "extract-e") });

                    string nonFiniteFocus = Path.Combine(root, "non-finite-focus.cdskin");
                    CreateCdskin(nonFiniteFocus, manifest.Replace("\"focusX\":0.5", "\"focusX\":\"NaN\""), image, null);
                    AssertInvocationThrows(read, new object[] { nonFiniteFocus, Path.Combine(root, "extract-f") });

                    string invalidPosition = Path.Combine(root, "invalid-position.cdskin");
                    CreateCdskin(invalidPosition, manifest.Replace("\"focusX\":0.5", "\"positionX\":1.1,\"focusX\":0.5"), image, null);
                    AssertInvocationThrows(read, new object[] { invalidPosition, Path.Combine(root, "extract-g") });

                    string invalidZoom = Path.Combine(root, "invalid-zoom.cdskin");
                    CreateCdskin(invalidZoom, manifest.Replace("\"focusX\":0.5", "\"zoom\":\"NaN\",\"focusX\":0.5"), image, null);
                    AssertInvocationThrows(read, new object[] { invalidZoom, Path.Combine(root, "extract-h") });

                    string invalidPositionMode = Path.Combine(root, "invalid-position-mode.cdskin");
                    CreateCdskin(invalidPositionMode, manifest.Replace("\"focusX\":0.5", "\"positionMode\":\"floating\",\"focusX\":0.5"), image, null);
                    AssertInvocationThrows(read, new object[] { invalidPositionMode, Path.Combine(root, "extract-i") });
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Parses batch import results", delegate
            {
                MethodInfo parse = typeof(DreamSkinService).GetMethod("ParseBatchResult", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                AssertTrue(parse != null);
                object result = parse.Invoke(null, new object[] { "{\"imported\":2,\"skipped\":1,\"failed\":1,\"results\":[{\"name\":\"A\",\"status\":\"imported\",\"message\":\"\",\"themeDirectory\":\"C:\\\\themes\\\\a\"}]}" });
                AssertEqual("2", ReadMember(result, "Imported"));
                AssertEqual("1", ReadMember(result, "Skipped"));
                AssertEqual("1", ReadMember(result, "Failed"));
                IEnumerable items = ReadMemberObject(result, "Results") as IEnumerable;
                AssertTrue(items != null && ContainsResultName(items, "A"));
            });

            Run("Parses theme deletion cleanup state", delegate
            {
                ThemeDeletionResult result = DreamSkinService.ParseThemeDeletionResult(
                    "{\"id\":\"saved-a\",\"name\":\"我的主题\",\"deleted\":true,\"cleanupPending\":true}");
                AssertEqual("saved-a", result.Id);
                AssertTrue(result.Deleted);
                AssertTrue(result.CleanupPending);
            });

            Run("Calculates continuous preview crop and marker", delegate
            {
                Type math = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.PreviewMath", true);
                object crop = math.GetMethod("CalculateCrop", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                    .Invoke(null, new object[] { 2000.0, 1000.0, 1000.0, 1000.0, 0.37, 0.5 });
                AssertClose(0.185, Convert.ToDouble(ReadMemberObject(crop, "X")));
                AssertClose(0.5, Convert.ToDouble(ReadMemberObject(crop, "Width")));
                object marker = math.GetMethod("CalculateMarker", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                    .Invoke(null, new object[] { 800.0, 400.0, 0.37, 0.83 });
                AssertClose(296.0, Convert.ToDouble(ReadMemberObject(marker, "X")));
                AssertClose(332.0, Convert.ToDouble(ReadMemberObject(marker, "Y")));
                MethodInfo calculateLayout = math.GetMethod("CalculateFramingLayout",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                object locked = calculateLayout.Invoke(null,
                    new object[] { 2000.0, 1000.0, 1000.0, 1000.0, 1.0, 0.0, 1.0, "locked" });
                AssertClose(2000, Convert.ToDouble(ReadMemberObject(locked, "Width")));
                AssertClose(0, Convert.ToDouble(ReadMemberObject(locked, "X")));
                AssertClose(0, Convert.ToDouble(ReadMemberObject(locked, "Y")));
                object free = calculateLayout.Invoke(null,
                    new object[] { 2000.0, 1000.0, 1000.0, 1000.0, 1.0, -1.0, 1.0, "free" });
                AssertClose(1000, Convert.ToDouble(ReadMemberObject(free, "X")));
                AssertClose(-1000, Convert.ToDouble(ReadMemberObject(free, "Y")));
                object centeredZoom = calculateLayout.Invoke(null,
                    new object[] { 1000.0, 1000.0, 1000.0, 1000.0, 0.0, 0.0, 1.5, "locked" });
                AssertClose(1500, Convert.ToDouble(ReadMemberObject(centeredZoom, "Width")));
                AssertClose(1500, Convert.ToDouble(ReadMemberObject(centeredZoom, "Height")));
                AssertClose(-250, Convert.ToDouble(ReadMemberObject(centeredZoom, "X")));
                AssertClose(-250, Convert.ToDouble(ReadMemberObject(centeredZoom, "Y")));
                MethodInfo usesCustomFraming = math.GetMethod("UsesCustomFraming",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                AssertTrue(!Convert.ToBoolean(usesCustomFraming.Invoke(null,
                    new object[] { false, 0.0, 0.0, 1.0, "locked" })));
                AssertTrue(Convert.ToBoolean(usesCustomFraming.Invoke(null,
                    new object[] { true, 0.0, 0.0, 1.0, "locked" })));
                AssertTrue(Convert.ToBoolean(usesCustomFraming.Invoke(null,
                    new object[] { false, 0.0, 0.0, 1.0, "free" })));
                AssertTrue(Convert.ToBoolean(usesCustomFraming.Invoke(null,
                    new object[] { false, 0.1, 0.0, 1.0, "locked" })));
            });

            Run("Derives action availability from state", delegate
            {
                Type availabilityType = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.ActionAvailability", true);
                MethodInfo fromStatus = availabilityType.GetMethod("FromStatus", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                DreamSkinStatus stopped = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"stopped\",\"supportedActions\":[\"ResetTheme\"],\"themes\":[]}");
                object stoppedActions = fromStatus.Invoke(null, new object[] { stopped, false, true, true });
                AssertTrue(Convert.ToBoolean(ReadMemberObject(stoppedActions, "CanEnable")));
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(stoppedActions, "CanPause")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(stoppedActions, "CanReset")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(stoppedActions, "RestartAfterApply")));
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(stoppedActions, "RequiresRecovery")));
                DreamSkinStatus legacy = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"stopped\",\"supportedActions\":[\"Status\"],\"themes\":[]}");
                object legacyActions = fromStatus.Invoke(null, new object[] { legacy, false, true, true });
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(legacyActions, "CanReset")));
                DreamSkinStatus mismatch = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"mismatch\",\"themes\":[]}");
                object mismatchActions = fromStatus.Invoke(null, new object[] { mismatch, false, true, true });
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(mismatchActions, "CanEnable")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(mismatchActions, "CanApplyTheme")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(mismatchActions, "RestartAfterApply")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(mismatchActions, "RequiresRecovery")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(mismatchActions, "CanRestore")));
                DreamSkinStatus stale = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"stale\",\"supportedActions\":[\"ResetTheme\"],\"themes\":[]}");
                object staleActions = fromStatus.Invoke(null, new object[] { stale, false, true, true });
                AssertTrue(Convert.ToBoolean(ReadMemberObject(staleActions, "CanEnable")));
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(staleActions, "CanPause")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(staleActions, "CanReset")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(staleActions, "CanApplyTheme")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(staleActions, "RestartAfterApply")));
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(staleActions, "RequiresRecovery")));
                DreamSkinStatus stalePaused = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":true,\"statusKind\":\"stale\",\"themes\":[]}");
                object stalePausedActions = fromStatus.Invoke(null, new object[] { stalePaused, false, true, true });
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(stalePausedActions, "CanPause")));
                AssertEqual("暂停皮肤", Convert.ToString(ReadMemberObject(stalePausedActions, "PauseLabel")));
                DreamSkinStatus runningPaused = DreamSkinService.ParseStatus("{\"isRunning\":true,\"isPaused\":true,\"statusKind\":\"paused\",\"themes\":[]}");
                object runningPausedActions = fromStatus.Invoke(null, new object[] { runningPaused, false, true, true });
                AssertTrue(Convert.ToBoolean(ReadMemberObject(runningPausedActions, "CanPause")));
                AssertEqual("继续显示", Convert.ToString(ReadMemberObject(runningPausedActions, "PauseLabel")));
            });

            Run("Shows stale paused markers as stopped", delegate
            {
                string root = CreateLayout();
                File.WriteAllText(Path.Combine(root, "windows", "scripts", "manager-actions.ps1"),
                    "'{\"isRunning\":false,\"isPaused\":true,\"statusKind\":\"stale\",\"themes\":[]}'\n");
                try
                {
                    DreamSkinService service = new DreamSkinService(root);
                    MainWindow window = new MainWindow(service);
                    SynchronizationContext previousContext = SynchronizationContext.Current;
                    try
                    {
                        SynchronizationContext.SetSynchronizationContext(
                            new DispatcherSynchronizationContext(window.Dispatcher));
                        MethodInfo refresh = typeof(MainWindow).GetMethod("RefreshStatusAsync", BindingFlags.Instance | BindingFlags.NonPublic);
                        Task<bool> refreshTask = null;
                        window.Dispatcher.Invoke(new Action(delegate {
                            refreshTask = (Task<bool>)refresh.Invoke(window, new object[] { false });
                        }));
                        AssertTrue(WaitForTask(refreshTask, window.Dispatcher));
                        AssertEqual("皮肤未运行", GetPrivateField<TextBlock>(window, "statusText").Text);
                        Button pause = GetPrivateField<Button>(window, "pauseButton");
                        AssertTrue(!pause.IsEnabled);
                        AssertEqual("暂停皮肤", Convert.ToString(pause.Content));
                    }
                    finally
                    {
                        SynchronizationContext.SetSynchronizationContext(previousContext);
                        window.Close();
                    }
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Keeps actions available after a transient status refresh failure", delegate
            {
                string root = CreateLayout();
                File.WriteAllText(Path.Combine(root, "windows", "scripts", "manager-actions.ps1"),
                    "throw 'transient status failure'\n");
                try
                {
                    DreamSkinService service = new DreamSkinService(root);
                    MainWindow window = new MainWindow(service);
                    SynchronizationContext previousContext = SynchronizationContext.Current;
                    try
                    {
                        SynchronizationContext.SetSynchronizationContext(
                            new DispatcherSynchronizationContext(window.Dispatcher));
                        DreamSkinStatus running = new DreamSkinStatus {
                            IsRunning = true,
                            StatusKind = "running",
                            SupportedActions = new List<string> { "ResetTheme" }
                        };
                        typeof(MainWindow).GetField("currentStatus", BindingFlags.Instance | BindingFlags.NonPublic)
                            .SetValue(window, running);
                        ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                        themes.Items.Add(new ThemeOption { Id = "selected", Name = "Selected" });
                        themes.SelectedIndex = 0;

                        MethodInfo refresh = typeof(MainWindow).GetMethod("RefreshStatusAsync", BindingFlags.Instance | BindingFlags.NonPublic);
                        Task<bool> refreshTask = null;
                        window.Dispatcher.Invoke(new Action(delegate {
                            refreshTask = (Task<bool>)refresh.Invoke(window, new object[] { false });
                        }));
                        AssertTrue(!WaitForTask(refreshTask, window.Dispatcher));
                        AssertEqual("running", running.StatusKind);
                        AssertTrue(GetPrivateField<Button>(window, "applyThemeButton").IsEnabled);
                        AssertTrue(GetPrivateField<Button>(window, "refreshButton").IsEnabled);

                        MethodInfo runOperation = typeof(MainWindow).GetMethod("RunOperationAsync", BindingFlags.Instance | BindingFlags.NonPublic);
                        Func<Task> action = delegate { return Task.FromResult(0); };
                        Task operation = null;
                        window.Dispatcher.Invoke(new Action(delegate {
                            operation = (Task)runOperation.Invoke(window, new object[] { action, "done" });
                        }));
                        WaitForTask(operation, window.Dispatcher);
                        AssertTrue(!(bool)ReadMemberObject(window, "operationRunning"));
                        AssertTrue(GetPrivateField<Button>(window, "applyThemeButton").IsEnabled);

                        running.IsRunning = false;
                        running.StatusKind = "mismatch";
                        typeof(MainWindow).GetMethod("UpdateActionState", BindingFlags.Instance | BindingFlags.NonPublic)
                            .Invoke(window, null);
                        AssertTrue(!GetPrivateField<Button>(window, "enableButton").IsEnabled);
                        AssertTrue(GetPrivateField<Button>(window, "applyThemeButton").IsEnabled);
                        AssertEqual("应用并重启 Codex",
                            Convert.ToString(GetPrivateField<Button>(window, "applyThemeButton").Content));
                    }
                    finally
                    {
                        SynchronizationContext.SetSynchronizationContext(previousContext);
                        window.Close();
                    }
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Blocks mutations while a status refresh is in flight", delegate
            {
                string root = CreateLayout();
                File.WriteAllText(Path.Combine(root, "windows", "scripts", "manager-actions.ps1"),
                    "Start-Sleep -Milliseconds 600\n" +
                    "'{\"isRunning\":true,\"isPaused\":false,\"statusKind\":\"running\",\"themes\":[]}'\n");
                try
                {
                    DreamSkinService service = new DreamSkinService(root);
                    MainWindow window = new MainWindow(service);
                    SynchronizationContext previousContext = SynchronizationContext.Current;
                    try
                    {
                        SynchronizationContext.SetSynchronizationContext(
                            new DispatcherSynchronizationContext(window.Dispatcher));
                        typeof(MainWindow).GetField("currentStatus", BindingFlags.Instance | BindingFlags.NonPublic)
                            .SetValue(window, new DreamSkinStatus { IsRunning = true, StatusKind = "running" });
                        ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                        themes.Items.Add(new ThemeOption { Id = "selected", Name = "Selected" });
                        themes.SelectedIndex = 0;

                        MethodInfo refresh = typeof(MainWindow).GetMethod("RefreshStatusAsync", BindingFlags.Instance | BindingFlags.NonPublic);
                        Task<bool> refreshTask = null;
                        window.Dispatcher.Invoke(new Action(delegate {
                            refreshTask = (Task<bool>)refresh.Invoke(window, new object[] { false });
                        }));
                        AssertEqual("1", Convert.ToString(ReadMemberObject(window, "statusRefreshCount")));
                        AssertTrue(!GetPrivateField<Button>(window, "applyThemeButton").IsEnabled);
                        AssertTrue(!GetPrivateField<Button>(window, "refreshButton").IsEnabled);

                        int actionsRun = 0;
                        Func<Task> action = delegate { actionsRun++; return Task.FromResult(0); };
                        MethodInfo runOperation = typeof(MainWindow).GetMethod("RunOperationAsync", BindingFlags.Instance | BindingFlags.NonPublic);
                        Task blockedOperation = (Task)runOperation.Invoke(window, new object[] { action, "done" });
                        WaitForTask(blockedOperation, window.Dispatcher);
                        AssertEqual("0", actionsRun.ToString());

                        AssertTrue(WaitForTask(refreshTask, window.Dispatcher));
                        AssertEqual("0", Convert.ToString(ReadMemberObject(window, "statusRefreshCount")));
                        AssertTrue(GetPrivateField<Button>(window, "refreshButton").IsEnabled);
                    }
                    finally
                    {
                        SynchronizationContext.SetSynchronizationContext(previousContext);
                        window.Close();
                    }
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Keeps the expected stopped state when restore refresh fails", delegate
            {
                string root = CreateLayout();
                File.WriteAllText(Path.Combine(root, "windows", "scripts", "manager-actions.ps1"),
                    "throw 'transient status failure'\n");
                try
                {
                    DreamSkinService service = new DreamSkinService(root);
                    MainWindow window = new MainWindow(service);
                    SynchronizationContext previousContext = SynchronizationContext.Current;
                    try
                    {
                        SynchronizationContext.SetSynchronizationContext(
                            new DispatcherSynchronizationContext(window.Dispatcher));
                        DreamSkinStatus running = new DreamSkinStatus { IsRunning = true, StatusKind = "running" };
                        typeof(MainWindow).GetField("currentStatus", BindingFlags.Instance | BindingFlags.NonPublic)
                            .SetValue(window, running);
                        ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                        themes.Items.Add(new ThemeOption { Id = "selected", Name = "Selected" });
                        themes.SelectedIndex = 0;

                        MethodInfo expectedState = typeof(MainWindow).GetMethod("SetExpectedRuntimeState", BindingFlags.Instance | BindingFlags.NonPublic);
                        Func<Task> action = delegate {
                            expectedState.Invoke(window, new object[] { false, false });
                            return Task.FromResult(0);
                        };
                        MethodInfo runOperation = typeof(MainWindow).GetMethod("RunOperationAsync", BindingFlags.Instance | BindingFlags.NonPublic);
                        Task operation = (Task)runOperation.Invoke(window, new object[] { action, "restored" });
                        WaitForTask(operation, window.Dispatcher);

                        AssertEqual("stopped", running.StatusKind);
                        AssertTrue(!running.IsRunning);
                        AssertEqual("应用并重启 Codex",
                            Convert.ToString(GetPrivateField<Button>(window, "applyThemeButton").Content));
                        AssertTrue(GetPrivateField<Button>(window, "applyThemeButton").IsEnabled);
                    }
                    finally
                    {
                        SynchronizationContext.SetSynchronizationContext(previousContext);
                        window.Close();
                    }
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Allows emergency restore when manager script is missing", delegate
            {
                string root = CreateLayout(false);
                try
                {
                    DreamSkinService service = new DreamSkinService(root);
                    AssertTrue(Convert.ToBoolean(ReadMemberObject(service, "CanRestore")));
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Emergency restore tolerates a missing config backup", delegate
            {
                IList<ScriptArgument> withoutBackup = DreamSkinService.BuildRestoreArguments(true, false);
                AssertTrue(!ContainsScriptArgument(withoutBackup, "-RestoreBaseTheme"));
                AssertTrue(ContainsScriptArgument(withoutBackup, "-ForceRestart"));
                IList<ScriptArgument> withBackup = DreamSkinService.BuildRestoreArguments(false, true);
                AssertTrue(ContainsScriptArgument(withBackup, "-RestoreBaseTheme"));
                AssertTrue(!ContainsScriptArgument(withBackup, "-ForceRestart"));
            });

            Run("Enforces one manager instance", delegate
            {
                Type guardType = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.SingleInstanceGuard", true);
                MethodInfo acquire = guardType.GetMethod("TryAcquire", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                string name = "Local\\CodexDreamSkinManager-Test-" + Guid.NewGuid().ToString("N");
                IDisposable first = acquire.Invoke(null, new object[] { name }) as IDisposable;
                try
                {
                    AssertTrue(first != null);
                    object second = acquire.Invoke(null, new object[] { name });
                    AssertTrue(second == null);
                }
                finally { if (first != null) first.Dispose(); }
            });

            Run("Publishes semantic application version", delegate
            {
                AssertEqual("1.2.0.0", typeof(Program).Assembly.GetName().Version.ToString());
            });

            Run("Converts focus percentage", delegate
            {
                CustomThemeOptions options = new CustomThemeOptions();
                options.SetFocusPercent(72, 45);
                AssertClose(0.72, options.FocusX);
                AssertClose(0.45, options.FocusY);
                options.SetFramingPercent(65, -30, 175);
                AssertClose(0.65, options.PositionX);
                AssertClose(-0.3, options.PositionY);
                AssertClose(1.75, options.Zoom);
                options.Name = "测试";
                options.ImagePath = "image.jpg";
                options.Zoom = double.NaN;
                AssertThrows(delegate { options.Validate(); });
                options.Zoom = 1;
                options.PositionMode = "floating";
                AssertThrows(delegate { options.Validate(); });
            });

            Run("Rejects unsafe accent color", delegate
            {
                AssertThrows(delegate { CustomThemeOptions.ValidateAccent("red;Remove-Item"); });
                AssertEqual("#B65CFF", CustomThemeOptions.ValidateAccent("#B65CFF"));
            });

            Run("Builds required WPF controls", delegate
            {
                MainWindow window = new MainWindow(null);
                string[] names = {
                    "StatusText", "ThemeList", "ThemeGridScroll", "ThemeSearch", "ThemeCategory",
                    "ThemeSource", "ThemeSort", "AddImagesButton", "ImportPackageButton",
                    "ExportThemeButton", "DeleteThemeButton", "PreviewImage", "EnableButton", "PauseButton",
                    "ResetButton", "RestoreButton", "CustomSkinTab", "HorizontalPositionSlider",
                    "VerticalPositionSlider", "ZoomSlider", "PositionMode", "ResetFramingButton"
                };
                foreach (string name in names)
                    AssertTrue(FindAutomationName(window, name));
                window.Close();
            });

            Run("Blocks image selection while validation is running", delegate
            {
                string root = CreateLayout();
                try
                {
                    MainWindow window = new MainWindow(new DreamSkinService(root));
                    FieldInfo running = typeof(MainWindow).GetField("imageValidationRunning",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    MethodInfo update = typeof(MainWindow).GetMethod("UpdateActionState",
                        BindingFlags.Instance | BindingFlags.NonPublic);
                    Button browse = ReadMemberObject(window, "browseImageButton") as Button;
                    AssertTrue(running != null && update != null && browse != null);
                    running.SetValue(window, true);
                    update.Invoke(window, null);
                    AssertTrue(!browse.IsEnabled);
                    running.SetValue(window, false);
                    update.Invoke(window, null);
                    AssertTrue(browse.IsEnabled);
                    window.Close();
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Shows delete only for saved themes", delegate
            {
                string root = CreateLayout();
                try
                {
                    MainWindow window = new MainWindow(new DreamSkinService(root));
                    ListBox themes = ReadMemberObject(window, "themeList") as ListBox;
                    Button delete = ReadMemberObject(window, "deleteThemeButton") as Button;
                    DreamSkinStatus status = ReadMemberObject(window, "currentStatus") as DreamSkinStatus;
                    if (themes == null) throw new Exception("ThemeList was not found.");
                    if (delete == null) throw new Exception("DeleteThemeButton was not found.");
                    if (status == null) throw new Exception("Current status was not found.");
                    status.SupportedActions.Add("DeleteTheme");
                    ThemeOption preset = new ThemeOption { Id = "preset-a", Name = "内置", IsPreset = true, Source = "preset" };
                    ThemeOption saved = new ThemeOption { Id = "saved-a", Name = "我的主题", Source = "saved", ThemeDirectory = Path.Combine(root, "saved-a") };
                    themes.Items.Add(preset);
                    themes.Items.Add(saved);
                    themes.SelectedItem = preset;
                    if (delete.Visibility != Visibility.Collapsed) throw new Exception("Delete button was shown for a preset theme.");
                    themes.SelectedItem = saved;
                    if (delete.Visibility != Visibility.Visible) throw new Exception("Delete button was hidden for a saved theme.");
                    if (!delete.IsEnabled) throw new Exception("Delete button was disabled for an inactive saved theme.");
                    status.ActiveThemeId = saved.Id;
                    themes.SelectedItem = preset;
                    themes.SelectedItem = saved;
                    if (delete.Visibility != Visibility.Visible) throw new Exception("Delete button was hidden for the active saved theme.");
                    if (delete.IsEnabled) throw new Exception("Delete button was enabled for the active saved theme.");
                    window.Close();
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Rejects invalid theme deletion requests", delegate
            {
                string root = CreateLayout();
                try
                {
                    DreamSkinService service = new DreamSkinService(root);
                    AssertThrows(delegate { service.DeleteThemeAsync(null); });
                    AssertThrows(delegate { service.DeleteThemeAsync(new ThemeOption { IsPreset = true, Source = "preset" }); });
                    AssertThrows(delegate { service.DeleteThemeAsync(new ThemeOption { Source = "saved" }); });
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Resets custom framing sliders", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Show();
                TabControl tabs = FindVisualChild<TabControl>(window);
                tabs.SelectedIndex = 1;
                window.UpdateLayout();
                Slider horizontal = FindAutomationElement(window, "HorizontalPositionSlider") as Slider;
                Slider vertical = FindAutomationElement(window, "VerticalPositionSlider") as Slider;
                Slider zoom = FindAutomationElement(window, "ZoomSlider") as Slider;
                Button reset = FindAutomationElement(window, "ResetFramingButton") as Button;
                AssertTrue(horizontal != null && vertical != null && zoom != null && reset != null);
                AssertClose(0, horizontal.Value);
                AssertClose(0, vertical.Value);
                AssertClose(100, zoom.Value);
                horizontal.Value = 80;
                vertical.Value = -45;
                zoom.Value = 180;
                reset.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                AssertClose(0, horizontal.Value);
                AssertClose(0, vertical.Value);
                AssertClose(100, zoom.Value);
                window.Close();
            });

            Run("Shows the selected movement mode", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Show();
                TabControl tabs = FindVisualChild<TabControl>(window);
                ListBox source = FindAutomationElement(window, "ThemeSource") as ListBox;
                AssertTrue(source != null);
                AssertTrue(ScrollViewer.GetHorizontalScrollBarVisibility(source) == ScrollBarVisibility.Disabled);
                tabs.SelectedIndex = 1;
                window.UpdateLayout();
                ListBox mode = FindAutomationElement(window, "PositionMode") as ListBox;
                AssertTrue(mode != null);
                AssertTrue(mode.HorizontalAlignment == HorizontalAlignment.Left);
                AssertTrue(ScrollViewer.GetHorizontalScrollBarVisibility(mode) == ScrollBarVisibility.Disabled);
                ListBoxItem locked = mode.ItemContainerGenerator.ContainerFromIndex(0) as ListBoxItem;
                ListBoxItem free = mode.ItemContainerGenerator.ContainerFromIndex(1) as ListBoxItem;
                AssertTrue(locked != null && free != null && locked.IsSelected && !free.IsSelected);
                locked.ApplyTemplate();
                free.ApplyTemplate();
                Border lockedChrome = locked.Template.FindName("SegmentChrome", locked) as Border;
                Border freeChrome = free.Template.FindName("SegmentChrome", free) as Border;
                AssertEqual("#FF111214", ((SolidColorBrush)lockedChrome.Background).Color.ToString());
                AssertEqual("#FFFFFFFF", ((SolidColorBrush)freeChrome.Background).Color.ToString());
                mode.SelectedIndex = 1;
                window.UpdateLayout();
                AssertTrue(!locked.IsSelected && free.IsSelected);
                AssertEqual("#FFFFFFFF", ((SolidColorBrush)lockedChrome.Background).Color.ToString());
                AssertEqual("#FF111214", ((SolidColorBrush)freeChrome.Background).Color.ToString());
                window.Close();
            });

            Run("Builds centered black gold button roles", delegate
            {
                MethodInfo primaryFactory = typeof(MainWindow).GetMethod("PrimaryButton",
                    BindingFlags.Static | BindingFlags.NonPublic);
                MethodInfo secondaryFactory = typeof(MainWindow).GetMethod("SecondaryButton",
                    BindingFlags.Static | BindingFlags.NonPublic);
                MethodInfo dangerFactory = typeof(MainWindow).GetMethod("DangerButton",
                    BindingFlags.Static | BindingFlags.NonPublic);
                AssertTrue(primaryFactory != null);
                AssertTrue(secondaryFactory != null);
                AssertTrue(dangerFactory != null);

                Button primary = (Button)primaryFactory.Invoke(null, new object[] { "启用皮肤" });
                Button secondary = (Button)secondaryFactory.Invoke(null, new object[] { "刷新状态" });
                Button danger = (Button)dangerFactory.Invoke(null, new object[] { "紧急恢复原始外观" });
                foreach (Button button in new[] { primary, secondary, danger })
                {
                    AssertClose(40, button.MinHeight);
                    AssertClose(14, button.FontSize);
                    AssertEqual(HorizontalAlignment.Center.ToString(),
                        button.HorizontalContentAlignment.ToString());
                    AssertEqual(VerticalAlignment.Center.ToString(),
                        button.VerticalContentAlignment.ToString());
                    AssertTrue(button.Template != null);
                }
                AssertPrimaryGradient(primary.Background);
                AssertSolidBrush("#FF111214", secondary.Background);
                AssertSolidBrush("#FF1B1113", danger.Background);
            });

            Run("Assigns black gold roles to window actions", delegate
            {
                MainWindow window = new MainWindow(null);
                try
                {
                    AssertPrimaryGradient(GetPrivateField<Button>(window, "enableButton").Background);
                    AssertPrimaryGradient(GetPrivateField<Button>(window, "saveApplyButton").Background);
                    AssertSolidBrush("#FF111214", GetPrivateField<Button>(window, "refreshButton").Background);
                    AssertSolidBrush("#FF111214", GetPrivateField<Button>(window, "applyThemeButton").Background);
                    AssertSolidBrush("#FF111214", GetPrivateField<Button>(window, "saveThemeButton").Background);
                    AssertSolidBrush("#FF1B1113", GetPrivateField<Button>(window, "restoreButton").Background);
                }
                finally { window.Close(); }
            });

            Run("Centers rendered button content without disabled layout shift", delegate
            {
                MethodInfo dangerFactory = typeof(MainWindow).GetMethod("DangerButton",
                    BindingFlags.Static | BindingFlags.NonPublic);
                Button button = (Button)dangerFactory.Invoke(null,
                    new object[] { "紧急恢复原始外观" });
                button.Margin = new Thickness(12);
                Window host = new Window {
                    Width = 360,
                    Height = 120,
                    WindowStyle = WindowStyle.None,
                    ShowInTaskbar = false,
                    Content = button
                };
                host.Show();
                host.UpdateLayout();
                try
                {
                    ContentPresenter content = button.Template.FindName("ButtonContent", button)
                        as ContentPresenter;
                    Border chrome = button.Template.FindName("ButtonChrome", button) as Border;
                    AssertTrue(content != null);
                    AssertTrue(chrome != null);
                    Rect contentBounds = content.TransformToAncestor(button)
                        .TransformBounds(new Rect(content.RenderSize));
                    AssertClose(button.ActualWidth / 2,
                        contentBounds.Left + contentBounds.Width / 2);
                    AssertClose(button.ActualHeight / 2,
                        contentBounds.Top + contentBounds.Height / 2);
                    double enabledHeight = button.ActualHeight;
                    button.IsEnabled = false;
                    host.UpdateLayout();
                    AssertClose(enabledHeight, button.ActualHeight);
                    AssertSolidBrush("#FF2A2926", chrome.Background);
                }
                finally { host.Close(); }
            });

            Run("Theme grid uses available width from three to six columns", delegate
            {
                MainWindow window = new MainWindow(null);
                ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                for (int i = 0; i < 24; i++)
                    themes.Items.Add(new ThemeOption { Id = "theme-" + i, Name = "主题 " + i });
                window.Width = 980;
                window.Height = 680;
                window.Show();
                window.UpdateLayout();
                try
                {
                    int defaultColumns = CountVisibleColumns(themes);
                    if (defaultColumns < 3) throw new Exception("Default theme columns: " + defaultColumns);
                    window.Width = 1920;
                    window.Height = 1080;
                    window.UpdateLayout();
                    int maximumColumns = CountVisibleColumns(themes);
                    int expectedColumns = ExpectedVisibleColumns(themes, 6);
                    if (maximumColumns < defaultColumns)
                        throw new Exception("Expanded theme grid regressed from " + defaultColumns +
                            " to " + maximumColumns + " columns.");
                    if (maximumColumns < expectedColumns)
                        throw new Exception("Expanded theme columns: " + maximumColumns +
                            ", expected at least " + expectedColumns + " for width " + themes.ActualWidth + ".");
                }
                finally { window.Close(); }
            });

            Run("Keeps theme grid reachable and vertically scrollable", delegate
            {
                MainWindow window = new MainWindow(null);
                ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                for (int i = 0; i < 40; i++)
                    themes.Items.Add(new ThemeOption { Id = "scroll-theme-" + i, Name = "主题 " + i });
                window.Width = 760;
                window.Height = 560;
                window.Show();
                window.UpdateLayout();
                try
                {
                    foreach (Size size in new[] { new Size(760, 560), new Size(1634, 900) })
                    {
                        window.Width = size.Width;
                        window.Height = size.Height;
                        window.UpdateLayout();
                        ScrollViewer dashboard = FindAutomationElement(window, "DashboardScroll") as ScrollViewer;
                        AssertTrue(dashboard != null);
                        Rect bounds = themes.TransformToAncestor(dashboard)
                            .TransformBounds(new Rect(themes.RenderSize));
                        AssertTrue(bounds.Top >= 0 && bounds.Bottom <= dashboard.ViewportHeight + 0.5);
                        ScrollViewer gridScroll = FindVisualChild<ScrollViewer>(themes);
                        AssertTrue(gridScroll != null && gridScroll.ScrollableHeight > 0);
                        gridScroll.ScrollToEnd();
                        window.UpdateLayout();
                        AssertClose(gridScroll.ScrollableHeight, gridScroll.VerticalOffset);
                    }
                }
                finally
                {
                    window.Close();
                }
            });

            Run("Constrains maximized dashboard layout", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Width = 1920;
                window.Height = 1080;
                window.WindowStartupLocation = WindowStartupLocation.Manual;
                window.Left = 0;
                window.Top = 0;
                window.Show();
                window.UpdateLayout();
                try
                {
                    FrameworkElement root = FindAutomationElement(window, "RootContent");
                    FrameworkElement workspace = FindAutomationElement(window, "DashboardContent");
                    FrameworkElement controls = FindAutomationElement(window, "DashboardControls");
                    Border preview = GetPrivateField<Border>(window, "previewSurface");
                    TabControl tabs = FindVisualChild<TabControl>(window);
                    AssertTrue(root != null);
                    AssertAtMost(1440.5, root.ActualWidth, "Maximized root content is too wide.");
                    AssertTrue(workspace != null);
                    AssertAtMost(1260.5, workspace.ActualWidth, "Dashboard workspace is too wide.");
                    AssertBetween(329.0, 331.0, controls.ActualWidth, "Dashboard controls do not keep a stable width.");
                    AssertAtMost(540.0, controls.ActualHeight, "Dashboard controls stretch into an empty full-height panel.");
                    AssertResponsivePreview(preview, "Dashboard preview does not follow its responsive height contract.");
                    Rect controlsBounds = controls.TransformToAncestor(tabs).TransformBounds(new Rect(controls.RenderSize));
                    AssertTrue(controlsBounds.Left >= 0 && controlsBounds.Right <= tabs.ActualWidth + 0.5);
                }
                finally { window.Close(); }
            });

            Run("Constrains maximized custom theme layout", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Width = 1920;
                window.Height = 1080;
                window.WindowStartupLocation = WindowStartupLocation.Manual;
                window.Left = 0;
                window.Top = 0;
                window.Show();
                try
                {
                    TabControl tabs = FindVisualChild<TabControl>(window);
                    tabs.SelectedIndex = 1;
                    window.UpdateLayout();
                    FrameworkElement workspace = FindAutomationElement(window, "CustomThemeContent");
                    FrameworkElement controls = FindAutomationElement(window, "CustomThemeControls");
                    Border preview = GetPrivateField<Border>(window, "customPreviewSurface");
                    AssertTrue(workspace != null);
                    AssertAtMost(1260.5, workspace.ActualWidth, "Custom workspace is too wide.");
                    AssertBetween(379.0, 381.0, controls.ActualWidth, "Custom controls do not keep a stable width.");
                    AssertAtMost(720.0, controls.ActualHeight, "Custom controls stretch into an empty full-height panel.");
                    AssertResponsivePreview(preview,
                        "Custom preview does not follow its responsive height contract (workspace " + workspace.ActualWidth +
                        ", preview " + preview.ActualWidth + "x" + preview.ActualHeight +
                        ", controls " + controls.ActualWidth + ").");
                    Rect controlsBounds = controls.TransformToAncestor(tabs).TransformBounds(new Rect(controls.RenderSize));
                    AssertTrue(controlsBounds.Left >= 0 && controlsBounds.Right <= tabs.ActualWidth + 0.5);
                }
                finally { window.Close(); }
            });

            Run("Dashboard hides outer scrollbar but remains scrollable", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Width = 760;
                window.Height = 560;
                window.Show();
                window.UpdateLayout();
                try
                {
                    FrameworkElement element = FindAutomationElement(window, "DashboardScroll");
                    ScrollViewer scroll = element as ScrollViewer;
                    AssertTrue(scroll != null);
                    AssertTrue(scroll.VerticalScrollBarVisibility == ScrollBarVisibility.Hidden);
                    AssertTrue(scroll.ScrollableHeight > 0);
                }
                finally
                {
                    window.Close();
                }
            });

            Run("Custom save actions remain reachable at minimum size", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Width = 760;
                window.Height = 560;
                window.Show();
                try
                {
                    TabControl tabs = FindVisualChild<TabControl>(window);
                    tabs.SelectedIndex = 1;
                    window.UpdateLayout();
                    ScrollViewer scroll = ((TabItem)tabs.SelectedItem).Content as ScrollViewer;
                    Button saveApply = GetPrivateField<Button>(window, "saveApplyButton");
                    AssertTrue(scroll != null);
                    scroll.ScrollToEnd();
                    window.UpdateLayout();
                    Rect bounds = saveApply.TransformToAncestor(tabs)
                        .TransformBounds(new Rect(saveApply.RenderSize));
                    AssertTrue(bounds.Top >= 0 && bounds.Bottom <= tabs.ActualHeight + 0.5);
                }
                finally
                {
                    window.Close();
                }
            });

            Run("Preview selection does not replace active theme label", delegate
            {
                MainWindow window = new MainWindow(null);
                TextBlock active = GetPrivateField<TextBlock>(window, "activeThemeText");
                ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                active.Text = "当前活动主题";
                themes.Items.Add(new ThemeOption { Id = "preview", Name = "仅预览主题" });
                themes.SelectedIndex = 0;
                AssertEqual("当前活动主题", active.Text);
                window.Close();
            });

            Run("Refreshes the selected theme preview after status updates", delegate
            {
                string root = Path.Combine(Path.GetTempPath(), "dream-skin-preview-refresh-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                string activeImage = CreateJpeg(root, "active.jpg");
                string selectedImage = CreateJpeg(root, "selected.jpg");
                try
                {
                    MainWindow window = new MainWindow(null);
                    DreamSkinStatus status = new DreamSkinStatus { ActiveThemeImage = activeImage };
                    typeof(MainWindow).GetField("currentStatus", BindingFlags.Instance | BindingFlags.NonPublic)
                        .SetValue(window, status);
                    ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                    ThemeOption selected = new ThemeOption {
                        Id = "selected", Name = "Selected", ImagePath = selectedImage, FramingEnabled = true
                    };
                    themes.Items.Add(selected);
                    themes.SelectedIndex = 0;
                    MethodInfo populate = typeof(MainWindow).GetMethod("PopulateThemes", BindingFlags.Instance | BindingFlags.NonPublic);
                    MethodInfo refreshPreview = typeof(MainWindow).GetMethod("RefreshDashboardPreview", BindingFlags.Instance | BindingFlags.NonPublic);
                    populate.Invoke(window, new object[] { new List<ThemeOption> {
                        new ThemeOption { Id = "active", Name = "Active", ImagePath = activeImage }, selected
                    } });
                    refreshPreview.Invoke(window, null);
                    Image layer = GetPrivateField<Image>(window, "previewImageLayer");
                    BitmapImage source = layer.Source as BitmapImage;
                    AssertTrue(source != null);
                    AssertEqual(Path.GetFullPath(selectedImage), source.UriSource.LocalPath);
                    AssertTrue(object.ReferenceEquals(selected, GetPrivateField<ThemeOption>(window, "dashboardPreviewTheme")));
                    window.Close();
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Recomputes dashboard framing when preview size changes", delegate
            {
                string root = Path.Combine(Path.GetTempPath(), "dream-skin-preview-resize-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                string imagePath = CreateJpeg(root, "framed.jpg");
                try
                {
                    MainWindow window = new MainWindow(null);
                    window.Show();
                    window.UpdateLayout();
                    ThemeOption theme = new ThemeOption {
                        Id = "framed", Name = "Framed", ImagePath = imagePath,
                        FramingEnabled = true, PositionX = 0.4, PositionY = -0.2, Zoom = 1.5,
                        PositionMode = "locked"
                    };
                    ListBox themes = GetPrivateField<ListBox>(window, "themeList");
                    themes.Items.Add(theme);
                    themes.SelectedIndex = 0;
                    MethodInfo refreshPreview = typeof(MainWindow).GetMethod("RefreshDashboardPreview", BindingFlags.Instance | BindingFlags.NonPublic);
                    refreshPreview.Invoke(window, null);
                    Border preview = GetPrivateField<Border>(window, "previewSurface");
                    Image layer = GetPrivateField<Image>(window, "previewImageLayer");
                    Brush beforeFill = preview.Background;
                    double before = layer.Width;
                    preview.Width = Math.Max(160, preview.ActualWidth - 80);
                    window.UpdateLayout();
                    AssertTrue(layer.Width > 0 && Math.Abs(layer.Width - before) > 1);
                    AssertTrue(object.ReferenceEquals(beforeFill, preview.Background));
                    window.Close();
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Reads large PowerShell output streams without deadlock", delegate
            {
                string script = Path.Combine(Path.GetTempPath(), "dream-skin-streams-" + Guid.NewGuid().ToString("N") + ".ps1");
                File.WriteAllText(script, "$chunk = 'x' * 4096\n1..256 | ForEach-Object { [Console]::Error.WriteLine($chunk) }\nWrite-Output 'done'\n");
                try
                {
                    ScriptResult result = PowerShellRunner.RunAsync(script, new ScriptArgument[0], 10000).GetAwaiter().GetResult();
                    AssertEqual("done", result.Output);
                    AssertTrue(result.Error.Length > 100000);
                }
                finally
                {
                    File.Delete(script);
                }
            });

            Run("Stops PowerShell after timeout", delegate
            {
                string script = Path.Combine(Path.GetTempPath(), "dream-skin-timeout-" + Guid.NewGuid().ToString("N") + ".ps1");
                File.WriteAllText(script, "Start-Sleep -Seconds 5\n");
                try
                {
                    AssertThrows<TimeoutException>(delegate
                    {
                        PowerShellRunner.RunAsync(script, new ScriptArgument[0], 200).GetAwaiter().GetResult();
                    });
                }
                finally
                {
                    File.Delete(script);
                }
            });

            Run("Bounds output drain after PowerShell exits", delegate
            {
                string script = Path.Combine(Path.GetTempPath(), "dream-skin-output-timeout-" + Guid.NewGuid().ToString("N") + ".ps1");
                string pidPath = Path.Combine(Path.GetTempPath(), "dream-skin-output-pids-" + Guid.NewGuid().ToString("N") + ".txt");
                File.WriteAllText(script,
                    "param([string]$PidPath)\n" +
                    "$child = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 15' -NoNewWindow -PassThru\n" +
                    "Set-Content -LiteralPath $PidPath -Value (\"$PID|$($child.Id)\")\n" +
                    "Write-Output 'done'\n");
                int childPid = 0;
                try
                {
                    Stopwatch stopwatch = Stopwatch.StartNew();
                    Task<ScriptResult> task = PowerShellRunner.RunAsync(script, new[] {
                        ScriptArgument.Parameter("-PidPath"), ScriptArgument.Literal(pidPath)
                    }, 5000);
                    DateTime markerDeadline = DateTime.UtcNow.AddSeconds(3);
                    while (!File.Exists(pidPath) && DateTime.UtcNow < markerDeadline) Thread.Sleep(25);
                    AssertTrue(File.Exists(pidPath));
                    string[] processIds = File.ReadAllText(pidPath).Trim().Split('|');
                    int parentPid = Convert.ToInt32(processIds[0]);
                    childPid = Convert.ToInt32(processIds[1]);
                    bool parentExited = false;
                    DateTime exitDeadline = DateTime.UtcNow.AddSeconds(2);
                    while (!parentExited && DateTime.UtcNow < exitDeadline)
                    {
                        try
                        {
                            using (Process parent = Process.GetProcessById(parentPid))
                                parentExited = parent.HasExited;
                        }
                        catch (ArgumentException) { parentExited = true; }
                        if (!parentExited) Thread.Sleep(25);
                    }
                    AssertTrue(parentExited);
                    AssertTrue(!task.IsCompleted);
                    AssertThrows<TimeoutException>(delegate
                    {
                        task.GetAwaiter().GetResult();
                    });
                    stopwatch.Stop();
                    AssertTrue(stopwatch.ElapsedMilliseconds < 8000);
                }
                finally
                {
                    if (childPid > 0)
                    {
                        try
                        {
                            using (Process child = Process.GetProcessById(childPid))
                            {
                                if (!child.HasExited) child.Kill();
                                child.WaitForExit(2000);
                            }
                        }
                        catch (ArgumentException) { }
                    }
                    File.Delete(script);
                    File.Delete(pidPath);
                }
            });

            Run("Decodes theme thumbnails at bounded size", delegate
            {
                string imagePath = Path.Combine(Path.GetTempPath(), "dream-skin-thumbnail-" + Guid.NewGuid().ToString("N") + ".jpg");
                using (System.Drawing.Bitmap bitmap = new System.Drawing.Bitmap(800, 600))
                    bitmap.Save(imagePath, System.Drawing.Imaging.ImageFormat.Jpeg);
                try
                {
                    ThemeOption option = new ThemeOption { ImagePath = imagePath };
                    BitmapSource thumbnail = option.ThumbnailImage as BitmapSource;
                    AssertTrue(thumbnail != null);
                    AssertTrue(thumbnail.PixelWidth <= 224);
                }
                finally
                {
                    File.Delete(imagePath);
                }
            });

            Run("Bounds the shared thumbnail cache to 64 images", delegate
            {
                string root = Path.Combine(Path.GetTempPath(), "dream-skin-thumbnail-cache-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(root);
                try
                {
                    for (int i = 0; i < 70; i++)
                    {
                        string imagePath = CreateJpeg(root, "thumb-" + i + ".jpg");
                        AssertTrue(new ThemeOption { ImagePath = imagePath }.ThumbnailImage != null);
                    }
                    Type cache = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.ThemeThumbnailCache", true);
                    PropertyInfo count = cache.GetProperty("CachedCount", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                    AssertTrue(Convert.ToInt32(count.GetValue(null, null)) <= 64);
                }
                finally { Directory.Delete(root, true); }
            });

            Run("Replaces corrupted theme names for display", delegate
            {
                MethodInfo method = typeof(MainWindow).GetMethod("CleanThemeName", BindingFlags.Static | BindingFlags.NonPublic);
                AssertTrue(method != null);
                string cleaned = (string)method.Invoke(null, new object[] { "损坏\uFFFD名称" });
                AssertEqual("已保存主题", cleaned);
            });

            if (Failures.Count == 0)
            {
                Console.WriteLine("PASS: " + PassCount + " tests");
                return 0;
            }

            foreach (string failure in Failures) Console.Error.WriteLine(failure);
            Console.Error.WriteLine("FAIL: " + Failures.Count + " test(s)");
            return 1;
        }

        private static string CreateLayout(bool includeManager = true)
        {
            string root = Path.Combine(Path.GetTempPath(), "dream-skin-manager-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(root, "windows", "scripts"));
            File.WriteAllText(Path.Combine(root, "windows", "scripts", "start-dream-skin.ps1"), "# fixture");
            File.WriteAllText(Path.Combine(root, "windows", "scripts", "restore-dream-skin.ps1"), "# fixture");
            File.WriteAllText(Path.Combine(root, "windows", "scripts", "apply-theme-and-recover.ps1"), "# fixture");
            if (includeManager) File.WriteAllText(Path.Combine(root, "windows", "scripts", "manager-actions.ps1"), "# fixture");
            return root;
        }

        private static void Run(string name, Action action)
        {
            try
            {
                action();
                PassCount++;
                Console.WriteLine("PASS: " + name);
            }
            catch (Exception ex)
            {
                Failures.Add("FAIL: " + name + " - " + ex.Message);
            }
        }

        private static void AssertEqual(string expected, string actual)
        {
            if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
                throw new Exception("Expected '" + expected + "', got '" + actual + "'.");
        }

        private static void AssertSolidBrush(string expected, Brush brush)
        {
            SolidColorBrush solid = brush as SolidColorBrush;
            AssertTrue(solid != null);
            AssertEqual(expected.ToUpperInvariant(), solid.Color.ToString().ToUpperInvariant());
        }

        private static void AssertPrimaryGradient(Brush brush)
        {
            LinearGradientBrush gradient = brush as LinearGradientBrush;
            AssertTrue(gradient != null);
            AssertEqual("#FFF1D58A", gradient.GradientStops[0].Color.ToString().ToUpperInvariant());
            AssertEqual("#FFD2A84F", gradient.GradientStops[1].Color.ToString().ToUpperInvariant());
        }

        private static void AssertTrue(bool value)
        {
            if (!value) throw new Exception("Expected true.");
        }

        private static void AssertClose(double expected, double actual)
        {
            if (Math.Abs(expected - actual) > 0.0001)
                throw new Exception("Expected " + expected + ", got " + actual + ".");
        }

        private static void AssertAtMost(double maximum, double actual, string message)
        {
            if (actual > maximum) throw new Exception(message + " Maximum " + maximum + ", got " + actual + ".");
        }

        private static void AssertBetween(double minimum, double maximum, double actual, string message)
        {
            if (actual < minimum || actual > maximum)
                throw new Exception(message + " Expected " + minimum + "-" + maximum + ", got " + actual + ".");
        }

        private static object ReadMemberObject(object instance, string name)
        {
            if (instance == null) throw new Exception("Cannot read member from null: " + name);
            Type type = instance.GetType();
            FieldInfo field = type.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (field != null) return field.GetValue(instance);
            PropertyInfo property = type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (property != null) return property.GetValue(instance, null);
            throw new Exception("Member was not found: " + type.FullName + "." + name);
        }

        private static string ReadMember(object instance, string name)
        {
            object value = ReadMemberObject(instance, name);
            return value == null ? "" : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
        }

        private static bool Contains(IEnumerable values, string expected)
        {
            foreach (object value in values)
                if (string.Equals(Convert.ToString(value), expected, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static bool ContainsScriptArgument(IEnumerable<ScriptArgument> values, string expected)
        {
            foreach (ScriptArgument value in values)
                if (string.Equals(value.Text, expected, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static bool ContainsResultName(IEnumerable values, string expected)
        {
            foreach (object value in values)
                if (string.Equals(ReadMember(value, "Name"), expected, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static ThemeOption CreateThemeForFilter(string id, string name, string category,
            string source, int order, string[] tags)
        {
            ThemeOption theme = new ThemeOption { Id = id, Name = name };
            SetMember(theme, "Category", category);
            SetMember(theme, "Source", source);
            SetMember(theme, "Order", order);
            SetMember(theme, "Tags", new List<string>(tags));
            return theme;
        }

        private static string CreateJpeg(string root, string name)
        {
            string path = Path.Combine(root, name);
            using (System.Drawing.Bitmap bitmap = new System.Drawing.Bitmap(320, 180))
                bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Jpeg);
            return path;
        }

        private static void CreateCdskin(string packagePath, string manifest, string imagePath, params string[] extraEntries)
        {
            using (FileStream stream = File.Create(packagePath))
            using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Create))
            {
                ZipArchiveEntry manifestEntry = archive.CreateEntry("manifest.json");
                using (StreamWriter writer = new StreamWriter(manifestEntry.Open(), new UTF8Encoding(false))) writer.Write(manifest);
                ZipArchiveEntry imageEntry = archive.CreateEntry("art.jpg");
                using (Stream source = File.OpenRead(imagePath))
                using (Stream target = imageEntry.Open()) source.CopyTo(target);
                foreach (string extra in extraEntries ?? new string[0])
                {
                    ZipArchiveEntry entry = archive.CreateEntry(extra);
                    using (StreamWriter writer = new StreamWriter(entry.Open())) writer.Write("extra");
                }
            }
        }

        private static void AssertInvocationThrows(MethodInfo method, object[] arguments)
        {
            try { method.Invoke(null, arguments); }
            catch (TargetInvocationException ex) { if (ex.InnerException != null) return; throw; }
            throw new Exception("Expected reflected method to reject input.");
        }

        private static void SetMember(object instance, string name, object value)
        {
            Type type = instance.GetType();
            FieldInfo field = type.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (field != null) { field.SetValue(instance, value); return; }
            PropertyInfo property = type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            if (property != null) { property.SetValue(instance, value, null); return; }
            throw new Exception("Member was not found: " + type.FullName + "." + name);
        }

        private static void AssertThrows(Action action)
        {
            try
            {
                action();
            }
            catch
            {
                return;
            }
            throw new Exception("Expected an exception.");
        }

        private static void AssertThrows<T>(Action action) where T : Exception
        {
            try
            {
                action();
            }
            catch (T)
            {
                return;
            }
            throw new Exception("Expected exception: " + typeof(T).Name);
        }

        private static bool FindAutomationName(DependencyObject root, string name)
        {
            if (AutomationProperties.GetName(root) == name) return true;
            foreach (object child in LogicalTreeHelper.GetChildren(root))
            {
                DependencyObject dependency = child as DependencyObject;
                if (dependency != null && FindAutomationName(dependency, name)) return true;
            }
            return false;
        }

        private static FrameworkElement FindAutomationElement(DependencyObject root, string name)
        {
            FrameworkElement element = root as FrameworkElement;
            if (element != null && AutomationProperties.GetName(element) == name) return element;
            int count = VisualTreeHelper.GetChildrenCount(root);
            for (int i = 0; i < count; i++)
            {
                FrameworkElement match = FindAutomationElement(VisualTreeHelper.GetChild(root, i), name);
                if (match != null) return match;
            }
            return null;
        }

        private static T FindVisualChild<T>(DependencyObject root) where T : DependencyObject
        {
            T direct = root as T;
            if (direct != null) return direct;
            int count = VisualTreeHelper.GetChildrenCount(root);
            for (int i = 0; i < count; i++)
            {
                T match = FindVisualChild<T>(VisualTreeHelper.GetChild(root, i));
                if (match != null) return match;
            }
            return null;
        }

        private static T GetPrivateField<T>(object instance, string name) where T : class
        {
            FieldInfo field = instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic);
            T value = field == null ? null : field.GetValue(instance) as T;
            if (value == null) throw new Exception("Private field was not found: " + name);
            return value;
        }

        private static T WaitForTask<T>(Task<T> task, Dispatcher dispatcher)
        {
            T result = default(T);
            Exception failure = null;
            DispatcherFrame frame = new DispatcherFrame();
            task.ContinueWith(completed =>
            {
                if (completed.IsFaulted) failure = completed.Exception.InnerException;
                else if (!completed.IsCanceled) result = completed.Result;
                dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(delegate { frame.Continue = false; }));
            });
            Dispatcher.PushFrame(frame);
            if (failure != null) throw failure;
            return result;
        }

        private static void WaitForTask(Task task, Dispatcher dispatcher)
        {
            WaitForTask<object>(task.ContinueWith(completed =>
                {
                    if (completed.IsFaulted) throw completed.Exception.InnerException;
                    return (object)null;
                }), dispatcher);
        }

        private static int CountVisibleColumns(ListBox list)
        {
            HashSet<int> columns = new HashSet<int>();
            for (int i = 0; i < list.Items.Count; i++)
            {
                ListBoxItem item = list.ItemContainerGenerator.ContainerFromIndex(i) as ListBoxItem;
                if (item == null || item.ActualWidth <= 0) continue;
                Point point = item.TransformToAncestor(list).Transform(new Point(0, 0));
                if (point.Y >= 0 && point.Y < list.ActualHeight) columns.Add((int)Math.Round(point.X));
            }
            return columns.Count;
        }

        private static int ExpectedVisibleColumns(ListBox list, int maximum)
        {
            double available = list.ActualWidth - list.Padding.Left - list.Padding.Right -
                list.BorderThickness.Left - list.BorderThickness.Right;
            int columns = (int)Math.Floor(Math.Max(0, available) / 132.0);
            return Math.Max(1, Math.Min(maximum, columns));
        }

        private static void AssertResponsivePreview(Border preview, string message)
        {
            ResponsivePreviewBorder responsive = preview as ResponsivePreviewBorder;
            AssertTrue(responsive != null);
            AssertClose(16.0 / 9.0, responsive.PreviewAspectRatio);
            double expectedHeight = Math.Max(responsive.PreviewMinHeight,
                Math.Min(responsive.PreviewMaxHeight,
                    preview.ActualWidth / responsive.PreviewAspectRatio));
            AssertBetween(expectedHeight - 0.5, expectedHeight + 0.5,
                preview.ActualHeight, message);
        }
    }
}
