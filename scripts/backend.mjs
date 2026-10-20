#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

import { findPython, serviceDir } from "./python.mjs";

const child = spawn(findPython(), ["-m", "organizer"], {
  cwd: serviceDir,
  stdio: "inherit",
  env: process.env,
});

process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
