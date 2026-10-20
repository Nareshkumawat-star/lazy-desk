"use client";

import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Cpu,
  Files,
  FolderCog,
  FolderSearch,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/session-badge";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import { formatBytes, formatRelative, shortenPath } from "@/lib/utils";

const FREE_AI_PROVIDER = "pollinations";

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.dashboard());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function enableFreeAi() {
    setEnabling(true);
    setNotice(null);
    try {
      await api.updateSettings({
        provider: FREE_AI_PROVIDER,
        cloud_consent: true,
        ai_enabled: true,
      });
      setNotice("Free AI is on. LazyDesk will send filenames (never contents) to Pollinations.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEnabling(false);
    }
  }

  const stats = data
    ? [
        {
          label: "Files indexed",
          value: data.files_indexed.toLocaleString(),
          hint: `${formatBytes(data.total_bytes)} of metadata`,
          icon: Files,
        },
        {
          label: "Organization sessions",
          value: data.sessions.toLocaleString(),
          hint: "Scans and plans you created",
          icon: FolderSearch,
        },
        {
          label: "Moves awaiting review",
          value: data.pending_moves.toLocaleString(),
          hint: "Only approved files move",
          icon: ListChecks,
        },
        {
          label: "Duplicate groups",
          value: data.duplicate_groups.toLocaleString(),
          hint: `${formatBytes(data.duplicate_bytes)} potential — not reclaimed`,
          icon: Copy,
        },
      ]
    : [];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Dashboard"
        description="Review what LazyDesk has indexed, what is waiting for approval, and the safest next step."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
            <Link
              href="/organize"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <FolderCog className="h-4 w-4" />
              Organize a folder
            </Link>
          </>
        }
      />

      {error ? (
        <Alert variant="destructive" title="Could not load the dashboard">
          {error}
        </Alert>
      ) : null}

      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {loading && !data ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-24">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : null}

      {data ? (
        <>
          {!data.ai.ready ? (
            <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/[0.07] via-card to-card">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">
                    <Sparkles className="h-3 w-3" /> AI is optional
                  </Badge>
                  <Badge variant="outline">No Ollama required</Badge>
                </div>
                <CardTitle className="pt-1 text-lg">Turn on free AI suggestions in one click</CardTitle>
                <CardDescription className="max-w-3xl">
                  Rule-based organization already works offline. If you want the AI to interpret ambiguous
                  filenames, enable the free Pollinations model — no signup, no API key. Only filenames and
                  extensions are sent, never file contents or full paths. You can switch to Gemini,
                  OpenRouter, Groq, Hugging Face or local Ollama at any time.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void enableFreeAi()} loading={enabling}>
                  <Sparkles className="h-4 w-4" />
                  Enable free cloud AI
                </Button>
                <Link
                  href="/settings"
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-input px-4 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Choose another provider
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <span className="text-xs text-muted-foreground">
                  Or keep rule-based mode — it never leaves your machine.
                </span>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-success/25 bg-success/[0.04]">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
                  <div>
                    <p className="text-sm font-semibold">AI suggestions are ready</p>
                    <p className="text-sm text-muted-foreground">
                      {data.ai.active} · {data.ai.model} — {data.ai.message}
                    </p>
                  </div>
                </div>
                <Link
                  href="/settings"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Model settings
                </Link>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {stat.label}
                      </p>
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent sessions</CardTitle>
                  <CardDescription>Scans and plans, newest first.</CardDescription>
                </div>
                <Badge variant="outline">{data.sessions} total</Badge>
              </CardHeader>
              <CardContent>
                {data.recent_sessions.length === 0 ? (
                  <EmptyState
                    icon={<FolderSearch className="h-7 w-7" />}
                    title="No folders scanned yet"
                    description="Pick a folder and LazyDesk will build a reviewable organization plan. Nothing moves until you approve it."
                    action={
                      <Link
                        href="/organize"
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
                      >
                        <FolderCog className="h-4 w-4" /> Start organizing
                      </Link>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recent_sessions.map((session) => (
                      <li key={session.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium" title={session.root_path}>
                            {shortenPath(session.root_path, 58)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {session.file_count} files · {formatBytes(session.total_bytes)} ·{" "}
                            {formatRelative(session.created_at)} · {session.source}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={session.status} />
                          <Link
                            href={`/organize?session=${session.id}`}
                            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                          >
                            Open
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-success" />
                    Privacy posture
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5 text-sm text-muted-foreground">
                  <p>Service bound to 127.0.0.1 with a per-install token.</p>
                  <p>No file contents are uploaded, including when cloud AI is enabled.</p>
                  <p>Destination collisions are renamed, never overwritten.</p>
                  <p>Every move is recorded so it can be undone.</p>
                  <Link
                    href="/settings"
                    className="inline-flex items-center gap-1 pt-1 text-xs font-medium text-primary hover:underline"
                  >
                    Review data and AI settings <ArrowRight className="h-3 w-3" />
                  </Link>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-muted-foreground" /> Recent actions
                    </CardTitle>
                  </div>
                  <Link
                    href="/history"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    All history
                  </Link>
                </CardHeader>
                <CardContent>
                  {data.recent_batches.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No files have been moved yet. Applied plans appear here with an undo option.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {data.recent_batches.map((batch) => (
                        <li key={batch.id} className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {batch.applied_count} file{batch.applied_count === 1 ? "" : "s"} moved
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {batch.root_path ? shortenPath(batch.root_path, 42) : "—"} ·{" "}
                              {formatRelative(batch.created_at)}
                            </p>
                          </div>
                          <StatusBadge status={batch.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
