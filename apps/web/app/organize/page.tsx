"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  FolderCog,
  ListChecks,
  Loader2,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  Confidence,
  EmptyState,
  Label,
  PageHeader,
  Progress,
  Select,
  Spinner,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type {
  AiScope,
  ApplyResponse,
  PlanItem,
  PlanResponse,
  PreviewResponse,
  ScanResponse,
  Settings,
  UndoResponse,
} from "@/lib/types";
import { classForCategory, formatBytes, shortenPath } from "@/lib/utils";

export default function OrganizePage() {
  const [path, setPath] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [aiScope, setAiScope] = useState<AiScope>("ambiguous");
  const [resolveConflicts, setResolveConflicts] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [scanning, setScanning] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResponse | null>(null);
  const [undoResult, setUndoResult] = useState<UndoResponse | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => undefined);
  }, []);

  const hydrateSession = useCallback(async (sessionId: number) => {
    setLoadingSession(true);
    setError(null);
    try {
      const detail = await api.sessionDetail(sessionId);
      setPath(detail.session.root_path);
      setScan({
        session: detail.session,
        files: detail.files,
        skipped: detail.session.skipped_count,
        errors: [],
        truncated: false,
        excluded_dirs: [],
      });
      if (detail.operations.length) {
        const validation = await api.preview(sessionId);
        setPreview(validation);
        setPlan({
          session_id: sessionId,
          items: validation.items,
          categories: [],
          unchanged: validation.unchanged,
          ai_used: detail.session.ai_used,
          provider: detail.session.ai_provider,
          model: detail.session.ai_model,
          warnings: [],
        });
        setSelected(
          new Set(
            validation.items
              .filter((item) => item.status !== "missing")
              .map((item) => item.operation_id),
          ),
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingSession(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");
    if (sessionParam && /^\d+$/.test(sessionParam)) {
      void hydrateSession(Number(sessionParam));
    }
  }, [hydrateSession]);

  const aiReady = settings?.status.ready ?? false;
  const selectableItems = useMemo(
    () => (plan?.items ?? []).filter((item) => item.status !== "missing"),
    [plan],
  );
  const allSelected =
    selectableItems.length > 0 && selectableItems.every((item) => selected.has(item.operation_id));
  const selectedItems = useMemo(
    () => selectableItems.filter((item) => selected.has(item.operation_id)),
    [selectableItems, selected],
  );
  const conflictCount = selectedItems.filter((item) => item.conflict).length;

  async function runScan() {
    if (!path.trim()) {
      setError("Choose a folder first.");
      return;
    }
    setScanning(true);
    setError(null);
    setNotice(null);
    setApplyResult(null);
    setUndoResult(null);
    setPlan(null);
    setPreview(null);
    setSelected(new Set());
    try {
      const result = await api.scan(path.trim(), { includeHidden });
      setScan(result);
      if (result.files.length === 0) {
        setNotice("The folder was scanned but no eligible files were found.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  async function generatePlan() {
    if (!scan) return;
    setPlanning(true);
    setError(null);
    setNotice(null);
    setConfirming(false);
    setApplyResult(null);
    try {
      const result = await api.plan(scan.session.id, aiScope !== "none", aiScope);
      setPlan(result);
      const validation = await api.preview(scan.session.id);
      setPreview(validation);
      setSelected(new Set(result.items.map((item) => item.operation_id)));
      if (result.items.length === 0) {
        setNotice("Every file is already in its category folder — nothing to move.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPlanning(false);
    }
  }

  function toggleOne(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableItems.map((item) => item.operation_id)));
  }

  async function applySelected() {
    if (!scan || selectedItems.length === 0) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.apply(
        scan.session.id,
        selectedItems.map((item) => item.operation_id),
        resolveConflicts,
      );
      setApplyResult(result);
      setConfirming(false);
      setPlan(null);
      setPreview(null);
      setSelected(new Set());
      setScan(null);
      // Refresh file list with new locations.
      const detail = await api.sessionDetail(scan.session.id);
      setScan({
        session: detail.session,
        files: detail.files,
        skipped: detail.session.skipped_count,
        errors: [],
        truncated: false,
        excluded_dirs: [],
      });
      if (result.errors.length) setError(result.errors.slice(0, 4).join(" · "));
      else setNotice(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  }

  async function undoLast() {
    setUndoing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.undo(applyResult?.batch_id ?? null);
      setUndoResult(result);
      if (result.failed > 0) {
        setError(result.errors.slice(0, 4).join(" · "));
      } else {
        setNotice(result.message);
      }
      if (scan) {
        const detail = await api.sessionDetail(scan.session.id);
        setScan({
          session: detail.session,
          files: detail.files,
          skipped: detail.session.skipped_count,
          errors: [],
          truncated: false,
          excluded_dirs: [],
        });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Organize files"
        description="Scan a folder, let AI suggest categories for the ambiguous files, then approve each move. Nothing is written until you apply."
        actions={
          <Badge variant={aiReady ? "success" : "secondary"}>
            <Sparkles className="h-3 w-3" />
            {aiReady
              ? `${settings?.status.active} · ${settings?.status.model}`
              : "Rule-based mode"}
          </Badge>
        }
      />

      {error ? (
        <Alert variant="destructive" title="Something needs attention">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {settings && !aiReady ? (
        <Alert variant="info" title="AI is not active — deterministic rules are being used">
          {settings.status.message}{" "}
          <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">
            Configure a free provider
          </Link>
          .
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-primary" /> 1. Pick a folder
          </CardTitle>
          <CardDescription>
            Hidden files, symlinks, system folders and development caches such as node_modules are skipped by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FolderField value={path} onChange={setPath} disabled={scanning} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={includeHidden}
                onChange={(event) => setIncludeHidden(event.target.checked)}
              />
              Include hidden files
            </label>
            <Button onClick={() => void runScan()} loading={scanning} disabled={!path.trim()}>
              <ScanLine className="h-4 w-4" />
              {scanning ? "Scanning…" : "Scan folder"}
            </Button>
          </div>

          {scanning ? (
            <div className="space-y-2 rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading file metadata — no file contents are opened.
              </div>
              <Progress value={null} />
            </div>
          ) : null}

          {scan && !scanning ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{shortenPath(scan.session.root_path, 72)}</p>
                  <p className="text-xs text-muted-foreground">
                    {scan.files.length} files · {formatBytes(scan.session.total_bytes)} ·{" "}
                    {scan.skipped} skipped
                    {scan.truncated ? " · scan truncated at the file limit" : ""}
                  </p>
                </div>
                <Badge variant="outline">{scan.files.length} indexed</Badge>
              </div>
              {scan.excluded_dirs.length > 0 ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium">
                    Excluded {scan.excluded_dirs.length} cache folder(s)
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {scan.excluded_dirs.map((dir) => (
                      <li key={dir} className="truncate font-mono">
                        {dir}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {scan.errors.length > 0 ? (
                <details className="text-xs text-warning">
                  <summary className="cursor-pointer font-medium">
                    {scan.errors.length} inaccessible item(s)
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {scan.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {scan ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> 2. Generate an organization plan
            </CardTitle>
            <CardDescription>
              Rules classify obvious file types. AI is only asked about files the rules cannot confidently classify,
              unless you choose otherwise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ai-scope">AI usage</Label>
                <Select
                  id="ai-scope"
                  value={aiScope}
                  onChange={(event) => setAiScope(event.target.value as AiScope)}
                  disabled={planning}
                >
                  <option value="ambiguous">AI for ambiguous files (recommended)</option>
                  <option value="all">AI for every file</option>
                  <option value="none">Rules only — no AI call</option>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => void generatePlan()}
                  loading={planning}
                  className="w-full"
                  disabled={scan.files.length === 0}
                >
                  <ListChecks className="h-4 w-4" />
                  {planning ? "Building plan…" : "Generate plan"}
                </Button>
              </div>
            </div>
            {planning ? (
              <div className="space-y-2 rounded-lg border border-border p-4">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Classifying filenames{aiScope !== "none" && aiReady ? " with AI" : " with local rules"}…
                </p>
                <Progress value={null} />
              </div>
            ) : null}
            {plan?.warnings.map((warning) => (
              <Alert key={warning} variant="warning">
                {warning}
              </Alert>
            ))}
            {plan?.items.length === 0 && !planning ? (
              <EmptyState
                icon={<CheckCircle2 className="h-7 w-7 text-success" />}
                title="Nothing to move"
                description={plan.unchanged > 0 ? `${plan.unchanged} file(s) are already organized.` : undefined}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {plan && plan.items.length > 0 ? (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-primary" /> 3. Review before anything moves
                </CardTitle>
                <CardDescription>
                  {selectedItems.length} of {selectableItems.length} selected · {plan.unchanged} already organized
                  {preview?.missing.length ? ` · ${preview.missing.length} missing source(s)` : ""}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={plan.ai_used ? "default" : "secondary"}>
                  {plan.ai_used ? `AI: ${plan.provider}` : "Rules only"}
                </Badge>
                {conflictCount > 0 ? (
                  <Badge variant="warning">
                    <AlertTriangle className="h-3 w-3" /> {conflictCount} rename
                    {conflictCount === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {plan.categories.map((category) => (
                <span
                  key={category.category}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    classForCategory(category.category),
                  )}
                >
                  {category.category} · {category.count} → {category.folder}/
                </span>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={allSelected} onChange={toggleAll} />
                Select all
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={resolveConflicts}
                  onChange={(event) => setResolveConflicts(event.target.checked)}
                />
                Rename conflicts instead of skipping (never overwrites)
              </label>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="px-3 py-2.5 font-semibold">File</th>
                    <th className="px-3 py-2.5 font-semibold">Category</th>
                    <th className="px-3 py-2.5 font-semibold">Destination</th>
                    <th className="px-3 py-2.5 font-semibold">Why</th>
                    <th className="px-3 py-2.5 font-semibold">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {plan.items.map((item: PlanItem) => {
                    const isSelected = selected.has(item.operation_id);
                    const missing = item.status === "missing";
                    return (
                      <tr
                        key={item.operation_id}
                        className={cn(
                          "align-top transition-colors",
                          isSelected ? "bg-primary/[0.04]" : "hover:bg-muted/30",
                          missing && "opacity-60",
                        )}
                      >
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={isSelected}
                            disabled={missing}
                            onChange={() => toggleOne(item.operation_id)}
                            aria-label={`Approve ${item.name}`}
                          />
                        </td>
                        <td className="max-w-[220px] px-3 py-3">
                          <p className="truncate font-medium" title={item.source_path}>
                            {item.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" title={item.source_path}>
                            {shortenPath(item.source_path, 52)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              classForCategory(item.category),
                            )}
                          >
                            {item.category}
                          </span>
                        </td>
                        <td className="max-w-[260px] px-3 py-3">
                          <p className="truncate font-mono text-xs" title={item.destination_path}>
                            {shortenPath(item.destination_path, 58)}
                          </p>
                          {item.conflict ? (
                            <p className="mt-1 text-[11px] text-warning">
                              {item.conflict_reason ?? "Name conflict — will be renamed"}
                            </p>
                          ) : null}
                        </td>
                        <td className="max-w-[240px] px-3 py-3 text-xs text-muted-foreground">
                          {item.reason ?? "—"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <Confidence value={item.confidence} />
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {item.classification_source}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!resolveConflicts && conflictCount > 0 ? (
              <Alert variant="warning">
                {conflictCount} selected destination(s) already exist. With automatic renaming off, those files will be
                skipped and left untouched.
              </Alert>
            ) : null}

            {confirming ? (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm font-semibold">
                  Move {selectedItems.length} file{selectedItems.length === 1 ? "" : "s"} into category folders?
                </p>
                <p className="text-sm text-muted-foreground">
                  Destination collisions will be renamed, not overwritten. This batch is recorded in Activity History and
                  can be undone.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void applySelected()} loading={applying}>
                    <ArrowRight className="h-4 w-4" /> Confirm and move
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={applying}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={selectedItems.length === 0}
                  variant="success"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Apply {selectedItems.length} approved move{selectedItems.length === 1 ? "" : "s"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  Unselected files stay exactly where they are.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {applyResult ? (
        <Card className={applyResult.applied > 0 ? "border-success/30" : "border-warning/30"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              {applyResult.message}
            </CardTitle>
            <CardDescription>
              {applyResult.applied} moved · {applyResult.skipped} skipped · {applyResult.failed} failed
              {applyResult.batch_id ? ` · batch ${applyResult.batch_id.slice(0, 8)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {applyResult.items.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {applyResult.items.map((op) => (
                  <li key={op.id} className="truncate font-mono">
                    {shortenPath(op.source_path, 48)} → {shortenPath(op.final_destination ?? op.destination_path, 48)}
                  </li>
                ))}
              </ul>
            ) : null}
            {applyResult.errors.length > 0 ? (
              <Alert variant="warning" title="Some files were left in place">
                {applyResult.errors.slice(0, 5).join(" · ")}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void undoLast()} loading={undoing}>
                <Undo2 className="h-4 w-4" /> Undo last operation
              </Button>
              <Button variant="ghost" onClick={() => setApplyResult(null)}>
                Dismiss
              </Button>
              <Link
                href="/history"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-primary hover:bg-muted"
              >
                Open history <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {undoResult && !applyResult ? (
        <Alert variant={undoResult.failed > 0 ? "warning" : "success"} title={undoResult.message}>
          {undoResult.failed > 0
            ? undoResult.errors.slice(0, 4).join(" · ")
            : "Files were restored to their original locations."}
        </Alert>
      ) : null}

      {loadingSession ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> Loading saved session…
        </div>
      ) : null}

      {!scan && !scanning && !loadingSession ? (
        <Card>
          <CardContent className="p-6">
            <EmptyState
              icon={<FolderCog className="h-7 w-7" />}
              title="Start with a folder you do not mind tidying"
              description="Try Downloads or Desktop. LazyDesk previews every move, and the undo button uses the exact recorded paths."
            />
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <Cloud className="h-3.5 w-3.5" /> Cloud AI stays optional · filenames only · no document contents
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
