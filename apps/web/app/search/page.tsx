"use client";

import {
  Database,
  ExternalLink,
  FolderSearch,
  Loader2,
  Search as SearchIcon,
  Sparkles,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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
  Input,
  PageHeader,
  Switch,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { IndexStatus, SearchResponse } from "@/lib/types";
import { classForCategory, formatBytes, formatDate, shortenPath } from "@/lib/utils";

const EXAMPLES = [
  "Find my Python projects",
  "Show PDFs related to operating systems",
  "Find large video files",
  "Show files I downloaded recently",
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [revealing, setRevealing] = useState<string | null>(null);

  async function loadIndexStatus() {
    try {
      setIndexStatus(await api.indexStatus());
    } catch {
      // The main search error state already covers an offline service.
    }
  }

  useEffect(() => {
    void loadIndexStatus();
  }, []);

  async function runSearch(text?: string) {
    const value = (text ?? query).trim();
    if (!value) return;
    setQuery(value);
    setSearching(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.search({ query: value, use_ai: useAi });
      setResult(response);
    } catch (err) {
      setError(errorMessage(err));
      setResult(null);
    } finally {
      setSearching(false);
    }
  }

  async function buildIndex() {
    setIndexing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.index(null, 2000);
      setNotice(response.message);
      await loadIndexStatus();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIndexing(false);
    }
  }

  async function reveal(path: string) {
    setRevealing(path);
    setError(null);
    try {
      await api.reveal(path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRevealing(null);
    }
  }

  const filters = result?.filters;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Smart search"
        description="Ask in plain language. LazyDesk turns your query into metadata filters, then optionally reranks the results with local embeddings — file contents are only indexed if you explicitly enable that."
      />

      {error ? (
        <Alert variant="destructive" title="Search could not complete">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SearchIcon className="h-4 w-4 text-primary" /> Describe what you are looking for
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. Show large PDFs from this month"
              aria-label="Search query"
              autoFocus
            />
            <Button type="submit" loading={searching} disabled={!query.trim()} className="shrink-0">
              <SearchIcon className="h-4 w-4" />
              Search
            </Button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void runSearch(example)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium">AI query understanding</p>
                <p className="text-xs text-muted-foreground">
                  Sends only your query text and the category list — no filenames. Turn off to use deterministic filters
                  only.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{useAi ? "On" : "Off"}</span>
              <Switch checked={useAi} onCheckedChange={setUseAi} label="AI query understanding" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" /> Semantic index
            </CardTitle>
            <CardDescription>
              Optional. Embeds filenames (and file text only with explicit consent) so similar concepts can match.
            </CardDescription>
          </div>
          <Badge variant="outline">{indexStatus?.indexed ?? 0} embedded</Badge>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {indexStatus?.indexed
              ? `Last built ${formatDate(indexStatus.last_indexed_at)} · ${indexStatus.content_indexed} with text content`
              : "No embeddings yet. Metadata search works without this."}
          </div>
          <Button variant="outline" onClick={() => void buildIndex()} loading={indexing}>
            <Database className="h-4 w-4" /> Build / refresh index
          </Button>
        </CardContent>
      </Card>

      {searching ? (
        <div className="flex items-center gap-2 rounded-xl border border-border px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Parsing your query and searching indexed metadata…
        </div>
      ) : null}

      {result ? (
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>{result.total} matching file(s)</CardTitle>
                <CardDescription>{result.message || `Results for “${result.query}”`}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {result.semantic ? <Badge variant="success">Semantic rerank</Badge> : null}
                {result.provider ? <Badge variant="outline">{result.provider}</Badge> : null}
                {filters?.category ? <Badge variant="default">{filters.category}</Badge> : null}
                {filters?.extensions.map((ext) => (
                  <Badge key={ext} variant="secondary">
                    .{ext}
                  </Badge>
                ))}
                {filters?.min_size_mb ? <Badge variant="secondary">≥ {filters.min_size_mb} MB</Badge> : null}
                {filters?.max_size_mb ? <Badge variant="secondary">≤ {filters.max_size_mb} MB</Badge> : null}
                {filters?.modified_within_days ? (
                  <Badge variant="secondary">last {filters.modified_within_days} days</Badge>
                ) : null}
              </div>
            </div>
            {filters?.keywords.length ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Tags className="h-3.5 w-3.5" /> Keywords: {filters.keywords.join(", ")}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            {result.hits.length === 0 ? (
              <EmptyState
                icon={<FolderSearch className="h-7 w-7" />}
                title="No files matched"
                description="Scan more folders, broaden the query, or build the semantic index for concept matching."
                action={
                  <Link
                    href="/organize"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted"
                  >
                    Organize a folder
                  </Link>
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">File</th>
                      <th className="px-3 py-2.5 font-semibold">Category</th>
                      <th className="px-3 py-2.5 font-semibold">Size</th>
                      <th className="px-3 py-2.5 font-semibold">Modified</th>
                      <th className="px-3 py-2.5 font-semibold">Why it matched</th>
                      <th className="px-3 py-2.5 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.hits.map((hit) => (
                      <tr key={hit.path} className="align-top hover:bg-muted/30">
                        <td className="max-w-[300px] px-3 py-3">
                          <p className="truncate font-medium">{hit.name}</p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground" title={hit.path}>
                            {shortenPath(hit.path, 60)}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              classForCategory(hit.category),
                            )}
                          >
                            {hit.category ?? "Other"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                          {formatBytes(hit.size)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                          {formatDate(hit.modified_at)}
                        </td>
                        <td className="max-w-[260px] px-3 py-3 text-xs text-muted-foreground">
                          {hit.match_reason}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void reveal(hit.path)}
                            loading={revealing === hit.path}
                            title="Reveal in folder"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Reveal
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!result && !searching ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Search your indexed files"
          description="Queries combine categories, extensions, size and recency. All matching happens locally against the SQLite index; no search terms leave your machine unless AI query understanding is on."
        />
      ) : null}
    </div>
  );
}
