const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const API_BASE = "http://127.0.0.1:8765";
const DEV_URL = process.env.LAZYDESK_DEV_URL || "";
const REUSE_BACKEND = process.env.LAZYDESK_REUSE_BACKEND === "1";

let mainWindow = null;
let backendProcess = null;
let backendToken = process.env.LAZYDESK_SERVICE_TOKEN || crypto.randomBytes(32).toString("base64url");
let quitting = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "lazydesk",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function candidatePython() {
  const serviceDir = path.resolve(__dirname, "..", "..", "services", "organizer");
  const candidates = [
    process.env.LAZYDESK_PYTHON,
    path.join(serviceDir, ".venv", "Scripts", "python.exe"),
    path.join(serviceDir, ".venv", "bin", "python"),
    path.join(process.resourcesPath, "python", "python.exe"),
    path.join(process.resourcesPath, "python", "bin", "python3"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function backendLayout() {
  if (app.isPackaged) {
    return {
      cwd: process.resourcesPath,
      moduleRoot: process.resourcesPath,
      webRoot: path.join(process.resourcesPath, "out"),
    };
  }
  return {
    cwd: path.resolve(__dirname, "..", "..", "services", "organizer"),
    moduleRoot: path.resolve(__dirname, "..", "..", "services", "organizer"),
    webRoot: path.resolve(__dirname, "..", "web", "out"),
  };
}

async function healthy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureBackend() {
  if (await healthy()) {
    if (REUSE_BACKEND && process.env.LAZYDESK_SERVICE_TOKEN) {
      backendToken = process.env.LAZYDESK_SERVICE_TOKEN;
      return true;
    }
    if (REUSE_BACKEND) return true;
    // A stale service is running with a token we do not know.
    throw new Error(
      "Another LazyDesk service is already running on port 8765. Close it and start LazyDesk again.",
    );
  }

  const layout = backendLayout();
  const python = candidatePython();
  const dataDir = app.getPath("userData");

  backendProcess = spawn(python, ["-m", "organizer"], {
    cwd: layout.cwd,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONPATH: layout.moduleRoot,
      LAZYDESK_SERVICE_TOKEN: backendToken,
      LAZYDESK_DATA_DIR: dataDir,
      LAZYDESK_PORT: "8765",
    },
  });

  let stderr = "";
  backendProcess.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });
  backendProcess.stdout?.on("data", (chunk) => {
    if (!app.isPackaged) process.stdout.write(chunk);
  });
  backendProcess.on("error", (error) => {
    stderr += `\n${error.message}`;
  });

  const started = Date.now();
  while (Date.now() - started < 40_000) {
    if (await healthy()) return true;
    if (backendProcess.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `The local Python service did not start. LazyDesk needs Python 3.12+ and the backend dependencies.\n\n` +
      `Run the setup from the project folder:\n` +
      `  cd services/organizer\n` +
      `  python -m venv .venv\n` +
      `  .venv/Scripts/python.exe -m pip install -r requirements.txt\n\n` +
      (stderr ? `Backend output:\n${stderr}` : ""),
  );
}

function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;
  const pid = backendProcess.pid;
  backendProcess = null;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/f", "/t"], { windowsHide: true });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function registerStaticProtocol() {
  const { webRoot } = backendLayout();
  await protocol.handle("lazydesk", async (request) => {
    try {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname || pathname === "/") pathname = "/index.html";
      if (pathname.endsWith("/")) pathname += "index.html";
      if (!path.extname(pathname)) pathname = path.join(pathname, "index.html");
      const target = path.resolve(webRoot, `.${pathname}`);
      const relative = path.relative(webRoot, target);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return new Response("Not found", { status: 404 });
      }
      const data = await fs.readFile(target);
      const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
      return new Response(data, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#0d0d11",
    title: "LazyDesk",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      additionalArguments: [
        `--lazydesk-token=${backendToken}`,
        `--lazydesk-api=${API_BASE}`,
      ],
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("lazydesk://") || (DEV_URL && url.startsWith(DEV_URL));
    if (!allowed) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadURL("lazydesk://app/index.html");
  }
}

ipcMain.handle("lazydesk:select-folder", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose a folder for LazyDesk",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this folder",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("lazydesk:open-external", async (_event, url) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  stopBackend();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  try {
    await registerStaticProtocol();
    await ensureBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("LazyDesk could not start", error.message || String(error));
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  if (!quitting) console.error(error);
});
