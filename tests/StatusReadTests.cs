using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Threading;

namespace CodexDreamSkinManager
{
    internal static partial class ManagerTests
    {
        private static void RunStatusReadTests()
        {
            Run("Catalog publishes before a blocked status read completes", delegate { AssertIndependentRead(false, false, false); });
            Run("Status failure preserves the independently loaded catalog and last running state", delegate { AssertIndependentRead(true, false, false); });
            Run("Status publishes before a blocked catalog read completes", delegate { AssertIndependentRead(false, false, true); });
            Run("Catalog failure preserves the old list without discarding fresh status", delegate { AssertIndependentRead(false, true, true); });
            Run("Both read failures preserve existing data and release the refresh guard", delegate { AssertIndependentRead(true, true, false); });
            Run("Status-only refresh does not request the catalog", delegate
            {
                WithStatusWindow(@"
param($Action,$SkillRoot,[switch]$Quick,[switch]$SkipThemes)
if ($Action -ne 'Status' -or -not $Quick -or -not $SkipThemes) { throw 'Unexpected expensive read' }
'{""isRunning"":true,""statusKind"":""running"",""rendererStatus"":""unchecked"",""themes"":[]}'
", delegate(MainWindow window, string root)
                {
                    AssertTrue(WaitForTask(InvokeRefresh(window, true, false), window.Dispatcher));
                    AssertEqual("old", ((ThemeOption)GetPrivateField<ListBox>(window, "themeList").Items[0]).Id);
                    AssertEqual("皮肤服务运行中", GetPrivateField<TextBlock>(window, "statusText").Text);
                });
            });
            Run("Quiet refresh failure repaints the retained runtime state", delegate
            {
                WithStatusWindow("throw 'read failed'", delegate(MainWindow window, string root)
                {
                    AssertTrue(!WaitForTask(InvokeRefresh(window, false, false), window.Dispatcher));
                    AssertEqual("皮肤运行中", GetPrivateField<TextBlock>(window, "statusText").Text);
                    AssertEqual("running", GetPrivateField<DreamSkinStatus>(window, "currentStatus").StatusKind);
                });
            });
            Run("Read and mutation timeout policies remain separate", delegate
            {
                AssertEqual("15000", Convert.ToString(typeof(DreamSkinService).GetField("ReadTimeoutMilliseconds",
                    BindingFlags.Static | BindingFlags.NonPublic).GetRawConstantValue()));
                AssertEqual("300000", Convert.ToString(typeof(DreamSkinService).GetField("OperationTimeoutMilliseconds",
                    BindingFlags.Static | BindingFlags.NonPublic).GetRawConstantValue()));
            });
            Run("Catalog parser preserves empty, singleton and warning responses", delegate
            {
                AssertEqual("0", DreamSkinService.ParseStatus("{\"themes\":[]}").Themes.Count.ToString());
                DreamSkinStatus catalog = DreamSkinService.ParseStatus("{\"catalogMessage\":\"skipped broken theme\",\"themes\":[{\"id\":\"one\",\"name\":\"One\"}]}");
                AssertEqual("1", catalog.Themes.Count.ToString());
                AssertEqual("one", catalog.Themes[0].Id);
                AssertEqual("skipped broken theme", catalog.Message);
            });
            Run("Normal image switching bypasses startup preflight", delegate
            {
                AssertApplyFlow(true, false, true, false, "apply", true);
            });
            Run("Cold image switching still performs startup preflight", delegate
            {
                AssertApplyFlow(false, false, true, false, "check,apply,start", true);
            });
            Run("Unhealthy video still obtains consent before connecting", delegate
            {
                AssertApplyFlow(true, true, true, false, "check,confirm,connect,apply,start", true, false, true);
            });
            Run("Connection lost during live apply requests consent before fallback startup", delegate
            {
                AssertApplyFlow(true, false, true, false, "apply,check,confirm,start", true, false, false, true);
            });
            Run("Declining fallback restart never starts Codex after publication", delegate
            {
                AssertApplyFlow(true, false, false, false, "apply,check,confirm", true, false, false, true);
            });
        }

        private static Task<bool> InvokeRefresh(MainWindow window, bool reportErrors, bool reloadThemes)
        {
            return (Task<bool>)typeof(MainWindow).GetMethod("RefreshStatusAsync",
                BindingFlags.Instance | BindingFlags.NonPublic).Invoke(window, new object[] { reportErrors, reloadThemes });
        }

