#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

import { findPython, serviceDir } from "./python.mjs";

const result = spawnSync(findPython(), ["-m", "pytest", "-q"], {
  cwd: serviceDir,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
