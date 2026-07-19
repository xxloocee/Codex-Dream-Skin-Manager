using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace CodexDreamSkinManager
{
    internal sealed class DreamSkinService
    {
        private readonly string rootDirectory;
        private readonly string scriptsDirectory;
        private readonly string managerScript;
        private readonly string restoreScript;
        private readonly string recoveryScript;

        public bool CanManage { get { return File.Exists(managerScript); } }
        public bool CanRestore { get { return File.Exists(restoreScript); } }
        public bool CanRecover { get { return File.Exists(recoveryScript); } }

        public DreamSkinService(string root)
        {
            rootDirectory = Path.GetFullPath(root);
            scriptsDirectory = FindScriptsDirectory(rootDirectory);
            managerScript = Path.Combine(scriptsDirectory, "manager-actions.ps1");
            restoreScript = Path.Combine(scriptsDirectory, "restore-dream-skin.ps1");
            recoveryScript = Path.Combine(scriptsDirectory, "apply-theme-and-recover.ps1");
            if (!CanManage && !CanRestore)
                throw new FileNotFoundException("缺少管理脚本和紧急恢复脚本。", managerScript);
        }

        public static string FindScriptsDirectory(string root)
        {
            string scripts = Path.GetFullPath(Path.Combine(root, "windows", "scripts"));
            if (!Directory.Exists(scripts) || !File.Exists(Path.Combine(scripts, "start-dream-skin.ps1")))
                throw new DirectoryNotFoundException("未找到 windows\\scripts，请把管理器放在 CodexDreamSkin 根目录。");
            return scripts;
        }

        public static DreamSkinStatus ParseStatus(string json)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> data = serializer.Deserialize<Dictionary<string, object>>(json);
            if (data == null) throw new FormatException("状态 JSON 为空。");
            DreamSkinStatus status = new DreamSkinStatus();
            status.IsRunning = ReadBool(data, "isRunning");
            status.IsPaused = ReadBool(data, "isPaused");
            status.StatusKind = ReadString(data, "statusKind", status.IsRunning ? "running" : "stopped");
            status.StatusMessage = ReadString(data, "statusMessage", "");
            status.ActiveThemeName = ReadString(data, "activeTheme", "未选择");
            status.ActiveThemeImage = ReadString(data, "activeImage", "");
            status.ManagerApiVersion = ReadString(data, "managerApiVersion", "");
            status.ThemeSchemaVersion = ReadInt(data, "themeSchemaVersion");
            status.StateSchemaVersion = ReadInt(data, "stateSchemaVersion");
            status.InjectorVersion = ReadString(data, "injectorVersion", "");
            status.NodeVersion = ReadString(data, "nodeVersion", "");
            status.CodexVersion = ReadString(data, "codexVersion", "");
            object supported;
            if (data.TryGetValue("supportedActions", out supported))
            {
                IEnumerable actions = supported as IEnumerable;
                if (actions != null)
                    foreach (object action in actions) if (action != null) status.SupportedActions.Add(Convert.ToString(action, CultureInfo.InvariantCulture));
            }
            object themeData;
            if (data.TryGetValue("themes", out themeData))
            {
                IEnumerable items = themeData as IEnumerable;
                if (items != null)
                {
                    foreach (object item in items)
                    {
                        Dictionary<string, object> row = item as Dictionary<string, object>;
                        if (row == null) continue;
                        ThemeOption theme = new ThemeOption();
                        theme.Id = ReadString(row, "id", "");
                        theme.Name = ReadString(row, "name", theme.Id);
                        theme.ImagePath = ReadString(row, "imagePath", "");
                        theme.ThemeDirectory = ReadString(row, "themeDirectory", "");
                        theme.IsPreset = ReadBool(row, "isPreset");
                        theme.Category = ReadString(row, "category", theme.IsPreset ? "uncategorized" : "custom");
                        theme.Source = ReadString(row, "source", theme.IsPreset ? "preset" : "saved");
                        theme.Order = ReadInt(row, "order");
                        theme.AddedAt = ReadString(row, "addedAt", "");
                        theme.Appearance = ReadString(row, "appearance", "auto");
                        theme.FocusX = ReadDouble(row, "focusX", 0.5);
                        theme.FocusY = ReadDouble(row, "focusY", 0.5);
                        theme.SafeArea = ReadString(row, "safeArea", "auto");
                        theme.TaskMode = ReadString(row, "taskMode", "auto");
                        theme.Accent = ReadString(row, "accent", "");
                        object tags;
                        if (row.TryGetValue("tags", out tags))
                        {
                            IEnumerable tagItems = tags as IEnumerable;
                            if (tagItems != null)
                                foreach (object tag in tagItems) if (tag != null) theme.Tags.Add(Convert.ToString(tag, CultureInfo.InvariantCulture));
                        }
                        status.Themes.Add(theme);
                    }
                }
            }
            return status;
        }

        public async Task<DreamSkinStatus> GetStatusAsync()
        {
            EnsureManagerAvailable();
            ScriptResult result = await PowerShellRunner.RunAsync(managerScript,
                new[] { P("-Action"), V("Status"), P("-SkillRoot"), V(Path.Combine(rootDirectory, "windows")) }, 8000);
            return ParseStatus(result.Output);
        }

        public static ImageValidationResult ParseImageValidation(string json)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> data = serializer.Deserialize<Dictionary<string, object>>(json);
            if (data == null) throw new FormatException("图片验证 JSON 为空。");
            return new ImageValidationResult {
                Path = ReadString(data, "path", ""),
                Format = ReadString(data, "format", ""),
                Width = ReadInt(data, "width"),
                Height = ReadInt(data, "height"),
                Bytes = ReadLong(data, "bytes"),
                CanPreview = ReadBool(data, "canPreview"),
                PreviewMessage = ReadString(data, "previewMessage", "")
            };
        }

        public async Task<ImageValidationResult> ValidateImageAsync(string imagePath)
        {
            EnsureManagerAvailable();
            ScriptResult result = await PowerShellRunner.RunAsync(managerScript,
                new[] { P("-Action"), V("ValidateImage"), P("-SkillRoot"), V(Path.Combine(rootDirectory, "windows")),
                    P("-ImagePath"), V(imagePath) }, 8000);
            return ParseImageValidation(result.Output);
        }

        public static BatchImportResult ParseBatchResult(string json)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            Dictionary<string, object> data = serializer.Deserialize<Dictionary<string, object>>(json);
            if (data == null) throw new FormatException("批量导入 JSON 为空。");
            BatchImportResult result = new BatchImportResult {
                Imported = ReadInt(data, "imported"),
                Skipped = ReadInt(data, "skipped"),
                Failed = ReadInt(data, "failed")
            };
            object rows;
            if (data.TryGetValue("results", out rows))
            {
                IEnumerable items = rows as IEnumerable;
                if (items != null)
                    foreach (object item in items)
                    {
                        Dictionary<string, object> row = item as Dictionary<string, object>;
                        if (row == null) continue;
                        result.Results.Add(new BatchImportResultItem {
                            Name = ReadString(row, "name", ""),
                            Status = ReadString(row, "status", ""),
                            Message = ReadString(row, "message", ""),
                            ThemeDirectory = ReadString(row, "themeDirectory", "")
                        });
                    }
            }
            return result;
        }

        public async Task<BatchImportResult> ImportBatchAsync(IList<BatchImportItem> items)
        {
            EnsureManagerAvailable();
            if (items == null || items.Count < 1 || items.Count > 50)
                throw new ArgumentOutOfRangeException("items", "一次只能导入 1 到 50 个主题。");
            string stateRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexDreamSkin");
            string requestsRoot = Path.Combine(stateRoot, "requests");
            Directory.CreateDirectory(requestsRoot);
            string id = Guid.NewGuid().ToString("N");
            string temporary = Path.Combine(requestsRoot, ".request-" + id + ".tmp");
            string request = Path.Combine(requestsRoot, "request-" + id + ".json");
            try
            {
                List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
                foreach (BatchImportItem item in items)
                {
                    if (item == null) throw new ArgumentException("批量导入包含空项目。", "items");
                    rows.Add(new Dictionary<string, object> {
                        { "imagePath", item.ImagePath }, { "name", item.Name }, { "appearance", item.Appearance },
                        { "focusX", item.FocusX }, { "focusY", item.FocusY }, { "safeArea", item.SafeArea },
                        { "taskMode", item.TaskMode }, { "accent", item.Accent }, { "category", item.Category },
                        { "tags", (item.Tags ?? new List<string>()).ToArray() }
                    });
                }
                Dictionary<string, object> payload = new Dictionary<string, object> { { "schemaVersion", 1 }, { "items", rows.ToArray() } };
                string content = new JavaScriptSerializer().Serialize(payload) + "\r\n";
                File.WriteAllText(temporary, content, new System.Text.UTF8Encoding(true));
                File.Move(temporary, request);
                ScriptResult scriptResult = await PowerShellRunner.RunAsync(managerScript,
                    new[] { P("-Action"), V("ImportBatch"), P("-SkillRoot"), V(Path.Combine(rootDirectory, "windows")),
                        P("-RequestPath"), V(request) }, 180000);
                return ParseBatchResult(scriptResult.Output);
            }
            finally
            {
                try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
                try { if (File.Exists(request)) File.Delete(request); } catch { }
            }
        }

        public Task ApplyThemeAsync(ThemeOption theme)
        {
            List<ScriptArgument> args = new List<ScriptArgument>();
            args.Add(P("-Action")); args.Add(V("ApplyTheme"));
            args.Add(P("-SkillRoot")); args.Add(V(Path.Combine(rootDirectory, "windows")));
            AddThemeArguments(args, theme);
            return RunManagerAsync(args);
        }

        public Task ApplyThemeAndRecoverAsync(ThemeOption theme)
        {
            if (!CanRecover) throw new FileNotFoundException("缺少主题恢复脚本。", recoveryScript);
            List<ScriptArgument> args = new List<ScriptArgument>();
            args.Add(P("-SkillRoot")); args.Add(V(Path.Combine(rootDirectory, "windows")));
            AddThemeArguments(args, theme);
            return RunScriptAsync(recoveryScript, args);
        }

        private static void AddThemeArguments(List<ScriptArgument> args, ThemeOption theme)
        {
            if (theme == null) throw new ArgumentNullException("theme");
            if (!string.IsNullOrWhiteSpace(theme.ThemeDirectory))
            {
                args.Add(P("-ThemeDirectory")); args.Add(V(theme.ThemeDirectory));
            }
            else
            {
                args.Add(P("-ImagePath")); args.Add(V(theme.ImagePath));
                args.Add(P("-Name")); args.Add(V(theme.Name));
                args.Add(P("-Appearance")); args.Add(V(theme.Appearance));
                args.Add(P("-FocusX")); args.Add(V(theme.FocusX.ToString(CultureInfo.InvariantCulture)));
                args.Add(P("-FocusY")); args.Add(V(theme.FocusY.ToString(CultureInfo.InvariantCulture)));
                args.Add(P("-SafeArea")); args.Add(V(theme.SafeArea));
                args.Add(P("-TaskMode")); args.Add(V(theme.TaskMode));
                args.Add(P("-Accent")); args.Add(V(theme.Accent));
            }
        }

        public Task ImportThemeAsync(CustomThemeOptions options, bool keepCurrent)
        {
            options.Validate();
            List<ScriptArgument> args = new List<ScriptArgument>(new[] {
                P("-Action"), V("ImportTheme"), P("-SkillRoot"), V(Path.Combine(rootDirectory, "windows")),
                P("-ImagePath"), V(options.ImagePath), P("-Name"), V(options.Name),
                P("-Appearance"), V(options.Appearance),
                P("-FocusX"), V(options.FocusX.ToString(CultureInfo.InvariantCulture)),
                P("-FocusY"), V(options.FocusY.ToString(CultureInfo.InvariantCulture)),
                P("-SafeArea"), V(options.SafeArea), P("-TaskMode"), V(options.TaskMode),
                P("-Accent"), V(options.Accent)
            });
            if (keepCurrent) args.Add(P("-KeepCurrent"));
            return RunManagerAsync(args);
        }

        public Task SetPausedAsync(bool paused)
        {
            return RunManagerAsync(new[] { P("-Action"), V(paused ? "Pause" : "Resume"),
                P("-SkillRoot"), V(Path.Combine(rootDirectory, "windows")) });
        }

        public Task ResetThemeAsync()
        {
            return RunManagerAsync(new[] { P("-Action"), V("ResetTheme"),
                P("-SkillRoot"), V(Path.Combine(rootDirectory, "windows")) });
        }

        public Task StartAsync(bool restartExisting)
        {
            List<ScriptArgument> args = new List<ScriptArgument>();
            if (restartExisting) args.Add(P("-RestartExisting"));
            return RunScriptAsync(Path.Combine(scriptsDirectory, "start-dream-skin.ps1"), args);
        }

        public Task RestoreAsync(bool restartExisting)
        {
            if (!CanRestore) throw new FileNotFoundException("缺少紧急恢复脚本。", restoreScript);
            string configBackup = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CodexDreamSkin", "config.before-dream-skin.toml");
            IList<ScriptArgument> args = BuildRestoreArguments(restartExisting, File.Exists(configBackup));
            return RunScriptAsync(restoreScript, args);
        }

        internal static IList<ScriptArgument> BuildRestoreArguments(bool restartExisting, bool hasConfigBackup)
        {
            List<ScriptArgument> args = new List<ScriptArgument>();
            if (hasConfigBackup) args.Add(P("-RestoreBaseTheme"));
            if (restartExisting) args.Add(P("-ForceRestart"));
            return args;
        }

        private async Task RunManagerAsync(IList<ScriptArgument> args)
        {
            EnsureManagerAvailable();
            await PowerShellRunner.RunAsync(managerScript, args, 30000);
        }

        private async Task RunScriptAsync(string script, IList<ScriptArgument> args)
        {
            await PowerShellRunner.RunAsync(script, args, 180000);
        }

        private void EnsureManagerAvailable()
        {
                if (!CanManage) throw new FileNotFoundException("管理脚本不可用；你仍可使用紧急恢复。", managerScript);
        }

        private static ScriptArgument P(string value) { return ScriptArgument.Parameter(value); }
        private static ScriptArgument V(string value) { return ScriptArgument.Literal(value); }

        private static bool ReadBool(Dictionary<string, object> data, string key)
        {
            object value;
            return data.TryGetValue(key, out value) && value is bool && (bool)value;
        }

        private static string ReadString(Dictionary<string, object> data, string key, string fallback)
        {
            object value;
            return data.TryGetValue(key, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) : fallback;
        }

        private static int ReadInt(Dictionary<string, object> data, string key)
        {
            object value;
            int parsed;
            return data.TryGetValue(key, out value) && value != null && int.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed) ? parsed : 0;
        }

        private static long ReadLong(Dictionary<string, object> data, string key)
        {
            object value;
            long parsed;
            return data.TryGetValue(key, out value) && value != null && long.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed) ? parsed : 0;
        }

        private static double ReadDouble(Dictionary<string, object> data, string key, double fallback)
        {
            object value;
            double parsed;
            return data.TryGetValue(key, out value) && value != null &&
                double.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Float,
                    CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
        }
    }
}
