using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Collections;
using System.IO.Compression;
using System.Text;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
                        AssertTrue(ex.Message.Contains("恢复失败：中文错误"));
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
                DreamSkinStatus status = DreamSkinService.ParseStatus("{\"isRunning\":true,\"isPaused\":false,\"activeTheme\":\"森林薄雾\",\"themes\":[]}");
                AssertTrue(status.IsRunning);
                AssertEqual("森林薄雾", status.ActiveThemeName);
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
                DreamSkinStatus status = DreamSkinService.ParseStatus("{\"isRunning\":false,\"themes\":[{\"id\":\"cloud\",\"name\":\"云端遐想\",\"category\":\"dream\",\"tags\":[\"云层\",\"柔光\"],\"source\":\"preset\",\"order\":7,\"addedAt\":\"2026-07-17T00:00:00Z\",\"appearance\":\"light\",\"focusX\":0.62,\"focusY\":0.41,\"safeArea\":\"left\",\"taskMode\":\"ambient\",\"accent\":\"#7B78D6\"}]}");
                ThemeOption theme = status.Themes[0];
                AssertEqual("dream", ReadMember(theme, "Category"));
                AssertEqual("preset", ReadMember(theme, "Source"));
                AssertEqual("7", ReadMember(theme, "Order"));
                IEnumerable tags = ReadMemberObject(theme, "Tags") as IEnumerable;
                AssertTrue(tags != null && Contains(tags, "柔光"));
                AssertEqual("light", ReadMember(theme, "Appearance"));
                AssertClose(0.62, Convert.ToDouble(ReadMemberObject(theme, "FocusX")));
                AssertClose(0.41, Convert.ToDouble(ReadMemberObject(theme, "FocusY")));
                AssertEqual("left", ReadMember(theme, "SafeArea"));
                AssertEqual("ambient", ReadMember(theme, "TaskMode"));
                AssertEqual("#7B78D6", ReadMember(theme, "Accent"));
            });

            Run("Ships a balanced 24 theme preset catalog", delegate
            {
                string presetRoot = Path.Combine(Environment.CurrentDirectory, "windows", "presets");
                string catalogPath = Path.Combine(presetRoot, "catalog.json");
                Dictionary<string, object> catalog = new JavaScriptSerializer()
                    .Deserialize<Dictionary<string, object>>(File.ReadAllText(catalogPath, Encoding.UTF8));
                AssertEqual("1", Convert.ToString(catalog["schemaVersion"]));
                ArrayList themes = catalog["themes"] as ArrayList;
                AssertTrue(themes != null);
                AssertEqual("24", themes.Count.ToString());
                HashSet<string> ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                Dictionary<string, int> categories = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
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
                }
                foreach (string category in new[] { "dream", "nature", "cyber", "minimal", "dark", "warm" })
                    AssertTrue(categories.ContainsKey(category) && categories[category] == 4);
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
                    CreateCdskin(package, "{\"formatVersion\":1,\"id\":\"sample\",\"name\":\"示例主题\",\"image\":\"art.jpg\",\"category\":\"custom\",\"tags\":[\"测试\"],\"appearance\":\"dark\",\"art\":{\"focusX\":0.7,\"focusY\":0.4,\"safeArea\":\"left\",\"taskMode\":\"ambient\"},\"palette\":{\"accent\":\"#112233\"}}", image, null);
                    Type serviceType = typeof(MainWindow).Assembly.GetType("CodexDreamSkinManager.ThemePackageService", true);
                    MethodInfo read = serviceType.GetMethod("ReadPackage", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
                    object data = read.Invoke(null, new object[] { package, Path.Combine(root, "extract") });
                    AssertEqual("示例主题", ReadMember(data, "Name"));
                    AssertEqual("custom", ReadMember(data, "Category"));
                    AssertEqual("dark", ReadMember(data, "Appearance"));
                    AssertClose(0.7, Convert.ToDouble(ReadMemberObject(data, "FocusX")));
                    AssertTrue(Contains(ReadMemberObject(data, "Tags") as IEnumerable, "测试"));
                    AssertTrue(File.Exists(ReadMember(data, "ImagePath")));
                    BatchImportItem item = MainWindow.CreateBatchImportItem((ThemePackageData)data);
                    AssertEqual("custom", ReadMember(item, "Category"));
                    AssertTrue(Contains(ReadMemberObject(item, "Tags") as IEnumerable, "测试"));
                    string exported = Path.Combine(root, "roundtrip.cdskin");
                    serviceType.GetMethod("WritePackage", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                        .Invoke(null, new object[] { exported, data });
                    object roundtrip = read.Invoke(null, new object[] { exported, Path.Combine(root, "roundtrip-extract") });
                    AssertEqual("示例主题", ReadMember(roundtrip, "Name"));
                    AssertEqual("#112233", ReadMember(roundtrip, "Accent"));
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

                    string invalidFocus = Path.Combine(root, "invalid-focus.cdskin");
                    CreateCdskin(invalidFocus, manifest.Replace("\"focusX\":0.5", "\"focusX\":\"invalid\""), image, null);
                    AssertInvocationThrows(read, new object[] { invalidFocus, Path.Combine(root, "extract-e") });

                    string nonFiniteFocus = Path.Combine(root, "non-finite-focus.cdskin");
                    CreateCdskin(nonFiniteFocus, manifest.Replace("\"focusX\":0.5", "\"focusX\":\"NaN\""), image, null);
                    AssertInvocationThrows(read, new object[] { nonFiniteFocus, Path.Combine(root, "extract-f") });
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
                DreamSkinStatus legacy = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"stopped\",\"supportedActions\":[\"Status\"],\"themes\":[]}");
                object legacyActions = fromStatus.Invoke(null, new object[] { legacy, false, true, true });
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(legacyActions, "CanReset")));
                DreamSkinStatus mismatch = DreamSkinService.ParseStatus("{\"isRunning\":false,\"isPaused\":false,\"statusKind\":\"mismatch\",\"themes\":[]}");
                object mismatchActions = fromStatus.Invoke(null, new object[] { mismatch, false, true, true });
                AssertTrue(!Convert.ToBoolean(ReadMemberObject(mismatchActions, "CanApplyTheme")));
                AssertTrue(Convert.ToBoolean(ReadMemberObject(mismatchActions, "CanRestore")));
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
                AssertEqual("1.0.0.0", typeof(Program).Assembly.GetName().Version.ToString());
            });

            Run("Converts focus percentage", delegate
            {
                CustomThemeOptions options = new CustomThemeOptions();
                options.SetFocusPercent(72, 45);
                AssertClose(0.72, options.FocusX);
                AssertClose(0.45, options.FocusY);
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
                    "ExportThemeButton", "PreviewImage", "EnableButton", "PauseButton",
                    "ResetButton", "RestoreButton", "CustomSkinTab"
                };
                foreach (string name in names)
                    AssertTrue(FindAutomationName(window, name));
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

            Run("Theme grid exposes at least three default and six maximized columns", delegate
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
                    if (maximumColumns < 6) throw new Exception("Maximized theme columns: " + maximumColumns);
                }
                finally { window.Close(); }
            });

            Run("Keeps theme grid reachable and vertically scrollable", delegate
            {
                MainWindow window = new MainWindow(null);
                window.Width = 980;
                window.Height = 680;
                window.Show();
                window.UpdateLayout();
                try
                {
                    FrameworkElement themeLibrary = FindAutomationElement(window, "ThemeList");
                    TabControl tabs = FindVisualChild<TabControl>(window);
                    Rect bounds = themeLibrary.TransformToAncestor(tabs)
                        .TransformBounds(new Rect(themeLibrary.RenderSize));
                    AssertTrue(bounds.Top >= 0 && bounds.Top < tabs.ActualHeight);
                    ScrollViewer gridScroll = FindVisualChild<ScrollViewer>(themeLibrary);
                    AssertTrue(gridScroll != null);
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
                    AssertBetween(1.7, 2.3, preview.ActualWidth / preview.ActualHeight, "Dashboard preview is distorted at maximum size.");
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
                    AssertBetween(1.7, 2.3, preview.ActualWidth / preview.ActualHeight,
                        "Custom preview is distorted at maximum size (workspace " + workspace.ActualWidth +
                        ", preview " + preview.ActualWidth + "x" + preview.ActualHeight +
                        ", controls " + controls.ActualWidth + ").");
                    Rect controlsBounds = controls.TransformToAncestor(tabs).TransformBounds(new Rect(controls.RenderSize));
                    AssertTrue(controlsBounds.Left >= 0 && controlsBounds.Right <= tabs.ActualWidth + 0.5);
                }
                finally { window.Close(); }
            });

            Run("Dashboard supports vertical scrolling", delegate
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
                    AssertTrue(scroll.VerticalScrollBarVisibility == ScrollBarVisibility.Auto);
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
    }
}
