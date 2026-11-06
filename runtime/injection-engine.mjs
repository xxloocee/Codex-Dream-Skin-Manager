// Selector access stays lazy: Windows initializes its contract on CLI entry,
// while Mac loads it when importing the platform injector.
export function createInjectionEngine({
  selectorLiteral, stableTestidLiteral,
  tolerateProbeErrors = false,
}) {
  async function probeSession(session) {
    return session.evaluate(`(() => {
      const initialRoute = new URLSearchParams(String(location.search || ''))
        .get('initialRoute') || '';
      const pathname = String(location.pathname || '');
      const excludedPetSurface = location.protocol === 'app:' && (
        pathname.endsWith('/avatar-overlay-composition-surface.html') ||
        initialRoute === '/avatar-overlay' || initialRoute.startsWith('/avatar-overlay/')
      );
      const genericCodexSurface = () => {
        if (location.protocol !== 'app:') return false;
        const main = document.querySelector('main, [role="main"]');
        const input = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        const branded = Boolean(document.querySelector(
          ${stableTestidLiteral("app-shell-header-context-menu-surface")},
        ));
        return Boolean(main && input && branded);
      };
      const markers = {
        shell: Boolean(document.querySelector(${selectorLiteral("shell-main")})),
        sidebar: Boolean(document.querySelector(${selectorLiteral("left-panel")})),
        composer: Boolean(document.querySelector(${selectorLiteral("composer-chrome")})),
        main: Boolean(document.querySelector(${selectorLiteral("home-route")})),
        generic: genericCodexSurface(),
      };
      const settings = Boolean(document.querySelector(${selectorLiteral("settings-panel")})) ||
        Boolean(document.querySelector(${selectorLiteral("appearance-radio")})) ||
        Boolean(document.querySelector(${stableTestidLiteral("theme-preview")}));
      return {
        markers, excludedPetSurface,
        codex: !excludedPetSurface && location.protocol === 'app:' &&
          ((markers.shell && markers.sidebar) || settings || markers.main || markers.generic),
      };
    })()`);
  }

  async function waitForCodexProbe(session, timeoutMs = 1800) {
    const deadline = Date.now() + timeoutMs;
    let probe = null;
    while (Date.now() < deadline) {
      try {
        probe = await probeSession(session);
        if (probe?.codex) return probe;
      } catch (error) {
        if (!tolerateProbeErrors) throw error;
        // Windows permits document replacement while the early payload waits.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return probe;
  }

  function earlyPayloadFor(payload, revision) {
    if (payload.includes("dreamskin-file:video/mp4")) return "void 0;";
    return `(() => {
      const generationKey = "__CODEX_DREAM_SKIN_EARLY_GENERATION__";
      const appliedKey = "__CODEX_DREAM_SKIN_EARLY_APPLIED__";
      const bootstrapKey = "__CODEX_DREAM_SKIN_EARLY_BOOTSTRAP__";
      const generation = ${JSON.stringify(revision)};
      window[bootstrapKey]?.();
      window[generationKey] = generation;
      let bootstrapTimer = null;
      let timeout = null;
      const stop = () => {
        if (bootstrapTimer) clearInterval(bootstrapTimer);
        bootstrapTimer = null;
        if (timeout) clearTimeout(timeout);
        timeout = null;
        document.removeEventListener?.("DOMContentLoaded", install);
        if (window[bootstrapKey] === stop) delete window[bootstrapKey];
      };
      const hasCodexSurface = () => {
        if (location.protocol !== "app:") return false;
        const shell = document.querySelector(${selectorLiteral("shell-main")});
        const sidebar = document.querySelector(${selectorLiteral("left-panel")});
        const main = document.querySelector(${selectorLiteral("home-route")});
        const settings = document.querySelector(${selectorLiteral("settings-panel")}) ||
          document.querySelector(${selectorLiteral("appearance-radio")}) ||
          document.querySelector(${stableTestidLiteral("theme-preview")});
        const genericMain = document.querySelector('main, [role="main"]');
        const genericInput = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        const branded = Boolean(document.querySelector(
          ${stableTestidLiteral("app-shell-header-context-menu-surface")},
        ));
        return Boolean((shell && sidebar) || settings || main ||
          (genericMain && genericInput && branded));
      };
      const install = () => {
        if (window[generationKey] !== generation) { stop(); return true; }
        // The renderer can install before body exists, avoiding a bare frame.
        if (!document.documentElement || !hasCodexSurface()) return false;
        stop();
        ${payload};
        window[appliedKey] = generation;
        return true;
      };
      window[bootstrapKey] = stop;
      if (install()) return;
      document.addEventListener?.("DOMContentLoaded", install, { once: true });
      bootstrapTimer = setInterval(install, 250);
      timeout = setTimeout(stop, 10000);
    })()`;
  }

  return { probeSession, waitForCodexProbe, earlyPayloadFor };
}

// Platforms supply identity-aware listing, transport budgets, and Pet cleanup.
export async function discoverCodexTargets({
  port, timeoutMs, listTargets, connectTarget, probeSession, cleanupExcludedSurface,
  isFatalError = () => false, productName = "Codex",
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const targets = await listTargets();
      const connected = [];
      try {
        for (const target of targets) {
          let session;
          try {
            session = await connectTarget(target, port);
            const probe = await probeSession(session);
            if (probe?.codex) connected.push({ target, session, probe });
            else {
              if (probe?.excludedPetSurface && !await cleanupExcludedSurface(session)) {
                throw new Error("Excluded Pet surface cleanup did not verify");
              }
              session.close();
            }
          } catch (error) {
            session?.close();
            if (isFatalError(error)) throw error;
            lastError = error;
          }
        }
      } catch (error) {
        for (const { session } of connected) session.close();
        throw error;
      }
      if (connected.length) return connected;
      lastError = new Error(`No page matched the expected ${productName} shell markers`);
    } catch (error) {
      if (isFatalError(error)) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`No verified ${productName} renderer on 127.0.0.1:${port}: ${lastError?.message ?? "timed out"}`);
}
