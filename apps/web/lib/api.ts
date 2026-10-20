import type {
  AIStatus,
  ApplyResponse,
  AutomationOverview,
  AutomationRule,
  AutomationRunResponse,
  CategorizeResponse,
  Dashboard,
  DuplicatesResponse,
  HistoryResponse,
  IndexStatus,
  AiScope,
  Operation,
  PendingAutomation,
  PlanResponse,
  PreviewResponse,
  Provider,
  ScanResponse,
  SearchResponse,
  Session,
  Settings,
  SettingsPatch,
  UndoResponse,
} from "./types";
import { getBridge } from "./runtime";

const DEFAULT_API_BASE = "http://127.0.0.1:8765";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status = 0, detail: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function apiBase(): string {
  if (typeof window !== "undefined") {
    const bridge = getBridge();
    if (bridge?.apiBase) return bridge.apiBase.replace(/\/$/, "");
    const stored = window.localStorage.getItem("lazydesk.apiBase");
    if (stored) return stored.replace(/\/$/, "");
  }
  return (process.env.NEXT_PUBLIC_LAZYDESK_API || DEFAULT_API_BASE).replace(/\/$/, "");
}

export function getToken(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_LAZYDESK_TOKEN || "";
  }
  const bridge = getBridge();
  if (bridge?.token) return bridge.token;
  // An explicit ?token= in the URL is a deliberate, one-off user action, so it
  // wins over a token stored earlier. Otherwise a stale token would shadow
  // the URL forever and the site could only be re-authenticated by clearing
  // localStorage by hand.
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    window.localStorage.setItem("lazydesk.token", fromUrl);
    return fromUrl;
  }
  const stored = window.localStorage.getItem("lazydesk.token");
  if (stored) return stored;
  return process.env.NEXT_PUBLIC_LAZYDESK_TOKEN || "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-LazyDesk-Token": token } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail: unknown = null;
      let message = `Request failed (${response.status})`;
      try {
        detail = await response.json();
        if (detail && typeof detail === "object" && "detail" in detail) {
          const value = (detail as { detail: unknown }).detail;
          if (typeof value === "string") message = value;
          else if (Array.isArray(value) && value.length) {
            message = value.map((item) => item?.msg ?? "Invalid value").join(", ");
          }
        }
      } catch {
        // Keep the generic message when the body is not JSON.
      }
      if (response.status === 401) {
        message =
          "LazyDesk could not authenticate with the service. The token may be wrong or out of date - open the site again with ?token=<your token> to replace it, or restart the desktop app so a fresh token is issued.";
      }
      throw new ApiError(message, response.status, detail);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "The local service did not respond in time. Large folders or a rate-limited AI model can take a while — try again.",
        0,
      );
    }
    throw new ApiError(
      "Cannot reach the LazyDesk local service. Make sure the backend is running on 127.0.0.1:8765.",
      0,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export const api = {
  base: apiBase,
  dashboard: () => request<Dashboard>("/api/dashboard", { timeoutMs: 20_000 }),
  aiStatus: () => request<AIStatus>("/api/ai/status", { timeoutMs: 20_000 }),
  settings: () => request<Settings>("/api/settings", { timeoutMs: 25_000 }),
  updateSettings: (patch: SettingsPatch) =>
    request<Settings>("/api/settings", { method: "PATCH", body: patch, timeoutMs: 25_000 }),
  providers: () => request<Provider[]>("/api/ai/providers", { timeoutMs: 15_000 }),
  testAI: (provider?: string) =>
    request<{ ok: boolean; message: string; provider?: string; model?: string }>(
      `/api/ai/test${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`,
      { method: "POST", timeoutMs: 30_000 },
    ),
  models: (provider: string) =>
    request<{ provider: string; models: string[]; fetched: boolean; message: string }>(
      `/api/ai/models?provider=${encodeURIComponent(provider)}`,
      { timeoutMs: 20_000 },
    ),

  scan: (path: string, options?: { includeHidden?: boolean; maxDepth?: number }) =>
    request<ScanResponse>("/api/scan", {
      method: "POST",
      body: {
        path,
        include_hidden: options?.includeHidden ?? false,
        max_depth: options?.maxDepth ?? 12,
      },
      timeoutMs: 120_000,
    }),
  categorize: (sessionId: number, useAi: boolean, aiScope: AiScope) =>
    request<CategorizeResponse>("/api/categorize", {
      method: "POST",
      body: { session_id: sessionId, use_ai: useAi, ai_scope: aiScope },
      timeoutMs: 180_000,
    }),
  plan: (sessionId: number, useAi: boolean, aiScope: AiScope) =>
    request<PlanResponse>("/api/plan", {
      method: "POST",
      body: { session_id: sessionId, use_ai: useAi, ai_scope: aiScope },
      timeoutMs: 180_000,
    }),
  preview: (sessionId: number, operationIds?: number[], resolveConflicts = true) =>
    request<PreviewResponse>("/api/operations/preview", {
      method: "POST",
      body: {
        session_id: sessionId,
        operation_ids: operationIds ?? null,
        resolve_conflicts: resolveConflicts,
      },
      timeoutMs: 30_000,
    }),
  apply: (sessionId: number, operationIds?: number[], resolveConflicts = true) =>
    request<ApplyResponse>("/api/operations/apply", {
      method: "POST",
      body: {
        session_id: sessionId,
        operation_ids: operationIds ?? null,
        resolve_conflicts: resolveConflicts,
      },
      timeoutMs: 120_000,
    }),
  undo: (batchId?: string | null) =>
    request<UndoResponse>("/api/operations/undo", {
      method: "POST",
      body: { batch_id: batchId ?? null },
      timeoutMs: 120_000,
    }),
  history: (limit = 25) =>
    request<HistoryResponse>(`/api/history?limit=${limit}`, { timeoutMs: 20_000 }),
  sessionDetail: (sessionId: number) =>
    request<{
      session: Session;
      files: ScanResponse["files"];
      operations: Operation[];
    }>(`/api/sessions/${sessionId}`, { timeoutMs: 20_000 }),

  search: (payload: {
    query: string;
    root_path?: string | null;
    limit?: number;
    use_ai?: boolean;
  }) =>
    request<SearchResponse>("/api/search", {
      method: "POST",
      body: {
        query: payload.query,
        root_path: payload.root_path ?? null,
        limit: payload.limit ?? 50,
        use_ai: payload.use_ai ?? true,
      },
      timeoutMs: 90_000,
    }),
  index: (rootPath?: string | null, limit = 2000) =>
    request<{ indexed: number; provider: string | null; model: string | null; message: string }>(
      "/api/search/index",
      {
        method: "POST",
        body: { root_path: rootPath ?? null, limit },
        timeoutMs: 180_000,
      },
    ),
  indexStatus: () => request<IndexStatus>("/api/search/index/status", { timeoutMs: 15_000 }),
  clearIndex: () =>
    request<{ message: string }>("/api/index/clear", { method: "POST", timeoutMs: 30_000 }),

  duplicates: (path: string) =>
    request<DuplicatesResponse>("/api/duplicates/scan", {
      method: "POST",
      body: { path, min_size: 1 },
      timeoutMs: 180_000,
    }),
  reveal: (path: string) =>
    request<{ revealed: boolean; message: string }>("/api/files/reveal", {
      method: "POST",
      body: { path },
      timeoutMs: 15_000,
    }),

  automation: () => request<AutomationOverview>("/api/automation", { timeoutMs: 20_000 }),
  pendingAutomation: () =>
    request<{ pending: PendingAutomation[] }>("/api/automation/pending", { timeoutMs: 20_000 }),
  createRule: (payload: {
    name: string;
    root_path: string;
    enabled?: boolean;
    interval_minutes?: number;
    auto_apply?: boolean;
  }) =>
    request<AutomationRule>("/api/automation/rules", {
      method: "POST",
      body: payload,
      timeoutMs: 30_000,
    }),
  updateRule: (
    id: number,
    payload: Partial<{
      name: string;
      root_path: string;
      enabled: boolean;
      interval_minutes: number;
      auto_apply: boolean;
    }>,
  ) =>
    request<AutomationRule>(`/api/automation/rules/${id}`, {
      method: "PATCH",
      body: payload,
      timeoutMs: 20_000,
    }),
  deleteRule: (id: number) =>
    request<{ ok: boolean }>(`/api/automation/rules/${id}`, { method: "DELETE" }),
  runRule: (id: number) =>
    request<AutomationRunResponse>(`/api/automation/rules/${id}/run`, {
      method: "POST",
      timeoutMs: 240_000,
    }),
};

export async function pickFolder(): Promise<string | null> {
  const bridge = getBridge();
  if (bridge?.selectFolder) {
    return bridge.selectFolder();
  }
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
