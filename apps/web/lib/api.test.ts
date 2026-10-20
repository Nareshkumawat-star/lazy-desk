import { afterEach, describe, expect, it, vi } from "vitest";

import { getToken } from "./api";

interface FakeWindowOptions {
  search?: string;
  stored?: string | null;
  bridge?: { token: string };
}

function stubWindow(options: FakeWindowOptions = {}) {
  const store = new Map<string, string>();
  if (options.stored) store.set("lazydesk.token", options.stored);
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
    location: { search: options.search ?? "" },
  };
  if (options.bridge) win.lazydesk = options.bridge;
  vi.stubGlobal("window", win);
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getToken", () => {
  it("uses the token from the URL and remembers it for the next visit", () => {
    const store = stubWindow({ search: "?token=from-url" });
    expect(getToken()).toBe("from-url");
    expect(store.get("lazydesk.token")).toBe("from-url");
  });

  it("lets an explicit URL token replace a stale stored one", () => {
    // A hosted site that is re-authenticated with a new token must not keep
    // sending the old one from localStorage.
    const store = stubWindow({ search: "?token=fresh", stored: "stale" });
    expect(getToken()).toBe("fresh");
    expect(store.get("lazydesk.token")).toBe("fresh");
  });

  it("falls back to the stored token when the URL carries none", () => {
    stubWindow({ search: "", stored: "stored-token" });
    expect(getToken()).toBe("stored-token");
  });

  it("falls back to the build-time token when nothing is stored", () => {
    vi.stubEnv("NEXT_PUBLIC_LAZYDESK_TOKEN", "baked-token");
    stubWindow({ search: "" });
    expect(getToken()).toBe("baked-token");
  });

  it("prefers the desktop bridge over every other source", () => {
    vi.stubEnv("NEXT_PUBLIC_LAZYDESK_TOKEN", "baked-token");
    stubWindow({ search: "?token=from-url", stored: "stored-token", bridge: { token: "bridge-token" } });
    expect(getToken()).toBe("bridge-token");
  });
});
