import { describe, expect, it } from "vitest";

import {
  basename,
  classForCategory,
  extensionLabel,
  formatBytes,
  formatDuration,
  shortenPath,
} from "./utils";

describe("formatBytes", () => {
  it("formats zero and small values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats larger units", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(2.25 * 1024 * 1024 * 1024)).toBe("2.3 GB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-100)).toBe("0 B");
  });
});

describe("path helpers", () => {
  it("reads basenames on Windows and POSIX paths", () => {
    expect(basename("C:\\Users\\demo\\Downloads\\report.pdf")).toBe("report.pdf");
    expect(basename("/home/demo/Notes.md")).toBe("Notes.md");
  });

  it("shortens long paths without losing both ends", () => {
    const long = `C:\\Users\\demo\\${"nested\\".repeat(12)}file.txt`;
    const short = shortenPath(long, 40);
    expect(short.length).toBeLessThanOrEqual(41);
    expect(short).toContain("…");
    expect(short.endsWith("file.txt")).toBe(true);
  });

  it("labels extensions", () => {
    expect(extensionLabel("pdf")).toBe("PDF");
    expect(extensionLabel("")).toBe("FILE");
  });
});

describe("category styling", () => {
  it("returns different classes per category and a fallback", () => {
    expect(classForCategory("Images")).toContain("emerald");
    expect(classForCategory("Source Code")).toContain("amber");
    expect(classForCategory(null)).toContain("muted");
    expect(classForCategory("Unknown category")).toBe(classForCategory(null));
  });
});

describe("formatDuration", () => {
  it("switches units", () => {
    expect(formatDuration(250)).toBe("250 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(65_000)).toBe("1m 5s");
  });
});
