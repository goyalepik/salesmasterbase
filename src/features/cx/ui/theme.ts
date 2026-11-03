"use client";

import { useCallback, useSyncExternalStore } from "react";

// Light, dark, or follow the device. A per-viewer convenience, so it may live in localStorage.

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "epik-cx-theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  // The server renders "system", which the CSS resolves from the device, so there is no flash.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as ThemeChoice);
  const set = useCallback((next: ThemeChoice) => {
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Blocked storage: the choice lasts until the tab closes.
    }
    listeners.forEach((fn) => fn());
  }, []);
  return [theme, set];
}

function subscribeMedia(fn: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

/** True when the screen is dark right now (chosen, or the device's setting under "System"). */
export function useIsDark(): boolean {
  const [theme] = useTheme();
  const deviceDark = useSyncExternalStore(subscribeMedia, () => window.matchMedia("(prefers-color-scheme: dark)").matches, () => false);
  return theme === "dark" || (theme === "system" && deviceDark);
}
