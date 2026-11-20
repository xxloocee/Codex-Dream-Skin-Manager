using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using Newtonsoft.Json.Linq;

namespace DreamSkin.SharedHost
{
    internal sealed class NativeDesktop
    {
        private readonly Window owner;
        private readonly string state = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexDreamSkin");
        private readonly Queue<JObject> intents = new Queue<JObject>();
        private readonly HashSet<string> notified = new HashSet<string>();
        private System.Windows.Forms.NotifyIcon notification;
        private System.Drawing.Icon notificationIcon;
        internal NativeDesktop(Window window) { owner = window; }
        internal static string CommunityLink(string address)
        {
            if (address == null || !Regex.IsMatch(address, @"\Adreamskin://apply\?version=ver_[a-z0-9]{8,64}\z")) throw new IOException();
            return address;
        }
        internal void Navigate(string page, string section = "none", string link = null)
        {
            if (intents.Count >= 8) intents.Dequeue();
            intents.Enqueue(new JObject { ["id"] = Guid.NewGuid().ToString("N"), ["page"] = page, ["section"] = section, ["link"] = link == null ? JValue.CreateNull() : new JValue(link) });
            if (owner.WindowState == WindowState.Minimized) owner.WindowState = WindowState.Normal;
            owner.Show(); owner.Activate();
        }
        private string Preference
        {
            get {
                var file = Path.Combine(state, "language.txt");
                if (!File.Exists(file)) return "system";
                SafeFiles.Check(file, state); if (new FileInfo(file).Length > 16) throw new IOException();
                var text = File.ReadAllText(file).Trim(); return text == "en-US" || text == "zh-CN" ? text : "system";
            }
        }
        internal JObject Info()
        {
            var language = Preference;
            return new JObject { ["language"] = language, ["resolvedLanguage"] = language == "system" ? (CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase) ? "zh-CN" : "en-US") : language,
                ["hostVersion"] = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version.ToString(3), ["login"] = "unsupported" };
        }
        internal JObject Execute(string method, JObject parameters, JObject authorized)
        {
            if ((bool?)authorized["authorized"] != true) throw new IOException();
            if (method == "desktop.get") return Info();
            if (method == "desktop.intents") { var result = new JArray(); while (intents.Count > 0) result.Add(intents.Dequeue()); return new JObject { ["intents"] = result }; }
            if (method == "desktop.language") {
                var language = (string)parameters["language"];
                if (language != "system" && language != "zh-CN" && language != "en-US") throw new IOException();
                Directory.CreateDirectory(state); SafeFiles.CheckDirectory(state);
                var file = Path.Combine(state, "language.txt"); if (File.Exists(file)) SafeFiles.Check(file, state);
                var temporary = Path.Combine(state, ".language-" + Guid.NewGuid().ToString("N") + ".tmp");
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    var bytes = new UTF8Encoding(false).GetBytes(language == "system" ? "system\n" : language + "\n"); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
                }
                if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
                return Info();
            }
            if (method == "desktop.login") throw new IOException("Login items are not supported on this platform.");
            if (method == "desktop.open") {
                var target = (string)parameters["target"];
                var urls = new Dictionary<string, string> { ["website"] = "https://dreamskin.cc", ["gallery"] = "https://dreamskin.cc/gallery", ["studio"] = "https://dreamskin.cc/studio" };
                if (urls.TryGetValue(target, out var address)) Process.Start(new ProcessStartInfo { FileName = address, UseShellExecute = true });
                else {
                    if (target != "themes" && target != "images" && target != "state") throw new IOException();
                    var folder = target == "state" ? state : Path.Combine(state, target);
                    SafeFiles.CheckDirectory(folder); Process.Start(new ProcessStartInfo { FileName = folder, UseShellExecute = true });
                }
                return new JObject { ["opened"] = true };
            }
            if (method == "desktop.notifyUpdate") {
                var channel = (string)authorized["channel"]; var version = (string)authorized["version"];
                if (!Regex.IsMatch(version ?? "", @"\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z") || !notified.Add(channel + ":" + version)) return new JObject { ["delivered"] = false };
                notificationIcon = notificationIcon ?? System.Drawing.Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location);
                notification?.Dispose(); notification = new System.Windows.Forms.NotifyIcon { Icon = notificationIcon, Visible = true, Text = "Dream Skin" };
                notification.BalloonTipClicked += (sender, args) => Navigate("settings", "updates");
                notification.ShowBalloonTip(8000, "Dream Skin", ((string)Info()["resolvedLanguage"] == "zh-CN" ? "有新版本：" : "Update available: ") + version, System.Windows.Forms.ToolTipIcon.Info);
                return new JObject { ["delivered"] = true };
            }
            throw new IOException();
        }
        internal void Close() { notification?.Dispose(); notificationIcon?.Dispose(); }
    }
}
