# Dream Skin — Windows components

This package assembles the shared React interface, Node core, Windows WPF/WebView2 host and platform runtime from source. `shared-resource-inventory.json` describes managed resources; it is not a complete release or installation acceptance report.

React 18.3.1, React DOM 18.3.1 and scheduler 0.23.2 are distributed under their original MIT licenses, included as `react-LICENSE.txt`, `react-dom-LICENSE.txt` and `scheduler-LICENSE.txt`.

The x64 host uses Microsoft.Web.WebView2 1.0.2903.40 and Newtonsoft.Json 13.0.3. Their original terms and notices are included at:

- `Microsoft.Web.WebView2/1.0.2903.40/LICENSE.txt`
- `Microsoft.Web.WebView2/1.0.2903.40/NOTICE.txt`
- `Newtonsoft.Json/13.0.3/LICENSE.md`

WebView2 Evergreen Runtime and .NET Framework 4.8 are system prerequisites. Build reference assemblies are not delivered runtime dependencies.

Bundled Node executables must satisfy `>=22.22.2 <23`. The Node license and bundled third-party terms accompany the executable, with the original license also retained under `Node.js/LICENSE`.

Upstream runtime notices and all asset restrictions continue to apply. The project's MIT license does not license all bundled skin assets. These notices do not establish a complete redistribution rights review or a verified signed release.
