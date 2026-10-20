#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

import { findPython, serviceDir } from "./python.mjs";

const result = spawnSync(findPython(), ["-m", "ruff", "check", "."], {
  cwd: serviceDir,
  stdio: "inherit",
  env: process.env,
});

if (result.error || result.status === null) {
  console.error(
    "\nRuff is not available in this environment. Install the development dependencies:\n\n" +
      "  cd services/organizer\n" +
      '  .venv/Scripts/python.exe -m pip install -e ".[dev]"   (Windows)\n' +
      '  .venv/bin/python -m pip install -e ".[dev]"           (macOS/Linux)\n',
  );
  process.exit(1);
}

process.exit(result.status);
