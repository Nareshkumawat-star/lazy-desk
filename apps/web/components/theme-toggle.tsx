"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { applyTheme, currentStoredTheme, resolveDark, type ThemeChoice } from "@/lib/theme";
import { Button } from "./ui";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(currentStoredTheme());
    setMounted(true);
  }, []);

  const isDark = mounted ? resolveDark(theme) : true;

  function toggle() {
    const next: ThemeChoice = isDark ? "light" : "dark";
    setTheme(next);
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
