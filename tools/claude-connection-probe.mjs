#!/usr/bin/env node
// Experimental, Windows-only, read-only probe. It never enables a debugger.
// The user must explicitly enable Claude's native Main Process Debugger first.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const LOOPBACK = new Set(['127.0.0.1', '::1']);
const flags = process.argv.slice(2);
if (flags.includes('--help')) {
  console.log('Usage: node tools/claude-connection-probe.mjs\nReads a user-enabled Claude Main Process Debugger twice to verify reconnect.\nDoes not enable debugging, modify appearance, or read conversation text.');
  process.exit(0);
}
if (flags.length || process.platform !== 'win32') {
  console.error('This experimental probe supports Windows with no command arguments.');
  process.exit(1);
}

function powershell(source) {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
    encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 262144,
  }).trim());
}

function inventory() {
  const value = powershell(`
$ErrorActionPreference = 'Stop'
$packages = @(Get-AppxPackage -Name 'Claude' | Where-Object { $_.Name -eq 'Claude' })
$rows = @()
foreach ($package in $packages) {
  $expected = Join-Path $package.InstallLocation 'app\\Claude.exe'
  foreach ($entry in @(Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'")) {
    if ($entry.ExecutablePath -and $entry.ExecutablePath -ieq $expected -and $entry.CommandLine -notmatch '--type=') {
      $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $entry.ProcessId -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{ address = $_.LocalAddress; port = $_.LocalPort }
      })
      $rows += [pscustomobject]@{ pid = $entry.ProcessId; executable = $expected; packageVersion = [string]$package.Version; listeners = $listeners }
    }
  }
}
ConvertTo-Json -InputObject @($rows) -Depth 5 -Compress
`);
  if (!Array.isArray(value) || value.length !== 1) throw new Error('Expected exactly one registered running Claude desktop main process.');
  const app = value[0];
  if (!Number.isSafeInteger(app.pid) || app.pid < 1 || !path.win32.isAbsolute(app.executable) || !Array.isArray(app.listeners)) {
    throw new Error('Invalid Claude process inventory.');
  }
  return app;
}

function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}

function ownedEndpoint(app, endpoint) {
  const fresh = inventory();
  if (fresh.pid !== app.pid || !samePath(fresh.executable, app.executable) ||
      !fresh.listeners.some(item => item.address === endpoint.address && item.port === endpoint.port)) {
    throw new Error('Claude process or listener changed; reconnect must rediscover it.');
  }
}

function readTargets(endpoint) {
  return new Promise((resolve, reject) => {
    let request;
    const deadline = setTimeout(() => request?.destroy(new Error('Inspector discovery deadline exceeded.')), 3000);
    const fail = error => { clearTimeout(deadline); reject(error); };
    request = http.get({ hostname: endpoint.address, port: endpoint.port, path: '/json/list', timeout: 2500 }, response => {
      if (response.statusCode !== 200) {
        fail(new Error('Listener does not expose an Inspector target list.'));
        response.destroy();
        return;
      }
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 65536) request.destroy(new Error('Inspector target list is too large.'));
        else chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        clearTimeout(deadline);
        try {
          const targets = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Array.isArray(targets)) throw new Error('Invalid Inspector target list.');
          resolve(targets);
        } catch { reject(new Error('Invalid Inspector target list.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Inspector discovery timed out.')));
    request.on('error', fail);
  });
}

function inspectorUrl(target, endpoint) {
  const url = new URL(target.webSocketDebuggerUrl);
  const expectedHost = endpoint.address === '::1' ? '[::1]' : endpoint.address;
  if (target.type !== 'node' || url.protocol !== 'ws:' || url.hostname !== expectedHost ||
      Number(url.port) !== endpoint.port || url.username || url.password || url.search || url.hash ||
      !/^\/[a-f0-9-]{36}$/i.test(url.pathname)) throw new Error('Rejected Inspector endpoint shape.');
  return url.href;
}

