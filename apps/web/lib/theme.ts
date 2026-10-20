export type ThemeChoice = "light" | "dark" | "system";

export function resolveDark(theme: ThemeChoice): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: ThemeChoice, persist = true): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolveDark(theme));
  if (persist) {
    try {
      window.localStorage.setItem("lazydesk.theme", theme);
    } catch {
      // Storage can be unavailable in hardened browsers; theme still applies.
    }
  }
}

export function currentStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem("lazydesk.theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}
