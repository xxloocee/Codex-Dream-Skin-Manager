const MIN_RENDERER_WIDTH = 320, MIN_RENDERER_HEIGHT = 240, MAX_RENDERER_DIMENSION = 65536;
function hasReasonableDimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width >= MIN_RENDERER_WIDTH && height >= MIN_RENDERER_HEIGHT && width <= MAX_RENDERER_DIMENSION && height <= MAX_RENDERER_DIMENSION;
}
export function assessRendererVerification(renderer, nativeWindow, expected) {
  const result = renderer && typeof renderer === "object" ? { ...renderer } : {};
  const viewportWidth = Number(result.viewport?.width);
  const viewportHeight = Number(result.viewport?.height);
  const viewportPass = hasReasonableDimensions(viewportWidth, viewportHeight);
  const documentVisible = result.documentVisibility === "visible" && !result.documentHidden;
  const settingsRoute = result.scope?.baseState === "settings";
  // Scope can still describe a mounted, inactive home tab. Use visible DOM evidence.
  const homeRoute = result.homeRoute || result.homePresent;
  const l1ScopePass = result.scope?.level === "L1" &&
    Array.isArray(result.scope?.missingL1) && result.scope.missingL1.length === 0;
  const genericStructurePass = l1ScopePass && Boolean(result.genericMain?.visible) &&
    (Boolean(result.genericInput?.visible) || Boolean(homeRoute && result.homePresent));
  const l0StructurePass = result.scope?.level === "L0" &&
    settingsRoute && Boolean(result.settings?.visible);
  const structurePass = l0StructurePass || (l1ScopePass && (
    (Boolean(result.shell?.visible) && Boolean(result.sidebar?.visible)) || genericStructurePass
  ));
  const nativeWindowPass = (nativeWindow?.status === "ready" || nativeWindow?.pass === true);
  const fallbackWindowPass = (nativeWindow?.status === "unsupported" || nativeWindow?.unsupported === true);
  const windowPass = documentVisible && viewportPass
    && (nativeWindowPass || fallbackWindowPass);
  const basePass = result.installed && result.version === expected.skinVersion
    && result.stylePresent && result.businessClassPollution === 0
    && result.opacityUpdateFailed !== true
    && structurePass && windowPass && !result.documentOverflow?.x;
  const payloadPass = (!expected.expectedThemeId || result.themeId === expected.expectedThemeId)
    && (!expected.expectedRevision || result.revision === expected.expectedRevision);
  const visibleSuggestionLabels = Array.isArray(result.suggestionLabels)
    ? result.suggestionLabels.filter((item) => item?.visible) : [];
  const homeFallbackVisible = Boolean(homeRoute && result.homePresent && result.genericMain?.visible);
  const homePass = !homeRoute || (
    result.homePresent && ((result.hero?.visible && result.hero.width >= 280
      && result.hero.height >= 120) || homeFallbackVisible)
    && (result.visibleCardCount === 0 || (
      visibleSuggestionLabels.length >= result.visibleCardCount
      && result.suggestionLabelColorsMatch
    ))
  );

  result.nativeWindow = nativeWindow;
  result.checks = {
    documentVisible,
    fallbackWindowPass,
    nativeWindowPass,
    payloadPass,
    structurePass,
    viewportPass,
    windowPass,
  };
  result.readiness = { windowPass, documentPass: documentVisible, viewportPass, structurePass, nativeWindowPass, fallbackWindowPass };
  result.expectedVersion = expected.skinVersion;
  result.pass = Boolean(basePass && homePass && payloadPass);
  result.expectedThemeId = expected.expectedThemeId;
  result.expectedRevision = expected.expectedRevision;
  result.softNotes = {
    projectButtonOptional: !result.projectButton?.visible,
    composerOptionalOnNonTaskRoutes: !result.composer?.visible,
    suggestionCardsOptional: homeRoute && result.visibleCardCount === 0,
  };
  return result;
}