class InspectorSession {
  constructor(url) {
    this.pending = new Map();
    this.counter = 0;
    this.closed = false;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || event.data.length > 262144) return this.close();
      let message;
      try { message = JSON.parse(event.data); } catch { return this.close(); }
      const pending = this.pending.get(message?.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      // Do not print raw debugger errors or exception objects from user state.
      if (message.error || message.result?.exceptionDetails) pending.reject(new Error('Read-only Inspector evaluation failed.'));
      else pending.resolve(message.result?.result?.value);
    });
    this.socket.addEventListener('error', () => this.close());
    this.socket.addEventListener('close', () => this.close());
  }
  async open() {
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onError);
        this.socket.removeEventListener('close', onError);
        if (error) reject(error); else resolve();
      };
      const onOpen = () => finish();
      const onError = () => finish(new Error('Inspector connection failed.'));
      const timer = setTimeout(() => { finish(new Error('Inspector connection timed out.')); this.close(); }, 3500);
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('error', onError);
      this.socket.addEventListener('close', onError);
    });
  }
  evaluate(expression) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) throw new Error('Inspector connection is closed.');
    return new Promise((resolve, reject) => {
      const id = ++this.counter;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Read-only Inspector evaluation timed out.')); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
          expression, returnByValue: true, awaitPromise: true, silent: true,
        } }));
      } catch { this.close(); }
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Inspector connection closed.'));
    }
    this.pending.clear();
    this.socket.close();
  }
  async disconnect() {
    if (this.socket.readyState === WebSocket.CLOSED) { this.close(); return; }
    await new Promise((resolve, reject) => {
      const onClose = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.socket.removeEventListener('close', onClose);
        reject(new Error('Inspector disconnect was not confirmed.'));
      }, 3500);
      this.socket.addEventListener('close', onClose, { once: true });
      this.close();
    });
  }
}

const IDENTITY = `({ pid: process.pid, executable: process.execPath, electron: process.versions.electron ?? null })`;
const PAGE_PROBE = `({codeRoute:location.protocol==='app:'&&location.hostname==='localhost'&&location.pathname.startsWith('/epitaxy/'),main:!!document.querySelector('main.dframe-content'),sidebar:!!document.querySelector('aside.dframe-sidebar'),frames:document.querySelectorAll('iframe,webview').length})`;
const PAGES = `(async()=>{
  const electron = typeof require==='function' ? require('electron') : process.mainModule?.require('electron');
  if (!electron?.webContents || !electron?.app) return { supported: false };
  const pages = electron.webContents.getAllWebContents().filter(w=>{
    if(w.isDestroyed())return false;
    try { const u=new URL(w.getURL());return u.protocol==='app:'&&u.hostname==='localhost'&&u.pathname.startsWith('/epitaxy/'); }catch{return false;}
  });
  if(pages.length>4) return { supported:true, tooManyPages:true };
  const results=[];
  for(const w of pages) {
    const dom=await w.executeJavaScript(${JSON.stringify(PAGE_PROBE)});
    results.push({id:w.id,type:w.getType(),dom});
  }
  return { supported:true, version:electron.app.getVersion(), pages:results };
})()`;

async function inspectOnce(app, endpoint) {
  ownedEndpoint(app, endpoint);
  const targets = (await readTargets(endpoint)).filter(target => target?.type === 'node');
  if (targets.length !== 1) throw new Error('Expected one Node Inspector target.');
  const url = inspectorUrl(targets[0], endpoint);
  ownedEndpoint(app, endpoint);
  const session = new InspectorSession(url);
  try {
    await session.open();
    const identity = await session.evaluate(IDENTITY);
    if (identity?.pid !== app.pid || !samePath(identity.executable, app.executable) || typeof identity.electron !== 'string') {
      throw new Error('Inspector identity does not match registered Claude.');
    }
    ownedEndpoint(app, endpoint);
    const result = await session.evaluate(PAGES);
    const matched = result?.pages?.filter(page => page.dom?.codeRoute && page.dom.main && page.dom.sidebar) ?? [];
    if (!result?.supported || !matched.length || matched.length !== result.pages.length) {
      throw new Error('Could not verify Claude Code renderer structure.');
    }
    return { pid: app.pid, version: result.version, electron: identity.electron,
      pages: matched.map(page => ({ id: page.id, type: page.type, ...page.dom })) };
  } finally { await session.disconnect(); }
}

try {
  const app = inventory();
  const endpoints = app.listeners.filter(item => LOOPBACK.has(item.address) && Number.isInteger(item.port) && item.port > 0 && item.port <= 65535);
  if (!endpoints.length) {
    console.log(JSON.stringify({ status: 'awaiting-user-enabled-debugger', pid: app.pid, packageVersion: app.packageVersion,
      next: 'Claude → Developer → Enable Main Process Debugger. Requires explicit user approval.' }, null, 2));
    process.exitCode = 2;
  } else {
    let verified = null;
    for (const endpoint of endpoints) {
      try {
        const first = await inspectOnce(app, endpoint);
        const second = await inspectOnce(app, endpoint);
        verified = { status: 'connected', host: endpoint.address, port: endpoint.port, first, second,
          reconnected: true, appearanceChanged: false, debuggerDisabledByProbe: false };
        break;
      } catch { /* Ignore non-Inspector listeners; no raw user data in output. */ }
    }
    if (!verified) throw new Error('No verified Claude Code Inspector connection; debugger may be unavailable or the renderer may have changed.');
    console.log(JSON.stringify(verified, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'unavailable', message: error.message }));
  process.exitCode = 1;
}
