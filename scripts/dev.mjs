#!/usr/bin/env node
/* Start the Python service and Next.js with a shared loopback token.
 * Usage: npm run dev            → browser preview at http://localhost:3000
 *        npm run dev:desktop    → same, inside the Electron shell
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { findPython, repoRoot, serviceDir, venvExists } from "./python.mjs";

const desktop = process.argv.includes("--desktop");
if (!venvExists()) {
  console.error(
    "\nLazyDesk's Python environment is missing. Run this first:\n\n" +
      "  cd services/organizer\n" +
      "  python -m venv .venv\n" +
      "  .venv/Scripts/python.exe -m pip install -r requirements.txt   (Windows)\n" +
      "  .venv/bin/python -m pip install -r requirements.txt            (macOS/Linux)\n",
  );
  process.exit(1);
}

const token = randomBytes(32).toString("base64url");
const python = findPython();
const children = [];
let shuttingDown = false;

function launch(label, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`[${label}] exited with code ${code}`);
    }
  });
  children.push({ label, child });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const backend = launch("backend", python, ["-m", "organizer"], {
  cwd: serviceDir,
  env: { LAZYDESK_SERVICE_TOKEN: token, LAZYDESK_LOG_LEVEL: "info" },
});

async function waitForHealth(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch("http://127.0.0.1:8765/api/health");
      if (response.ok) return true;
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

const healthy = await waitForHealth();
if (!healthy) {
  console.error("Backend did not become healthy on http://127.0.0.1:8765");
  shutdown(1);
} else {
  console.log("Backend ready at http://127.0.0.1:8765");
}

const webArgs = ["--workspace", "@lazydesk/web", "run", "dev"];
const npmCli = process.env.npm_execpath;
const web = npmCli
  ? launch("web", process.execPath, [npmCli, ...webArgs], {
      cwd: repoRoot,
      env: { NEXT_PUBLIC_LAZYDESK_TOKEN: token },
    })
  : launch("web", process.platform === "win32" ? "npm.cmd" : "npm", webArgs, {
      cwd: repoRoot,
      shell: process.platform === "win32",
      env: { NEXT_PUBLIC_LAZYDESK_TOKEN: token },
    });

if (desktop) {
  // Give Next.js a moment to boot; Electron will keep retrying the URL anyway.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const electronBinary =
    process.platform === "win32"
      ? join(repoRoot, "node_modules", "electron", "dist", "electron.exe")
      : process.platform === "darwin"
        ? join(repoRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
        : join(repoRoot, "node_modules", "electron", "dist", "electron");
  const desktopEnv = {
    LAZYDESK_SERVICE_TOKEN: token,
    LAZYDESK_DEV_URL: "http://localhost:3000",
    LAZYDESK_PYTHON: python,
    LAZYDESK_REUSE_BACKEND: "1",
  };
  if (existsSync(electronBinary)) {
    launch("desktop", electronBinary, [join("apps", "desktop")], {
      cwd: repoRoot,
      env: desktopEnv,
    });
  } else {
    launch("desktop", process.platform === "win32" ? "npx.cmd" : "npx", ["electron", join("apps", "desktop")], {
      cwd: repoRoot,
      shell: process.platform === "win32",
      env: desktopEnv,
    });
  }
} else {
  console.log("\nOpen http://localhost:3000 in your browser (dev token already injected).\n");
}

web.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 0);
});
backend.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 0);
});
