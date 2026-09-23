using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Xml;

namespace CodexDreamSkinManager
{
    internal sealed class ScriptResult
    {
        public int ExitCode;
        public string Output = "";
        public string Error = "";
    }

    internal sealed class ScriptArgument
    {
        public string Text { get; private set; }
        public bool IsParameter { get; private set; }

        private ScriptArgument(string text, bool isParameter)
        {
            Text = text ?? "";
            IsParameter = isParameter;
        }

        public static ScriptArgument Parameter(string text)
        {
            if (!PowerShellRunner.IsParameterToken(text))
                throw new ArgumentException("PowerShell 参数名称无效。", "text");
            return new ScriptArgument(text, true);
        }

        public static ScriptArgument Literal(string text)
        {
            return new ScriptArgument(text, false);
        }
    }

    internal static class PowerShellRunner
    {
        private const string EncodedErrorPrefix = "__CODEX_DREAM_SKIN_ERROR_UTF8__";

        public static string QuoteLiteral(string value)
        {
            return "'" + (value ?? "").Replace("'", "''") + "'";
        }

        public static Task<ScriptResult> RunAsync(string scriptPath, IList<ScriptArgument> arguments)
        {
            return RunAsync(scriptPath, arguments, 180000);
        }

        public static Task<ScriptResult> RunAsync(string scriptPath, IList<ScriptArgument> arguments, int timeoutMilliseconds)
        {
            if (timeoutMilliseconds <= 0) throw new ArgumentOutOfRangeException("timeoutMilliseconds");
            return Task.Run(delegate
            {
                ProcessStartInfo info = new ProcessStartInfo();
                string completionMarker = "__DREAM_SKIN_COMPLETE_" + Guid.NewGuid().ToString("N") + "__";
                string operation = Path.GetFileName(scriptPath);
                for (int index = 0; index + 1 < arguments.Count; index++)
                    if (arguments[index] != null && arguments[index + 1] != null &&
                        arguments[index].IsParameter && arguments[index].Text == "-Action")
                        operation += " / " + arguments[index + 1].Text;
                info.FileName = "powershell.exe";
                info.Arguments = BuildArguments(scriptPath, arguments, completionMarker);
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.Default;

                using (Process process = Process.Start(info))
                {
                    Stopwatch stopwatch = Stopwatch.StartNew();
                    Task<string> outputTask = ReadScriptOutputAsync(process.StandardOutput, completionMarker);
                    Task<string> errorTask = ReadScriptOutputAsync(process.StandardError, completionMarker);
                    if (!process.WaitForExit(timeoutMilliseconds))
                    {
                        try { if (!process.HasExited) process.Kill(); } catch { }
                        process.WaitForExit(5000);
                        throw new TimeoutException(string.Format(CultureInfo.InvariantCulture,
                            "操作执行超时（{0}，等待 {1} 秒）。操作结果尚未确认，请刷新状态。",
                            operation, timeoutMilliseconds / 1000.0));
                    }
                    int remainingMilliseconds = Math.Max(0,
                        timeoutMilliseconds - (int)Math.Min(stopwatch.ElapsedMilliseconds, int.MaxValue));
                    int exitCode = process.ExitCode;
                    if (!Task.WaitAll(new Task[] { outputTask, errorTask }, Math.Min(2000, remainingMilliseconds)))
                        throw new TimeoutException(string.Format(CultureInfo.InvariantCulture,
                            "脚本已退出，但输出未完整回收（{0}，退出码 {1}）。请刷新状态确认操作结果。",
                            operation, exitCode));
                    ScriptResult result = new ScriptResult();
                    result.ExitCode = exitCode;
                    result.Output = outputTask.Result.Trim();
                    result.Error = NormalizePowerShellError(errorTask.Result);
                    if (result.ExitCode != 0)
                    {
                        string encodedError = ExtractEncodedError(result.Output);
                        throw new InvalidOperationException(!string.IsNullOrWhiteSpace(encodedError)
                            ? encodedError
                            : (string.IsNullOrWhiteSpace(result.Error) ? result.Output : result.Error));
                    }
                    return result;
                }
            });
        }

        internal static string BuildArguments(string scriptPath, IList<ScriptArgument> arguments)
        {
            return BuildArguments(scriptPath, arguments, null);
        }

