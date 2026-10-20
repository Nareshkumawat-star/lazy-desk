import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const serviceDir = join(repoRoot, "services", "organizer");

export function findPython() {
  const candidates = [
    process.env.LAZYDESK_PYTHON,
    join(serviceDir, ".venv", "Scripts", "python.exe"),
    join(serviceDir, ".venv", "bin", "python"),
    process.platform === "win32" ? "python" : "python3",
    "python",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  return "python";
}

export function venvExists() {
  return (
    existsSync(join(serviceDir, ".venv", "Scripts", "python.exe")) ||
    existsSync(join(serviceDir, ".venv", "bin", "python"))
  );
}
