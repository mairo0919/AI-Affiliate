export type LogLevel = "debug" | "info" | "warn" | "error";

export type ResearchSource = "tiktok" | "x" | "fanza";

export interface ResearchTarget {
  source: ResearchSource;
  query: string;
}
