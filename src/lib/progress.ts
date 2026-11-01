/** Deliverable progress: not started → in progress → delivered. */
export type Progress = "not_started" | "in_progress" | "delivered";
export const PROGRESS: { value: Progress; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "delivered", label: "Delivered" },
];
export const progressLabel = (p: Progress | undefined) => PROGRESS.find((x) => x.value === (p ?? "not_started"))!.label;

/** Overall progress: delivered counts 1, in progress counts ½. */
export function progressSummary(items: { progress?: Progress }[]) {
  const total = items.length;
  const delivered = items.filter((d) => d.progress === "delivered").length;
  const inProgress = items.filter((d) => d.progress === "in_progress").length;
  const pct = total ? Math.round(((delivered + inProgress / 2) / total) * 100) : 0;
  return { total, delivered, inProgress, pct, label: total ? `${delivered} of ${total} delivered` : "No deliverables" };
}
