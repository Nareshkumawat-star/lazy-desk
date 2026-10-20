export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  const digits = index === 0 ? 0 : decimals;
  return `${value.toFixed(digits).replace(/\.0+$/, "")} ${units[index]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  for (const [unit, divisor] of ranges) {
    if (Math.abs(seconds) >= divisor) {
      return formatter.format(-Math.round(seconds / divisor), unit);
    }
  }
  return "just now";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function shortenPath(path: string, max = 64): string {
  if (path.length <= max) return path;
  const head = path.slice(0, Math.floor(max / 2) - 1);
  const tail = path.slice(-Math.floor(max / 2));
  return `${head}…${tail}`;
}

export function extensionLabel(extension: string): string {
  return extension ? extension.toUpperCase() : "FILE";
}

export function classForCategory(category: string | null | undefined): string {
  switch (category) {
    case "Documents":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
    case "Images":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "Videos":
      return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
    case "Audio":
      return "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400";
    case "Source Code":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "Archives":
      return "bg-orange-500/10 text-orange-600 dark:text-orange-400";
    case "Installers":
      return "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400";
    case "Projects":
      return "bg-violet-500/10 text-violet-600 dark:text-violet-400";
    case "Presentations":
      return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "Spreadsheets":
      return "bg-teal-500/10 text-teal-600 dark:text-teal-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}
