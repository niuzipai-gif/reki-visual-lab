import { useCallback, useMemo, useState } from "react";

const DESKTOP_STORAGE_KEY = "reki.desktop-panel-width";
const SHEET_STORAGE_KEY = "reki.mobile-sheet-height";
const DESKTOP_MIN = 240;
const DESKTOP_MAX = 520;
const SHEET_MIN = 38;
const SHEET_MAX = 82;
const DEFAULT_DESKTOP_WIDTH = 320;
const DEFAULT_SHEET_HEIGHT = 62;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readPersisted(key, fallback, min, max) {
  try {
    const stored = globalThis.localStorage?.getItem(key);
    if (stored === null || stored === undefined) return fallback;
    const value = Number(stored);
    return Number.isFinite(value) ? clamp(value, min, max) : fallback;
  } catch {
    return fallback;
  }
}

function persist(key, value) {
  try {
    globalThis.localStorage?.setItem(key, String(value));
  } catch {
    // Layout preferences are optional when storage is unavailable.
  }
}

export function useResizablePanels() {
  const [desktopWidth, setDesktopWidthState] = useState(() =>
    readPersisted(DESKTOP_STORAGE_KEY, DEFAULT_DESKTOP_WIDTH, DESKTOP_MIN, DESKTOP_MAX),
  );
  const [sheetHeight, setSheetHeightState] = useState(() =>
    readPersisted(SHEET_STORAGE_KEY, DEFAULT_SHEET_HEIGHT, SHEET_MIN, SHEET_MAX),
  );

  const setDesktopWidth = useCallback((next) => {
    setDesktopWidthState((current) => {
      const value = clamp(Math.round(typeof next === "function" ? next(current) : next), DESKTOP_MIN, DESKTOP_MAX);
      persist(DESKTOP_STORAGE_KEY, value);
      return value;
    });
  }, []);
  const setSheetHeight = useCallback((next) => {
    setSheetHeightState((current) => {
      const value = clamp(Math.round(typeof next === "function" ? next(current) : next), SHEET_MIN, SHEET_MAX);
      persist(SHEET_STORAGE_KEY, value);
      return value;
    });
  }, []);

  const beginDesktopResize = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = desktopWidth;
    const move = (moveEvent) => setDesktopWidth(startWidth - (moveEvent.clientX - startX));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }, [desktopWidth, setDesktopWidth]);

  const beginSheetResize = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = sheetHeight;
    const viewportHeight = Math.max(window.innerHeight, 1);
    const move = (moveEvent) => setSheetHeight(startHeight + ((startY - moveEvent.clientY) / viewportHeight) * 100);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }, [setSheetHeight, sheetHeight]);

  const desktopSeparatorProps = useMemo(() => ({
    role: "separator",
    tabIndex: 0,
    "aria-label": "调整右侧工作区宽度",
    "aria-orientation": "vertical",
    "aria-valuemin": DESKTOP_MIN,
    "aria-valuemax": DESKTOP_MAX,
    "aria-valuenow": desktopWidth,
    onPointerDown: beginDesktopResize,
    onKeyDown: (event) => {
      if (event.key === "ArrowLeft") setDesktopWidth((value) => value - 16);
      if (event.key === "ArrowRight") setDesktopWidth((value) => value + 16);
      if (event.key === "Home") setDesktopWidth(DESKTOP_MIN);
      if (event.key === "End") setDesktopWidth(DESKTOP_MAX);
    },
  }), [beginDesktopResize, desktopWidth, setDesktopWidth]);

  const sheetSeparatorProps = useMemo(() => ({
    role: "separator",
    tabIndex: 0,
    "aria-label": "调整移动端面板高度",
    "aria-orientation": "horizontal",
    "aria-valuemin": SHEET_MIN,
    "aria-valuemax": SHEET_MAX,
    "aria-valuenow": sheetHeight,
    onPointerDown: beginSheetResize,
    onKeyDown: (event) => {
      if (event.key === "ArrowUp") setSheetHeight((value) => value + 4);
      if (event.key === "ArrowDown") setSheetHeight((value) => value - 4);
      if (event.key === "Home") setSheetHeight(SHEET_MIN);
      if (event.key === "End") setSheetHeight(SHEET_MAX);
    },
  }), [beginSheetResize, setSheetHeight, sheetHeight]);

  return {
    desktopWidth,
    sheetHeight,
    setDesktopWidth,
    setSheetHeight,
    desktopSeparatorProps,
    sheetSeparatorProps,
  };
}

export const RESIZABLE_PANEL_LIMITS = {
  desktop: { min: DESKTOP_MIN, max: DESKTOP_MAX },
  sheet: { min: SHEET_MIN, max: SHEET_MAX },
};
