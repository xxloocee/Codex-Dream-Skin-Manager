import type { ThemeParameters } from "../../../contracts/manager.mjs";

export const emptyParameters: ThemeParameters = { appearance: null, focusX: null, focusY: null, positionX: null, positionY: null,
  zoom: null, playbackRate: null, positionMode: null, framingEnabled: null, safeArea: null, taskMode: null, bubbleOpacity: null, surfaceOpacity: null, shellOpacity: null, accent: null };
// Only new imports use these explicit defaults. Existing themes keep their null values.
export const importParameters: ThemeParameters = { ...emptyParameters, appearance: "auto", positionX: 0, positionY: 0,
  zoom: 1, positionMode: "locked", framingEnabled: true, safeArea: "auto", taskMode: "auto", bubbleOpacity: 0, surfaceOpacity: 0.3, accent: "#B65CFF" };
const finite = (value: number | null, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

// UI defaults describe a preview only; they must never be persisted as a patch.
export function previewParameters(stored: ThemeParameters, patch: Partial<ThemeParameters> = {}, systemDark?: boolean): ThemeParameters {
  const value = { ...stored, ...patch };
  const framing = value.framingEnabled ?? [value.positionX, value.positionY, value.zoom, value.positionMode].some(entry => entry !== null);
  const shellDefault = value.appearance === "light" ? 0.64 : value.appearance === "dark" ? 0.58
    : systemDark === undefined ? null : systemDark ? 0.58 : 0.64;
  return {
    appearance: value.appearance ?? "auto", focusX: value.focusX === null ? null : finite(value.focusX, 0.5, 0, 1),
    focusY: value.focusY === null ? null : finite(value.focusY, 0.5, 0, 1),
    positionX: framing ? finite(value.positionX, 0, -1, 1) : 0, positionY: framing ? finite(value.positionY, 0, -1, 1) : 0,
    zoom: framing ? finite(value.zoom, 1, 1, 2) : 1, positionMode: framing ? value.positionMode ?? "locked" : "locked", framingEnabled: framing,
    playbackRate: finite(value.playbackRate, 1, 0.25, 2),
    safeArea: value.safeArea ?? "auto", taskMode: value.taskMode ?? "auto", bubbleOpacity: finite(value.bubbleOpacity, 0, 0, 1),
    surfaceOpacity: finite(value.surfaceOpacity, 0.3, 0, 1), accent: value.accent && /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : null,
    shellOpacity: value.shellOpacity == null ? shellDefault : finite(value.shellOpacity, shellDefault ?? 0.58, 0, 1),
  };
}

export interface PreviewSize { width: number; height: number }
// Port of src/Models.cs PreviewMath: focus crop and locked/free framing.
export function previewLayout(image: PreviewSize, viewport: PreviewSize, params: ThemeParameters) {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const framing = params.framingEnabled === true;
  const scale = Math.max(viewport.width / image.width, viewport.height / image.height) * (framing ? finite(params.zoom, 1, 1, 2) : 1);
  const width = image.width * scale, height = image.height * scale;
  if (!framing) return { width, height, x: (viewport.width - width) * finite(params.focusX, 0.5, 0, 1), y: (viewport.height - height) * finite(params.focusY, 0.5, 0, 1) };
  const free = params.positionMode === "free";
  const rangeX = free ? (width + viewport.width) / 2 : Math.max(0, (width - viewport.width) / 2);
  const rangeY = free ? (height + viewport.height) / 2 : Math.max(0, (height - viewport.height) / 2);
  return { width, height, x: (viewport.width - width) / 2 + finite(params.positionX, 0, -1, 1) * rangeX,
    y: (viewport.height - height) / 2 + finite(params.positionY, 0, -1, 1) * rangeY };
}
