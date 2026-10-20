#!/usr/bin/env node
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { repoRoot } from "./python.mjs";

let removed = 0;

function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = join(path, entry.name);
    if (entry.name === "__pycache__") {
      rmSync(target, { recursive: true, force: true });
      removed += 1;
      continue;
    }
    if (entry.name === ".venv" || entry.name === "node_modules" || entry.name === ".git") continue;
    walk(target);
  }
}

walk(join(repoRoot, "services", "organizer", "organizer"));
console.log(`Removed ${removed} __pycache__ folder(s).`);
process.exit(0);
