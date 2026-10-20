"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FolderField } from "@/components/folder-field";
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
  Checkbox,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Switch,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AutomationOverview, AutomationRunResponse, PendingAutomation } from "@/lib/types";
import { formatDate, formatRelative, shortenPath } from "@/lib/utils";

const INTERVALS = [
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Every day" },
  { value: 10080, label: "Every week" },
];

export default function AutomationPage() {
  const [overview, setOverview] = useState<AutomationOverview | null>(null);
  const [pending, setPending] = useState<PendingAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<AutomationRunResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(1440);
  const [autoApply, setAutoApply] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, pendingData] = await Promise.all([api.automation(), api.pendingAutomation()]);
      setOverview(data);
      setPending(pendingData.pending);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleAutomation(enabled: boolean) {
    setBusy("global");
    setError(null);
    setNotice(null);
    try {
      await api.updateSettings({ automation_enabled: enabled });
      setNotice(
        enabled
          ? "Scheduled scans are on. Disabled rules stay paused until you enable them."
          : "Scheduled scans are off. Existing rules are kept but will not run automatically.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !rootPath.trim()) {
      setError("Give the rule a name and choose a folder.");
      return;
    }
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      await api.createRule({
        name: name.trim(),
        root_path: rootPath.trim(),
        enabled: true,
        interval_minutes: intervalMinutes,
        auto_apply: autoApply,
      });
      setName("");
      setRootPath("");
      setAutoApply(false);
      setNotice("Rule created. It will create a review session on its next scheduled run.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function toggleRule(id: number, enabled: boolean) {
    setBusy(`rule-${id}`);
    setError(null);
    try {
      await api.updateRule(id, { enabled });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoApply(id: number, value: boolean) {
    setBusy(`auto-${id}`);
    setError(null);
    try {
      await api.updateRule(id, { auto_apply: value });
      setNotice(
        value
          ? "Auto-apply is on for this rule. New files will be moved during scheduled runs without another prompt."
          : "Auto-apply is off. Scheduled runs will wait for your review.",
      );
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function runNow(id: number) {
    setBusy(`run-${id}`);
    setError(null);
    setNotice(null);
    setRunResult(null);
    try {
      const result = await api.runRule(id);
      setRunResult(result);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeRule(id: number) {
    setBusy(`delete-${id}`);
    setError(null);
    try {
      await api.deleteRule(id);
      setConfirmDelete(null);
      setNotice("Rule deleted.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Automation"
        description="Save organization rules for folders you tidy often. Scheduled scans are off by default and can always run in review-only mode."
      />

      {error ? (
        <Alert variant="destructive" title="Automation action failed">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {runResult ? (
        <Alert variant={runResult.status === "failed" ? "destructive" : "info"} title={runResult.message}>
          {runResult.session_id ? (
            <Link
              href={`/organize?session=${runResult.session_id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Open the session to review {runResult.planned} proposed move(s)
            </Link>
          ) : null}
        </Alert>
      ) : null}

      <Card className={overview?.enabled ? "border-success/30" : undefined}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="max-w-2xl space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" />
              Scheduled scans {overview?.enabled ? "are on" : "are off"}
            </p>
            <p className="text-sm text-muted-foreground">
              {overview?.status.message ??
                "Rules only run while LazyDesk is open. Disabled rules never run, even when this switch is on."}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Auto-apply is a separate, per-rule opt-in.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {overview?.enabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              checked={overview?.enabled ?? false}
              onCheckedChange={(value) => void toggleAutomation(value)}
              disabled={loading || busy === "global"}
              label="Scheduled scans"
            />
          </div>
        </CardContent>
      </Card>

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for review</CardTitle>
            <CardDescription>Automation prepared these sessions but did not move anything.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {pending.map((item) => (
                <li key={item.session.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{shortenPath(item.session.root_path, 60)}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.planned} proposed moves · {formatRelative(item.session.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={item.session.status} />
                    <Link
                      href={`/organize?session=${item.session.id}`}
                      className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-xs font-medium hover:bg-muted"
                    >
                      Review
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Saved rules</CardTitle>
          <CardDescription>
            Each run scans the folder and builds a plan. Turn on auto-apply only if you trust the folder and the rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading rules…</p>
          ) : overview && overview.rules.length > 0 ? (
            <ul className="space-y-3">
              {overview.rules.map((rule) => (
                <li key={rule.id} className="rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{rule.name}</p>
                        {rule.auto_apply ? (
                          <Badge variant="warning">
                            <AlertTriangle className="h-3 w-3" /> Auto-apply
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Review first</Badge>
                        )}
                        {!rule.enabled ? <Badge variant="outline">Paused</Badge> : null}
                      </div>
                      <p className="truncate font-mono text-[11px] text-muted-foreground" title={rule.root_path}>
                        {shortenPath(rule.root_path, 76)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {INTERVALS.find((item) => item.value === rule.interval_minutes)?.label ??
                          `Every ${rule.interval_minutes} minutes`}{" "}
                        · Last run {formatRelative(rule.last_run_at)} · Next{" "}
                        {rule.enabled ? formatDate(rule.next_run_at) : "paused"}
                      </p>
                      {rule.last_result ? (
                        <p className="text-xs text-muted-foreground">{rule.last_result}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">Enabled</span>
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={(value) => void toggleRule(rule.id, value)}
                          disabled={busy === `rule-${rule.id}`}
                          label={`Enable ${rule.name}`}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runNow(rule.id)}
                        loading={busy === `run-${rule.id}`}
                      >
                        <Play className="h-3.5 w-3.5" /> Run now
                      </Button>
                      {confirmDelete === rule.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void removeRule(rule.id)}
                            loading={busy === `delete-${rule.id}`}
                          >
                            Confirm delete
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setConfirmDelete(rule.id)}
                          aria-label={`Delete ${rule.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={rule.auto_apply}
                      onChange={(event) => void toggleAutoApply(rule.id, event.target.checked)}
                      disabled={busy === `auto-${rule.id}`}
                    />
                    Move approved categories automatically on scheduled runs (never overwrites; conflicts are renamed)
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<CalendarClock className="h-7 w-7" />}
              title="No automation rules yet"
              description="Create a rule below for a folder you clean up regularly, such as Downloads."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" /> New rule
          </CardTitle>
          <CardDescription>
            The folder becomes an approved root. Rules cannot touch anything outside it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={createRule}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rule-name">Rule name</Label>
                <Input
                  id="rule-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Weekly Downloads cleanup"
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-interval">Frequency</Label>
                <Select
                  id="rule-interval"
                  value={String(intervalMinutes)}
                  onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                >
                  {INTERVALS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <FolderField value={rootPath} onChange={setRootPath} label="Folder" id="rule-path" />
            <label className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
              <Checkbox
                checked={autoApply}
                onChange={(event) => setAutoApply(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Auto-apply this rule on scheduled runs</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Files are moved without another review prompt. Only this folder is affected, existing files are never
                  overwritten, and every batch remains undoable from Activity History.
                </span>
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Button type="submit" loading={creating}>
                <Plus className="h-4 w-4" /> Create rule
              </Button>
              <Link
                href="/organize"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                Organize manually instead
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Clock className="mt-0.5 h-3.5 w-3.5" />
        Schedules are checked once a minute while LazyDesk runs. Missed runs happen after the app reopens, not in the
        background.
      </div>
      {runResult?.status === "applied" ? (
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> {runResult.applied} file(s) moved by the rule.
        </div>
      ) : null}
    </div>
  );
}
