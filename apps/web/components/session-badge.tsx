import { Badge } from "./ui";

const LABELS: Record<string, string> = {
  scanned: "Scanned",
  planned: "Plan ready",
  applied: "Applied",
  partial: "Partial",
  undone: "Undone",
  failed: "Failed",
  pending_review: "Needs review",
  conflict: "Conflict",
  missing: "Missing file",
  skipped: "Skipped",
  proposed: "Proposed",
};

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "applied" || status === "undone"
      ? "success"
      : status === "partial" || status === "pending_review" || status === "planned"
        ? "warning"
        : status === "failed" || status === "conflict" || status === "missing"
          ? "destructive"
          : "secondary";
  return <Badge variant={variant}>{LABELS[status] ?? status}</Badge>;
}
