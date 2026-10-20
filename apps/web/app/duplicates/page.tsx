"use client";

import { Copy, ExternalLink, Fingerprint, Info, Loader2, ScanSearch, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { FolderField } from "@/components/folder-field";
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
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { DuplicatesResponse } from "@/lib/types";
import { formatBytes, formatDate, formatDuration, shortenPath } from "@/lib/utils";

export default function DuplicatesPage() {
  const [path, setPath] = useState("");
  const [result, setResult] = useState<DuplicatesResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);

  async function runScan() {
    if (!path.trim()) {
      setError("Choose a folder to scan for duplicates.");
      return;
    }
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.duplicates(path.trim()));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setScanning(false);
    }
  }

  async function reveal(target: string) {
    setRevealing(target);
    setError(null);
    try {
      await api.reveal(target);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRevealing(null);
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Duplicates"
        description="Find byte-for-byte copies using SHA-256 after a size pre-filter. LazyDesk never deletes or moves duplicates automatically — it only shows you where they are."
      />

      {error ? (
        <Alert variant="destructive" title="Duplicate scan failed">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-primary" /> Scan a folder
          </CardTitle>
          <CardDescription>
            Files are grouped by size first, then hashed, so a folder full of unique files stays fast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FolderField value={path} onChange={setPath} label="Folder to check" id="dup-path" disabled={scanning} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Read-only. Nothing is modified.
            </p>
            <Button onClick={() => void runScan()} loading={scanning} disabled={!path.trim()}>
              <Fingerprint className="h-4 w-4" />
              {scanning ? "Hashing files…" : "Find duplicates"}
            </Button>
          </div>

          {scanning ? (
            <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading file sizes and hashing same-size candidates…
            </div>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Files scanned", value: result.scanned_files.toLocaleString() },
              { label: "Files hashed", value: result.hashed_files.toLocaleString() },
              { label: "Duplicate groups", value: result.groups.length.toLocaleString() },
              {
                label: "Potential duplicate space",
                value: formatBytes(result.potential_savings),
              },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Alert variant="warning" title="Potential space is not reclaimed space">
            These numbers describe identical files that exist. LazyDesk has not deleted anything, so no storage has been
            freed. Review the locations and decide manually what to keep. The scan took{" "}
            {formatDuration(result.duration_ms)}.
          </Alert>

          {result.groups.length === 0 ? (
            <EmptyState
              icon={<Copy className="h-7 w-7" />}
              title="No exact duplicates found"
              description="Every file in this folder has a unique size or content hash. Files with different names but identical bytes would still appear here."
            />
          ) : (
            <div className="space-y-4">
              {result.groups.map((group) => (
                <Card key={group.hash}>
                  <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Copy className="h-4 w-4 text-primary" />
                        {group.count} identical copies
                      </CardTitle>
                      <CardDescription className="font-mono text-[11px]">
                        SHA-256 {group.hash.slice(0, 16)}… · {formatBytes(group.size)} each
                      </CardDescription>
                    </div>
                    <Badge variant="warning">{formatBytes(group.potential_savings)} potential</Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5" />
                      Suggested retained copy is marked below. Confirm it is the version you want before removing others
                      yourself.
                    </div>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {group.files.map((file, index) => (
                        <li
                          key={file.path}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium">{file.name}</p>
                              {index === 0 ? (
                                <Badge variant="success">Suggested retained copy</Badge>
                              ) : null}
                            </div>
                            <p className="truncate font-mono text-[11px] text-muted-foreground" title={file.path}>
                              {shortenPath(file.path, 84)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Modified {formatDate(file.modified_at)}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void reveal(file.path)}
                            loading={revealing === file.path}
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Reveal
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {result.errors.length > 0 ? (
            <Alert variant="warning" title="Some files could not be read">
              {result.errors.slice(0, 5).join(" · ")}
            </Alert>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