        private static void WithStatusWindow(string script, Action<MainWindow, string> test)
        {
            string root = CreateLayout();
            MainWindow window = null;
            SynchronizationContext previous = SynchronizationContext.Current;
            try
            {
                File.WriteAllText(Path.Combine(root, "windows", "scripts", "manager-actions.ps1"), script, new UTF8Encoding(true));
                window = new MainWindow(new DreamSkinService(root));
                SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(window.Dispatcher));
                typeof(MainWindow).GetField("currentStatus", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(window,
                    new DreamSkinStatus { IsRunning = true, StatusKind = "running", ActiveThemeId = "old-active" });
                typeof(MainWindow).GetMethod("PopulateThemes", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(window,
                    new object[] { new List<ThemeOption> { new ThemeOption { Id = "old", Name = "Old" } } });
                test(window, root);
            }
            finally
            {
                SynchronizationContext.SetSynchronizationContext(previous);
                if (window != null) window.Close();
                Directory.Delete(root, true);
            }
        }

        private static void AssertIndependentRead(bool statusFails, bool catalogFails, bool statusFirst)
        {
            string script = @"
param($Action,$SkillRoot,[switch]$Quick,[switch]$SkipThemes)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'Status' -and (-not $Quick -or -not $SkipThemes)) { throw 'Status must be lightweight' }
if ($Action -eq 'ListThemes' -and ($Quick -or $SkipThemes)) { throw 'Catalog request lost its own contract' }
if ($Action -ne 'Status' -and $Action -ne 'ListThemes') { throw 'Unexpected action' }
if ($Action -eq '__SLOW__') {
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not (Test-Path (Join-Path $PSScriptRoot 'release'))) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Test did not release read' }
    Start-Sleep -Milliseconds 20
  }
}
if ($Action -eq 'Status') {
  if (__STATUS_FAILS__) { throw 'status fixture failure' }
  '{""isRunning"":true,""statusKind"":""running"",""activeThemeId"":""fresh-active"",""rendererStatus"":""unchecked"",""themes"":[]}'
} else {
  if (__CATALOG_FAILS__) { throw 'catalog fixture failure' }
  '{""catalogMessage"":""catalog warning"",""themes"":[{""id"":""fresh"",""name"":""Fresh""}]}'
}
".Replace("__SLOW__", statusFirst ? "ListThemes" : "Status")
                .Replace("__STATUS_FAILS__", statusFails ? "$true" : "$false")
                .Replace("__CATALOG_FAILS__", catalogFails ? "$true" : "$false");
            WithStatusWindow(script, delegate(MainWindow window, string root)
            {
                Task<bool> refresh = InvokeRefresh(window, true, true);
                ListBox list = GetPrivateField<ListBox>(window, "themeList");
                try
                {
                    if (!(statusFails && catalogFails))
                    {
                        WaitForTask(WaitUntilAsync(delegate
                        {
                            return statusFirst
                                ? GetPrivateField<DreamSkinStatus>(window, "currentStatus").ActiveThemeId == "fresh-active"
                                : list.Items.Count == 1 && ((ThemeOption)list.Items[0]).Id == "fresh";
                        }), window.Dispatcher);
                        AssertTrue(!refresh.IsCompleted);
                    }
                }
                finally
                {
                    File.WriteAllText(Path.Combine(root, "windows", "scripts", "release"), "go");
                    WaitForTask(refresh, window.Dispatcher);
                }
                AssertEqual((!statusFails && !catalogFails).ToString(), refresh.Result.ToString());
                DreamSkinStatus status = GetPrivateField<DreamSkinStatus>(window, "currentStatus");
                AssertEqual(catalogFails ? "old" : "fresh", ((ThemeOption)list.Items[0]).Id);
                AssertEqual(statusFails ? "old-active" : "fresh-active", status.ActiveThemeId);
                AssertTrue(status.IsRunning);
                AssertEqual(statusFails ? "error" : "running", status.StatusKind);
                AssertEqual("0", Convert.ToString(ReadMemberObject(window, "statusRefreshCount")));
                AssertTrue(GetPrivateField<Button>(window, "refreshButton").IsEnabled);
                if (!catalogFails) AssertEqual("catalog warning", status.Message);
            });
        }

        private static async Task WaitUntilAsync(Func<bool> predicate)
        {
            Stopwatch clock = Stopwatch.StartNew();
            while (!predicate())
            {
                if (clock.ElapsedMilliseconds > 8000) throw new Exception("Independent read did not publish before the other completed.");
                await Task.Delay(20);
            }
        }
    }
}
