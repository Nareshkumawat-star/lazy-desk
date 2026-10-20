"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Cpu,
  Database,
  ExternalLink,
  KeyRound,
  Laptop,
  Moon,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Switch,
  cn,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AiScope, IndexStatus, Settings, Theme } from "@/lib/types";
import { applyTheme, type ThemeChoice } from "@/lib/theme";
import { formatDate, shortenPath } from "@/lib/utils";

const PROVIDER_ICONS: Record<string, typeof Sparkles> = {
  pollinations: Cloud,
  gemini: Sparkles,
  openrouter: Sparkles,
  groq: Cpu,
  huggingface: Cloud,
  ollama: Laptop,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [provider, setProvider] = useState("auto");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [embeddingModel, setEmbeddingModel] = useState("gemini-embedding-001");
  const [consent, setConsent] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [scope, setScope] = useState<AiScope>("ambiguous");
  const [batchSize, setBatchSize] = useState(20);
  const [contentIndex, setContentIndex] = useState(false);
  const [semantic, setSemantic] = useState(true);
  const [automation, setAutomation] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const hydrate = useCallback((data: Settings) => {
    setSettings(data);
    setProvider(data.provider);
    setConsent(data.cloud_consent);
    setAiEnabled(data.ai_enabled);
    setScope(data.ai_scope);
    setBatchSize(data.batch_size);
    setContentIndex(data.content_index_enabled);
    setSemantic(data.semantic_search_enabled);
    setAutomation(data.automation_enabled);
    setTheme(data.theme);
    setOllamaUrl(data.ollama_url);
    setEmbeddingModel(data.embedding_model);
    const selected = data.providers.find((item) => item.id === data.provider);
    setModel(selected?.model ?? "");
    setModels(selected?.models ?? []);
    setApiKey("");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.settings();
      hydrate(data);
      setIndexStatus(await api.indexStatus().catch(() => null));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedProvider = useMemo(
    () => settings?.providers.find((item) => item.id === provider) ?? null,
    [settings, provider],
  );

  const isCloud = selectedProvider?.kind === "cloud";
  const needsKey = Boolean(
    selectedProvider && selectedProvider.kind === "cloud" && selectedProvider.id !== "pollinations",
  );
  const keyConfigured = Boolean(
    selectedProvider && settings?.api_keys_configured[selectedProvider.id],
  );

  function chooseProvider(id: string) {
    setProvider(id);
    setTestResult(null);
    const meta = settings?.providers.find((item) => item.id === id);
    setModel(meta?.model ?? "");
    setModels(meta?.models ?? []);
    setApiKey("");
  }

  async function loadModels() {
    if (!provider || provider === "auto" || provider === "rules") return;
    setLoadingModels(true);
    setError(null);
    try {
      const result = await api.models(provider);
      setModels(result.models);
      setNotice(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingModels(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const result = await api.testAI(provider === "auto" ? undefined : provider);
      setTestResult(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const patch: Parameters<typeof api.updateSettings>[0] = {
        provider,
        ai_enabled: aiEnabled,
        ai_scope: scope,
        cloud_consent: consent,
        content_index_enabled: contentIndex,
        semantic_search_enabled: semantic,
        automation_enabled: automation,
        ollama_url: ollamaUrl,
        embedding_model: embeddingModel,
        batch_size: batchSize,
        theme,
      };
      if (provider !== "auto" && provider !== "rules" && model.trim()) {
        patch.models = { [provider]: model.trim() };
      }
      if (needsKey && apiKey.trim()) {
        patch.api_keys = { [provider]: apiKey.trim() };
      }
      const updated = await api.updateSettings(patch);
      hydrate(updated);
      setNotice("Settings saved locally on this computer.");
      applyTheme(theme);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function clearIndex() {
    setClearing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.clearIndex();
      setNotice(result.message);
      setConfirmClear(false);
      setIndexStatus(await api.indexStatus());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClearing(false);
    }
  }

  function chooseTheme(value: Theme) {
    setTheme(value);
    applyTheme(value as ThemeChoice);
  }

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-24">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Settings"
        description="Everything is stored locally. API keys never leave this computer except when calling the provider you selected."
        actions={
          <Button onClick={() => void save()} loading={saving}>
            <Save className="h-4 w-4" /> Save settings
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" title="Settings could not be updated">
          {error}
        </Alert>
      ) : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {testResult ? (
        <Alert variant={testResult.ok ? "success" : "warning"} title={testResult.ok ? "Connection works" : "Not ready"}>
          {testResult.message}
        </Alert>
      ) : null}

      {settings ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> AI provider
              </CardTitle>
              <CardDescription>
                Use a free hosted model with no local installation, or run everything locally with Ollama. Rules keep
                working when AI is unavailable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[{ id: "auto", label: "Automatic", kind: "auto", description: "Pick local Ollama if it is running, otherwise the first ready cloud provider.", configured: true, free: true, model: "", signup_url: null, models: [], selected: false }, { id: "rules", label: "Rules only", kind: "rules", description: "Never call AI. Deterministic extension rules and your saved categories only.", configured: true, free: true, model: "", signup_url: null, models: [], selected: false }, ...settings.providers].map((item) => {
                  const Icon = PROVIDER_ICONS[item.id] ?? Sparkles;
                  const active = provider === item.id;
                  const configured = "configured" in item ? item.configured : true;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => chooseProvider(item.id)}
                      className={cn(
                        "rounded-xl border p-4 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30"
                          : "border-border hover:border-primary/40 hover:bg-muted/40",
                      )}
                      aria-pressed={active}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <Icon className="h-4 w-4" /> {item.label}
                        </span>
                        {item.id === "pollinations" ? (
                          <Badge variant="success">No key</Badge>
                        ) : item.kind === "local" ? (
                          <Badge variant="secondary">Local</Badge>
                        ) : configured ? (
                          <Badge variant="default">Ready</Badge>
                        ) : (
                          <Badge variant="outline">Setup</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                      {item.kind === "cloud" ? (
                        <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Filenames only · no contents
                        </p>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">Enable AI suggestions</p>
                  <p className="text-xs text-muted-foreground">
                    When off, LazyDesk classifies files with deterministic rules only.
                  </p>
                </div>
                <Switch checked={aiEnabled} onCheckedChange={setAiEnabled} label="Enable AI suggestions" />
              </div>

              {provider !== "auto" && provider !== "rules" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <div className="flex gap-2">
                      <Input
                        id="model"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="Model identifier"
                        spellCheck={false}
                        list="model-options"
                      />
                      <datalist id="model-options">
                        {models.map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </datalist>
                      <Button variant="outline" onClick={() => void loadModels()} loading={loadingModels}>
                        <RefreshCw className="h-4 w-4" /> Models
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Suggested: {selectedProvider?.models.slice(0, 3).join(", ") || "—"}
                    </p>
                  </div>

                  {needsKey ? (
                    <div className="space-y-2">
                      <Label htmlFor="api-key" className="flex items-center gap-1.5">
                        <KeyRound className="h-3.5 w-3.5" /> API key
                        {keyConfigured ? <Badge variant="success">Saved</Badge> : null}
                      </Label>
                      <Input
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={keyConfigured ? "Saved — leave blank to keep" : "Paste a free API key"}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {selectedProvider?.signup_url ? (
                        <a
                          href={selectedProvider.signup_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Get a free key <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  ) : provider === "ollama" ? (
                    <div className="space-y-2">
                      <Label htmlFor="ollama-url">Ollama URL</Label>
                      <Input
                        id="ollama-url"
                        value={ollamaUrl}
                        onChange={(event) => setOllamaUrl(event.target.value)}
                        spellCheck={false}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional local fallback. Install from ollama.com, then run <code className="code-chip">ollama pull qwen2.5:7b</code>.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-success/25 bg-success/5 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <CheckCircle2 className="h-4 w-4 text-success" /> No API key needed
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pollinations anonymous access is rate limited to roughly one request every 30 seconds. Add a free
                        pollen key later for higher limits.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {isCloud ? (
                <label className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
                  <Checkbox
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-sm font-medium">Allow cloud AI processing (filenames only)</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      LazyDesk sends only file names, extensions and sizes to the selected provider. It
                      never sends file contents or full folder paths, and never requires a cloud account for the rest of
                      the app. You can revoke this at any time.
                    </span>
                  </span>
                </label>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ai-scope-setting">When to ask AI</Label>
                  <Select
                    id="ai-scope-setting"
                    value={scope}
                    onChange={(event) => setScope(event.target.value as AiScope)}
                  >
                    <option value="ambiguous">Only ambiguous files (recommended)</option>
                    <option value="all">Every file</option>
                    <option value="none">Never (rules only)</option>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="batch-size">Files per AI request</Label>
                  <Input
                    id="batch-size"
                    type="number"
                    min={1}
                    max={30}
                    value={batchSize}
                    onChange={(event) => setBatchSize(Number(event.target.value) || 1)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Smaller batches finish faster on rate-limited free tiers.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => void testConnection()} loading={testing}>
                  <RefreshCw className="h-4 w-4" /> Test connection
                </Button>
                <Button onClick={() => void save()} loading={saving}>
                  <Save className="h-4 w-4" /> Save AI settings
                </Button>
                <span className="text-xs text-muted-foreground">
                  Active:{" "}
                  {settings.status.ready
                    ? `${settings.status.active} · ${settings.status.model}`
                    : settings.status.message}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-success" /> Privacy & indexing
                </CardTitle>
                <CardDescription>Search and automation defaults. Both are conservative.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Index file text for semantic search</p>
                    <p className="text-xs text-muted-foreground">
                      When off, only filenames and metadata are embedded. When on, short text excerpts from supported
                      text files are embedded locally or by your chosen provider. Nothing is uploaded unless cloud AI is
                      enabled above.
                    </p>
                  </div>
                  <Switch
                    checked={contentIndex}
                    onCheckedChange={setContentIndex}
                    label="Index file text"
                  />
                </div>
                <div className="flex items-start justify-between gap-3 border-t border-border pt-4">
                  <div>
                    <p className="text-sm font-medium">Use embeddings to rerank search</p>
                    <p className="text-xs text-muted-foreground">
                      Requires Gemini or Ollama. Metadata search always works without it.
                    </p>
                  </div>
                  <Switch checked={semantic} onCheckedChange={setSemantic} label="Semantic reranking" />
                </div>
                <div className="flex items-start justify-between gap-3 border-t border-border pt-4">
                  <div>
                    <p className="text-sm font-medium">Scheduled automation</p>
                    <p className="text-xs text-muted-foreground">
                      Global switch for saved rules. Review-first is the default per rule.
                    </p>
                  </div>
                  <Switch checked={automation} onCheckedChange={setAutomation} label="Scheduled automation" />
                </div>
                <div className="space-y-2 border-t border-border pt-4">
                  <Label htmlFor="embedding-model">Embedding model</Label>
                  <Input
                    id="embedding-model"
                    value={embeddingModel}
                    onChange={(event) => setEmbeddingModel(event.target.value)}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Examples: <code className="code-chip">gemini-embedding-001</code> or{" "}
                    <code className="code-chip">nomic-embed-text</code> (Ollama).
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" /> Local data
                </CardTitle>
                <CardDescription>Indexes live in the app data folder, never in your organized folders.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data folder</p>
                  <p className="mt-1 break-all font-mono text-[11px]" title={settings.data_dir}>
                    {shortenPath(settings.data_dir, 72)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Embedding index
                  </p>
                  <p className="mt-1 text-sm">
                    {indexStatus?.indexed ?? 0} file(s) embedded
                    {indexStatus?.last_indexed_at
                      ? ` · last built ${formatDate(indexStatus.last_indexed_at)}`
                      : ""}
                  </p>
                </div>
                {confirmClear ? (
                  <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-sm font-medium">Clear the local embedding index?</p>
                    <p className="text-xs text-muted-foreground">
                      File metadata and operation history are kept. Only search vectors are removed.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" onClick={() => void clearIndex()} loading={clearing}>
                        Clear index
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmClear(true)}>
                    <Trash2 className="h-4 w-4" /> Clear local index
                  </Button>
                )}
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                  Operation history is intentionally kept after clearing the index so recent moves remain undoable.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Choose how LazyDesk looks on this computer.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { value: "light" as Theme, label: "Light", icon: Sun },
                  { value: "dark" as Theme, label: "Dark", icon: Moon },
                  { value: "system" as Theme, label: "System", icon: Laptop },
                ].map((option) => {
                  const Icon = option.icon;
                  const active = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => chooseTheme(option.value)}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 text-sm font-medium transition-colors",
                        active ? "border-primary bg-primary/[0.06]" : "border-border hover:bg-muted",
                      )}
                    >
                      <Icon className="h-4 w-4" /> {option.label}
                      {active ? <CheckCircle2 className="ml-auto h-4 w-4 text-primary" /> : null}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={saving} size="lg">
              <Save className="h-4 w-4" /> Save settings
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