export function createRendererVerifier(selectorLiteral, stableTestidLiteral, SKIN_VERSION) {
async function verifyRenderer(session, nativeWindow, expectedThemeId = null, expectedRevision = null) {
  const renderer = await session.evaluate(`(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const opacity = Number.parseFloat(style.opacity);
      const right = Number.isFinite(r.right) ? r.right : r.x + r.width;
      const bottom = Number.isFinite(r.bottom) ? r.bottom : r.y + r.height;
      let cssVisible = r.width > 0 && r.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
        style.contentVisibility !== 'hidden' && (!Number.isFinite(opacity) || opacity > 0);
      try {
        if (typeof node.checkVisibility === 'function') {
          cssVisible = cssVisible && node.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          });
        }
      } catch {}
      const intersectsViewport = right > 0 && bottom > 0 && r.x < innerWidth && r.y < innerHeight;
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
        visible: Boolean(node.isConnected !== false && cssVisible && intersectsViewport),
      };
    };
    // Inactive tabs remain mounted in recent Codex releases.
    const visibleQuery = (selector) => [...document.querySelectorAll(selector)]
      .find((node) => box(node)?.visible) ?? null;
    const homeIndicator = visibleQuery(${selectorLiteral("home-icon")});
    const homeSignal = homeIndicator ?? visibleQuery(${selectorLiteral("game-source")}) ??
      visibleQuery(${selectorLiteral("home-suggestions")});
    const homeRoute = homeSignal?.closest('[role="main"]') ?? null;
    // Codex 26.721.x can render the home content before home-icon. Reuse the
    // already-resolved semantic home container so a healthy home session is
    // not rejected solely because the stricter home-icon selector is late.
    const home = visibleQuery(${selectorLiteral("home-route")}) ?? homeRoute;
    const suggestions = home?.querySelector(${selectorLiteral("home-suggestions")}) ?? null;
    const cardButtons = suggestions ? [...suggestions.querySelectorAll('button')] : [];
    const cardBoxes = cardButtons.map(box);
    const visibleCards = cardBoxes.filter((item) => item?.visible);
    const suggestionLabels = cardButtons.flatMap((button) => {
      const expectedColor = getComputedStyle(button).color;
      return [...button.querySelectorAll('*')]
        .filter((node) => [...node.childNodes].some((child) =>
          child.nodeType === 3 && child.textContent.trim()))
        .map((node) => ({
          ...box(node),
          text: node.textContent.trim().slice(0, 80),
          color: getComputedStyle(node).color,
          expectedColor,
        }));
    });
    const visibleSuggestionLabels = suggestionLabels.filter((item) => item?.visible);
    const suggestionLabelColorsMatch = visibleSuggestionLabels.every((item) =>
      item.color === item.expectedColor);
    // Codex 26.721+ moved the real home content out of home.firstElementChild's
    // descendant chain: that wrapper now only holds the (usually empty) native
    // .home-banners slot, and the actual content became its sibling instead
    // (see #244). Prefer a sibling of the banner-holding wrapper when present;
    // fall back to the pre-26.721 first-child chain (deepest visible node)
    // otherwise, so older Codex builds keep working unchanged.
    const homeChildren = home?.children ? Array.from(home.children) : [];
    const bannerHolder = homeChildren.find((el) => el.querySelector(${selectorLiteral("home-banners")}));
    const siblingCandidates = homeChildren.filter((el) => el !== bannerHolder).map(box);
    const heroChain = [];
    for (let node = home?.firstElementChild ?? null; node && heroChain.length < 3;
      node = node.firstElementChild) heroChain.push(node);
    const boxableChain = heroChain.filter((node) => typeof node?.getBoundingClientRect === "function");
    const chainCandidates = boxableChain.map(box);
    const hero = siblingCandidates.find((item) => item?.visible && item.width >= 280 && item.height >= 120)
      ?? chainCandidates.findLast((item) => item?.visible)
      ?? siblingCandidates.find((item) => item?.visible)
      ?? box(boxableChain[boxableChain.length - 1]);
    const projectButton = box(home?.querySelector(${selectorLiteral("project-selector")} + " > button"));
    const shell = box(visibleQuery(${selectorLiteral("shell-main")}));
    const composer = box(visibleQuery(${selectorLiteral("composer-chrome")}));
    const sidebar = box(visibleQuery(${selectorLiteral("left-panel")}));
    const genericMain = box(visibleQuery('[data-ds-part="main"], [data-ds-part="home"]'));
    const genericInput = box(visibleQuery('[data-ds-part="composer"]'));
    const settingsBoxes = [
      box(visibleQuery(${selectorLiteral("settings-panel")})),
      box(visibleQuery(${selectorLiteral("appearance-radio")})),
      box(visibleQuery(${stableTestidLiteral("theme-preview")})),
    ];
    const settings = settingsBoxes.find((item) => item?.visible) ??
      settingsBoxes.find(Boolean) ?? null;
    const runtime = window.__CODEX_DREAM_SKIN_STATE__;
    const adopted = runtime?.styleMode === 'adopted' &&
      [...document.adoptedStyleSheets].includes(runtime.styleSheet);
    const fallback = runtime?.styleMode === 'style' &&
      document.getElementById('codex-dream-skin-style') === runtime.styleNode;
    const result = {
      installed: document.documentElement.getAttribute('data-dream-skin') === 'active',
      documentVisibility: document.visibilityState,
      documentHidden: document.hidden === true,
      homeSurface: box(home),
      suggestionsPresent: Boolean(suggestions),
      version: runtime?.version ?? null,
      themeId: runtime?.themeId ?? null,
      revision: runtime?.revision ?? null,
      opacityUpdateFailed: runtime?.opacityUpdateFailed === true,
      styleMode: runtime?.styleMode ?? null,
      stylePresent: Boolean(adopted || fallback),
      scope: runtime?.scope ?? null,
      businessClassPollution: [...document.querySelectorAll('[class]')].filter((node) =>
        [...node.classList].some((name) => /^(?:dream-|codex-dream-skin(?:-|$))/.test(name))
      ).length,
      homeRoute: Boolean(homeRoute),
      homePresent: Boolean(home),
      hero,
      cards: cardBoxes,
      visibleCardCount: visibleCards.length,
      suggestionLabels,
      suggestionLabelColorsMatch,
      projectButton,
      shell,
      composer,
      sidebar,
      genericMain,
      genericInput,
      settings,
      viewport: { width: innerWidth, height: innerHeight },
      documentOverflow: {
        x: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
    return result;
  })()`);
  return assessRendererVerification(renderer, nativeWindow, {
    skinVersion: SKIN_VERSION,
    expectedThemeId,
    expectedRevision,
  });
}

  return verifyRenderer;
}
