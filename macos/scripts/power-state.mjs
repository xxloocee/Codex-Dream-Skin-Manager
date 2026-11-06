import { spawn } from "node:child_process";

// One native observer lives with the watcher; no per-tick shell, ps or ioreg.
export function observePowerState(executable, onSuspended) {
  const child = spawn(executable, ["--observe-power"], { stdio: ["pipe", "pipe", "ignore"] });
  let pending = "", closed = false, previous = null;
  const publish = (suspended) => {
    if (previous === suspended) return;
    previous = suspended; onSuspended(suspended);
  };
  const failed = () => {
    if (closed) return;
    closed = true; child.stdin.destroy(); child.kill();
    console.error("[dream-skin] native power observation unavailable; page visibility remains active");
    publish(false);
  };
  child.on("error", failed);
  child.on("exit", failed);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    pending += text;
    if (pending.length > 4096) { failed(); return; }
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (typeof value.screenAwake !== "boolean") throw new Error();
        publish(!value.screenAwake);
      } catch { failed(); return; }
    }
  });
  return () => { closed = true; child.stdin.destroy(); child.kill(); };
}

export function powerStateExpression(suspended) {
  return `(() => {
    window.__CODEX_DREAM_SKIN_POWER_SUSPENDED__ = ${Boolean(suspended)};
    window.dispatchEvent(new Event("dreamskin-power-change"));
  })()`;
}
