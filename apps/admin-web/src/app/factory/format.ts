export function money(value: number | null | undefined): string {
  if (value == null) return "UNKNOWN";
  return `$${value.toFixed(4)}`;
}

export function metricLabel(metric: { status: string; value: number | null } | undefined): string {
  if (!metric || metric.status !== "AVAILABLE") return metric?.status ?? "NOT_AVAILABLE";
  return String(metric.value);
}

export function perAdopted(cost: number | null | undefined, adopted: number): string {
  if (adopted <= 0) return "N/A";
  if (cost == null) return "UNKNOWN";
  return `$${(cost / adopted).toFixed(4)}`;
}

export function countLabel(value: number | null | undefined): string {
  if (value == null) return "UNKNOWN";
  return String(value);
}
