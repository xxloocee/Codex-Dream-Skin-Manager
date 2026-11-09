using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DreamSkin.SharedHost
{
    internal sealed class NativeBackend : IDisposable
    {
        internal const string Protocol = "dreamskin.manager/1";
        internal const int Limit = 1024 * 1024;
        private readonly Process process;
        private readonly SemaphoreSlim writer = new SemaphoreSlim(1, 1);
        private int queued;
        private volatile bool closed;
        internal event Action<JObject> Message;
        internal event Action Disconnected;
        internal NativeBackend(string root, string resources)
        {
            var node = Path.Combine(root, "runtime", "node", "node.exe");
            var entry = Path.Combine(root, "shared", "core", "main.mjs");
            SafeFiles.Check(node, root); SafeFiles.Check(entry, root);
            process = new Process { StartInfo = new ProcessStartInfo {
                FileName = node,
                Arguments = Quote(entry) + " --application-root " + Quote(root) + " --resource-directory " + Quote(resources) + " --media-origin https://media.dreamskin.invalid --mode manager",
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false, true)
            }};
        }
        internal void Start()
        {
            process.Start();
            _ = Task.Run(async () => { try { var bytes = new byte[4096]; while (await process.StandardError.BaseStream.ReadAsync(bytes, 0, bytes.Length) != 0) { } } catch { } });
            _ = Task.Run(Read);
        }
        private async Task Read()
        {
            try
            {
                var decoder = new UTF8Encoding(false, true);
                var bytes = new byte[8192];
                using (var line = new MemoryStream())
                {
                    int count;
                    while ((count = await process.StandardOutput.BaseStream.ReadAsync(bytes, 0, bytes.Length)) != 0)
                    {
                        for (var i = 0; i < count; i++)
                        {
                            if (bytes[i] == 10)
                            {
                                var value = Parse(decoder.GetString(line.ToArray())); line.SetLength(0);
                                if ((string)value["protocol"] != Protocol) throw new IOException();
                                Message?.Invoke(value);
                            }
                            else { if (line.Length >= Limit) throw new IOException(); line.WriteByte(bytes[i]); }
                        }
                    }
                    if (line.Length != 0) throw new IOException();
                }
            }
            catch { /* Only a fixed disconnect notification crosses the web boundary. */ }
            finally { if (!closed) { Dispose(); Disconnected?.Invoke(); } }
        }
        internal async Task Send(string text)
        {
            if (closed) throw new IOException();
            if (Encoding.UTF8.GetByteCount(text) > Limit) throw new IOException();
            var request = Parse(text);
            if ((string)request["protocol"] != Protocol || (string)request["kind"] != "request" ||
                !Regex.IsMatch((string)request["requestId"] ?? "", "\\A[A-Za-z0-9:_-]{1,128}\\z") || ((string)request["requestId"]).StartsWith("native:", StringComparison.Ordinal) ||
                !(request["params"] is JObject) || !new HashSet<string> { "system.hello", "status.get", "themes.list", "themes.get", "themes.active", "media.activePreview", "media.resolve", "media.release", "skin.apply", "skin.pause", "skin.resume", "skin.reset", "skin.restore", "runtime.repair", "runtime.upgrade", "events.subscribe", "events.unsubscribe", "session.close", "operations.list", "operations.get", "operations.confirm", "themes.update", "themes.copy", "sources.preview", "sources.release", "themes.create", "packages.inspect", "packages.preview", "packages.release", "themes.importPackage", "community.list", "community.local", "community.preview", "community.inspect", "community.download", "community.import", "community.apply", "updates.check", "updates.install", "updates.get", "maintenance.inspect", "maintenance.prepare", "maintenance.execute", "maintenance.get", "startup.get", "startup.update", "claude.status", "claude.apply", "claude.reset", "claude.startup.get", "claude.startup.update", "claude.pause", "claude.resume", "claude.restore", "claude.operations.get", "claude.parameters.get", "claude.parameters.update", "themes.delete", "library.recovery.list", "library.recover" }.Contains((string)request["method"])) throw new IOException();
            foreach (var property in request.Properties()) if (!new HashSet<string> { "protocol", "kind", "requestId", "method", "params" }.Contains(property.Name)) throw new IOException();
            await Write(text);
        }
        internal Task SendNative(JObject request)
        {
            if ((string)request["protocol"] != Protocol || (string)request["kind"] != "native.request" ||
                !new HashSet<string> { "sources.register", "media.original", "files.release", "packages.register", "packages.export", "updates.authorizeOpen", "updates.authorizeQuit", "desktop.authorize" }.Contains((string)request["method"])) throw new IOException();
            return Write(request.ToString(Formatting.None));
        }
        private async Task Write(string text)
        {
            if (closed || Encoding.UTF8.GetByteCount(text) > Limit) throw new IOException();
            // Match the manager's 32 pending requests, including 20 thumbnail warmups.
            if (Interlocked.Increment(ref queued) > 32) { Interlocked.Decrement(ref queued); throw new IOException(); }
            try { await writer.WaitAsync(); try {
                if (closed) throw new IOException();
                // .NET Framework 4.8 has no StandardInputEncoding option. Write
                // BOM-free UTF-8 directly so non-ASCII JSON never uses a code page.
                var bytes = new UTF8Encoding(false, true).GetBytes(text + "\n");
                var input = process.StandardInput.BaseStream;
                await input.WriteAsync(bytes, 0, bytes.Length); await input.FlushAsync();
            } finally { writer.Release(); } }
            finally { Interlocked.Decrement(ref queued); }
        }
        internal static JObject Parse(string text)
        {
            using (var reader = new JsonTextReader(new StringReader(text)) { DateParseHandling = DateParseHandling.None, MaxDepth = 32 })
            {
                var result = JObject.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                if (reader.Read()) throw new IOException(); return result;
            }
        }
        private static string Quote(string value)
        {
            // CommandLineToArgvW rules, including trailing backslashes.
            var result = new StringBuilder("\""); var slashes = 0;
            foreach (var character in value)
            {
                if (character == '\\') { slashes++; continue; }
                if (character == '"') result.Append('\\', slashes * 2 + 1).Append('"');
                else result.Append('\\', slashes).Append(character);
                slashes = 0;
            }
            return result.Append('\\', slashes * 2).Append('"').ToString();
        }
        public void Dispose()
        {
            if (closed) return; closed = true;
            try { process.StandardInput.Close(); } catch { }
            // Closing stdin asks Node to drain an accepted transaction. Killing
            // this process could orphan a publication or restart in progress.
        }
    }
}
