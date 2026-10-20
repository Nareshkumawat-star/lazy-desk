// Shared API contract between the Next.js UI and the Python service.
// Keep these in sync with services/organizer/organizer/schemas.py.

export type AiScope = "none" | "ambiguous" | "all";
export type Theme = "light" | "dark" | "system";

export interface Session {
  id: number;
  root_path: string;
  status: string;
  source: string;
  file_count: number;
  total_bytes: number;
  skipped_count: number;
  ai_provider: string | null;
  ai_model: string | null;
  ai_used: boolean;
  created_at: string;
  warnings: string[];
}

export interface ScannedFile {
  id: number;
  path: string;
  name: string;
  extension: string;
  size: number;
  modified_at: string | null;
  category: string | null;
  confidence: number | null;
  reason: string | null;
  source: string;
  content_hash: string | null;
}

export interface ScanResponse {
  session: Session;
  files: ScannedFile[];
  skipped: number;
  errors: string[];
  truncated: boolean;
  excluded_dirs: string[];
}

export interface CategoryCount {
  category: string;
  count: number;
  bytes: number;
}

export interface CategorizeResponse {
  session: Session;
  files: ScannedFile[];
  categories: CategoryCount[];
  ai_used: boolean;
  provider: string | null;
  model: string | null;
  warnings: string[];
}

export interface PlanItem {
  operation_id: number;
  file_id: number | null;
  name: string;
  source_path: string;
  destination_path: string;
  category: string;
  reason: string | null;
  confidence: number | null;
  classification_source: string;
  conflict: boolean;
  conflict_reason: string | null;
  status: string;
}

export interface CategorySummary {
  category: string;
  count: number;
  bytes: number;
  folder: string;
}

export interface PlanResponse {
  session_id: number;
  items: PlanItem[];
  categories: CategorySummary[];
  unchanged: number;
  ai_used: boolean;
  provider: string | null;
  model: string | null;
  warnings: string[];
}

export interface PreviewResponse {
  session_id: number;
  items: PlanItem[];
  conflicts: number;
  missing: string[];
  unchanged: number;
  can_apply: boolean;
  warnings: string[];
}

export interface Operation {
  id: number;
  source_path: string;
  destination_path: string;
  final_destination: string | null;
  category: string | null;
  reason: string | null;
  confidence: number | null;
  status: string;
  error: string | null;
  batch_id: string | null;
}

export interface ApplyResponse {
  batch_id: string | null;
  applied: number;
  failed: number;
  skipped: number;
  items: Operation[];
  errors: string[];
  message: string;
}

export interface UndoResponse {
  batch_id: string | null;
  restored: number;
  failed: number;
  errors: string[];
  message: string;
}

export interface HistoryBatch {
  id: string;
  session_id: number | null;
  root_path: string | null;
  status: string;
  applied_count: number;
  failed_count: number;
  undone_count: number;
  created_at: string;
  operations: Operation[];
}

export interface HistoryResponse {
  batches: HistoryBatch[];
  total: number;
}

export interface DuplicateFile {
  path: string;
  name: string;
  size: number;
  modified_at: string | null;
}

export interface DuplicateGroup {
  hash: string;
  size: number;
  count: number;
  potential_savings: number;
  files: DuplicateFile[];
}

export interface DuplicatesResponse {
  root: string;
  groups: DuplicateGroup[];
  scanned_files: number;
  hashed_files: number;
  potential_savings: number;
  duration_ms: number;
  skipped: number;
  errors: string[];
}

export interface SearchFilters {
  category: string | null;
  extensions: string[];
  keywords: string[];
  min_size_mb: number | null;
  max_size_mb: number | null;
  modified_within_days: number | null;
}

export interface SearchHit {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified_at: string | null;
  category: string | null;
  score: number;
  match_reason: string;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  total: number;
  filters: SearchFilters;
  semantic: boolean;
  provider: string | null;
  message: string;
}

export interface Provider {
  id: string;
  label: string;
  kind: "cloud" | "local" | string;
  free: boolean;
  configured: boolean;
  model: string;
  description: string;
  signup_url: string | null;
  models: string[];
  selected: boolean;
}

export interface AIStatus {
  active: string | null;
  model: string | null;
  ready: boolean;
  message: string;
  requested: string;
  rules_available: boolean;
}

export interface Settings {
  provider: string;
  ai_enabled: boolean;
  ai_scope: AiScope;
  cloud_consent: boolean;
  content_index_enabled: boolean;
  semantic_search_enabled: boolean;
  automation_enabled: boolean;
  ollama_url: string;
  embedding_model: string;
  batch_size: number;
  theme: Theme;
  data_dir: string;
  api_keys_configured: Record<string, boolean>;
  providers: Provider[];
  status: AIStatus;
}

export interface SettingsPatch {
  provider?: string;
  ai_enabled?: boolean;
  ai_scope?: AiScope;
  cloud_consent?: boolean;
  content_index_enabled?: boolean;
  semantic_search_enabled?: boolean;
  automation_enabled?: boolean;
  ollama_url?: string;
  embedding_model?: string;
  batch_size?: number;
  theme?: Theme;
  models?: Record<string, string>;
  api_keys?: Record<string, string>;
}

export interface Dashboard {
  files_indexed: number;
  total_bytes: number;
  sessions: number;
  pending_moves: number;
  duplicate_groups: number;
  duplicate_bytes: number;
  duplicate_scanned_at: string | null;
  recent_sessions: Session[];
  recent_batches: HistoryBatch[];
  ai: AIStatus;
}

export interface AutomationRule {
  id: number;
  name: string;
  root_path: string;
  enabled: boolean;
  interval_minutes: number;
  auto_apply: boolean;
  categories: string[] | null;
  last_run_at: string | null;
  last_session_id: number | null;
  last_result: string | null;
  next_run_at: string | null;
}

export interface AutomationOverview {
  enabled: boolean;
  rules: AutomationRule[];
  status: {
    enabled: boolean;
    rules: number;
    active_rules: number;
    last_run_at: string | null;
    message: string;
  };
}

export interface AutomationRunResponse {
  rule_id: number;
  session_id: number | null;
  status: string;
  planned: number;
  applied: number;
  message: string;
}

export interface PendingAutomation {
  session: Session;
  planned: number;
}

export interface IndexStatus {
  indexed: number;
  content_indexed: number;
  last_indexed_at: string | null;
}

export interface ApiMessage {
  message: string;
  ok?: boolean;
}

export interface AIStatusResponse {
  active: string | null;
  model: string | null;
  ready: boolean;
  message: string;
  requested: string;
  rules_available: boolean;
}
