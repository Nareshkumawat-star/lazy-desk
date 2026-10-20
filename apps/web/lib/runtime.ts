export interface LazyDeskBridge {
  token: string;
  apiBase: string;
  platform: string;
  selectFolder: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    lazydesk?: LazyDeskBridge;
  }
}

export function getBridge(): LazyDeskBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.lazydesk;
}

export function hasNativeBridge(): boolean {
  return Boolean(getBridge());
}
