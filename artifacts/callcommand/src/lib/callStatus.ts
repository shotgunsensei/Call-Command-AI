// Phase 2 introduced telephony-specific call statuses (incoming, ringing,
// in_progress, recording_ready, transcribing, analyzing, flow_running,
// completed, failed, busy, no_answer) on top of the original Phase 1
// values (queued, processing, ready, error). The UI only needs three
// buckets — pending, ready, error — so this mapper collapses everything
// into those for badge styling and progress messaging.

export type DisplayStatus = "pending" | "ready" | "error";

const READY_STATUSES = new Set(["ready", "completed"]);
const ERROR_STATUSES = new Set([
  "error",
  "failed",
  "busy",
  "no_answer",
  "canceled",
]);

export function toDisplayStatus(raw: string | null | undefined): DisplayStatus {
  if (!raw) return "pending";
  if (READY_STATUSES.has(raw)) return "ready";
  if (ERROR_STATUSES.has(raw)) return "error";
  return "pending";
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  incoming: "Ringing",
  ringing: "Ringing",
  in_progress: "On the line",
  recording_ready: "Recording received",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  flow_running: "Running flow",
  processing: "Processing",
  completed: "Ready",
  ready: "Ready",
  error: "Error",
  failed: "Failed",
  busy: "Busy",
  no_answer: "No answer",
  canceled: "Canceled",
};

export function statusLabel(raw: string | null | undefined): string {
  if (!raw) return "Pending";
  return STATUS_LABELS[raw] ?? raw;
}

export function statusBadgeClass(raw: string | null | undefined): string {
  const display = toDisplayStatus(raw);
  if (display === "ready")
    return "bg-green-500/15 text-green-400 border-green-500/30";
  if (display === "error")
    return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}
