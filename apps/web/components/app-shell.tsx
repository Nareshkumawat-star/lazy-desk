"use client";

import {
  CalendarClock,
  Copy,
  FolderCog,
  History,
  LayoutDashboard,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "./ui";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/organize", label: "Organize Files", icon: FolderCog },
  { href: "/search", label: "Smart Search", icon: Search },
  { href: "/duplicates", label: "Duplicates", icon: Copy },
  { href: "/automation", label: "Automation", icon: CalendarClock },
  { href: "/history", label: "Activity History", icon: History },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

interface ServiceState {
  online: boolean;
  aiReady: boolean;
  aiLabel: string;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [service, setService] = useState<ServiceState>({
    online: false,
    aiReady: false,
    aiLabel: "Checking service…",
  });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await api.aiStatus();
        if (cancelled) return;
        setService({
          online: true,
          aiReady: status.ready,
          aiLabel: status.ready
            ? `${status.active} · ${status.model}`
            : status.active
              ? "AI needs attention"
              : "Rule-based mode",
        });
      } catch {
        if (!cancelled) {
          setService({ online: false, aiReady: false, aiLabel: "Local service offline" });
        }
      }
    }
    void check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/40 px-3 py-5 lg:flex">
        <Link href="/" className="mx-2 mb-7 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-400 text-primary-foreground shadow-sm">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold leading-tight tracking-tight">LazyDesk</span>
            <span className="text-[11px] text-muted-foreground">Local-first AI organizer</span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main navigation">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn("sidebar-link", isActive(item.href) && "sidebar-link-active")}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 space-y-3 rounded-xl border border-border bg-background/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Local service
            </span>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                service.online ? "bg-success" : "bg-destructive",
              )}
              aria-hidden="true"
            />
          </div>
          <p className="truncate text-xs text-muted-foreground" title={service.aiLabel}>
            {service.aiLabel}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">127.0.0.1 only</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold">LazyDesk</span>
            </Link>
            <ThemeToggle />
          </div>
          <nav
            className="flex gap-1 overflow-x-auto px-3 pb-2"
            aria-label="Main navigation"
          >
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground",
                    isActive(item.href) && "bg-accent text-accent-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <footer className="px-6 pb-5 text-center text-[11px] text-muted-foreground">
          Files stay on this computer. AI receives filenames only when you enable a provider.
        </footer>
      </div>
    </div>
  );
}
