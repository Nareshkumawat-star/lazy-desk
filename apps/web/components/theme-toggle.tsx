"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { applyTheme, type ThemeChoice } from "@/lib/theme";
import { Button } from "./ui";

function appliedDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(appliedDark());
  }, []);

  function toggle() {
    // Read the theme that is actually on screen instead of trusting the last
    // render: before React mounts the state is still the server default, and
    // flipping from that would land on the wrong theme.
    const next: ThemeChoice = appliedDark() ? "light" : "dark";
    setIsDark(next === "dark");
    applyTheme(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
