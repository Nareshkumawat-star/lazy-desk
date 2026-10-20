"use client";

import { ChevronDown, ChevronRight, History as HistoryIcon, RefreshCw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/session-badge";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  PageHeader,
  Spinner,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { HistoryResponse, UndoResponse } from "@/lib/types";
import { formatDate, formatRelative, shortenPath } from "@/lib/utils";

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [undoResult, setUndoResult] = useState<UndoResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setHistory(await api.history(30));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function undo(batchId: string) {
    setUndoing(batchId);
    setError(null);
    setNotice(null);
    setUndoResult(null);
    try {
      const result = await api.undo(batchId);
      setUndoResult(result);
      setConfirmUndo(null);
      if (result.failed > 0) {
        setError(result.errors.slice(0, 5).join(" · "));
      } else {
        setNotice(result.message);
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUndoing(null);
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Activity history"
        description="Every applied batch is recorded with exact source and destination paths. Undo re-validates both before touching anything."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" title="History action failed">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {undoResult && !notice && undoResult.failed === 0 ? (
        <Alert variant="success">{undoResult.message}</Alert>
      ) : null}

      {loading && !history ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-20">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : null}

      {history ? (
        history.batches.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="h-7 w-7" />}
            title="No operations yet"
            description="Once you apply an organization plan, the batch appears here with an undo button."
            action={
              <Link
                href="/organize"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
              >
                Organize a folder
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {history.batches.map((batch) => {
              const isOpen = expanded.has(batch.id);
              const canUndo = batch.status === "applied" || batch.status === "partial";
              return (
                <Card key={batch.id}>
                  <CardContent className="p-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="flex min-w-0 items-start gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleExpanded(batch.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Collapse operations" : "Expand operations"}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold">
                              {batch.applied_count} file{batch.applied_count === 1 ? "" : "s"} moved
                            </p>
                            <StatusBadge status={batch.status} />
                            {batch.failed_count > 0 ? (
                              <Badge variant="warning">{batch.failed_count} left in place</Badge>
                            ) : null}
                          </div>
                          <p className="truncate font-mono text-[11px] text-muted-foreground" title={batch.root_path ?? ""}>
                            {batch.root_path ? shortenPath(batch.root_path, 72) : "Folder unavailable"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(batch.created_at)} · {formatRelative(batch.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {batch.session_id ? (
                          <Link
                            href={`/organize?session=${batch.session_id}`}
                            className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-xs font-medium hover:bg-muted"
                          >
                            Session
                          </Link>
                        ) : null}
                        {canUndo ? (
                          confirmUndo === batch.id ? (
                            <>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void undo(batch.id)}
                                loading={undoing === batch.id}
                              >
                                Confirm undo
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setConfirmUndo(null)}>
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmUndo(batch.id)}
                            >
                              <Undo2 className="h-3.5 w-3.5" /> Undo batch
                            </Button>
                          )
                        ) : batch.status === "undone" ? (
                          <Badge variant="secondary">
                            {batch.undone_count} restored
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    {isOpen ? (
                      <div className="border-t border-border bg-muted/20 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Recorded operations
                          </p>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            batch {batch.id.slice(0, 8)}
                          </span>
                        </div>
                        {batch.operations.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No operations in this batch.</p>
                        ) : (
                          <ul className="space-y-2">
                            {batch.operations.map((op) => (
                              <li
                                key={op.id}
                                className="rounded-md border border-border bg-background/70 px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <StatusBadge status={op.status} />
                                  <span className="text-[11px] text-muted-foreground">{op.category}</span>
                                </div>
                                <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                                  {op.source_path}
                                </p>
                                <p className="break-all font-mono text-[11px]">
                                  → {op.final_destination ?? op.destination_path}
                                </p>
                                {op.error ? (
                                  <p className="mt-1 text-[11px] text-warning">{op.error}</p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          Undo only succeeds when the moved file is still at its destination and the original location
                          is empty. It never overwrites a newly created file.
                        </p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}