        // A long-lived descendant can retain the pipe even after PowerShell exits.
        // The wrapper marks its own output complete without waiting for descendant EOF.
        private static async Task<string> ReadScriptOutputAsync(StreamReader reader, string completionMarker)
        {
            StringBuilder output = new StringBuilder();
            string line;
            while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
            {
                if (line == completionMarker) break;
                output.AppendLine(line);
            }
            return output.ToString();
        }

        private static string BuildArguments(string scriptPath, IList<ScriptArgument> arguments, string completionMarker)
        {
            StringBuilder command = new StringBuilder();
            command.Append("$utf8 = New-Object System.Text.UTF8Encoding($false); ");
            command.Append("[Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; try { & ");
            command.Append(QuoteLiteral(scriptPath));
            foreach (ScriptArgument argument in arguments)
            {
                if (argument == null) throw new ArgumentException("PowerShell 参数列表包含空项目。", "arguments");
                command.Append(' ');
                command.Append(argument.IsParameter ? argument.Text : QuoteLiteral(argument.Text));
            }
            command.Append(" } catch { $message = [string]$_.Exception.Message; ");
            command.Append("if ([string]::IsNullOrWhiteSpace($message)) { $message = [string]$_ }; ");
            command.Append("[Console]::Out.WriteLine('");
            command.Append(EncodedErrorPrefix);
            command.Append("' + [Convert]::ToBase64String($utf8.GetBytes($message))); exit 1 }");
            if (completionMarker != null)
            {
                command.Append(" finally { [Console]::Out.WriteLine(); [Console]::Out.WriteLine(");
                command.Append(QuoteLiteral(completionMarker));
                command.Append("); [Console]::Error.WriteLine(); [Console]::Error.WriteLine(");
                command.Append(QuoteLiteral(completionMarker));
                command.Append("); }");
            }
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(command.ToString()));
            return "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " + encoded;
        }

        internal static string ExtractEncodedError(string output)
        {
            string value = output ?? "";
            int marker = value.LastIndexOf(EncodedErrorPrefix, StringComparison.Ordinal);
            if (marker < 0) return "";
            int start = marker + EncodedErrorPrefix.Length;
            int end = value.IndexOfAny(new[] { '\r', '\n' }, start);
            string encoded = (end < 0 ? value.Substring(start) : value.Substring(start, end - start)).Trim();
            try { return Encoding.UTF8.GetString(Convert.FromBase64String(encoded)).Trim(); }
            catch (FormatException) { return ""; }
        }

        internal static string NormalizePowerShellError(string value)
        {
            string raw = (value ?? "").Trim();
            int xmlStart = raw.IndexOf("<Objs", StringComparison.Ordinal);
            if (xmlStart < 0) return raw;
            try
            {
                XmlDocument document = new XmlDocument();
                document.XmlResolver = null;
                document.LoadXml(raw.Substring(xmlStart));
                XmlNodeList errors = document.SelectNodes("//*[local-name()='S' and @S='Error']");
                foreach (XmlNode error in errors)
                {
                    string message = DecodePowerShellXmlEscapes(error.InnerText).Trim();
                    if (!string.IsNullOrWhiteSpace(message)) return message;
                }
            }
            catch (XmlException) { }
            return raw;
        }

        private static string DecodePowerShellXmlEscapes(string value)
        {
            StringBuilder result = new StringBuilder();
            for (int index = 0; index < value.Length; index++)
            {
                if (index + 6 < value.Length && value[index] == '_' && value[index + 1] == 'x' && value[index + 6] == '_')
                {
                    int codePoint;
                    if (int.TryParse(value.Substring(index + 2, 4), NumberStyles.HexNumber,
                        CultureInfo.InvariantCulture, out codePoint))
                    {
                        result.Append((char)codePoint);
                        index += 6;
                        continue;
                    }
                }
                result.Append(value[index]);
            }
            return result.ToString();
        }

        internal static bool IsParameterToken(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length < 2 || value[0] != '-') return false;
            for (int i = 1; i < value.Length; i++)
                if (!char.IsLetterOrDigit(value[i])) return false;
            return char.IsLetter(value[1]);
        }
    }
}
